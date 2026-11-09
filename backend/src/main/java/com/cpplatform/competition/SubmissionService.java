package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

@Service
public class SubmissionService {
    /** The newest judging generation of submission s, with its result once there is one. */
    private static final String LATEST="LEFT JOIN LATERAL (SELECT j.status,j.generation,r.verdict,r.execution_time_ms,r.peak_memory_kb,r.passed_tests,r.total_tests FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true ";
    private final Database db;private final CompetitionService contests;private final RateLimits limits;private final Permissions access;
    public SubmissionService(Database db,CompetitionService contests,RateLimits limits,Permissions access){this.db=db;this.contests=contests;this.limits=limits;this.access=access;}
    @Transactional
    public UUID submit(Actor actor,UUID run,Integer slot,UUID practiceVersion,UUID key,Map<String,Object> body) {
        String source=Api.text(body,"sourceCode",262144),language=Api.text(body,"language",24);
        lockUser(actor);
        var previous=db.jdbc.queryForList("SELECT * FROM submissions WHERE submitted_by=? AND idempotency_key=?",actor.id(),key);
        if(!previous.isEmpty()) {
            var p=previous.get(0);Api.require(Objects.equals(p.get("run_id"),run) && Objects.equals(p.get("problem_slot"),slot)
                    && (run!=null || Objects.equals(p.get("problem_version_id"),practiceVersion))
                    && source.equals(p.get("source_code")) && language.equals(p.get("language_code")),HttpStatus.CONFLICT,"Idempotency key reused for different content");
            return (UUID)p.get("id");
        }
        admit(actor,language);
        UUID submission,version;
        if(run!=null) {
            var r=contests.runAccess(actor,run,true);
            Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM contest_runs WHERE id=? AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() AND status IN ('PENDING','RUNNING') AND NOT submissions_paused)",run),
                    HttpStatus.CONFLICT,"Contest is not accepting submissions");
            Api.require(contests.released(r,slot) || access.jury(actor,(UUID)r.get("competition_id")),HttpStatus.FORBIDDEN,"This problem opens on a later day");
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

    /** Serializes only this participant's brief enqueue transaction, not execution. */
    void lockUser(Actor actor){db.one("SELECT id FROM users WHERE id=? FOR UPDATE",actor.id());}
    /**
     * Administrator admission settings (judging_settings), shared by contest, practice and duel submissions.
     * Call after lockUser in the same transaction: the user row lock makes the per-user checks exact across
     * API instances, and replays of an idempotency key never reach here, so they never count.
     */
    void admit(Actor actor,String language) {
        var admission=db.one("SELECT pending_submissions_per_user,submissions_per_minute,max_queued_submissions FROM judging_settings WHERE id=1");
        long recent=db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE submitted_by=? AND context IN ('CONTEST','PRACTICE','DUEL') AND submitted_at>clock_timestamp()-interval '60 seconds'",Long.class,actor.id());
        Api.require(recent<((Number)admission.get("submissions_per_minute")).longValue(),HttpStatus.TOO_MANY_REQUESTS,"Too many submissions in the last minute; retry shortly");
        limits.check("submit-global",200,1);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM judging_jobs WHERE status IN ('QUEUED','RUNNING','RETRY') OFFSET ?)",((Number)admission.get("max_queued_submissions")).intValue()-1),
                HttpStatus.TOO_MANY_REQUESTS,"Judge queue is full; retry later");
        long pending=db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.submitted_by=? AND s.context<>'BENCHMARK' AND j.status IN ('QUEUED','RUNNING','RETRY')",Long.class,actor.id());
        Api.require(pending<((Number)admission.get("pending_submissions_per_user")).longValue(),HttpStatus.TOO_MANY_REQUESTS,"Too many pending submissions");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM languages WHERE code=? AND enabled)",language),HttpStatus.BAD_REQUEST,"Language is disabled");
    }
    /** A submission with its latest judging; visible to its author, their entry's members, the run's jury and super administrators. */
    public Map<String,Object> result(Actor actor,UUID id) {
        var s=db.one("SELECT * FROM submissions WHERE id=?",id);
        boolean allowed=actor.id().equals(s.get("submitted_by")) || actor.superAdmin();
        if(s.get("run_id")!=null) {
            var r=contests.runAccess(actor,(UUID)s.get("run_id"),false);
            allowed=allowed || access.jury(actor,(UUID)r.get("competition_id")) || db.exists("SELECT EXISTS(SELECT 1 FROM run_entry_members WHERE entry_id=? AND user_id=?)",s.get("entry_id"),actor.id());
        }
        Api.require(allowed,HttpStatus.FORBIDDEN,"Submission access denied");
        var result=new LinkedHashMap<String,Object>();
        result.put("submission",s);
        var judging=db.jdbc.queryForList("SELECT j.id AS job_id,j.generation,j.status,j.last_error_code,r.verdict,r.execution_time_ms,r.peak_memory_kb,r.passed_tests,r.total_tests,r.public_feedback FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id WHERE j.submission_id=? ORDER BY j.generation DESC LIMIT 1",id);
        result.put("judging",judging);
        // Per-test verdicts in test order. Hidden test content is never returned; tests after an
        // early stop are reported as not run. Sample tests are marked so contestants can retry them locally.
        if(!judging.isEmpty() && judging.get(0).get("verdict")!=null)
            result.put("cases",db.jdbc.queryForList("SELECT row_number() OVER (ORDER BY g.position,t.position) AS number,t.is_sample AS sample,c.verdict,c.execution_time_ms,c.peak_memory_kb FROM test_cases t JOIN test_case_groups g ON g.id=t.group_id LEFT JOIN test_case_results c ON c.test_case_id=t.id AND c.job_id=? WHERE t.problem_version_id=? AND (t.is_sample OR NOT ?) ORDER BY g.position,t.position",
                    judging.get(0).get("job_id"),s.get("problem_version_id"),Boolean.TRUE.equals(s.get("samples_only"))));
        return result;
    }
    /** The actor's own submissions, newest first; team entries see every member's submissions for the runs they share. */
    public List<Map<String,Object>> history(Actor actor,UUID run,int offset) {
        Api.require(offset>=0 && offset<=1000000,HttpStatus.BAD_REQUEST,"Invalid offset");
        return db.jdbc.queryForList("SELECT s.id,s.context,s.run_id,s.problem_slot,s.problem_version_id,s.language_code,s.samples_only,s.submitted_at,latest.status,latest.verdict,latest.execution_time_ms,latest.peak_memory_kb,latest.passed_tests,latest.total_tests,u.handle AS submitted_by_handle FROM submissions s JOIN users u ON u.id=s.submitted_by "+LATEST
                +"WHERE s.context<>'BENCHMARK' AND (s.submitted_by=? OR s.entry_id IN (SELECT m.entry_id FROM run_entry_members m WHERE m.user_id=?)) AND (?::uuid IS NULL OR s.run_id=?::uuid) ORDER BY s.submitted_at DESC LIMIT 100 OFFSET ?",actor.id(),actor.id(),run,run,offset);
    }
    /** Jury submission monitor for one run; source is fetched separately through result(). */
    public List<Map<String,Object>> forJury(Actor actor,UUID run,int offset) {
        var r=db.one("SELECT competition_id FROM contest_runs WHERE id=?",run);
        Api.require(access.jury(actor,(UUID)r.get("competition_id")),HttpStatus.FORBIDDEN,"Jury access required");
        Api.require(offset>=0 && offset<=1000000,HttpStatus.BAD_REQUEST,"Invalid offset");
        return db.jdbc.queryForList("SELECT s.id,s.entry_id,e.display_name AS entry_name,u.handle,s.problem_slot,s.language_code,s.submitted_at,latest.status,latest.verdict,latest.execution_time_ms,latest.peak_memory_kb,latest.passed_tests,latest.total_tests,latest.generation FROM submissions s "
                +"JOIN run_entries e ON e.id=s.entry_id JOIN users u ON u.id=s.submitted_by "+LATEST
                +"WHERE s.run_id=? ORDER BY s.submitted_at DESC LIMIT 100 OFFSET ?",run,offset);
    }
    /**
     * Judges a submission again as a new generation. Contest submissions need contest management access,
     * others a super administrator; laboratory and benchmark submissions are never rejudged.
     */
    @Transactional
    public UUID rejudge(Actor actor,UUID id,String reason) {
        var s=db.one("SELECT * FROM submissions WHERE id=? FOR UPDATE",id);
        Api.require(!"LABORATORY".equals(s.get("context")),HttpStatus.CONFLICT,"Clone and revalidate laboratory versions");
        Api.require(!"BENCHMARK".equals(s.get("context")),HttpStatus.CONFLICT,"Start a new benchmark instead of rejudging one");
        if(s.get("run_id")==null)Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator required for non-contest rejudging");
        else {var r=db.one("SELECT competition_id FROM contest_runs WHERE id=?",s.get("run_id"));access.competition(actor,(UUID)r.get("competition_id"),false);}
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM judging_jobs WHERE submission_id=? AND status IN ('QUEUED','RUNNING','RETRY'))",id),HttpStatus.CONFLICT,"Judging is already active");
        UUID job=db.id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation,priority) SELECT ?,?,coalesce(max(generation),0)+1,100 FROM judging_jobs WHERE submission_id=? RETURNING id",id,s.get("problem_version_id"),id);
        db.audit(actor.id(),"SUBMISSION_REJUDGE","submission",id,reason);return job;
    }
}
