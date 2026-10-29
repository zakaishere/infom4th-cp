package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/**
 * Public practice set: the catalog with community statistics and the caller's own status,
 * plus organizer management (tags, visibility). Statistics count real submissions only:
 * "run examples" submissions (samples_only) and rejudged generations never inflate them.
 */
@Service
public class PracticeService {
    private final Database db;private final Permissions access;
    public PracticeService(Database db,Permissions access){this.db=db;this.access=access;}

    /** Latest verdict of every counted practice submission, by problem (any published version). */
    private static final String RESULTS="WITH res AS (SELECT v2.problem_id,s.submitted_by,r.verdict FROM submissions s "
            +"JOIN problem_versions v2 ON v2.id=s.problem_version_id "
            +"JOIN LATERAL (SELECT j.id FROM judging_jobs j WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) j ON true "
            +"JOIN judging_results r ON r.job_id=j.id WHERE s.context='PRACTICE' AND NOT s.samples_only) ";
    private static final String COLUMNS="pp.problem_id,v.id,v.title,p.slug,v.difficulty,pp.tags,pp.hidden,pp.published_at,v.time_limit_ms,v.memory_limit_mb,"
            +"(SELECT count(DISTINCT submitted_by) FROM res WHERE res.problem_id=pp.problem_id AND verdict='ACCEPTED') AS solved_by,"
            +"(SELECT count(DISTINCT submitted_by) FROM res WHERE res.problem_id=pp.problem_id) AS tried_by,"
            +"(SELECT count(*) FROM res WHERE res.problem_id=pp.problem_id) AS submissions,"
            +"(SELECT count(*) FROM res WHERE res.problem_id=pp.problem_id AND verdict='ACCEPTED') AS accepted,"
            +"(SELECT CASE WHEN bool_or(verdict='ACCEPTED') THEN 'SOLVED' WHEN count(*)>0 THEN 'TRIED' END FROM res WHERE res.problem_id=pp.problem_id AND res.submitted_by=?) AS my_status ";

    /** JDBC returns text[] as java.sql.Array; JSON needs a plain list. */
    private static List<Map<String,Object>> plain(List<Map<String,Object>> rows) {
        for(var row:rows) if(row.get("tags") instanceof java.sql.Array array) {
            try{row.put("tags",List.of((String[])array.getArray()));}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
        }
        return rows;
    }

    public List<Map<String,Object>> catalog(Actor actor) {
        return plain(db.jdbc.queryForList(RESULTS+"SELECT "+COLUMNS+"FROM practice_publications pp JOIN problem_versions v ON v.id=pp.problem_version_id "
                +"JOIN problems p ON p.id=pp.problem_id WHERE NOT pp.hidden ORDER BY pp.published_at DESC LIMIT 1000",actor.id()));
    }

    public Map<String,Object> stats(Actor actor,UUID version) {
        var rows=plain(db.jdbc.queryForList(RESULTS+"SELECT "+COLUMNS+"FROM practice_publications pp JOIN problem_versions v ON v.id=pp.problem_version_id "
                +"JOIN problems p ON p.id=pp.problem_id WHERE pp.problem_version_id=? AND NOT pp.hidden",actor.id(),version));
        Api.require(!rows.isEmpty(),HttpStatus.NOT_FOUND,"Practice problem not found");
        return rows.get(0);
    }

    /** Organizer view: every publication (hidden ones too) and approved problems not yet published. */
    public Map<String,Object> manage(Actor actor) {
        access.organizer(actor);
        var published=plain(db.jdbc.queryForList(RESULTS+"SELECT "+COLUMNS+"FROM practice_publications pp JOIN problem_versions v ON v.id=pp.problem_version_id "
                +"JOIN problems p ON p.id=pp.problem_id ORDER BY pp.published_at DESC",actor.id()));
        var candidates=db.jdbc.queryForList("SELECT v.id AS version_id,v.title,p.slug,v.difficulty,v.status,v.version_number FROM problem_versions v JOIN problems p ON p.id=v.problem_id "
                +"WHERE v.status IN ('APPROVED','PUBLISHED') AND p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM practice_publications pp WHERE pp.problem_version_id=v.id) ORDER BY v.created_at DESC LIMIT 500");
        return Map.of("published",published,"candidates",candidates,"tags",allTags());
    }

    public List<String> allTags() {
        return db.jdbc.queryForList("SELECT DISTINCT unnest(tags) AS tag FROM practice_publications WHERE NOT hidden ORDER BY 1",String.class);
    }

    @Transactional
    public void update(Actor actor,UUID problem,Map<String,Object> body) {
        access.organizer(actor);
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM practice_publications WHERE problem_id=?)",problem),HttpStatus.NOT_FOUND,"Not a practice problem");
        if(body.containsKey("tags")) {
            Api.require(body.get("tags") instanceof List<?>,HttpStatus.BAD_REQUEST,"tags must be a list");
            LinkedHashSet<String> tags=new LinkedHashSet<>();
            for(Object raw:(List<?>)body.get("tags")) {
                String tag=String.valueOf(raw).trim().toLowerCase(Locale.ROOT).replaceAll("\\s+"," ");
                if(tag.isEmpty())continue;
                Api.require(tag.matches("[a-z0-9][a-z0-9 +#.-]{0,23}"),HttpStatus.BAD_REQUEST,"Tags use letters, digits, space, + # . - (max 24 characters)");
                tags.add(tag);
            }
            Api.require(tags.size()<=8,HttpStatus.BAD_REQUEST,"At most 8 tags");
            db.jdbc.update("UPDATE practice_publications SET tags=?::text[] WHERE problem_id=?",tags.toArray(new String[0]),problem);
        }
        if(body.containsKey("hidden"))
            db.jdbc.update("UPDATE practice_publications SET hidden=? WHERE problem_id=?",Boolean.TRUE.equals(body.get("hidden")),problem);
        db.audit(actor.id(),"PRACTICE_UPDATE","problem",problem,Api.optional(body,"reason","Practice settings",2000));
    }
}
