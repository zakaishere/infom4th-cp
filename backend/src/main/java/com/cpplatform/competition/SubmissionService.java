package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

@Service
public class SubmissionService {
    private final Database db;private final CompetitionService contests;private final RateLimits limits;
    public SubmissionService(Database db,CompetitionService contests,RateLimits limits){this.db=db;this.contests=contests;this.limits=limits;}
    @Transactional
    public UUID submit(Actor actor,UUID run,Integer slot,UUID practiceVersion,UUID key,Map<String,Object> body) {
        String source=Api.text(body,"sourceCode",262144),language=Api.text(body,"language",24);
        // Serialize only this participant's brief enqueue transaction, not execution.
        db.one("SELECT id FROM users WHERE id=? FOR UPDATE",actor.id());
        var previous=db.jdbc.queryForList("SELECT * FROM submissions WHERE submitted_by=? AND idempotency_key=?",actor.id(),key);
        if(!previous.isEmpty()) {
            var p=previous.get(0);Api.require(Objects.equals(p.get("run_id"),run) && Objects.equals(p.get("problem_slot"),slot)
                    && (run!=null || Objects.equals(p.get("problem_version_id"),practiceVersion))
                    && source.equals(p.get("source_code")) && language.equals(p.get("language_code")),HttpStatus.CONFLICT,"Idempotency key reused for different content");
            return (UUID)p.get("id");
        }
        // Administrator admission settings (judging_settings). The user row lock above makes the
        // per-user checks exact across API instances; replays of an idempotency key never count.
        var admission=db.one("SELECT pending_submissions_per_user,submissions_per_minute,max_queued_submissions FROM judging_settings WHERE id=1");
        long recent=db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE submitted_by=? AND context IN ('CONTEST','PRACTICE') AND submitted_at>clock_timestamp()-interval '60 seconds'",Long.class,actor.id());
        Api.require(recent<((Number)admission.get("submissions_per_minute")).longValue(),HttpStatus.TOO_MANY_REQUESTS,"Too many submissions in the last minute; retry shortly");
        limits.check("submit-global",200,1);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM judging_jobs WHERE status IN ('QUEUED','RUNNING','RETRY') OFFSET ?)",((Number)admission.get("max_queued_submissions")).intValue()-1),
                HttpStatus.TOO_MANY_REQUESTS,"Judge queue is full; retry later");
        long pending=db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.submitted_by=? AND j.status IN ('QUEUED','RUNNING','RETRY')",Long.class,actor.id());
        Api.require(pending<((Number)admission.get("pending_submissions_per_user")).longValue(),HttpStatus.TOO_MANY_REQUESTS,"Too many pending submissions");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM languages WHERE code=? AND enabled)",language),HttpStatus.BAD_REQUEST,"Language is disabled");
        UUID submission,version;
        if(run!=null) {
            var r=contests.runAccess(actor,run,true);
            Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM contest_runs WHERE id=? AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() AND status IN ('PENDING','RUNNING') AND NOT submissions_paused)",run),
                    HttpStatus.CONFLICT,"Contest is not accepting submissions");
            var member=db.one("SELECT entry_id FROM run_entry_members WHERE run_id=? AND user_id=?",run,actor.id());
            var problem=db.one("SELECT cp.problem_version_id FROM competition_problems cp WHERE cp.competition_version_id=? AND slot=?",r.get("competition_version_id"),slot);
            version=(UUID)problem.get("problem_version_id");
            submission=db.id("INSERT INTO submissions(run_id,competition_version_id,entry_id,submitted_by,problem_slot,problem_version_id,language_code,source_code,idempotency_key,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,clock_timestamp()) RETURNING id",
                    run,r.get("competition_version_id"),member.get("entry_id"),actor.id(),slot,version,language,source,key);
        } else {
            Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM practice_publications WHERE problem_version_id=? AND NOT hidden)",practiceVersion),HttpStatus.NOT_FOUND,"Practice problem not found");
            version=practiceVersion;
            // mode=samples: "run examples" judges only the statement's example tests and is not counted.
            boolean samples="samples".equals(body.get("mode"));
            if(samples)Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM test_cases WHERE problem_version_id=? AND is_sample)",version),HttpStatus.CONFLICT,"This problem has no example tests");
            submission=db.id("INSERT INTO submissions(context,submitted_by,problem_version_id,language_code,source_code,idempotency_key,samples_only) VALUES ('PRACTICE',?,?,?,?,?,?) RETURNING id",
                    actor.id(),version,language,source,key,samples);
        }
        db.jdbc.update("INSERT INTO judging_jobs(submission_id,problem_version_id,priority) VALUES (?,?,?)",submission,version,run==null?0:100);
        return submission;
    }
}
