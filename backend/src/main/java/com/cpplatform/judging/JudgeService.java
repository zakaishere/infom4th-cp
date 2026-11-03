package com.cpplatform.judging;

import com.cpplatform.common.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
public class JudgeService {
    private static final Set<String> VERDICTS=Set.of("ACCEPTED","WRONG_ANSWER","TIME_LIMIT_EXCEEDED","MEMORY_LIMIT_EXCEEDED","RUNTIME_ERROR","COMPILATION_ERROR","OUTPUT_LIMIT_EXCEEDED","JUDGE_ERROR");
    private final Database db;private final ObjectMapper json;
    public JudgeService(Database db,ObjectMapper json){this.db=db;this.json=json;}
    private String encode(Object value) {
        try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalArgumentException("Invalid JSON");}
    }
    /** Transaction-scoped; released automatically at commit or rollback. */
    void lock(String key) {
        db.jdbc.queryForObject("SELECT count(*) FROM (SELECT pg_advisory_xact_lock(?,hashtext(?))) l",Long.class,JudgeCapacity.LOCK_SPACE,key);
    }
    /**
     * Upserts trusted worker facts (ceiling, memory budgets, host identity, runtimes).
     * Administrator state (desired_concurrency, drain_requested) is never overwritten here.
     */
    @Transactional
    public Map<String,Object> register(Map<String,Object> body) {
        String name=Api.text(body,"name",100);int capacity=Api.number(body,"capacity",1,1,32);
        Api.require(body.get("runtimes") instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Runtime manifest required");
        Map<?,?> runtimes=(Map<?,?>)body.get("runtimes");
        String lane=String.valueOf(runtimes.get("lane"));
        Api.require(lane.equals("official") || lane.equals("internal"),HttpStatus.BAD_REQUEST,"Runtime manifest lane must be official or internal");
        Api.require(runtimes.get("maxMemoryMb") instanceof Number,HttpStatus.BAD_REQUEST,"Runtime manifest maxMemoryMb required");
        int slotMemory=((Number)runtimes.get("maxMemoryMb")).intValue();
        Api.require(slotMemory>=1 && slotMemory<=1048576,HttpStatus.BAD_REQUEST,"Invalid maxMemoryMb");
        int initial=Api.number(body,"defaultConcurrency",capacity,1,capacity);
        int laneBudget=Api.number(body,"laneMemoryBudgetMb",capacity*slotMemory,1,16777216);
        int hostBudget=Api.number(body,"hostMemoryBudgetMb",laneBudget,1,16777216);
        String host=Api.optional(body,"hostId",name,100);
        Api.require(host.matches("[A-Za-z0-9._-]+"),HttpStatus.BAD_REQUEST,"hostId may contain letters, digits, dot, dash and underscore");
        Api.require((long)capacity*slotMemory<=laneBudget,HttpStatus.BAD_REQUEST,"capacity x maxMemoryMb exceeds laneMemoryBudgetMb");
        Api.require(laneBudget<=hostBudget,HttpStatus.BAD_REQUEST,"laneMemoryBudgetMb exceeds hostMemoryBudgetMb");
        Integer cpus=body.containsKey("detectedCpus")?Api.number(body,"detectedCpus",1,1,100000):null;
        Integer memory=body.containsKey("detectedMemoryMb")?Api.number(body,"detectedMemoryMb",1,1,Integer.MAX_VALUE):null;
        UUID id=db.id("INSERT INTO judge_workers(name,status,capacity,runtime_manifest,lane,host_id,slot_memory_mb,lane_memory_budget_mb,host_memory_budget_mb,default_concurrency,detected_cpus,detected_memory_mb) VALUES (?,'ONLINE',?,?::jsonb,?,?,?,?,?,?,?,?) "
                +"ON CONFLICT(name) DO UPDATE SET status=CASE WHEN judge_workers.drain_requested THEN 'DRAINING' ELSE 'ONLINE' END,capacity=excluded.capacity,runtime_manifest=excluded.runtime_manifest,"
                +"lane=excluded.lane,host_id=excluded.host_id,slot_memory_mb=excluded.slot_memory_mb,lane_memory_budget_mb=excluded.lane_memory_budget_mb,host_memory_budget_mb=excluded.host_memory_budget_mb,"
                +"default_concurrency=excluded.default_concurrency,detected_cpus=excluded.detected_cpus,detected_memory_mb=excluded.detected_memory_mb,last_heartbeat_at=now(),registered_at=now(),reported_active=NULL,reported_target=NULL RETURNING id",
                name,capacity,encode(runtimes),lane,host,slotMemory,laneBudget,hostBudget,initial,cpus,memory);
        // A runtime verified by a worker becomes available unless an administrator decided its state.
        for(var entry:runtimes.entrySet())
            if(entry.getValue() instanceof Map<?,?> r && Boolean.TRUE.equals(r.get("verified")) && r.get("imageId") instanceof String image && image.matches("sha256:[0-9a-f]{64}"))
                db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code=? AND NOT admin_locked AND runtime_image_id IS DISTINCT FROM ?",image,String.valueOf(entry.getKey()),image);
        return control(id);
    }
    /** Liveness plus the bounded control exchange: the reply carries the current target. */
    public Map<String,Object> heartbeat(UUID worker,Map<String,Object> body) {
        Integer active=body!=null && body.containsKey("active")?Api.number(body,"active",0,0,1024):null;
        Integer target=body!=null && body.containsKey("target")?Api.number(body,"target",0,0,1024):null;
        Api.require(db.jdbc.update("UPDATE judge_workers SET last_heartbeat_at=now(),reported_active=?,reported_target=? WHERE id=? AND status<>'OFFLINE'",active,target,worker)==1,
                HttpStatus.CONFLICT,"Worker is offline");
        return control(worker);
    }
    Map<String,Object> control(UUID worker) {
        var w=db.one("SELECT * FROM judge_workers WHERE id=?",worker);
        var result=new LinkedHashMap<String,Object>();
        result.put("workerId",worker);
        result.put("desiredConcurrency",JudgeCapacity.workerTarget(w));
        result.put("draining",Boolean.TRUE.equals(w.get("drain_requested")));
        // Workers may grow to any administrator value up to the absolute sanity cap.
        result.put("maxConcurrency",JudgeCapacity.ABSOLUTE_MAX);
        result.put("settingsVersion",w.get("settings_version"));
        return result;
    }
    /** Thrown when a job is claimable but no capacity is free; the worker keeps the delivery and retries. */
    static ResponseStatusException busy(String reason){return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,reason);}
    /**
     * Claims are serialized per lane and per host with transaction-scoped advisory locks,
     * so concurrent claims through any number of API instances cannot overshoot the
     * global lane limit or the per-worker limit. Host memory budgets are advisory. Locks are
     * always taken in the order lane -> host -> worker row. RUNNING jobs count until
     * completion or lease recovery, whether or not their lease has already expired.
     */
    @Transactional
    public Optional<Map<String,Object>> claim(UUID job,UUID worker,int dispatch) {
        var w=db.one("SELECT lane,host_id FROM judge_workers WHERE id=?",worker);
        // Stale, duplicate and backed-off deliveries are acknowledged without waiting for capacity.
        if(!db.exists("SELECT EXISTS(SELECT 1 FROM judging_jobs WHERE id=? AND dispatch_sequence>=? AND status IN ('QUEUED','RETRY') AND available_at<=now() AND attempt_count<max_attempts)",job,dispatch))
            return Optional.empty();
        lock("lane:"+w.get("lane"));lock("host:"+w.get("host_id"));
        w=db.one("SELECT *,last_heartbeat_at>now()-interval '90 seconds' AS fresh FROM judge_workers WHERE id=? FOR SHARE",worker);
        Api.require("ONLINE".equals(w.get("status")) && Boolean.TRUE.equals(w.get("fresh")),HttpStatus.CONFLICT,"Worker is unavailable");
        String lane=(String)w.get("lane");
        var load=db.one("SELECT (SELECT count(*) FROM judging_jobs WHERE worker_id=? AND status='RUNNING') AS worker_running,"
                +"(SELECT count(*) FROM judging_jobs j JOIN judge_workers x ON x.id=j.worker_id WHERE j.status='RUNNING' AND x.lane=?) AS lane_running,"
                +"(SELECT CASE WHEN ?='official' THEN official_concurrency_limit ELSE internal_concurrency_limit END FROM judging_settings WHERE id=1) AS lane_limit",
                worker,lane,lane);
        long workerRunning=((Number)load.get("worker_running")).longValue(),laneRunning=((Number)load.get("lane_running")).longValue();
        if(workerRunning>=JudgeCapacity.workerLimit(w))throw busy("WORKER_LIMIT: worker is running "+workerRunning+" of "+JudgeCapacity.workerLimit(w));
        if(load.get("lane_limit")!=null && laneRunning>=((Number)load.get("lane_limit")).longValue())
            throw busy("LANE_LIMIT: "+lane+" lane is running "+laneRunning+" of "+load.get("lane_limit"));
        UUID lease=UUID.randomUUID();
        var rows=db.jdbc.queryForList("UPDATE judging_jobs j SET status='RUNNING',first_started_at=coalesce(first_started_at,clock_timestamp()),last_started_at=clock_timestamp(),worker_id=?,lease_token=?,lease_expires_at=now()+interval '60 seconds',attempt_count=attempt_count+1,runtime_image_id=(?::jsonb->(SELECT language_code FROM submissions WHERE id=j.submission_id)->>'imageId') WHERE j.id=? AND j.dispatch_sequence>=? AND j.status IN ('QUEUED','RETRY') AND j.available_at<=now() AND j.attempt_count<j.max_attempts AND EXISTS(SELECT 1 FROM submissions s JOIN problem_versions v ON v.id=s.problem_version_id WHERE s.id=j.submission_id AND ?::jsonb->s.language_code->>'verified'='true' AND EXISTS(SELECT 1 FROM languages l WHERE l.code=s.language_code AND l.enabled AND EXISTS(SELECT 1 FROM problem_runtime_pins pin WHERE pin.problem_version_id=v.id AND pin.language_code=l.code AND pin.image_id=(?::jsonb->s.language_code->>'imageId'))) AND (?::jsonb->>'lane')=CASE WHEN EXISTS(SELECT 1 FROM contest_runs r WHERE r.id=s.run_id AND r.kind='OFFICIAL') OR EXISTS(SELECT 1 FROM benchmark_runs b WHERE b.id=s.benchmark_id AND b.lane='official') THEN 'official' ELSE 'internal' END AND v.memory_limit_mb<=coalesce((?::jsonb->>'maxMemoryMb')::integer,0)) RETURNING j.submission_id,j.problem_version_id",
                worker,lease,w.get("runtime_manifest").toString(),job,dispatch,w.get("runtime_manifest").toString(),w.get("runtime_manifest").toString(),w.get("runtime_manifest").toString(),w.get("runtime_manifest").toString());
        if(rows.isEmpty())return Optional.empty();
        // IOI contests and duels need every test result (partial points, "most tests passed"); other contexts stop at the first failure.
        var result=new LinkedHashMap<>(db.one("SELECT s.source_code,s.language_code,v.id AS problem_version_id,v.time_limit_ms,v.memory_limit_mb,v.output_limit_kb,v.checker,v.function_signature,(coalesce((SELECT cv.scoring_system='IOI' FROM competition_versions cv WHERE cv.id=s.competition_version_id),false) OR s.context='DUEL') AS run_all_tests FROM submissions s JOIN problem_versions v ON v.id=s.problem_version_id WHERE s.id=?",rows.get(0).get("submission_id")));
        // Practice "run examples" submissions are judged on the example tests only.
        result.put("tests",db.jdbc.queryForList("SELECT t.id,t.input_data,t.expected_output FROM test_cases t JOIN test_case_groups g ON g.id=t.group_id WHERE t.problem_version_id=? AND (t.is_sample OR NOT (SELECT samples_only FROM submissions WHERE id=?)) ORDER BY g.position,t.position",
                rows.get(0).get("problem_version_id"),rows.get(0).get("submission_id")));
        Api.require(!((List<?>)result.get("tests")).isEmpty(),HttpStatus.CONFLICT,"Empty test suite");
        result.put("leaseToken",lease);result.put("jobId",job);return Optional.of(result);
    }
    public void renew(UUID job,UUID worker,UUID lease) {
        int updated=db.jdbc.update("UPDATE judging_jobs SET lease_expires_at=now()+interval '60 seconds' WHERE id=? AND worker_id=? AND lease_token=? AND status='RUNNING' AND lease_expires_at>now()",job,worker,lease);
        Api.require(updated==1,HttpStatus.CONFLICT,"Lease is no longer active");
    }
    @Transactional
    public void complete(UUID job,UUID worker,UUID lease,Map<String,Object> result) {
        var j=db.one("SELECT *,lease_expires_at>now() AS lease_valid FROM judging_jobs WHERE id=? FOR UPDATE",job);
        // Repeated completion after a lost HTTP response is safe. A rejudge has a different job ID.
        if("COMPLETED".equals(j.get("status")) && worker.equals(j.get("worker_id")))return;
        Api.require("RUNNING".equals(j.get("status")) && worker.equals(j.get("worker_id")) && lease.equals(j.get("lease_token"))
                && Boolean.TRUE.equals(j.get("lease_valid")),HttpStatus.CONFLICT,"Stale judge lease");
        String verdict=Api.text(result,"verdict",32);
        Api.require(VERDICTS.contains(verdict),HttpStatus.BAD_REQUEST,"Invalid verdict");
        if("JUDGE_ERROR".equals(verdict)) { retry(j,"EXECUTION_INFRASTRUCTURE");return; }
        var tests=db.jdbc.queryForList("SELECT id FROM test_cases WHERE problem_version_id=? AND (is_sample OR NOT (SELECT samples_only FROM submissions WHERE id=?))",j.get("problem_version_id"),j.get("submission_id"));
        Api.require(result.get("cases") instanceof List<?>,HttpStatus.BAD_REQUEST,"Case results required");
        List<?> cases=(List<?>)result.get("cases");
        Set<UUID> expected=new HashSet<>();tests.forEach(t->expected.add((UUID)t.get("id")));
        Set<UUID> seen=new HashSet<>();int passed=0;
        for(Object item:cases) {
            Api.require(item instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Invalid case result");
            Map<?,?> c=(Map<?,?>)item;UUID id=Api.uuid(c.get("id"));String cv=String.valueOf(c.get("verdict"));
            Api.require(expected.contains(id) && seen.add(id) && VERDICTS.contains(cv) && !cv.equals("JUDGE_ERROR"),
                    HttpStatus.BAD_REQUEST,"Invalid or duplicate case");
            if(cv.equals("ACCEPTED"))passed++;
        }
        Api.require(!tests.isEmpty() && (!verdict.equals("ACCEPTED") || passed==tests.size()),
                HttpStatus.BAD_REQUEST,"Accepted requires every test to pass");
        Api.require(verdict.equals("COMPILATION_ERROR") || !cases.isEmpty(),HttpStatus.BAD_REQUEST,"Missing executed cases");
        int total=tests.size();
        long time=metric(result,"executionTimeMs"),memory=metric(result,"peakMemoryKb");
        String feedback=verdict.equals("COMPILATION_ERROR")?bounded(result.get("compilerOutput"),16000):"";
        // Optional: where the judging time went. Older workers do not send it.
        Map<?,?> timings=result.get("timings") instanceof Map<?,?> m?m:Map.of();
        db.jdbc.update("INSERT INTO judging_results(job_id,problem_version_id,verdict,execution_time_ms,peak_memory_kb,passed_tests,total_tests,public_feedback,compile_ms,tests_ms,judge_total_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                job,j.get("problem_version_id"),verdict,time,memory,passed,total,feedback,timing(timings,"compileMs"),timing(timings,"testsMs"),timing(timings,"totalMs"));
        for(Object item:cases) {
            Map<?,?> c=(Map<?,?>)item;
            db.jdbc.update("INSERT INTO test_case_results(job_id,problem_version_id,test_case_id,verdict,execution_time_ms,peak_memory_kb) VALUES (?,?,?,?,?,?)",
                    job,j.get("problem_version_id"),Api.uuid(c.get("id")),c.get("verdict"),metric(c,"executionTimeMs"),metric(c,"peakMemoryKb"));
        }
        db.jdbc.update("UPDATE judging_jobs SET status='COMPLETED',completed_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=?",job);
        db.jdbc.update("INSERT INTO run_events(run_id,kind) SELECT run_id,'SUBMISSION_JUDGED' FROM submissions WHERE id=? AND run_id IS NOT NULL",j.get("submission_id"));
    }
    private static Integer timing(Map<?,?> timings,String key) {
        return timings.get(key) instanceof Number n && n.longValue()>=0 && n.longValue()<=Integer.MAX_VALUE?Integer.valueOf(n.intValue()):null;
    }
    private static long metric(Map<?,?> result,String key) {
        Object value=result.get(key);
        Api.require(value instanceof Number && ((Number)value).longValue()>=0 && ((Number)value).longValue()<=1_000_000_000_000L,
                HttpStatus.BAD_REQUEST,"Invalid resource metric");return ((Number)value).longValue();
    }
    private static String bounded(Object value,int max){String s=value==null?"":String.valueOf(value);return s.substring(0,Math.min(s.length(),max));}
    private void retry(Map<String,Object> job,String code) {
        int attempts=((Number)job.get("attempt_count")).intValue(),max=((Number)job.get("max_attempts")).intValue();
        boolean failed=attempts>=max;
        db.jdbc.update("UPDATE judging_jobs SET status=?,completed_at=CASE WHEN ? THEN now() ELSE NULL END,lease_token=NULL,lease_expires_at=NULL,last_error_code=?,available_at=now()+(? * interval '1 second'),dispatch_sequence=dispatch_sequence+1 WHERE id=?",
                failed?"FAILED":"RETRY",failed,code,Math.min(60,1<<Math.min(attempts,6)),job.get("id"));
    }
    @Transactional
    public void recover() {
        var expired=db.jdbc.queryForList("SELECT * FROM judging_jobs WHERE status='RUNNING' AND lease_expires_at<now() ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 100");
        expired.forEach(j->retry(j,"WORKER_LEASE_EXPIRED"));
        db.jdbc.update("WITH stale AS (SELECT j.id FROM judging_jobs j WHERE j.status IN ('QUEUED','RETRY') AND j.available_at<now()-interval '2 minutes' AND EXISTS(SELECT 1 FROM judge_outbox o WHERE o.job_id=j.id AND o.dispatch_sequence=j.dispatch_sequence AND o.published_at<now()-interval '2 minutes') FOR UPDATE SKIP LOCKED LIMIT 100) UPDATE judging_jobs j SET dispatch_sequence=dispatch_sequence+1,available_at=now() FROM stale WHERE j.id=stale.id");
        db.jdbc.update("UPDATE judge_workers SET status='OFFLINE' WHERE status<>'OFFLINE' AND last_heartbeat_at<now()-interval '90 seconds'");
    }
    @Transactional
    public void finishValidations() {
        var validations=db.jdbc.queryForList("SELECT * FROM problem_validation_results WHERE status IN ('PENDING','RUNNING') FOR UPDATE SKIP LOCKED LIMIT 100");
        for(var validation:validations) {
            var jobs=db.jdbc.queryForList("SELECT j.status,r.verdict,ref.expected_verdict FROM submissions s JOIN judging_jobs j ON j.submission_id=s.id LEFT JOIN judging_results r ON r.job_id=j.id JOIN reference_solutions ref ON ref.id=s.reference_solution_id WHERE s.validation_id=?",validation.get("id"));
            if(jobs.isEmpty() || jobs.stream().anyMatch(j->!List.of("COMPLETED","FAILED").contains(j.get("status"))))continue;
            boolean infra=jobs.stream().anyMatch(j->"FAILED".equals(j.get("status")));
            boolean pass=!infra && jobs.stream().allMatch(j->Objects.equals(j.get("verdict"),j.get("expected_verdict")));
            db.jdbc.update("UPDATE problem_validation_results SET status=?,completed_at=now(),report=?::jsonb WHERE id=?",
                    infra?"JUDGE_ERROR":pass?"PASSED":"FAILED",encode(Map.of("references",jobs)),validation.get("id"));
            if(pass)db.jdbc.update("UPDATE problem_versions SET status='READY_FOR_REVIEW' WHERE id=? AND status='IN_TESTING'",validation.get("problem_version_id"));
        }
    }
}
