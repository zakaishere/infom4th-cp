package com.cpplatform.laboratory;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.io.InputStream;
import java.util.*;
import java.util.zip.GZIPInputStream;

/**
 * Installs the problem banks bundled with the backend so a fresh server has them without a manual
 * import: seed/duel-problems.json.gz (examples/duel-problems) goes to the duel pool, and
 * seed/td-problems.json.gz (examples/td-problems) goes to the academic TD section of practice, in
 * the TD and at the position each problem names. It follows the bulk import path: import the draft,
 * validate the reference on the judge, approve, publish.
 * Validation needs online judges for every language of a problem, so each call advances whatever it
 * can and the schedule retries the rest. Every slug is recorded in seeded_problems and never
 * imported again, and a slug that already exists (imported by hand, for example) is left alone.
 * Steps run as the first super administrator; with none yet, seeding waits.
 */
@Service
public class ProblemSeeder {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ProblemSeeder.class);
    static final String DUEL="duel-problems",TD="td-problems";
    private final Database db;private final LaboratoryService lab;private final ObjectMapper json;private final List<String> banks;
    private final Map<String,List<Map<String,Object>>> loaded=new HashMap<>();
    private volatile boolean finished;
    @Autowired
    public ProblemSeeder(Database db,LaboratoryService lab,ObjectMapper json,@Value("${cp.seed.duel-problems:true}") boolean duels,
                         @Value("${cp.seed.td-problems:true}") boolean td) {
        this(db,lab,json,banks(duels,td));
    }
    /** Seeds the duel bank only (tests). */
    public ProblemSeeder(Database db,LaboratoryService lab,ObjectMapper json,boolean duels) {this(db,lab,json,banks(duels,false));}
    public ProblemSeeder(Database db,LaboratoryService lab,ObjectMapper json,List<String> banks) {
        this.db=db;this.lab=lab;this.json=json;this.banks=List.copyOf(banks);
    }
    private static List<String> banks(boolean duels,boolean td) {
        var list=new ArrayList<String>();if(duels)list.add(DUEL);if(td)list.add(TD);return list;
    }

    /** A bundled bank, read once; the format is the bulk import format (infom4th.problem-bank). */
    @SuppressWarnings("unchecked")
    synchronized List<Map<String,Object>> bank(String name) {
        return loaded.computeIfAbsent(name,key->{
            var resource=new ClassPathResource("seed/"+key+".json.gz");
            if(!resource.exists())return List.of();
            try(InputStream in=new GZIPInputStream(resource.getInputStream())) {
                Map<String,Object> bank=json.readValue(in,new TypeReference<Map<String,Object>>(){});
                return (List<Map<String,Object>>)bank.get("problems");
            } catch(Exception e) {throw new IllegalStateException("Bundled problem bank seed/"+key+".json.gz is unreadable",e);}
        });
    }

    /** Advances every bundled problem one step; cheap once all of them are settled. */
    public void tick() {
        if(banks.isEmpty() || finished)return;
        var admins=db.jdbc.queryForList("SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role_code='SUPER_ADMIN' ORDER BY u.created_at LIMIT 1",UUID.class);
        if(admins.isEmpty())return;
        Actor actor=new Actor(admins.get(0),Set.of("SUPER_ADMIN"));
        boolean pending=false;
        for(String name:banks) for(var problem:bank(name)) {
            String slug=(String)problem.get("slug");
            try {
                pending|=step(actor,name,slug,problem);
            } catch(ResponseStatusException|DataAccessException e) {
                // Usually another API instance took the same step, or no judge is online yet: retried next time.
                log.debug("Seeding {} waits: {}",slug,e.getMessage());pending=true;
            }
        }
        if(!pending){finished=true;log.info("Bundled problem banks {} are installed",banks);}
    }

    /** One step for one problem; true while it still needs work. */
    private boolean step(Actor actor,String bank,String slug,Map<String,Object> problem) {
        var seeded=db.jdbc.queryForList("SELECT * FROM seeded_problems WHERE slug=?",slug);
        if(seeded.isEmpty()) {
            if(db.exists("SELECT EXISTS(SELECT 1 FROM problems WHERE slug=?)",slug)) {
                record(bank,slug,null,"SKIPPED","A problem with this short name already existed");return false;
            }
            UUID version=(UUID)lab.importProblem(actor,problem).get("versionId");
            record(bank,slug,version,"IMPORTED",null);
            log.info("Seeded {} problem {} as a draft",bank,slug);
            return true;
        }
        var row=seeded.get(0);
        if(!"IMPORTED".equals(row.get("status")))return false;
        UUID version=(UUID)row.get("problem_version_id");
        var v=db.one("SELECT v.status,p.archived_at,(SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.created_at DESC LIMIT 1) AS validation "
                +"FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=?",version);
        if(v.get("archived_at")!=null){record(bank,slug,version,"FAILED","Deleted in the lab before it was installed");return false;}
        switch((String)v.get("status")) {
            case "DRAFT" -> lab.validate(actor,version);
            case "IN_TESTING" -> {
                if(List.of("FAILED","JUDGE_ERROR").contains(v.get("validation"))) {
                    record(bank,slug,version,"FAILED","Reference validation "+v.get("validation")+"; open the problem in the lab");
                    log.warn("Seeded {} problem {} failed validation ({})",bank,slug,v.get("validation"));return false;
                }
            }
            case "READY_FOR_REVIEW" -> lab.approve(actor,version,"Bundled "+bank+" problem: the reference passed every test");
            case "APPROVED","PUBLISHED" -> {
                if(TD.equals(bank))publishTd(actor,version,problem);
                else lab.publishDuel(actor,version);
                record(bank,slug,version,"DONE",null);
                log.info("Seeded {} problem {} is published",bank,slug);return false;
            }
            default -> {record(bank,slug,version,"FAILED","Stopped in state "+v.get("status"));return false;}
        }
        return true;
    }

    /** Publishes to practice, inside the TD and at the position the bank gives, with its topics. */
    private void publishTd(Actor actor,UUID version,Map<String,Object> problem) {
        lab.publishPractice(actor,version,problem.containsKey("td")?problem:Map.of("td",Map.of("number",1)));
    }

    private void record(String bank,String slug,UUID version,String status,String detail) {
        // SKIPPED never overwrites: another API instance may have just imported this slug itself.
        db.jdbc.update("INSERT INTO seeded_problems(slug,bank,problem_version_id,status,detail) VALUES (?,?,?,?,?) "
                +("SKIPPED".equals(status)?"ON CONFLICT(slug) DO NOTHING":"ON CONFLICT(slug) DO UPDATE SET problem_version_id=coalesce(excluded.problem_version_id,seeded_problems.problem_version_id),status=excluded.status,detail=excluded.detail,updated_at=now()"),
                slug,bank,version,status,detail);
    }
}
