package com.cpplatform.laboratory;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.io.InputStream;
import java.util.*;
import java.util.zip.GZIPInputStream;

/**
 * Installs the duel problems bundled with the backend (seed/duel-problems.json.gz, built from
 * examples/duel-problems) so a fresh server has duels without a manual import. It follows the bulk
 * import path: import the draft, validate the reference on the judge, approve, add to the duel pool.
 * Validation needs online judges for every language of a problem, so each call advances whatever it
 * can and the schedule retries the rest. Every slug is recorded in seeded_problems and never
 * imported again, and a slug that already exists (imported by hand, for example) is left alone.
 * Steps run as the first super administrator; with none yet, seeding waits.
 */
@Service
public class ProblemSeeder {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ProblemSeeder.class);
    static final String BANK="duel-problems";
    private final Database db;private final LaboratoryService lab;private final ObjectMapper json;private final boolean enabled;
    private List<Map<String,Object>> problems;
    private volatile boolean finished;
    public ProblemSeeder(Database db,LaboratoryService lab,ObjectMapper json,@Value("${cp.seed.duel-problems:true}") boolean enabled) {
        this.db=db;this.lab=lab;this.json=json;this.enabled=enabled;
    }

    /** The bundled bank, read once; the format is the bulk import format (infom4th.problem-bank). */
    @SuppressWarnings("unchecked")
    synchronized List<Map<String,Object>> bank() {
        if(problems==null) {
            var resource=new ClassPathResource("seed/"+BANK+".json.gz");
            if(!resource.exists())return problems=List.of();
            try(InputStream in=new GZIPInputStream(resource.getInputStream())) {
                Map<String,Object> bank=json.readValue(in,new TypeReference<Map<String,Object>>(){});
                problems=(List<Map<String,Object>>)bank.get("problems");
            } catch(Exception e) {throw new IllegalStateException("Bundled problem bank seed/"+BANK+".json.gz is unreadable",e);}
        }
        return problems;
    }

    /** Advances every bundled problem one step; cheap once all of them are settled. */
    public void tick() {
        if(!enabled || finished)return;
        var admins=db.jdbc.queryForList("SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role_code='SUPER_ADMIN' ORDER BY u.created_at LIMIT 1",UUID.class);
        if(admins.isEmpty())return;
        Actor actor=new Actor(admins.get(0),Set.of("SUPER_ADMIN"));
        boolean pending=false;
        for(var problem:bank()) {
            String slug=(String)problem.get("slug");
            try {
                pending|=step(actor,slug,problem);
            } catch(ResponseStatusException|DataAccessException e) {
                // Usually another API instance took the same step, or no judge is online yet: retried next time.
                log.debug("Seeding {} waits: {}",slug,e.getMessage());pending=true;
            }
        }
        if(!pending){finished=true;log.info("Bundled {} problems are installed",BANK);}
    }

    /** One step for one problem; true while it still needs work. */
    private boolean step(Actor actor,String slug,Map<String,Object> problem) {
        var seeded=db.jdbc.queryForList("SELECT * FROM seeded_problems WHERE slug=?",slug);
        if(seeded.isEmpty()) {
            if(db.exists("SELECT EXISTS(SELECT 1 FROM problems WHERE slug=?)",slug)) {
                record(slug,null,"SKIPPED","A problem with this short name already existed");return false;
            }
            UUID version=(UUID)lab.importProblem(actor,problem).get("versionId");
            record(slug,version,"IMPORTED",null);
            log.info("Seeded duel problem {} as a draft",slug);
            return true;
        }
        var row=seeded.get(0);
        if(!"IMPORTED".equals(row.get("status")))return false;
        UUID version=(UUID)row.get("problem_version_id");
        var v=db.one("SELECT v.status,p.archived_at,(SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.created_at DESC LIMIT 1) AS validation "
                +"FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=?",version);
        if(v.get("archived_at")!=null){record(slug,version,"FAILED","Deleted in the lab before it was installed");return false;}
        switch((String)v.get("status")) {
            case "DRAFT" -> lab.validate(actor,version);
            case "IN_TESTING" -> {
                if(List.of("FAILED","JUDGE_ERROR").contains(v.get("validation"))) {
                    record(slug,version,"FAILED","Reference validation "+v.get("validation")+"; open the problem in the lab");
                    log.warn("Seeded duel problem {} failed validation ({})",slug,v.get("validation"));return false;
                }
            }
            case "READY_FOR_REVIEW" -> lab.approve(actor,version,"Bundled duel problem: the reference passed every test");
            case "APPROVED","PUBLISHED" -> {
                lab.publishDuel(actor,version);
                record(slug,version,"DONE",null);
                log.info("Seeded duel problem {} is in the duel pool",slug);return false;
            }
            default -> {record(slug,version,"FAILED","Stopped in state "+v.get("status"));return false;}
        }
        return true;
    }

    private void record(String slug,UUID version,String status,String detail) {
        // SKIPPED never overwrites: another API instance may have just imported this slug itself.
        db.jdbc.update("INSERT INTO seeded_problems(slug,bank,problem_version_id,status,detail) VALUES (?,?,?,?,?) "
                +("SKIPPED".equals(status)?"ON CONFLICT(slug) DO NOTHING":"ON CONFLICT(slug) DO UPDATE SET problem_version_id=coalesce(excluded.problem_version_id,seeded_problems.problem_version_id),status=excluded.status,detail=excluded.detail,updated_at=now()"),
                slug,BANK,version,status,detail);
    }
}
