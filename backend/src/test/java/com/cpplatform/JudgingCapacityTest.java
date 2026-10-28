package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.*;
import com.cpplatform.competition.*;
import com.cpplatform.judging.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Administrator judging capacity: real PostgreSQL transactions and concurrent claims. */
class JudgingCapacityTest {
    static EmbeddedPostgres postgres;static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;
    static JudgingSettingsService settings;static CompetitionService contests;static SubmissionService submissions;static MockMvc mvc;
    static final String IMAGE="sha256:"+"c".repeat(64);
    static final ObjectMapper JSON=new ObjectMapper();
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=","--spring.datasource.hikari.maximum-pool-size=30",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);settings=context.getBean(JudgingSettingsService.class);
        contests=context.getBean(CompetitionService.class);submissions=context.getBean(SubmissionService.class);
        mvc=MockMvcBuilders.webAppContextSetup((WebApplicationContext)context)
                .addFilters(context.getBean(com.cpplatform.config.RequestSizeFilter.class),context.getBean(FilterChainProxy.class)).build();
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}
    /** Each test starts with no active jobs, no live workers and default settings. */
    @BeforeEach void reset() {
        db.jdbc.update("UPDATE judging_jobs SET status='FAILED',completed_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE status IN ('QUEUED','RUNNING','RETRY')");
        db.jdbc.update("UPDATE judge_workers SET status='OFFLINE',last_heartbeat_at=now()-interval '2 days'");
        db.jdbc.update("UPDATE judging_settings SET official_concurrency_limit=NULL,internal_concurrency_limit=NULL,pending_submissions_per_user=5,submissions_per_minute=12,max_queued_submissions=5000");
    }

    record User(Actor actor,String token) {}
    User user(boolean admin) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        var session=auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!"));
        UUID id=(UUID)session.get("userId");
        if(admin)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new User(new Actor(id,admin?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT")),(String)session.get("accessToken"));
    }
    static Map<String,Object> registration(String name,String lane,int max,Map<String,Object> extra) {
        var body=new HashMap<String,Object>(Map.of("name",name,"capacity",max,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane",lane)));
        body.putAll(extra);return body;
    }
    UUID worker(String name,String lane,int max,Map<String,Object> extra) {
        UUID id=(UUID)judge.register(registration(name,lane,max,extra)).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        return id;
    }
    UUID worker(String lane,int max){return worker(lane+"-"+UUID.randomUUID(),lane,max,Map.of());}
    record Problem(User owner,UUID version,UUID job) {}
    Problem problem() {
        User owner=user(true);
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        UUID version=lab.create(owner.actor,Map.of("slug","cap-"+UUID.randomUUID(),"title","Sum","statement","Add","languages",List.of("CPP")));
        lab.tests(owner.actor,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner.actor,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner.actor,version);
        UUID job=db.jdbc.queryForObject("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.validation_id=?",UUID.class,validation);
        return new Problem(owner,version,job);
    }
    /** n internal (laboratory) jobs for the same immutable problem version. */
    List<UUID> internalJobs(int n) {
        UUID first=problem().job;List<UUID> jobs=new ArrayList<>(List.of(first));
        for(int g=2;g<=n;g++)jobs.add(db.id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation) SELECT submission_id,problem_version_id,? FROM judging_jobs WHERE id=? RETURNING id",g,first));
        return jobs;
    }
    String claim(UUID job,UUID worker) {
        try{return judge.claim(job,worker,0).isPresent()?"CLAIMED":"STALE";}
        catch(ResponseStatusException e){return e.getStatusCode().value()==429?"BUSY":"CONFLICT";}
    }
    Map<String,Object> accepted(UUID job) {
        var tests=db.jdbc.queryForList("SELECT id FROM test_cases WHERE problem_version_id=(SELECT problem_version_id FROM judging_jobs WHERE id=?)",job);
        return Map.of("verdict","ACCEPTED","executionTimeMs",5,"peakMemoryKb",512,
                "cases",tests.stream().map(t->Map.of("id",t.get("id"),"verdict","ACCEPTED","executionTimeMs",5,"peakMemoryKb",512)).toList());
    }
    void complete(UUID job) {
        var j=db.one("SELECT worker_id,lease_token FROM judging_jobs WHERE id=?",job);
        judge.complete(job,(UUID)j.get("worker_id"),(UUID)j.get("lease_token"),accepted(job));
    }
    long running(){return db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs WHERE status='RUNNING'",Long.class);}
    long version(){return db.jdbc.queryForObject("SELECT version FROM judging_settings",Long.class);}
    Map<String,Object> save(User admin,Map<String,Object> changes) {
        var body=new HashMap<String,Object>(changes);body.putIfAbsent("version",version());body.putIfAbsent("reason","Capacity test");
        return settings.update(admin.actor,body);
    }
    /** Runs every task at the same moment and returns the claim outcomes. */
    List<String> concurrently(List<Callable<String>> tasks) throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(tasks.size());CountDownLatch gate=new CountDownLatch(1);
        try {
            List<Future<String>> futures=new ArrayList<>();
            for(var task:tasks)futures.add(pool.submit(()->{gate.await();return task.call();}));
            gate.countDown();List<String> results=new ArrayList<>();
            for(var f:futures)results.add(f.get(60,TimeUnit.SECONDS));
            return results;
        } finally {pool.shutdownNow();}
    }
    @SuppressWarnings("unchecked") static Map<String,Object> lane(Map<String,Object> overview,String lane) {
        return (Map<String,Object>)((Map<String,Object>)overview.get("lanes")).get(lane);
    }

    @Test void onlySuperAdminsReadOrChangeJudgingSettings() throws Exception {
        User participant=user(false),admin=user(true);
        mvc.perform(get("/api/admin/judging/settings")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/judging/settings").header("Authorization","Bearer "+participant.token)).andExpect(status().isForbidden());
        String body="{\"version\":"+version()+",\"reason\":\"no\",\"internalConcurrencyLimit\":0}";
        mvc.perform(patch("/api/admin/judging/settings").header("Authorization","Bearer "+participant.token).contentType("application/json").content(body)).andExpect(status().isForbidden());
        UUID w=worker("internal",2);
        mvc.perform(patch("/api/admin/judging/workers/"+w+"/settings").header("Authorization","Bearer "+participant.token).contentType("application/json")
                .content("{\"version\":1,\"reason\":\"no\",\"draining\":true}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/judge/workers/"+w+"/drain").header("Authorization","Bearer "+participant.token).contentType("application/json")
                .content("{\"reason\":\"no\"}")).andExpect(status().isForbidden());
        assertNull(settings.settingsRow().get("internal_concurrency_limit"));
        assertEquals(false,db.one("SELECT drain_requested FROM judge_workers WHERE id=?",w).get("drain_requested"));
        String read=mvc.perform(get("/api/admin/judging/settings").header("Authorization","Bearer "+admin.token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(JSON.readTree(read).at("/lanes/internal/effectiveCapacity").asInt()>=2);
        assertFalse(read.contains("source_code") || read.contains("expected_output") || read.contains("WORKER_TOKEN"));
        mvc.perform(patch("/api/admin/judging/settings").header("Authorization","Bearer "+admin.token).contentType("application/json").content(body)).andExpect(status().isOk());
        assertEquals(0,settings.settingsRow().get("internal_concurrency_limit"));
    }

    @Test void changesRequireReasonAreVersionedAndAuditedWithPreviousValues() throws Exception {
        User admin=user(true);worker("official",8);
        long before=version();
        assertThrows(ResponseStatusException.class,()->settings.update(admin.actor,Map.of("version",before,"officialConcurrencyLimit",4)));
        var view=save(admin,Map.of("officialConcurrencyLimit",4,"submissionsPerMinute",20,"reason","Rehearsal sizing"));
        assertEquals(before+1,version());
        assertEquals(4,lane(view,"official").get("configuredLimit"));
        var audit=db.one("SELECT actor_id,reason,metadata::text AS metadata,created_at FROM audit_logs WHERE action='JUDGING_SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1");
        assertEquals(admin.actor.id(),audit.get("actor_id"));assertEquals("Rehearsal sizing",audit.get("reason"));assertNotNull(audit.get("created_at"));
        var metadata=JSON.readTree((String)audit.get("metadata"));
        assertTrue(metadata.at("/previous/officialConcurrencyLimit").isNull());
        assertEquals(4,metadata.at("/new/officialConcurrencyLimit").asInt());
        assertEquals(12,metadata.at("/previous/submissionsPerMinute").asInt());
        // A stale version is a conflict, not a silent overwrite.
        var stale=assertThrows(ResponseStatusException.class,()->settings.update(admin.actor,Map.of("version",before,"reason","Old tab","officialConcurrencyLimit",2)));
        assertEquals(409,stale.getStatusCode().value());
        assertEquals(4,settings.settingsRow().get("official_concurrency_limit"));
    }

    @Test void concurrentAdministratorEditsCannotBothApply() throws Exception {
        User first=user(true),second=user(true);worker("internal",8);
        long v=version();
        var results=concurrently(List.of(
                ()->{try{settings.update(first.actor,Map.of("version",v,"reason","A","internalConcurrencyLimit",3));return "OK";}catch(ResponseStatusException e){return String.valueOf(e.getStatusCode().value());}},
                ()->{try{settings.update(second.actor,Map.of("version",v,"reason","B","internalConcurrencyLimit",5));return "OK";}catch(ResponseStatusException e){return String.valueOf(e.getStatusCode().value());}}));
        assertEquals(1,results.stream().filter("OK"::equals).count());
        assertEquals(1,results.stream().filter("409"::equals).count());
        assertEquals(v+1,version());
    }

    @Test void invalidSettingsAreRejected() {
        User admin=user(true);UUID w=worker("small-"+UUID.randomUUID(),"official",4,Map.of());
        for(var bad:List.<Map<String,Object>>of(Map.of("officialConcurrencyLimit",-1),Map.of("officialConcurrencyLimit",1025),
                Map.of("pendingSubmissionsPerUser",0),Map.of("submissionsPerMinute",601),Map.of("maxQueuedSubmissions",0),Map.of("slots",16)))
            assertEquals(400,assertThrows(ResponseStatusException.class,()->save(admin,bad)).getStatusCode().value(),bad.toString());
        long wv=db.jdbc.queryForObject("SELECT settings_version FROM judge_workers WHERE id=?",Long.class,w);
        for(int bad:new int[]{0,257})
            assertEquals(400,assertThrows(ResponseStatusException.class,()->settings.updateWorker(admin.actor,w,Map.of("version",wv,"reason","x","desiredConcurrency",bad),true)).getStatusCode().value());
        assertThrows(ResponseStatusException.class,()->settings.updateWorker(admin.actor,w,Map.of("version",wv,"desiredConcurrency",2),true));
        assertThrows(ResponseStatusException.class,()->judge.register(registration("bad-"+UUID.randomUUID(),"official",4,Map.of("laneMemoryBudgetMb",2048))));
    }

    @SuppressWarnings("unchecked")
    @Test void administratorsMaySetAnyWorkerCountWithHonestWarnings() {
        User admin=user(true);
        UUID w=worker("small-"+UUID.randomUUID(),"official",4,Map.of("detectedCpus",4,"detectedMemoryMb",8192));
        // A global limit above what workers provide is saved, but effective capacity stays truthful.
        var view=save(admin,Map.of("officialConcurrencyLimit",16));
        assertEquals(16,lane(view,"official").get("configuredLimit"));
        assertEquals(4L,((Number)lane(view,"official").get("effectiveCapacity")).longValue());
        assertTrue(((List<String>)view.get("warnings")).get(0).contains("16"));
        assertTrue(((List<?>)lane(view,"official").get("constraints")).stream().anyMatch(c->c.toString().startsWith("WORKER_CAPACITY")));
        // A worker count beyond the deployment default, the cores and the memory is accepted and explained.
        var worker=settings.updateWorker(admin.actor,w,Map.of("version",1,"reason","Bigger round","desiredConcurrency",12),true);
        assertEquals(12,worker.get("effectiveConcurrency"));
        var warnings=(List<String>)worker.get("warnings");
        assertTrue(warnings.stream().anyMatch(x->x.contains("4 detected CPU cores")),warnings.toString());
        assertTrue(warnings.stream().anyMatch(x->x.contains("8192 MiB of detected memory")),warnings.toString());
        assertEquals(12,judge.heartbeat(w,Map.of()).get("desiredConcurrency"));
        assertEquals(12L,((Number)lane(settings.overview(),"official").get("effectiveCapacity")).longValue());
        var audit=db.one("SELECT metadata::text AS m FROM audit_logs WHERE action='WORKER_SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1");
        assertTrue(audit.get("m").toString().contains("warnings"));
    }

    @Test void globalLimitIsSharedByAllWorkersUnderConcurrentClaims() throws Exception {
        User admin=user(true);UUID a=worker("internal",4),b=worker("internal",4);
        save(admin,Map.of("internalConcurrencyLimit",3));
        List<UUID> jobs=internalJobs(6);List<Callable<String>> tasks=new ArrayList<>();
        for(UUID job:jobs){tasks.add(()->claim(job,a));tasks.add(()->claim(job,b));}
        var results=concurrently(tasks);
        assertEquals(3,results.stream().filter("CLAIMED"::equals).count(),results.toString());
        assertEquals(3,running());
        assertTrue(results.contains("BUSY"));
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs WHERE status='QUEUED' AND id IN ("+String.join(",",Collections.nCopies(6,"?"))+")",Long.class,jobs.toArray()));
        var view=settings.overview();
        assertEquals(3L,((Number)lane(view,"internal").get("effectiveCapacity")).longValue());
        assertEquals(0L,((Number)lane(view,"internal").get("availableSlots")).longValue());
        assertEquals(8L,((Number)lane(view,"internal").get("workerCapacity")).longValue());
    }

    @Test void perWorkerLimitHoldsUnderConcurrentClaims() throws Exception {
        User admin=user(true);UUID w=worker("internal",4);
        settings.updateWorker(admin.actor,w,Map.of("version",1,"reason","Smaller","desiredConcurrency",2),true);
        List<UUID> jobs=internalJobs(5);List<Callable<String>> tasks=new ArrayList<>();
        for(UUID job:jobs){tasks.add(()->claim(job,w));tasks.add(()->claim(job,w));}
        var results=concurrently(tasks);
        assertEquals(2,results.stream().filter("CLAIMED"::equals).count(),results.toString());
        assertEquals(2,running());
    }

    @Test void loweringLetsActiveJobsFinishAndBlocksNewClaimsUntilBelowLimit() {
        User admin=user(true);UUID w=worker("internal",4);
        save(admin,Map.of("internalConcurrencyLimit",3));
        List<UUID> jobs=internalJobs(5);
        for(int i=0;i<3;i++)assertEquals("CLAIMED",claim(jobs.get(i),w));
        var view=save(admin,Map.of("internalConcurrencyLimit",1));
        assertEquals(true,lane(view,"internal").get("overTarget"));
        assertTrue(((List<?>)lane(view,"internal").get("constraints")).stream().anyMatch(c->c.toString().startsWith("OVER_TARGET")));
        assertEquals("BUSY",claim(jobs.get(3),w));
        // Running jobs keep their leases and complete with their real verdicts.
        complete(jobs.get(0));assertEquals("BUSY",claim(jobs.get(3),w));
        complete(jobs.get(1));assertEquals("BUSY",claim(jobs.get(3),w));
        complete(jobs.get(2));assertEquals("CLAIMED",claim(jobs.get(3),w));
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM judging_results WHERE verdict='ACCEPTED' AND job_id IN (?,?,?)",Long.class,jobs.get(0),jobs.get(1),jobs.get(2)));
        // Refused claims did not consume attempts.
        assertEquals(1,db.one("SELECT attempt_count FROM judging_jobs WHERE id=?",jobs.get(3)).get("attempt_count"));
        assertEquals(0,db.one("SELECT attempt_count FROM judging_jobs WHERE id=?",jobs.get(4)).get("attempt_count"));
    }

    @Test void raisingLimitsEnablesMoreWorkLiveEvenAboveTheDeploymentDefault() {
        User admin=user(true);UUID w=worker("internal",2);
        settings.updateWorker(admin.actor,w,Map.of("version",1,"reason","Start small","desiredConcurrency",1),true);
        List<UUID> jobs=internalJobs(4);
        assertEquals("CLAIMED",claim(jobs.get(0),w));assertEquals("BUSY",claim(jobs.get(1),w));
        var raised=settings.updateWorker(admin.actor,w,Map.of("version",2,"reason","Grow","desiredConcurrency",2),true);
        assertEquals(2,raised.get("effectiveConcurrency"));
        assertEquals(2,judge.heartbeat(w,Map.of("active",1,"target",1)).get("desiredConcurrency"));
        assertEquals("CLAIMED",claim(jobs.get(1),w));assertEquals("BUSY",claim(jobs.get(2),w));
        settings.updateWorker(admin.actor,w,Map.of("version",3,"reason","Above default","desiredConcurrency",3),true);
        assertEquals("CLAIMED",claim(jobs.get(2),w));assertEquals("BUSY",claim(jobs.get(3),w));
    }

    @Test void officialAndInternalLimitsStaySeparate() throws Exception {
        User admin=user(true);UUID internal=worker("internal",2),official=worker("official",2);
        save(admin,Map.of("officialConcurrencyLimit",1,"internalConcurrencyLimit",1));
        Problem p=problem();
        var c=judge.claim(p.job,internal,0).orElseThrow();
        judge.complete(p.job,internal,Api.uuid(c.get("leaseToken")),accepted(p.job));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Validated");
        UUID contest=contests.create(p.owner.actor,Map.of("slug","lanes-"+UUID.randomUUID(),"title","Lane contest","languages",List.of("CPP"),"durationSeconds",120));
        contests.attach(p.owner.actor,contest,p.version,1,"A");contests.rehearsal(p.owner.actor,contest,Map.of());
        java.time.Instant start=java.time.Instant.now().plusSeconds(2);
        UUID run=contests.schedule(p.owner.actor,contest,start,"PUBLIC");
        User entrant=user(false);contests.register(entrant.actor,contest,null);
        while(java.time.Instant.now().isBefore(start))Thread.sleep(20);
        UUID submission=submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID first=db.jdbc.queryForObject("SELECT id FROM judging_jobs WHERE submission_id=?",UUID.class,submission);
        UUID second=db.id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation) SELECT submission_id,problem_version_id,2 FROM judging_jobs WHERE id=? RETURNING id",first);
        List<UUID> lab=internalJobs(2);
        assertEquals("CLAIMED",claim(first,official));
        assertEquals("CLAIMED",claim(lab.get(0),internal));
        assertEquals("BUSY",claim(second,official));
        assertEquals("BUSY",claim(lab.get(1),internal));
        assertEquals("STALE",claim(first,internal));
    }

    @Test void workerSettingsAndDrainSurviveReconnectsAndRestarts() {
        User admin=user(true);String name="persist-"+UUID.randomUUID();
        UUID w=worker(name,"official",4,Map.of());
        settings.updateWorker(admin.actor,w,Map.of("version",1,"reason","Tune","desiredConcurrency",2),true);
        settings.updateWorker(admin.actor,w,Map.of("version",2,"reason","Maintenance","draining",true),true);
        var control=judge.register(registration(name,"official",4,Map.of()));
        assertEquals(w,control.get("workerId"));
        assertEquals(0,control.get("desiredConcurrency"));assertEquals(true,control.get("draining"));
        var row=db.one("SELECT status,desired_concurrency,drain_requested FROM judge_workers WHERE id=?",w);
        assertEquals("DRAINING",row.get("status"));assertEquals(2,row.get("desired_concurrency"));
        // Offline recovery and re-registration still keep the administrator's drain decision.
        db.jdbc.update("UPDATE judge_workers SET last_heartbeat_at=now()-interval '5 minutes' WHERE id=?",w);judge.recover();
        assertEquals(409,assertThrows(ResponseStatusException.class,()->judge.heartbeat(w,Map.of())).getStatusCode().value());
        assertEquals(true,judge.register(registration(name,"official",4,Map.of())).get("draining"));
        assertEquals("DRAINING",db.one("SELECT status FROM judge_workers WHERE id=?",w).get("status"));
        settings.updateWorker(admin.actor,w,Map.of("version",3,"reason","Done","draining",false),true);
        assertEquals(2,judge.heartbeat(w,Map.of("active",0,"target",0)).get("desiredConcurrency"));
        // A restart with a smaller deployment default keeps the administrator's value and warns.
        assertEquals(2,judge.register(registration(name,"official",1,Map.of())).get("desiredConcurrency"));
        var view=settings.overview();
        @SuppressWarnings("unchecked") var mine=((List<Map<String,Object>>)view.get("workers")).stream().filter(x->w.equals(x.get("id"))).findFirst().orElseThrow();
        assertEquals(2,mine.get("configuredConcurrency"));assertEquals(2,mine.get("effectiveConcurrency"));
        assertTrue(((List<?>)mine.get("constraints")).stream().anyMatch(c->c.toString().contains("deployment default maximum")));
        assertEquals(1,mine.get("maxConcurrency"));
    }

    @Test void hostMemoryBudgetIsReportedAsAWarningAcrossWorkersOnOneHost() {
        String host="host-"+UUID.randomUUID().toString().substring(0,8);
        UUID a=worker("ha-"+UUID.randomUUID(),"internal",2,Map.of("hostId",host,"hostMemoryBudgetMb",2048));
        UUID b=worker("hb-"+UUID.randomUUID(),"internal",2,Map.of("hostId",host,"hostMemoryBudgetMb",2048));
        List<UUID> jobs=internalJobs(3);
        assertEquals("CLAIMED",claim(jobs.get(0),a));assertEquals("CLAIMED",claim(jobs.get(1),a));
        assertEquals("CLAIMED",claim(jobs.get(2),b));
        var view=settings.overview();
        @SuppressWarnings("unchecked") var hostView=((List<Map<String,Object>>)view.get("hosts")).stream().filter(h->host.equals(h.get("hostId"))).findFirst().orElseThrow();
        assertEquals(true,hostView.get("overcommitted"));assertEquals(3072L,((Number)hostView.get("reservedMb")).longValue());
        assertTrue(((List<?>)lane(view,"internal").get("constraints")).stream().anyMatch(c->c.toString().contains("host "+host)));
    }

    @Test void contestsStartNowAcceptLateEntrantsAndCanBeExtendedOrEnded() throws Exception {
        User admin=user(true);worker("internal",2);worker("official",2);Problem p=problem();
        var c=judge.claim(p.job,db.jdbc.queryForObject("SELECT id FROM judge_workers WHERE lane='internal' AND status='ONLINE' LIMIT 1",UUID.class),0).orElseThrow();
        judge.complete(p.job,(UUID)db.one("SELECT worker_id FROM judging_jobs WHERE id=?",p.job).get("worker_id"),Api.uuid(c.get("leaseToken")),accepted(p.job));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Validated");
        String tag=UUID.randomUUID().toString().substring(0,8);
        UUID contest=contests.create(admin.actor,Map.of("slug","now-"+tag,"title","Start now","languages",List.of("CPP"),"durationSeconds",600));
        contests.attach(admin.actor,contest,p.version,1,"A");contests.rehearsal(admin.actor,contest,Map.of());
        String body="{\"startNow\":true,\"visibility\":\"PUBLIC\",\"reason\":\"Go\"}";
        UUID run=Api.uuid(JSON.readTree(mvc.perform(post("/api/manage/competitions/"+contest+"/schedule").header("Authorization","Bearer "+admin.token).contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("runId").asText());
        var r=db.one("SELECT status,starts_at,ends_at,extract(epoch FROM ends_at-starts_at)::int AS length FROM contest_runs WHERE id=?",run);
        assertEquals("RUNNING",r.get("status"));assertEquals(600,r.get("length"));
        assertEquals("RUNNING",db.one("SELECT status FROM competitions WHERE id=?",contest).get("status"));
        // Late entrants may join a running contest and submit immediately.
        User late=user(false);contests.register(late.actor,contest,null);
        assertNotNull(submissions.submit(late.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")));
        String handle=(String)db.one("SELECT handle FROM users WHERE id=?",user(false).actor.id()).get("handle");
        assertEquals("REGISTERED",contests.registerUsers(admin.actor,contest,List.of(handle)).get(0).get("status"));
        contests.control(admin.actor,run,Map.of("action","extend","minutes",10,"reason","Network issue"));
        assertEquals(1200,db.one("SELECT extract(epoch FROM ends_at-starts_at)::int AS length FROM contest_runs WHERE id=?",run).get("length"));
        assertThrows(ResponseStatusException.class,()->contests.control(admin.actor,run,Map.of("action","start-now","reason","Again")));
        contests.control(admin.actor,run,Map.of("action","end-now","reason","Done"));
        assertEquals("FINISHED",db.one("SELECT status FROM contest_runs WHERE id=?",run).get("status"));
        assertEquals("FINISHED",db.one("SELECT status FROM competitions WHERE id=?",contest).get("status"));
        assertThrows(ResponseStatusException.class,()->contests.register(user(false).actor,contest,null));
    }

    @Test void signedInUsersChangeTheirPasswordAndOtherSessionsEnd() throws Exception {
        User u=user(false);
        String email=(String)db.one("SELECT email FROM users WHERE id=?",u.actor.id()).get("email");
        mvc.perform(post("/api/me/password").header("Authorization","Bearer "+u.token).contentType("application/json")
                .content("{\"currentPassword\":\"wrong\",\"newPassword\":\"NewPassword2!\"}")).andExpect(status().isBadRequest());
        String body=mvc.perform(post("/api/me/password").header("Authorization","Bearer "+u.token).contentType("application/json")
                .content("{\"currentPassword\":\"TestPassword1!\",\"newPassword\":\"NewPassword2!\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String fresh=JSON.readTree(body).get("accessToken").asText();
        mvc.perform(get("/api/me").header("Authorization","Bearer "+u.token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").header("Authorization","Bearer "+fresh)).andExpect(status().isOk());
        assertNotNull(auth.login(Map.of("email",email,"password","NewPassword2!")).get("accessToken"));
        assertThrows(ResponseStatusException.class,()->auth.login(Map.of("email",email,"password","TestPassword1!")));
    }

    @Test void verifiedRuntimesEnableThemselvesUnlessAnAdministratorDecided() {
        String image="sha256:"+"b".repeat(64);
        db.jdbc.update("UPDATE languages SET enabled=false,runtime_image_id=NULL,admin_locked=false WHERE code='RUBY'");
        db.jdbc.update("UPDATE languages SET enabled=false,runtime_image_id=NULL,admin_locked=true WHERE code='PHP'");
        var body=new HashMap<String,Object>(Map.of("name","auto-"+UUID.randomUUID(),"capacity",1,"runtimes",Map.of(
                "RUBY",Map.of("verified",true,"imageId",image),"PHP",Map.of("verified",true,"imageId",image),"maxMemoryMb",1024,"lane","official")));
        judge.register(body);
        var ruby=db.one("SELECT enabled,runtime_image_id FROM languages WHERE code='RUBY'");
        assertEquals(true,ruby.get("enabled"));assertEquals(image,ruby.get("runtime_image_id"));
        assertEquals(false,db.one("SELECT enabled FROM languages WHERE code='PHP'").get("enabled"));
    }

    @Test void bulkUsersAndOrganizerRegistrationWork() throws Exception {
        User admin=user(true),participant=user(false);
        String tag=UUID.randomUUID().toString().replace("-","").substring(0,8);
        String body=JSON.writeValueAsString(Map.of("reason","Import round 1","users",List.of(
                Map.of("email","bulk1"+tag+"@example.test","handle","bulk1"+tag,"displayName","Bulk One"),
                Map.of("email","bulk2"+tag+"@example.test","handle","bulk2"+tag,"role","MODERATOR"),
                Map.of("email","bulk1"+tag+"@example.test","handle","dup"+tag),
                Map.of("email","bad","handle","x"))));
        mvc.perform(post("/api/admin/users/bulk").header("Authorization","Bearer "+participant.token).contentType("application/json").content(body)).andExpect(status().isForbidden());
        var result=JSON.readTree(mvc.perform(post("/api/admin/users/bulk").header("Authorization","Bearer "+admin.token).contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertEquals(2,result.get("created").asInt());
        assertEquals("ERROR",result.at("/results/2/status").asText());assertEquals("ERROR",result.at("/results/3/status").asText());
        String password=result.at("/results/0/password").asText();
        assertNotNull(auth.login(Map.of("email","bulk1"+tag+"@example.test","password",password)).get("accessToken"));
        assertTrue(db.exists("SELECT EXISTS(SELECT 1 FROM user_roles r JOIN users u ON u.id=r.user_id WHERE u.handle=? AND r.role_code='MODERATOR')","bulk2"+tag));
        worker("internal",2);worker("official",2);Problem p=problem();
        var c=judge.claim(p.job,db.jdbc.queryForObject("SELECT id FROM judge_workers WHERE lane='internal' AND status='ONLINE' LIMIT 1",UUID.class),0).orElseThrow();
        judge.complete(p.job,(UUID)db.one("SELECT worker_id FROM judging_jobs WHERE id=?",p.job).get("worker_id"),Api.uuid(c.get("leaseToken")),accepted(p.job));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Validated");
        UUID contest=contests.create(admin.actor,Map.of("slug","bulk-"+tag,"title","Bulk contest","languages",List.of("CPP")));
        contests.attach(admin.actor,contest,p.version,1,"A");
        var before=contests.registerUsers(admin.actor,contest,List.of("bulk1"+tag,"missing-"+tag));
        assertEquals("REGISTERED",before.get(0).get("status"));assertEquals("NOT_FOUND",before.get(1).get("status"));
        contests.rehearsal(admin.actor,contest,Map.of());
        UUID run=contests.schedule(admin.actor,contest,java.time.Instant.now().plusSeconds(60),"PRIVATE");
        assertEquals("REGISTERED",contests.registerUsers(admin.actor,contest,List.of("bulk2"+tag+"@example.test")).get(0).get("status"));
        assertEquals("ALREADY_REGISTERED",contests.registerUsers(admin.actor,contest,List.of("bulk1"+tag)).get(0).get("status"));
        assertEquals(2,db.jdbc.queryForObject("SELECT count(*) FROM run_entries WHERE run_id=?",Integer.class,run));
        assertThrows(ResponseStatusException.class,()->contests.registerUsers(participant.actor,contest,List.of(participant.actor.id().toString())));
    }

    @Test void staleOrDuplicateDeliveriesAreNotHeldAsCapacityWaits() {
        UUID w=worker("internal",1);List<UUID> jobs=internalJobs(2);
        db.jdbc.update("UPDATE judging_jobs SET dispatch_sequence=1 WHERE id=?",jobs.get(0));
        // An earlier delivery of a redispatched queued job may still claim it exactly once.
        assertEquals("CLAIMED",claim(jobs.get(0),w));
        assertEquals("STALE",claim(jobs.get(0),w));
        assertEquals("BUSY",claim(jobs.get(1),w));
        complete(jobs.get(0));
        assertEquals("STALE",claim(jobs.get(0),w));
    }

    @Test void admissionSettingsTakeEffectImmediately() {
        User admin=user(true);UUID w=worker("internal",2);Problem p=problem();
        var c=judge.claim(p.job,w,0).orElseThrow();
        judge.complete(p.job,w,Api.uuid(c.get("leaseToken")),accepted(p.job));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Validated");
        UUID contest=contests.create(p.owner.actor,Map.of("slug","adm-"+UUID.randomUUID(),"title","Admission","languages",List.of("CPP")));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        UUID run=contests.rehearsal(p.owner.actor,contest,Map.of());
        Map<String,Object> code=Map.of("language","CPP","sourceCode","int main() {}");
        save(admin,Map.of("pendingSubmissionsPerUser",1));
        UUID key=UUID.randomUUID();
        UUID first=submissions.submit(p.owner.actor,run,1,null,key,code);
        assertEquals(first,submissions.submit(p.owner.actor,run,1,null,key,code),"Replays are not counted");
        assertTrue(assertThrows(ResponseStatusException.class,()->submissions.submit(p.owner.actor,run,1,null,UUID.randomUUID(),code)).getReason().contains("pending"));
        save(admin,Map.of("pendingSubmissionsPerUser",10,"submissionsPerMinute",2));
        submissions.submit(p.owner.actor,run,1,null,UUID.randomUUID(),code);
        assertTrue(assertThrows(ResponseStatusException.class,()->submissions.submit(p.owner.actor,run,1,null,UUID.randomUUID(),code)).getReason().contains("minute"));
        save(admin,Map.of("submissionsPerMinute",60,"maxQueuedSubmissions",2));
        assertTrue(assertThrows(ResponseStatusException.class,()->submissions.submit(p.owner.actor,run,1,null,UUID.randomUUID(),code)).getReason().contains("queue is full"));
        save(admin,Map.of("maxQueuedSubmissions",3));
        assertNotNull(submissions.submit(p.owner.actor,run,1,null,UUID.randomUUID(),code));
    }
}
