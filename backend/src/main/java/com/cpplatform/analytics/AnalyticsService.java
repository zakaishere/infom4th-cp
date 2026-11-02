package com.cpplatform.analytics;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** Platform analytics for the control room: live load, history, daily reports and per-contest statistics. */
@Service
public class AnalyticsService {
    private final Database db;private final ServerMetrics server;private final Permissions access;private final ObjectMapper json;private final ApiMetrics apiMetrics;
    public AnalyticsService(Database db,ServerMetrics server,Permissions access,ObjectMapper json,ApiMetrics apiMetrics){this.db=db;this.server=server;this.access=access;this.json=json;this.apiMetrics=apiMetrics;}

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
        var api=apiMetrics.drain();
        db.jdbc.update("INSERT INTO api_request_samples(requests,client_errors,server_errors,total_ms,max_ms) VALUES (?,?,?,?,?)",
                api.get("requests"),api.get("clientErrors"),api.get("serverErrors"),api.get("totalMs"),api.get("maxMs"));
        db.jdbc.update("DELETE FROM api_request_samples WHERE sampled_at<now()-interval '14 days'");
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
        result.put("health",health());
        return result;
    }

    /**
     * One derived verdict for the banner, from data already stored: is the platform alive, is the
     * queue growing, and did anything die in the last hour. Charts need a human watching; this does not.
     */
    public Map<String,Object> health() {
        var row=db.jdbc.queryForMap("SELECT "+
                "(SELECT coalesce(extract(epoch FROM now()-max(sampled_at))::int,999999) FROM metric_samples) AS sample_age,"+
                "(SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.status='FAILED' AND j.completed_at>now()-interval '1 hour' AND s.context<>'BENCHMARK') AS dropped,"+
                "(SELECT coalesce(max(extract(epoch FROM now()-created_at))::int,0) FROM judging_jobs WHERE status IN ('QUEUED','RETRY')) AS oldest_wait,"+
                "(SELECT coalesce(max(extract(epoch FROM now()-created_at))::int,0) FROM judge_outbox WHERE published_at IS NULL) AS outbox_age,"+
                "(SELECT count(*) FROM (SELECT queued_jobs,lag(queued_jobs) OVER (ORDER BY sampled_at) AS previous FROM "+
                "(SELECT sampled_at,queued_jobs FROM metric_samples ORDER BY sampled_at DESC LIMIT 3) t) x WHERE previous IS NOT NULL AND queued_jobs>previous) AS rising");
        long sampleAge=((Number)row.get("sample_age")).longValue(),dropped=((Number)row.get("dropped")).longValue();
        long oldestWait=((Number)row.get("oldest_wait")).longValue(),outboxAge=((Number)row.get("outbox_age")).longValue();
        long rising=((Number)row.get("rising")).longValue();
        List<String> reasons=new ArrayList<>();
        if(sampleAge>120) reasons.add("No server sample for "+(sampleAge>600000?"a long time":sampleAge+" s")+": the API may be down.");
        if(dropped>0) reasons.add(dropped+" job(s) used every attempt in the last hour.");
        if(oldestWait>300) reasons.add("The oldest waiting job has queued for "+(oldestWait/60)+" min.");
        if(rising>=2) reasons.add("The judge queue grew in each of the last samples.");
        if(outboxAge>30) reasons.add("A judge message waited "+outboxAge+" s to be published.");
        String level=!reasons.isEmpty()&&(sampleAge>120||dropped>0||oldestWait>300)?"bad":!reasons.isEmpty()?"warn":"ok";
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("level",level);
        out.put("reasons",reasons);
        out.put("sampleAgeSeconds",sampleAge);
        out.put("droppedLastHour",dropped);
        out.put("oldestWaitSeconds",oldestWait);
        return out;
    }

    /** Bucket size in seconds: about 240 points, never finer than 5 seconds, so short contest windows stay readable. */
    private static int bucketSeconds(int minutes) {
        int ideal = Math.max(1, minutes * 60 / 240);
        int chosen = 5;
        for (int step : new int[]{5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200}) {
            if (step > ideal) break;
            chosen = step;
        }
        return chosen;
    }

    /** Server samples and pipeline activity in about 240 buckets covering the last {@code minutes}. */
    public Map<String,Object> timeseries(int minutes) {
        int bucket=bucketSeconds(minutes);
        var serverRows=db.jdbc.queryForList("SELECT date_bin(make_interval(secs=>?),sampled_at,timestamptz '2000-01-01') AS at,"+
                "round(avg(system_cpu)::numeric,3) AS system_cpu,round(max(system_cpu)::numeric,3) AS peak_cpu,round(avg(process_cpu)::numeric,3) AS process_cpu,"+
                "round(avg(memory_used_mb)) AS memory_used_mb,max(memory_total_mb) AS memory_total_mb,round(avg(heap_used_mb)) AS heap_used_mb,max(heap_max_mb) AS heap_max_mb,"+
                "round(avg(load_average)::numeric,2) AS load_average,max(db_connections) AS db_connections,max(threads) AS threads,"+
                "max(queued_jobs) AS queued_jobs,max(running_jobs) AS running_jobs,min(workers_online) AS workers_online,max(judge_slots) AS judge_slots "+
                "FROM metric_samples WHERE sampled_at>now()-make_interval(mins=>?) GROUP BY 1 ORDER BY 1",bucket,minutes);
        // Counts per bucket. Rates are derived below so a 10 s bucket and a 42 min bucket are comparable.
        var activity=db.jdbc.queryForList("WITH b AS (SELECT generate_series(date_bin(make_interval(secs=>?),now()-make_interval(mins=>?),timestamptz '2000-01-01'),now(),make_interval(secs=>?)) AS at) "+
                "SELECT b.at,"+
                "(SELECT count(*) FROM submissions s WHERE s.submitted_at>=b.at AND s.submitted_at<b.at+make_interval(secs=>?) AND s.context<>'BENCHMARK') AS arrivals,"+
                "(SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.first_started_at>=b.at AND j.first_started_at<b.at+make_interval(secs=>?) AND s.context<>'BENCHMARK') AS claims,"+
                "(SELECT count(*) FROM judging_results r JOIN judging_jobs j ON j.id=r.job_id JOIN submissions s ON s.id=j.submission_id WHERE r.judged_at>=b.at AND r.judged_at<b.at+make_interval(secs=>?) AND s.context<>'BENCHMARK') AS verdicts,"+
                "(SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.first_started_at>=b.at AND j.first_started_at<b.at+make_interval(secs=>?) AND j.attempt_count>1 AND s.context<>'BENCHMARK') AS retries,"+
                "(SELECT count(*) FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.completed_at>=b.at AND j.completed_at<b.at+make_interval(secs=>?) AND j.status='FAILED' AND s.context<>'BENCHMARK') AS dropped,"+
                "(SELECT max(queued_jobs) FROM metric_samples m WHERE m.sampled_at>=b.at AND m.sampled_at<b.at+make_interval(secs=>?)) AS backlog "+
                "FROM b ORDER BY b.at",bucket,minutes,bucket,bucket,bucket,bucket,bucket,bucket,bucket);
        // The server sample is one point per minute, so finer buckets are empty. Carry the last backlog forward.
        Integer lastBacklog=null;
        for(var row:activity) {
            Object backlog=row.get("backlog");
            if(backlog==null) { if(lastBacklog!=null) row.put("backlog",lastBacklog); }
            else lastBacklog=((Number)backlog).intValue();
            for(String count:List.of("arrivals","claims","verdicts","retries","dropped"))
                row.put(count+"_per_min",rate(row.get(count),bucket));
        }
        return Map.of("bucketSeconds",bucket,"minutes",minutes,"server",serverRows,"activity",activity);
    }

    private static double rate(Object count,int bucketSeconds) {
        if(count==null) return 0;
        return Math.round(((Number)count).doubleValue()*6000.0/bucketSeconds)/100.0;
    }

    /**
     * HTTP traffic for the analytics screen. Recent minutes come from the in-process meter, which
     * survives no restart; older ranges come from the per-minute rows the sampler persists.
     */
    public Map<String,Object> apiUsage(int minutes) {
        var live=apiMetrics.summary(minutes);
        long liveRequests=((Number)((Map<?,?>)live.get("now")).get("requests")).longValue();
        if (minutes<=ApiMetrics.WINDOW_MINUTES&&liveRequests>0) { live.put("source","live"); return live; }
        int bucket=Math.max(60,minutes*60/240);
        var rows=db.jdbc.queryForList("SELECT date_bin(make_interval(secs=>?),sampled_at,timestamptz '2000-01-01') AS at,"+
                "sum(requests) AS requests,sum(client_errors) AS client_errors,sum(server_errors) AS server_errors,sum(total_ms) AS total_ms,max(max_ms) AS max_ms "+
                "FROM api_request_samples WHERE sampled_at>now()-make_interval(mins=>?) GROUP BY 1 ORDER BY 1",bucket,minutes);
        if (rows.isEmpty()) { live.put("source","live"); return live; }
        long requests=0,client=0,server=0,totalMs=0,maxMs=0;
        double peak=0;
        var buckets=new ArrayList<Map<String,Object>>();
        for(var row:rows) {
            long count=((Number)row.get("requests")).longValue();
            double rps=Math.round(count*6000.0/bucket)/100.0;
            requests+=count;
            client+=((Number)row.get("client_errors")).longValue();
            server+=((Number)row.get("server_errors")).longValue();
            totalMs+=((Number)row.get("total_ms")).longValue();
            maxMs=Math.max(maxMs,((Number)row.get("max_ms")).longValue());
            peak=Math.max(peak,rps);
            var point=new LinkedHashMap<String,Object>();
            point.put("at",Api.time(row.get("at")).toString());
            point.put("requests",count);
            point.put("rps",rps);
            point.put("clientErrors",row.get("client_errors"));
            point.put("serverErrors",row.get("server_errors"));
            buckets.add(point);
        }
        var totals=new LinkedHashMap<String,Object>();
        totals.put("path","all");
        totals.put("requests",requests);
        totals.put("clientErrors",client);
        totals.put("serverErrors",server);
        totals.put("avgMs",requests==0?0:Math.round((double)totalMs/requests));
        totals.put("maxMs",maxMs);
        var out=new LinkedHashMap<String,Object>();
        out.put("windowMinutes",minutes);
        out.put("bucketSeconds",bucket);
        out.put("now",totals);
        out.put("peakRps",Math.round(peak*100)/100.0);
        out.put("buckets",buckets);
        out.put("endpoints",List.of());
        out.put("source","stored");
        return out;
    }

    // One row per submission with its latest judging. Times are milliseconds; a rejudge is timed from when it was requested.
    private static final String TIMED="SELECT s.id,s.submitted_at,s.context,s.samples_only,s.language_code,s.submitted_by,u.handle,pv.title AS problem,c.title AS contest,r.kind AS run_kind,cp.label,"+
            "CASE WHEN s.context='CONTEST' THEN 'Contest' WHEN s.context='LABORATORY' THEN 'Problem testing' WHEN s.context='BENCHMARK' THEN 'Benchmark' WHEN s.samples_only THEN 'Practice examples' ELSE 'Practice' END AS kind,"+
            "CASE WHEN s.context='CONTEST' OR (SELECT b.lane FROM benchmark_runs b WHERE b.id=s.benchmark_id)='official' THEN 'official' ELSE 'internal' END AS lane,"+
            "l.status,l.verdict,l.passed_tests,l.total_tests,l.execution_time_ms,l.peak_memory_kb,l.generation,l.attempt_count,l.last_error_code,l.worker,l.compile_ms,l.tests_ms,"+
            "round(extract(epoch FROM coalesce(l.first_started_at,now())-l.created_at)*1000) AS wait_ms,"+
            "round(extract(epoch FROM l.completed_at-coalesce(l.last_started_at,l.first_started_at))*1000) AS judge_ms,"+
            "round(extract(epoch FROM l.completed_at-l.created_at)*1000) AS server_ms,"+
            "greatest(0,l.judge_total_ms-coalesce(l.compile_ms,0)-coalesce(l.tests_ms,0)) AS sandbox_ms,"+
            "t.accepted_ms,t.verdict_ms "+
            "FROM submissions s JOIN users u ON u.id=s.submitted_by JOIN problem_versions pv ON pv.id=s.problem_version_id "+
            "LEFT JOIN contest_runs r ON r.id=s.run_id LEFT JOIN competitions c ON c.id=r.competition_id "+
            "LEFT JOIN competition_problems cp ON cp.competition_version_id=s.competition_version_id AND cp.slot=s.problem_slot "+
            "LEFT JOIN LATERAL (SELECT j.status,j.generation,j.attempt_count,j.last_error_code,j.created_at,j.first_started_at,j.last_started_at,j.completed_at,w.name AS worker,res.verdict,res.passed_tests,res.total_tests,res.execution_time_ms,res.peak_memory_kb,res.compile_ms,res.tests_ms,res.judge_total_ms "+
            "FROM judging_jobs j LEFT JOIN judging_results res ON res.job_id=j.id LEFT JOIN judge_workers w ON w.id=j.worker_id WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) l ON true "+
            "LEFT JOIN submission_client_timings t ON t.submission_id=s.id ";

    /** Recent submissions with every latency we know, newest or slowest first. Never includes source code. */
    public List<Map<String,Object>> recentSubmissions(int hours,int limit,String kind,String search,String verdict,boolean slowest) {
        return db.jdbc.queryForList("SELECT * FROM ("+TIMED+"WHERE s.submitted_at>now()-make_interval(hours=>?)) d "+
                "WHERE (?::text IS NULL OR d.kind=?::text) AND (?::text IS NULL OR d.handle ILIKE '%'||?::text||'%' OR d.problem ILIKE '%'||?::text||'%' OR d.contest ILIKE '%'||?::text||'%') "+
                "AND (?::text IS NULL OR d.verdict=?::text) ORDER BY "+(slowest?"d.server_ms DESC NULLS LAST":"d.submitted_at DESC")+" LIMIT ?",
                hours,kind,kind,search,search,search,search,verdict,verdict,limit);
    }

    private static String spread(String column) {
        return "round(avg("+column+")) AS avg_"+column+",round((percentile_cont(0.5) WITHIN GROUP (ORDER BY "+column+"))::numeric) AS p50_"+column+
                ",round((percentile_cont(0.95) WITHIN GROUP (ORDER BY "+column+"))::numeric) AS p95_"+column+",max("+column+") AS max_"+column;
    }

    /** Latency by kind of submission and by language, lane capacity, and how jobs die. */
    public Map<String,Object> latency(int hours) {
        String window="FROM ("+TIMED+"WHERE s.submitted_at>now()-make_interval(hours=>?)) d WHERE d.status='COMPLETED' ";
        // A job that needed more than one claim means infrastructure dropped it; the extra claims are the cost.
        String columns="count(*) AS count,"+spread("wait_ms")+","+spread("judge_ms")+","+spread("server_ms")+","+spread("accepted_ms")+","+spread("verdict_ms")+
                ",round(avg(compile_ms)) AS avg_compile_ms,round(avg(tests_ms)) AS avg_tests_ms,round(avg(sandbox_ms)) AS avg_sandbox_ms,round(avg(total_tests),1) AS avg_tests,"+
                "round(avg(attempt_count),2) AS avg_attempts,count(*) FILTER (WHERE attempt_count>1) AS retried,max(attempt_count) AS worst_attempts ";
        var result=new LinkedHashMap<String,Object>();
        result.put("hours",hours);
        result.put("byKind",db.jdbc.queryForList("SELECT kind,"+columns+window+"GROUP BY kind ORDER BY count(*) DESC",hours));
        result.put("byLanguage",db.jdbc.queryForList("SELECT language_code,"+columns+window+"GROUP BY language_code ORDER BY count(*) DESC",hours));
        // Examples only run a few tests, so they would make capacity look better than it is.
        // Both lanes are always listed, including a lane with no online worker: that is the outage case.
        result.put("lanes",db.jdbc.queryForList("SELECT l.lane,coalesce(w.workers,0) AS workers,coalesce(w.slots,0) AS slots,w.cpus,w.memory_mb,"+
                "coalesce(m.count,0) AS count,m.avg_judge_ms,m.p95_judge_ms,m.avg_attempts,m.retried,m.worst_attempts,coalesce(q.unpublished,0) AS unpublished,q.oldest_unpublished_ms "+
                "FROM (VALUES ('official'),('internal')) l(lane) "+
                "LEFT JOIN (SELECT lane,count(*) AS workers,sum(coalesce(reported_target,desired_concurrency,default_concurrency)) AS slots,max(detected_cpus) AS cpus,max(detected_memory_mb) AS memory_mb FROM judge_workers WHERE "+ONLINE+" AND NOT drain_requested GROUP BY lane) w ON w.lane=l.lane "+
                "LEFT JOIN (SELECT lane,count(*) AS count,round(avg(judge_ms)) AS avg_judge_ms,round((percentile_cont(0.95) WITHIN GROUP (ORDER BY judge_ms))::numeric) AS p95_judge_ms,"+
                "round(avg(attempt_count),2) AS avg_attempts,count(*) FILTER (WHERE attempt_count>1) AS retried,max(attempt_count) AS worst_attempts "+
                window+"AND NOT samples_only GROUP BY lane) m ON m.lane=l.lane "+
                "LEFT JOIN (SELECT lane,count(*) AS unpublished,round(max(extract(epoch FROM now()-created_at))*1000) AS oldest_unpublished_ms FROM judge_outbox WHERE published_at IS NULL GROUP BY lane) q ON q.lane=l.lane "+
                "ORDER BY l.lane",hours));
        // Jobs that ran out of attempts. They are excluded from the averages above, which is why the block is separate.
        String failed="FROM ("+TIMED+"WHERE s.submitted_at>now()-make_interval(hours=>?)) d WHERE d.status='FAILED' ";
        result.put("failures",db.jdbc.queryForMap("SELECT count(*) AS total,"+spread("server_ms")+" "+failed,hours));
        result.put("failureCodes",db.jdbc.queryForList("SELECT coalesce(last_error_code,'UNKNOWN') AS code,count(*) AS count,"+spread("server_ms")+" "+failed+"GROUP BY 1 ORDER BY count(*) DESC",hours));
        result.put("limits",db.jdbc.queryForMap("SELECT pending_submissions_per_user,submissions_per_minute,max_queued_submissions FROM judging_settings"));
        result.put("hostBudgetMb",db.jdbc.queryForObject("SELECT min(host_memory_budget_mb) FROM judge_workers WHERE "+ONLINE,Integer.class));
        result.put("slotMemoryMb",db.jdbc.queryForObject("SELECT max(slot_memory_mb) FROM judge_workers WHERE "+ONLINE,Integer.class));
        return result;
    }

    /** A contestant's browser reports its own timing; the first report of each value is kept. */
    public void clientTiming(Actor actor,UUID submission,Map<String,Object> body) {
        Api.require(actor.id().equals(db.one("SELECT submitted_by FROM submissions WHERE id=?",submission).get("submitted_by")),HttpStatus.FORBIDDEN,"Not your submission");
        int accepted=Api.number(body,"acceptedMs",0,0,86400000);
        Integer verdict=body.get("verdictMs")==null?null:Integer.valueOf(Api.number(body,"verdictMs",0,0,86400000));
        db.jdbc.update("INSERT INTO submission_client_timings(submission_id,accepted_ms,verdict_ms) VALUES (?,?,?) "+
                "ON CONFLICT (submission_id) DO UPDATE SET verdict_ms=coalesce(submission_client_timings.verdict_ms,excluded.verdict_ms)",submission,accepted,verdict);
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
