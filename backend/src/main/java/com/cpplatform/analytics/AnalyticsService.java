package com.cpplatform.analytics;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** Platform analytics for the control room: live load, history, daily reports and per-contest statistics. */
@Service
public class AnalyticsService {
    private final Database db;private final ServerMetrics server;private final Permissions access;private final ObjectMapper json;
    public AnalyticsService(Database db,ServerMetrics server,Permissions access,ObjectMapper json){this.db=db;this.server=server;this.access=access;this.json=json;}

    // Latest judging generation per submission, so rejudges replace the original verdict.
    private static final String LATEST="SELECT DISTINCT ON (j.submission_id) j.submission_id,j.status,j.created_at,j.first_started_at,j.completed_at,r.verdict,r.execution_time_ms,r.peak_memory_kb FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id";
    private static final String ONLINE="status='ONLINE' AND last_heartbeat_at>now()-interval '90 seconds'";

    /** Records one minute of load; old samples expire after 14 days. */
    public void sample() {
        var s=server.snapshot();
        db.jdbc.update("INSERT INTO metric_samples(host,process_cpu,system_cpu,load_average,memory_used_mb,memory_total_mb,heap_used_mb,heap_max_mb,threads,disk_free_mb,db_connections,queued_jobs,running_jobs,workers_online,judge_slots,submissions) "+
                "SELECT ?,?,?,?,?,?,?,?,?,?,(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),"+
                "(SELECT count(*) FROM judging_jobs WHERE status IN ('QUEUED','RETRY')),(SELECT count(*) FROM judging_jobs WHERE status='RUNNING'),"+
                "(SELECT count(*) FROM judge_workers WHERE "+ONLINE+"),(SELECT coalesce(sum(coalesce(reported_target,desired_concurrency,default_concurrency)),0) FROM judge_workers WHERE "+ONLINE+" AND NOT drain_requested),"+
                "(SELECT count(*) FROM submissions WHERE submitted_at>now()-interval '1 minute')",
                server.host,s.get("processCpu"),s.get("systemCpu"),s.get("loadAverage"),s.get("memoryUsedMb"),s.get("memoryTotalMb"),
                s.get("heapUsedMb"),s.get("heapMaxMb"),s.get("threads"),s.get("diskFreeMb"));
        db.jdbc.update("DELETE FROM metric_samples WHERE sampled_at<now()-interval '14 days'");
    }

    /** Writes the report of every finished UTC day that has none yet (up to 30 days back), e.g. after downtime. */
    public int closeDays() {
        LocalDate yesterday=LocalDate.now(ZoneOffset.UTC).minusDays(1);
        LocalDate first=db.jdbc.queryForObject("SELECT greatest((now() AT TIME ZONE 'UTC')::date-30,(SELECT min(created_at AT TIME ZONE 'UTC')::date FROM users),coalesce((SELECT max(day)+1 FROM daily_reports),'-infinity'::date))",LocalDate.class);
        int written=0;
        for(LocalDate day=first;day!=null && !day.isAfter(yesterday);day=day.plusDays(1))
            written+=db.jdbc.update("INSERT INTO daily_reports(day,summary) VALUES (?,?::jsonb) ON CONFLICT DO NOTHING",day,write(day(day)));
        return written;
    }

    private String write(Object value) {
        try {return json.writeValueAsString(value);} catch(Exception e) {throw new IllegalStateException(e);}
    }
    private Map<String,Object> read(String value) {
        try {return json.readValue(value,new TypeReference<>(){});} catch(Exception e) {throw new IllegalStateException(e);}
    }

    /** Activity, judging and load summary of one UTC day. */
    public Map<String,Object> day(LocalDate day) {
        Timestamp from=Timestamp.from(day.atStartOfDay(ZoneOffset.UTC).toInstant()),to=Timestamp.from(day.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant());
        var result=new LinkedHashMap<String,Object>();
        result.put("day",day.toString());
        result.putAll(db.jdbc.queryForMap("SELECT count(*) AS submissions,count(DISTINCT submitted_by) AS active_users,"+
                "count(*) FILTER (WHERE context='CONTEST') AS contest_submissions,count(*) FILTER (WHERE context='PRACTICE') AS practice_submissions,count(*) FILTER (WHERE context='LABORATORY') AS laboratory_submissions "+
                "FROM submissions WHERE submitted_at>=? AND submitted_at<?",from,to));
        result.put("new_users",db.jdbc.queryForObject("SELECT count(*) FROM users WHERE created_at>=? AND created_at<?",Long.class,from,to));
        result.put("signed_in_users",db.jdbc.queryForObject("SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE created_at>=? AND created_at<?",Long.class,from,to));
        result.putAll(judging(from,to));
        result.put("verdicts",pairs("SELECT verdict AS key,count(*) AS count FROM judging_results WHERE judged_at>=? AND judged_at<? GROUP BY 1 ORDER BY 2 DESC",from,to));
        result.put("languages",pairs("SELECT language_code AS key,count(*) AS count FROM submissions WHERE submitted_at>=? AND submitted_at<? GROUP BY 1 ORDER BY 2 DESC",from,to));
        result.put("contest_runs",db.jdbc.queryForObject("SELECT count(*) FROM contest_runs WHERE starts_at<? AND ends_at>?",Long.class,to,from));
        var busiest=db.jdbc.queryForList("SELECT extract(hour FROM submitted_at AT TIME ZONE 'UTC')::int AS hour,count(*) AS count FROM submissions WHERE submitted_at>=? AND submitted_at<? GROUP BY 1 ORDER BY 2 DESC LIMIT 1",from,to);
        result.put("busiest_hour",busiest.isEmpty()?null:busiest.get(0));
        result.putAll(db.jdbc.queryForMap("SELECT count(*) AS samples,round(avg(system_cpu)::numeric,3) AS avg_cpu,round(max(system_cpu)::numeric,3) AS peak_cpu,"+
                "round(avg(memory_used_mb)) AS avg_memory_mb,max(memory_used_mb) AS peak_memory_mb,max(memory_total_mb) AS memory_total_mb,max(heap_used_mb) AS peak_heap_mb,"+
                "max(queued_jobs) AS peak_queue,max(running_jobs) AS peak_running,min(workers_online) AS min_workers_online,max(submissions) AS peak_submissions_per_minute "+
                "FROM metric_samples WHERE sampled_at>=? AND sampled_at<?",from,to));
        return result;
    }

    /** Queue wait (created until first started) and turnaround (created until completed) of jobs finished in a window. */
    private Map<String,Object> judging(Timestamp from,Timestamp to) {
        return db.jdbc.queryForMap("SELECT count(*) AS judged,count(*) FILTER (WHERE status='FAILED') AS failed_jobs,"+
                "round(avg(extract(epoch FROM first_started_at-created_at)*1000)) AS avg_wait_ms,"+
                "round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM first_started_at-created_at)*1000))::numeric) AS p95_wait_ms,"+
                "round(avg(extract(epoch FROM completed_at-created_at)*1000)) AS avg_turnaround_ms,"+
                "round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at-created_at)*1000))::numeric) AS p95_turnaround_ms,"+
                "round((percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at-created_at)*1000))::numeric) AS p99_turnaround_ms "+
                "FROM judging_jobs WHERE completed_at>=? AND completed_at<?",from,to);
    }
    private List<Map<String,Object>> pairs(String sql,Object... args){return db.jdbc.queryForList(sql,args);}

    public Map<String,Object> overview() {
        Timestamp now=Timestamp.from(Instant.now()),hour=Timestamp.from(Instant.now().minusSeconds(3600)),day=Timestamp.from(Instant.now().minusSeconds(86400));
        var result=new LinkedHashMap<String,Object>();
        result.put("generatedAt",now.toInstant().toString());
        result.put("server",server.snapshot());
        result.put("database",server.database());
        result.put("users",db.jdbc.queryForMap("SELECT count(*) AS total,count(*) FILTER (WHERE status='ACTIVE') AS active,"+
                "count(*) FILTER (WHERE created_at>now()-interval '1 day') AS new_day,count(*) FILTER (WHERE created_at>now()-interval '7 days') AS new_week,"+
                "(SELECT count(DISTINCT submitted_by) FROM submissions WHERE submitted_at>now()-interval '1 day') AS submitting_day,"+
                "(SELECT count(DISTINCT submitted_by) FROM submissions WHERE submitted_at>now()-interval '7 days') AS submitting_week,"+
                "(SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at>now() AND created_at>now()-interval '1 hour') AS online_hour,"+
                "(SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE created_at>now()-interval '1 day') AS signed_in_day FROM users"));
        result.put("submissions",db.jdbc.queryForMap("SELECT count(*) AS total,count(*) FILTER (WHERE submitted_at>now()-interval '1 hour') AS hour,"+
                "count(*) FILTER (WHERE submitted_at>now()-interval '1 day') AS day,count(*) FILTER (WHERE submitted_at>now()-interval '7 days') AS week,"+
                "count(*) FILTER (WHERE submitted_at>now()-interval '1 minute') AS minute FROM submissions"));
        var judgeHour=judging(hour,now);var judgeDay=judging(day,now);
        result.put("judging",Map.of("hour",judgeHour,"day",judgeDay,
                "queue",db.jdbc.queryForList("SELECT status,count(*) AS count,min(created_at) AS oldest FROM judging_jobs WHERE status IN ('QUEUED','RUNNING','RETRY') GROUP BY status"),
                "unpublishedEvents",db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE published_at IS NULL",Long.class)));
        result.put("verdicts",pairs("SELECT verdict AS key,count(*) AS count FROM judging_results WHERE judged_at>now()-interval '1 day' GROUP BY 1 ORDER BY 2 DESC"));
        result.put("languages",pairs("SELECT language_code AS key,count(*) AS count FROM submissions WHERE submitted_at>now()-interval '7 days' GROUP BY 1 ORDER BY 2 DESC"));
        result.put("contexts",pairs("SELECT context AS key,count(*) AS count FROM submissions WHERE submitted_at>now()-interval '7 days' GROUP BY 1 ORDER BY 2 DESC"));
        result.put("workers",db.jdbc.queryForList("SELECT w.id,w.name,w.lane,w.host_id,w.status,(w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds') AS online,"+
                "w.drain_requested,w.detected_cpus,w.detected_memory_mb,coalesce(w.reported_target,w.desired_concurrency,w.default_concurrency) AS slots,coalesce(w.reported_active,0) AS active,w.last_heartbeat_at,"+
                "(SELECT count(*) FROM judging_jobs j WHERE j.worker_id=w.id AND j.completed_at>now()-interval '1 hour') AS judged_hour,"+
                "(SELECT count(*) FROM judging_jobs j WHERE j.worker_id=w.id AND j.completed_at>now()-interval '1 day') AS judged_day "+
                "FROM judge_workers w ORDER BY w.lane,w.name"));
        result.put("content",db.jdbc.queryForMap("SELECT (SELECT count(*) FROM problems) AS problems,(SELECT count(*) FROM practice_publications WHERE NOT hidden) AS practice_problems,"+
                "(SELECT count(*) FROM competitions) AS competitions,(SELECT count(*) FROM competitions WHERE status='RUNNING') AS running_competitions,"+
                "(SELECT count(*) FROM contest_runs WHERE status='RUNNING') AS running_runs,(SELECT count(*) FROM teams) AS teams"));
        result.put("today",day(LocalDate.now(ZoneOffset.UTC)));
        return result;
    }

    /** Server samples and submission activity in about 240 buckets covering the last {@code hours}. */
    public Map<String,Object> timeseries(int hours) {
        int bucket=Math.max(1,hours*60/240);
        var serverRows=db.jdbc.queryForList("SELECT date_bin(make_interval(mins=>?),sampled_at,timestamptz '2000-01-01') AS at,"+
                "round(avg(system_cpu)::numeric,3) AS system_cpu,round(max(system_cpu)::numeric,3) AS peak_cpu,round(avg(process_cpu)::numeric,3) AS process_cpu,"+
                "round(avg(memory_used_mb)) AS memory_used_mb,max(memory_total_mb) AS memory_total_mb,round(avg(heap_used_mb)) AS heap_used_mb,max(heap_max_mb) AS heap_max_mb,"+
                "round(avg(load_average)::numeric,2) AS load_average,max(db_connections) AS db_connections,max(threads) AS threads,"+
                "max(queued_jobs) AS queued_jobs,max(running_jobs) AS running_jobs,min(workers_online) AS workers_online,max(judge_slots) AS judge_slots "+
                "FROM metric_samples WHERE sampled_at>now()-make_interval(hours=>?) GROUP BY 1 ORDER BY 1",bucket,hours);
        var activity=db.jdbc.queryForList("WITH b AS (SELECT generate_series(date_bin(make_interval(mins=>?),now()-make_interval(hours=>?),timestamptz '2000-01-01'),now(),make_interval(mins=>?)) AS at) "+
                "SELECT b.at,(SELECT count(*) FROM submissions s WHERE s.submitted_at>=b.at AND s.submitted_at<b.at+make_interval(mins=>?)) AS submissions,"+
                "(SELECT count(*) FROM judging_results r WHERE r.judged_at>=b.at AND r.judged_at<b.at+make_interval(mins=>?) AND r.verdict='ACCEPTED') AS accepted,"+
                "(SELECT count(*) FROM judging_results r WHERE r.judged_at>=b.at AND r.judged_at<b.at+make_interval(mins=>?)) AS judged "+
                "FROM b ORDER BY b.at",bucket,hours,bucket,bucket,bucket,bucket);
        return Map.of("bucketMinutes",bucket,"hours",hours,"server",serverRows,"activity",activity);
    }

    public List<Map<String,Object>> reports(int days) {
        var rows=db.jdbc.queryForList("SELECT summary::text AS summary FROM daily_reports ORDER BY day DESC LIMIT ?",days);
        var result=new ArrayList<Map<String,Object>>();
        for(var row:rows)result.add(read((String)row.get("summary")));
        return result;
    }

    public List<Map<String,Object>> contests(Actor actor) {
        access.organizer(actor);
        return db.jdbc.queryForList("SELECT c.id AS competition_id,c.title,c.status,r.id AS run_id,r.kind,r.status AS run_status,r.starts_at,r.ends_at,"+
                "(SELECT count(*) FROM run_entries e WHERE e.run_id=r.id) AS entries,(SELECT count(*) FROM submissions s WHERE s.run_id=r.id) AS submissions "+
                "FROM contest_runs r JOIN competitions c ON c.id=r.competition_id "+
                "WHERE ? OR c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=? AND s.access_level='MANAGER') "+
                "ORDER BY r.starts_at DESC LIMIT 200",actor.superAdmin(),actor.id(),actor.id());
    }

    /** Everything about one contest run: participation, problems, verdicts, timeline, judging speed and server load. */
    public Map<String,Object> run(Actor actor,UUID id) {
        var r=db.one("SELECT r.*,c.title FROM contest_runs r JOIN competitions c ON c.id=r.competition_id WHERE r.id=?",id);
        access.competition(actor,(UUID)r.get("competition_id"),false);
        Instant starts=Api.time(r.get("starts_at")),ends=Api.time(r.get("ends_at")),until=ends.isBefore(Instant.now())?ends:Instant.now();
        Timestamp from=Timestamp.from(starts),to=Timestamp.from(until.isAfter(starts)?until:starts.plusSeconds(60));
        String latest="WITH latest AS ("+LATEST+" JOIN submissions s ON s.id=j.submission_id WHERE s.run_id=? ORDER BY j.submission_id,j.generation DESC), "+
                "subs AS (SELECT s.*,l.verdict,l.status AS job_status,l.created_at AS job_created,l.first_started_at,l.completed_at,l.execution_time_ms FROM submissions s LEFT JOIN latest l ON l.submission_id=s.id WHERE s.run_id=?) ";
        var result=new LinkedHashMap<String,Object>();
        result.put("run",Map.of("id",id,"competitionId",r.get("competition_id"),"title",r.get("title"),"kind",r.get("kind"),"status",r.get("status"),
                "startsAt",starts.toString(),"endsAt",ends.toString(),"submissionsPaused",r.get("submissions_paused")));
        result.put("totals",db.jdbc.queryForMap(latest+"SELECT (SELECT count(*) FROM run_entries WHERE run_id=?) AS entries,"+
                "(SELECT count(*) FROM run_entry_members WHERE run_id=?) AS members,count(DISTINCT entry_id) AS active_entries,count(DISTINCT submitted_by) AS active_members,"+
                "count(*) AS submissions,count(*) FILTER (WHERE verdict='ACCEPTED') AS accepted,count(*) FILTER (WHERE job_status IN ('QUEUED','RUNNING','RETRY')) AS pending,"+
                "count(DISTINCT (entry_id,problem_slot)) FILTER (WHERE verdict='ACCEPTED') AS solves,"+
                "round(avg(extract(epoch FROM first_started_at-job_created)*1000)) AS avg_wait_ms,"+
                "round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM first_started_at-job_created)*1000))::numeric) AS p95_wait_ms,"+
                "round(avg(extract(epoch FROM completed_at-job_created)*1000)) AS avg_turnaround_ms,"+
                "round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at-job_created)*1000))::numeric) AS p95_turnaround_ms,"+
                "max(execution_time_ms) AS max_execution_ms FROM subs",id,id,id,id));
        result.put("problems",db.jdbc.queryForList(latest+"SELECT cp.slot,cp.label,pv.title,count(subs.id) AS attempts,count(DISTINCT subs.entry_id) AS tried,"+
                "count(DISTINCT subs.entry_id) FILTER (WHERE subs.verdict='ACCEPTED') AS solved,"+
                "round(extract(epoch FROM min(subs.submitted_at) FILTER (WHERE subs.verdict='ACCEPTED')-?::timestamptz)/60) AS first_solve_minute,"+
                "round(avg(subs.execution_time_ms) FILTER (WHERE subs.verdict='ACCEPTED')) AS avg_accepted_ms "+
                "FROM competition_problems cp JOIN problem_versions pv ON pv.id=cp.problem_version_id LEFT JOIN subs ON subs.problem_slot=cp.slot "+
                "WHERE cp.competition_version_id=? GROUP BY cp.slot,cp.label,pv.title ORDER BY cp.slot",id,id,from,r.get("competition_version_id")));
        result.put("verdicts",pairs(latest+"SELECT coalesce(verdict,job_status,'PENDING') AS key,count(*) AS count FROM subs GROUP BY 1 ORDER BY 2 DESC",id,id));
        result.put("languages",pairs(latest+"SELECT language_code AS key,count(*) AS count,count(*) FILTER (WHERE verdict='ACCEPTED') AS accepted FROM subs GROUP BY 1 ORDER BY 2 DESC",id,id));
        long span=Math.max(60,(to.getTime()-from.getTime())/1000);int bucket=(int)Math.max(60,Math.ceil(span/48.0/60)*60);
        result.put("bucketSeconds",bucket);
        result.put("timeline",db.jdbc.queryForList(latest+"SELECT b AS at,count(subs.id) AS submissions,count(subs.id) FILTER (WHERE subs.verdict='ACCEPTED') AS accepted "+
                "FROM generate_series(?::timestamptz,?::timestamptz-interval '1 second',make_interval(secs=>?)) b LEFT JOIN subs ON subs.submitted_at>=b AND subs.submitted_at<b+make_interval(secs=>?) "+
                "GROUP BY b ORDER BY b",id,id,from,to,bucket,bucket));
        result.put("clarifications",db.jdbc.queryForMap("SELECT count(*) AS total,count(answer) AS answered,round(avg(extract(epoch FROM answered_at-created_at))) AS avg_answer_seconds FROM clarifications WHERE run_id=?",id));
        result.put("load",db.jdbc.queryForMap("SELECT count(*) AS samples,round(max(system_cpu)::numeric,3) AS peak_cpu,round(avg(system_cpu)::numeric,3) AS avg_cpu,max(memory_used_mb) AS peak_memory_mb,"+
                "max(queued_jobs) AS peak_queue,max(running_jobs) AS peak_running,min(workers_online) AS min_workers_online,max(submissions) AS peak_submissions_per_minute "+
                "FROM metric_samples WHERE sampled_at>=? AND sampled_at<=?",from,to));
        return result;
    }
}
