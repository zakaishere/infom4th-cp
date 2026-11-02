package com.cpplatform.judging;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.LaboratoryService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.*;

/**
 * Administrator load test. Many copies of one program go through the real outbox, broker and judges on
 * a private problem, and each one's timing is reported. Times start when a submission entered the queue,
 * so the browser and the HTTP request are not part of them.
 */
@Service
public class BenchmarkService {
    public static final int MAX_SUBMISSIONS=1000,MAX_SPREAD_SECONDS=3600,MAX_SOURCE=65536;
    private static final String SLUG="system-benchmark-sum";
    private static final String ACTIVE="EXISTS(SELECT 1 FROM submissions s JOIN judging_jobs j ON j.submission_id=s.id WHERE s.benchmark_id=b.id AND j.status IN ('QUEUED','RUNNING','RETRY'))";
    private static final int[] TEST_SIZES={1,5,10,100,500,1000,5000,10000,20000,50000,75000,100000};

    /** Accepted solutions of the benchmark problem. The page offers them; an administrator may paste another program. */
    public static final Map<String,String> SAMPLES=samples();
    private static Map<String,String> samples() {
        var cpp="#include <iostream>\n\nint main() {\n    std::ios::sync_with_stdio(false);\n    std::cin.tie(nullptr);\n    int n;\n    std::cin >> n;\n    long long sum = 0;\n    for (int i = 0; i < n; i++) {\n        int value;\n        std::cin >> value;\n        sum += value;\n    }\n    std::cout << sum << \"\\n\";\n    return 0;\n}\n";
        var python="import sys\n\ndata = sys.stdin.read().split()\nprint(sum(map(int, data[1:])))\n";
        var out=new LinkedHashMap<String,String>();
        out.put("CPP",cpp);out.put("CPP20",cpp);
        out.put("C","#include <stdio.h>\n\nint main(void) {\n    int n, value;\n    long long sum = 0;\n    scanf(\"%d\", &n);\n    for (int i = 0; i < n; i++) {\n        scanf(\"%d\", &value);\n        sum += value;\n    }\n    printf(\"%lld\\n\", sum);\n    return 0;\n}\n");
        out.put("JAVA","import java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));\n        in.nextToken();\n        int n = (int) in.nval;\n        long sum = 0;\n        for (int i = 0; i < n; i++) {\n            in.nextToken();\n            sum += (long) in.nval;\n        }\n        System.out.println(sum);\n    }\n}\n");
        out.put("PYTHON",python);out.put("PYPY",python);
        out.put("JAVASCRIPT","const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nlet sum = 0;\nfor (let i = 1; i <= data[0]; i++) sum += data[i];\nconsole.log(String(sum));\n");
        out.put("GO","package main\n\nimport (\n    \"bufio\"\n    \"fmt\"\n    \"os\"\n)\n\nfunc main() {\n    in := bufio.NewReader(os.Stdin)\n    var n, value int\n    fmt.Fscan(in, &n)\n    sum := 0\n    for i := 0; i < n; i++ {\n        fmt.Fscan(in, &value)\n        sum += value\n    }\n    fmt.Println(sum)\n}\n");
        out.put("RUST","use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    let sum: i64 = input.split_whitespace().skip(1).map(|x| x.parse::<i64>().unwrap()).sum();\n    println!(\"{}\", sum);\n}\n");
        out.put("KOTLIN","fun main() {\n    val data = System.`in`.bufferedReader().readText().trim().split(Regex(\"\\\\s+\"))\n    println(data.drop(1).sumOf { it.toLong() })\n}\n");
        out.put("CSHARP","using System;\nusing System.Linq;\n\nclass Program {\n    static void Main() {\n        var data = Console.In.ReadToEnd().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);\n        Console.WriteLine(data.Skip(1).Sum(x => long.Parse(x)));\n    }\n}\n");
        out.put("RUBY","data = STDIN.read.split.map(&:to_i)\nputs data.drop(1).sum\n");
        out.put("PHP","<?php\n$data = preg_split('/\\s+/', trim(stream_get_contents(STDIN)));\necho array_sum(array_slice($data, 1)), \"\\n\";\n");
        out.put("ZIG","const std = @import(\"std\");\n\npub fn main() !void {\n    const input = try std.io.getStdIn().readToEndAlloc(std.heap.page_allocator, 1 << 30);\n    var it = std.mem.tokenizeAny(u8, input, \" \\r\\n\\t\");\n    const n = try std.fmt.parseInt(usize, it.next().?, 10);\n    var sum: i64 = 0;\n    for (0..n) |_| sum += try std.fmt.parseInt(i64, it.next().?, 10);\n    try std.io.getStdOut().writer().print(\"{d}\\n\", .{sum});\n}\n");
        // Brainfuck has no benchmark program: summing numbers in it is impractical.
        return Collections.unmodifiableMap(out);
    }

    private final Database db;private final LaboratoryService lab;private final ZoneId zone;
    public BenchmarkService(Database db,LaboratoryService lab,@Value("${cp.display-timezone:UTC}") String zone) {
        this.db=db;this.lab=lab;this.zone=ZoneId.of(zone);
    }

    /** The problem, what is ready to run, and past runs. */
    public Map<String,Object> state() {
        var out=new LinkedHashMap<String,Object>();
        var problem=problem();
        out.put("problem",problem);
        out.put("samples",SAMPLES);
        out.put("limits",Map.of("maxSubmissions",MAX_SUBMISSIONS,"maxSpreadSeconds",MAX_SPREAD_SECONDS,"maxSource",MAX_SOURCE));
        out.put("workers",db.jdbc.queryForList("SELECT lane,count(*) AS workers,sum(coalesce(reported_target,desired_concurrency,default_concurrency)) AS slots FROM judge_workers WHERE status='ONLINE' AND last_heartbeat_at>now()-interval '90 seconds' AND NOT drain_requested GROUP BY lane ORDER BY lane"));
        out.put("contestBusy",contestBusy());
        out.put("runs",db.jdbc.queryForList("SELECT b.id,b.language_code,b.lane,b.submission_count,b.spread_seconds,b.custom_source,b.created_at,b.cancelled_at,u.handle AS created_by,"+ACTIVE+" AS active FROM benchmark_runs b JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC LIMIT 25"));
        return out;
    }

    private Map<String,Object> problem() {
        var rows=db.jdbc.queryForList("SELECT v.id AS version_id,v.title,v.statement_md,v.time_limit_ms,v.memory_limit_mb,(SELECT count(*) FROM test_cases t WHERE t.problem_version_id=v.id) AS tests,"
                +"(SELECT r.status FROM problem_validation_results r WHERE r.problem_version_id=v.id ORDER BY r.completed_at DESC NULLS FIRST LIMIT 1) AS validation "
                +"FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE p.system_benchmark AND p.archived_at IS NULL ORDER BY v.version_number DESC LIMIT 1");
        var out=new LinkedHashMap<String,Object>();
        if(rows.isEmpty()){out.put("state","NONE");out.put("languages",List.of());return out;}
        out.putAll(rows.get(0));
        // A rebuilt language image gets a new ID, and the problem only runs on the images it was validated with.
        var languages=db.jdbc.queryForList("SELECT l.code,l.display_name FROM problem_version_languages p JOIN languages l ON l.code=p.language_code JOIN problem_runtime_pins pin ON pin.problem_version_id=p.problem_version_id AND pin.language_code=l.code AND pin.image_id=l.runtime_image_id WHERE p.problem_version_id=? AND l.enabled ORDER BY l.code",rows.get(0).get("version_id"));
        out.put("languages",languages);
        Object validation=rows.get(0).get("validation");
        out.put("state","PASSED".equals(validation)?(languages.isEmpty()?"STALE":"READY"):"PENDING".equals(validation) || "RUNNING".equals(validation)?"VALIDATING":"FAILED");
        return out;
    }

    /** Creates the private problem and sends it for validation, replacing an old one whose judge images have changed. */
    @Transactional
    public Map<String,Object> prepare(Actor actor) {
        lock();
        var current=problem();
        Api.require(!"VALIDATING".equals(current.get("state")),HttpStatus.CONFLICT,"The benchmark problem is already being validated");
        Api.require(!activeRun(),HttpStatus.CONFLICT,"Wait for the running benchmark to finish");
        var languages=db.jdbc.queryForList("SELECT l.code FROM languages l WHERE l.enabled AND EXISTS(SELECT 1 FROM judge_workers w WHERE w.status='ONLINE' AND w.runtime_manifest->>'lane'='internal' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->l.code->>'verified'='true' AND w.runtime_manifest->l.code->>'imageId'=l.runtime_image_id) ORDER BY l.code",String.class)
                .stream().filter(SAMPLES::containsKey).toList();
        Api.require(!languages.isEmpty(),HttpStatus.CONFLICT,"No judge is online with a verified language");
        if(current.get("version_id")!=null)lab.delete(actor,(UUID)current.get("version_id"),"Replaced by a new benchmark problem");
        var body=new HashMap<String,Object>(Map.of("slug",SLUG,"title","Benchmark: sum of numbers","difficulty","EASY","timeLimitMs",2000,"memoryLimitMb",256,"languages",languages,
                "statement","Read n and then n integers, and print their sum. This private problem is only used to measure judging speed."));
        body.put("inputFormat","The first number is n. Then n integers follow.");body.put("outputFormat","Print the sum.");
        UUID version=lab.create(actor,body);
        db.jdbc.update("UPDATE problems SET system_benchmark=true WHERE id=(SELECT problem_id FROM problem_versions WHERE id=?)",version);
        lab.tests(actor,version,tests());
        String reference=languages.contains("CPP")?"CPP":languages.get(0);
        lab.reference(actor,version,Map.of("label","Benchmark solution","language",reference,"sourceCode",SAMPLES.get(reference),"expectedVerdict","ACCEPTED"));
        lab.validate(actor,version);
        return problem();
    }

    /** Twelve tests from one number to a hundred thousand, the same on every install so results can be compared. */
    static List<Map<String,Object>> tests() {
        List<Map<String,Object>> tests=new ArrayList<>();
        for(int i=0;i<TEST_SIZES.length;i++) {
            int size=TEST_SIZES[i];long sum=0;var input=new StringBuilder().append(size).append('\n');
            for(int k=0;k<size;k++) {
                long value=(k*7919L)%1000;
                sum+=value;input.append(value).append(k+1<size?' ':'\n');
            }
            tests.add(Map.of("input",input.toString(),"expected",sum+"\n","sample",i==0));
        }
        return tests;
    }

    private boolean contestBusy() {
        return db.exists("SELECT EXISTS(SELECT 1 FROM contest_runs r WHERE r.kind='OFFICIAL' AND (r.status='RUNNING' OR (r.status='PENDING' AND r.starts_at<now()+interval '30 minutes')))");
    }
    private boolean activeRun() {
        return db.exists("SELECT EXISTS(SELECT 1 FROM benchmark_runs b WHERE "+ACTIVE+")");
    }
    private void lock(){db.jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtext('benchmark'))");}

    @Transactional
    public UUID start(Actor actor,Map<String,Object> body) {
        lock();
        int count=Api.number(body,"count",0,1,MAX_SUBMISSIONS),spread=Api.number(body,"spreadSeconds",0,0,MAX_SPREAD_SECONDS);
        String language=Api.text(body,"language",24),lane=Api.optional(body,"lane","official",16);
        Api.require(List.of("official","internal").contains(lane),HttpStatus.BAD_REQUEST,"Lane must be official or internal");
        var problem=problem();
        Api.require("READY".equals(problem.get("state")),HttpStatus.CONFLICT,"Prepare the benchmark problem first");
        @SuppressWarnings("unchecked") var languages=(List<Map<String,Object>>)problem.get("languages");
        Api.require(languages.stream().anyMatch(l->language.equals(l.get("code"))),HttpStatus.CONFLICT,"This language is not ready on the benchmark problem. Prepare the problem again.");
        Object rawSource=body.get("sourceCode");
        String source=rawSource==null || String.valueOf(rawSource).isBlank()?SAMPLES.get(language):String.valueOf(rawSource);
        Api.require(source!=null && source.length()<=MAX_SOURCE,HttpStatus.BAD_REQUEST,"The program must be at most "+MAX_SOURCE+" characters");
        Api.require(!activeRun(),HttpStatus.CONFLICT,"Another benchmark is still running");
        // Contest judges belong to contestants the moment a contest is on.
        Api.require(!lane.equals("official") || !contestBusy(),HttpStatus.CONFLICT,"A contest is running or starts within 30 minutes. Use the internal judges or wait.");
        UUID version=(UUID)problem.get("version_id");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM judge_workers w JOIN problem_runtime_pins pin ON pin.problem_version_id=? AND pin.language_code=? WHERE w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds' AND NOT w.drain_requested AND w.lane=? AND w.runtime_manifest->?->>'verified'='true' AND w.runtime_manifest->?->>'imageId'=pin.image_id)",version,language,lane,language,language),
                HttpStatus.CONFLICT,"No "+lane+" judge is online for this language");
        long queued=db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs WHERE status IN ('QUEUED','RUNNING','RETRY')",Long.class);
        long limit=((Number)db.one("SELECT max_queued_submissions FROM judging_settings WHERE id=1").get("max_queued_submissions")).longValue();
        Api.require(queued+count<limit,HttpStatus.CONFLICT,"This would fill the judging queue ("+queued+" waiting, limit "+limit+")");
        UUID run=db.id("INSERT INTO benchmark_runs(created_by,problem_version_id,language_code,lane,submission_count,spread_seconds,custom_source) VALUES (?,?,?,?,?,?,?) RETURNING id",
                actor.id(),version,language,lane,count,spread,!source.equals(SAMPLES.get(language)));
        Instant base=db.jdbc.queryForObject("SELECT clock_timestamp()",java.time.OffsetDateTime.class).toInstant();
        for(int i=0;i<count;i++) {
            // Each job is scheduled for its own moment, so pacing survives a server restart.
            Timestamp at=Timestamp.from(base.plusMillis(spread*1000L*i/count));
            UUID submission=db.id("INSERT INTO submissions(context,submitted_by,problem_version_id,language_code,source_code,idempotency_key,submitted_at,benchmark_id,benchmark_position) VALUES ('BENCHMARK',?,?,?,?,?,?,?,?) RETURNING id",
                    actor.id(),version,language,source,UUID.randomUUID(),at,run,i+1);
            db.jdbc.update("INSERT INTO judging_jobs(submission_id,problem_version_id,priority,available_at,created_at) VALUES (?,?,0,?,?)",submission,version,at,at);
        }
        db.audit(actor.id(),"BENCHMARK_START","benchmark",run,Api.optional(body,"reason",count+" submissions",2000));
        return run;
    }

    /** Jobs not yet started are dropped; ones already running finish so their numbers stay real. */
    @Transactional
    public int cancel(Actor actor,UUID run,String reason) {
        db.one("SELECT id FROM benchmark_runs WHERE id=? FOR UPDATE",run);
        int cancelled=db.jdbc.update("UPDATE judging_jobs j SET status='FAILED',completed_at=now(),last_error_code='BENCHMARK_CANCELLED',lease_token=NULL,lease_expires_at=NULL FROM submissions s WHERE s.id=j.submission_id AND s.benchmark_id=? AND j.status IN ('QUEUED','RETRY')",run);
        db.jdbc.update("UPDATE benchmark_runs SET cancelled_at=coalesce(cancelled_at,now()) WHERE id=?",run);
        db.audit(actor.id(),"BENCHMARK_CANCEL","benchmark",run,reason);
        return cancelled;
    }

    private static final String ROWS="SELECT s.benchmark_position AS position,s.id AS submission_id,s.language_code,s.submitted_at AS queued_at,j.status,j.attempt_count AS attempts,j.first_started_at AS started_at,j.completed_at AS finished_at,j.last_error_code AS error,w.name AS worker,"
            +"res.verdict,res.passed_tests,res.total_tests,res.execution_time_ms,res.peak_memory_kb,res.compile_ms,res.tests_ms,res.judge_total_ms,"
            +"round(extract(epoch FROM (SELECT min(o.published_at) FROM judge_outbox o WHERE o.job_id=j.id)-s.submitted_at)*1000) AS dispatch_ms,"
            +"round(extract(epoch FROM j.first_started_at-s.submitted_at)*1000) AS wait_ms,"
            +"round(extract(epoch FROM j.completed_at-coalesce(j.last_started_at,j.first_started_at))*1000) AS judge_ms,"
            +"CASE WHEN j.status='COMPLETED' THEN round(extract(epoch FROM j.completed_at-s.submitted_at)*1000) END AS total_ms,"
            +"greatest(0,res.judge_total_ms-coalesce(res.compile_ms,0)-coalesce(res.tests_ms,0)) AS sandbox_ms "
            +"FROM submissions s JOIN LATERAL (SELECT x.* FROM judging_jobs x WHERE x.submission_id=s.id ORDER BY x.generation DESC LIMIT 1) j ON true LEFT JOIN judging_results res ON res.job_id=j.id LEFT JOIN judge_workers w ON w.id=j.worker_id "
            +"WHERE s.benchmark_id=? ORDER BY s.benchmark_position";

    /** The columns that get an average and percentiles, with the name they carry in the report. */
    static final Map<String,String> METRICS=metrics();
    private static Map<String,String> metrics() {
        var out=new LinkedHashMap<String,String>();
        out.put("total_ms","Total latency (ms)");out.put("wait_ms","Queue wait (ms)");out.put("dispatch_ms","Sent to broker (ms)");out.put("judge_ms","Judging, server view (ms)");
        out.put("judge_total_ms","Judging, worker view (ms)");out.put("compile_ms","Compile (ms)");out.put("tests_ms","Running tests (ms)");out.put("sandbox_ms","Sandbox overhead (ms)");
        out.put("execution_time_ms","Slowest test CPU (ms)");out.put("peak_memory_kb","Peak memory (KB)");
        return Collections.unmodifiableMap(out);
    }

    public Map<String,Object> report(UUID run) {
        var out=new LinkedHashMap<String,Object>(db.one("SELECT b.id,b.language_code,b.lane,b.submission_count,b.spread_seconds,b.custom_source,b.created_at,b.cancelled_at,u.handle AS created_by,v.title AS problem,(SELECT count(*) FROM test_cases t WHERE t.problem_version_id=b.problem_version_id) AS tests,"+ACTIVE+" AS active FROM benchmark_runs b JOIN users u ON u.id=b.created_by JOIN problem_versions v ON v.id=b.problem_version_id WHERE b.id=?",run));
        var rows=db.jdbc.queryForList(ROWS,run);
        out.put("summary",summarize(rows));
        out.put("rows",rows);
        return out;
    }

    /** Totals, throughput and the spread of every timing, from finished submissions only. */
    static Map<String,Object> summarize(List<Map<String,Object>> rows) {
        var out=new LinkedHashMap<String,Object>();
        out.put("submissions",rows.size());
        out.put("finished",rows.stream().filter(r->"COMPLETED".equals(r.get("status"))).count());
        out.put("failed",rows.stream().filter(r->"FAILED".equals(r.get("status"))).count());
        out.put("waiting",rows.stream().filter(r->!List.of("COMPLETED","FAILED").contains(r.get("status"))).count());
        out.put("accepted",rows.stream().filter(r->"ACCEPTED".equals(r.get("verdict"))).count());
        out.put("verdicts",rows.stream().filter(r->r.get("verdict")!=null).collect(Collectors.groupingBy(r->(String)r.get("verdict"),TreeMap::new,Collectors.counting())));
        out.put("workers",rows.stream().filter(r->r.get("worker")!=null).collect(Collectors.groupingBy(r->(String)r.get("worker"),TreeMap::new,Collectors.counting())));
        var finished=rows.stream().filter(r->r.get("finished_at")!=null && "COMPLETED".equals(r.get("status"))).toList();
        if(!finished.isEmpty()) {
            Instant first=finished.stream().map(r->Api.time(r.get("queued_at"))).min(Comparator.naturalOrder()).orElseThrow();
            Instant last=finished.stream().map(r->Api.time(r.get("finished_at"))).max(Comparator.naturalOrder()).orElseThrow();
            long millis=Math.max(1,Duration.between(first,last).toMillis());
            out.put("elapsed_ms",millis);
            out.put("per_minute",Math.round(finished.size()*60000.0/millis*10)/10.0);
        }
        var metrics=new LinkedHashMap<String,Object>();
        for(var metric:METRICS.entrySet()) {
            var values=rows.stream().map(r->r.get(metric.getKey())).filter(Objects::nonNull).map(v->((Number)v).doubleValue()).sorted().toList();
            if(values.isEmpty())continue;
            var row=new LinkedHashMap<String,Object>();
            row.put("label",metric.getValue());row.put("count",values.size());
            row.put("min",Math.round(values.get(0)));
            row.put("avg",Math.round(values.stream().mapToDouble(Double::doubleValue).average().orElse(0)));
            row.put("p50",percentile(values,0.5));row.put("p95",percentile(values,0.95));row.put("p99",percentile(values,0.99));
            row.put("max",Math.round(values.get(values.size()-1)));
            metrics.put(metric.getKey(),row);
        }
        out.put("metrics",metrics);
        return out;
    }
    /** Nearest rank: always a value that really happened. */
    static long percentile(List<Double> sorted,double share) {
        return Math.round(sorted.get(Math.max(0,(int)Math.ceil(share*sorted.size())-1)));
    }

    /** Three sheets: the summary, every submission, and every test of every submission. */
    public byte[] workbook(UUID run) {
        var report=report(run);
        @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)report.get("rows");
        @SuppressWarnings("unchecked") var summary=(Map<String,Object>)report.get("summary");
        DateTimeFormatter format=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS").withZone(zone);
        List<List<Object>> overview=new ArrayList<>();
        overview.add(line("Time zone",zone.getId()));
        for(var field:new String[][]{{"Problem","problem"},{"Tests per submission","tests"},{"Language","language_code"},{"Judges","lane"},{"Submissions requested","submission_count"},{"Spread over (seconds)","spread_seconds"},{"Started by","created_by"}})overview.add(line(field[0],report.get(field[1])));
        overview.add(line("Custom program",Boolean.TRUE.equals(report.get("custom_source"))?"Yes":"No"));
        overview.add(line("Started at",format.format(Api.time(report.get("created_at")))));
        if(report.get("cancelled_at")!=null)overview.add(line("Cancelled at",format.format(Api.time(report.get("cancelled_at")))));
        overview.add(line("Finished",summary.get("finished")));overview.add(line("Failed or cancelled",summary.get("failed")));overview.add(line("Still waiting",summary.get("waiting")));overview.add(line("Accepted",summary.get("accepted")));
        overview.add(line("Elapsed (ms)",summary.get("elapsed_ms")));overview.add(line("Throughput (per minute)",summary.get("per_minute")));
        @SuppressWarnings("unchecked") var verdicts=(Map<String,Object>)summary.get("verdicts");
        verdicts.forEach((verdict,count)->overview.add(line("Verdict: "+verdict,count)));
        @SuppressWarnings("unchecked") var workers=(Map<String,Object>)summary.get("workers");
        workers.forEach((worker,count)->overview.add(line("Worker: "+worker,count)));
        overview.add(new ArrayList<>());
        overview.add(new ArrayList<>(List.of("Timing","Count","Min","Average","P50","P95","P99","Max")));
        @SuppressWarnings("unchecked") var metrics=(Map<String,Map<String,Object>>)summary.get("metrics");
        for(var m:metrics.values())overview.add(new ArrayList<>(Arrays.asList(m.get("label"),m.get("count"),m.get("min"),m.get("avg"),m.get("p50"),m.get("p95"),m.get("p99"),m.get("max"))));

        List<String> header=new ArrayList<>(List.of("#","Submission ID","Language","Status","Verdict","Tests passed","Tests total","Queued at","Started at","Finished at"));
        header.addAll(METRICS.values());header.addAll(List.of("Worker","Attempts","Error"));
        List<List<Object>> submissions=new ArrayList<>();
        for(var r:rows) {
            List<Object> row=new ArrayList<>(Arrays.asList(r.get("position"),String.valueOf(r.get("submission_id")),r.get("language_code"),r.get("status"),r.get("verdict"),r.get("passed_tests"),r.get("total_tests"),
                    moment(format,r.get("queued_at")),moment(format,r.get("started_at")),moment(format,r.get("finished_at"))));
            for(String metric:METRICS.keySet())row.add(r.get(metric));
            row.addAll(Arrays.asList(r.get("worker"),r.get("attempts"),r.get("error")));
            submissions.add(row);
        }
        List<List<Object>> tests=new ArrayList<>();
        for(var c:db.jdbc.queryForList("SELECT s.benchmark_position,row_number() OVER (PARTITION BY s.id ORDER BY g.position,t.position) AS number,t.is_sample,c.verdict,c.execution_time_ms,c.peak_memory_kb FROM submissions s JOIN judging_jobs j ON j.submission_id=s.id JOIN test_case_results c ON c.job_id=j.id JOIN test_cases t ON t.id=c.test_case_id JOIN test_case_groups g ON g.id=t.group_id WHERE s.benchmark_id=? ORDER BY s.benchmark_position,number",run))
            tests.add(new ArrayList<>(Arrays.asList(c.get("benchmark_position"),c.get("number"),Boolean.TRUE.equals(c.get("is_sample"))?"Example":"Hidden",c.get("verdict"),c.get("execution_time_ms"),c.get("peak_memory_kb"))));
        return Xlsx.write(List.of(new Xlsx.Sheet("Summary",List.of("Setting","Value","","","","","",""),overview),new Xlsx.Sheet("Submissions",header,submissions),
                new Xlsx.Sheet("Tests",List.of("Submission #","Test #","Type","Verdict","CPU (ms)","Peak memory so far (KB)"),tests)));
    }
    private static List<Object> line(String label,Object value){return new ArrayList<>(Arrays.asList(label,value));}
    private static String moment(DateTimeFormatter format,Object value){return value==null?null:format.format(Api.time(value));}
}
