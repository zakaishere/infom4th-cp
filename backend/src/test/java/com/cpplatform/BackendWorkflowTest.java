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
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class BackendWorkflowTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;
    static CompetitionService contests;static SubmissionService submissions;static MockMvc mvc;
    static final String IMAGE="sha256:"+"a".repeat(64);
    static final String PASSWORD="TestPassword1!";
    static final ObjectMapper JSON=new ObjectMapper();
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);contests=context.getBean(CompetitionService.class);submissions=context.getBean(SubmissionService.class);
        mvc=MockMvcBuilders.webAppContextSetup((WebApplicationContext)context)
                .addFilters(context.getBean(com.cpplatform.config.RequestSizeFilter.class),context.getBean(FilterChainProxy.class)).build();
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}
    record User(Actor actor,String token,String refresh) {}
    User user(boolean admin) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        var session=auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password",PASSWORD));
        UUID id=(UUID)session.get("userId");
        if(admin)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new User(new Actor(id,admin?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT")),
                (String)session.get("accessToken"),(String)session.get("refreshToken"));
    }
    UUID worker(String lane,int capacity) {
        UUID worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",capacity,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane",lane))).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        return worker;
    }
    record Problem(User owner,UUID version,UUID worker,UUID job) {}
    Problem validation() {
        User owner=user(true);UUID worker=worker("internal",2);
        UUID version=lab.create(owner.actor,Map.of("slug","sum-"+UUID.randomUUID(),"title","Sum","statement","Add two integers","languages",List.of("CPP")));
        lab.tests(owner.actor,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner.actor,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner.actor,version);
        UUID job=db.jdbc.queryForObject("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.validation_id=?",UUID.class,validation);
        return new Problem(owner,version,worker,job);
    }
    Map<String,Object> accepted(Map<String,Object> claimed) {
        List<?> tests=(List<?>)claimed.get("tests");
        var cases=tests.stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        return Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024);
    }
    void pass(Problem p) {
        var claimed=judge.claim(p.job,p.worker,0).orElseThrow();
        judge.complete(p.job,p.worker,Api.uuid(claimed.get("leaseToken")),accepted(claimed));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Reference validation passed");
    }
    @Test void publicAndWorkerBoundariesAreEnforced() throws Exception {
        User u=user(false);
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").header("Authorization","Bearer "+u.token)).andExpect(status().isOk());
        mvc.perform(post("/api/lab/problems").header("Authorization","Bearer "+u.token).contentType("application/json")
                .content("{\"slug\":\"forbidden\",\"title\":\"Forbidden\",\"languages\":[\"CPP\"]}")).andExpect(status().isForbidden());
        mvc.perform(post("/internal/judge/workers").header("Authorization","Bearer "+u.token).contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/users").header("Authorization","Bearer "+u.token)).andExpect(status().isForbidden());
    }
    @Test void refreshRotationRejectsReplayAndRevokesTheFamily() {
        User u=user(false);var next=auth.refresh(u.refresh).orElseThrow();
        assertTrue(auth.refresh(u.refresh).isEmpty());
        assertTrue(auth.refresh((String)next.get("refreshToken")).isEmpty());
    }
    @Test void laboratoryUsesRealClaimsAndRequiresCompleteResults() {
        Problem p=validation();var claimed=judge.claim(p.job,p.worker,0).orElseThrow();
        var incomplete=Map.<String,Object>of("verdict","ACCEPTED","cases",List.of(),"executionTimeMs",0,"peakMemoryKb",0);
        assertThrows(ResponseStatusException.class,()->judge.complete(p.job,p.worker,Api.uuid(claimed.get("leaseToken")),incomplete));
        judge.complete(p.job,p.worker,Api.uuid(claimed.get("leaseToken")),accepted(claimed));
        judge.complete(p.job,p.worker,Api.uuid(claimed.get("leaseToken")),accepted(claimed));
        judge.finishValidations();lab.approve(p.owner.actor,p.version,"Reviewed");
        assertEquals("APPROVED",db.one("SELECT status FROM problem_versions WHERE id=?",p.version).get("status"));
        assertEquals(1,db.jdbc.queryForObject("SELECT count(*) FROM judging_results WHERE job_id=?",Integer.class,p.job));
    }
    @Test void expiredLeaseCannotOverwriteAReclaimedJob() {
        Problem p=validation();var old=judge.claim(p.job,p.worker,0).orElseThrow();
        db.jdbc.update("UPDATE judging_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=?",p.job);
        judge.recover();
        db.jdbc.update("UPDATE judging_jobs SET available_at=now() WHERE id=?",p.job);
        var fresh=judge.claim(p.job,p.worker,1).orElseThrow();
        assertNotEquals(old.get("leaseToken"),fresh.get("leaseToken"));
        assertThrows(ResponseStatusException.class,()->judge.complete(p.job,p.worker,Api.uuid(old.get("leaseToken")),accepted(old)));
        judge.complete(p.job,p.worker,Api.uuid(fresh.get("leaseToken")),accepted(fresh));
        assertEquals(2,db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE job_id=?",Integer.class,p.job));
    }
    @Test void repeatedInfrastructureFailureTerminatesWithNoContestPenalty() {
        Problem p=validation();
        for(int i=0;i<3;i++) {
            db.jdbc.update("UPDATE judging_jobs SET available_at=now() WHERE id=?",p.job);
            var claimed=judge.claim(p.job,p.worker,i).orElseThrow();
            judge.complete(p.job,p.worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","JUDGE_ERROR"));
        }
        assertEquals("FAILED",db.one("SELECT status FROM judging_jobs WHERE id=?",p.job).get("status"));
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM judging_results WHERE job_id=?",Integer.class,p.job));
    }
    @Test void jobAndOutboxRollbackTogether() {
        Problem p=validation();UUID job=UUID.randomUUID();
        new TransactionTemplate(context.getBean(PlatformTransactionManager.class)).executeWithoutResult(status->{
            db.jdbc.update("INSERT INTO judging_jobs(id,submission_id,problem_version_id,generation) SELECT ?,submission_id,problem_version_id,99 FROM judging_jobs WHERE id=?",job,p.job);
            assertEquals(1,db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE job_id=?",Integer.class,job));
            status.setRollbackOnly();
        });
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM judging_jobs WHERE id=?",Integer.class,job));
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE job_id=?",Integer.class,job));
    }
    @Test void workerCapacityAndLaneAreEnforced() {
        Problem p=validation();UUID wrong=worker("official",1);
        assertTrue(judge.claim(p.job,wrong,0).isEmpty());
        UUID one=worker("internal",1);
        assertTrue(judge.claim(p.job,one,0).isPresent());
        UUID second=db.id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation) SELECT submission_id,problem_version_id,2 FROM judging_jobs WHERE id=? RETURNING id",p.job);
        // A claimable job on a full worker is refused with 429 so the worker keeps the delivery.
        var busy=assertThrows(ResponseStatusException.class,()->judge.claim(second,one,0));
        assertEquals(429,busy.getStatusCode().value());
        assertEquals("QUEUED",db.one("SELECT status FROM judging_jobs WHERE id=?",second).get("status"));
    }
    @Test void hundredParticipantsEnqueueWithoutLosingDispatchIntents() throws Exception {
        Problem p=validation();pass(p);
        UUID contest=contests.create(p.owner.actor,Map.of("slug","contest-"+UUID.randomUUID(),"title","Concurrent contest","languages",List.of("CPP"),"durationSeconds",3600));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        List<Actor> actors=new ArrayList<>();
        for(int i=0;i<100;i++) {
            String name="load"+UUID.randomUUID().toString().replace("-","");
            UUID user=db.id("INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,'test-only') RETURNING id",name+"@example.test",name.substring(0,30),name);
            actors.add(new Actor(user,Set.of("PARTICIPANT")));
        }
        UUID run=contests.rehearsal(p.owner.actor,contest,Map.of("userIds",actors.stream().map(a->a.id().toString()).toList()));
        ExecutorService pool=Executors.newFixedThreadPool(20);
        try {
            List<Callable<UUID>> calls=actors.stream().map(a->(Callable<UUID>)()->submissions.submit(a,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"))).toList();
            for(Future<UUID> future:pool.invokeAll(calls))assertNotNull(future.get(20,TimeUnit.SECONDS));
        } finally {pool.shutdownNow();}
        assertEquals(100,db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE run_id=?",Integer.class,run));
        assertEquals(100,db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox o JOIN judging_jobs j ON j.id=o.job_id JOIN submissions s ON s.id=j.submission_id WHERE s.run_id=?",Integer.class,run));
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM official_submission_results WHERE run_id=?",Integer.class,run));
    }
    @Test void submissionApiIsIdempotentAndHidesOtherUsersSource() throws Exception {
        Problem p=validation();pass(p);
        UUID contest=contests.create(p.owner.actor,Map.of("slug","api-"+UUID.randomUUID(),"title","API contest","languages",List.of("CPP")));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        UUID run=contests.rehearsal(p.owner.actor,contest,Map.of());
        String key=UUID.randomUUID().toString(),path="/api/runs/"+run+"/problems/1/submissions";
        String payload="{\"language\":\"CPP\",\"sourceCode\":\"int main() {}\"}";
        String first=mvc.perform(post(path).header("Authorization","Bearer "+p.owner.token).header("Idempotency-Key",key).contentType("application/json").content(payload))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        String id=JSON.readTree(first).get("submissionId").asText();
        String repeated=mvc.perform(post(path).header("Authorization","Bearer "+p.owner.token).header("Idempotency-Key",key).contentType("application/json").content(payload))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        assertEquals(id,JSON.readTree(repeated).get("submissionId").asText());
        User outsider=user(false);
        mvc.perform(get("/api/submissions/"+id).header("Authorization","Bearer "+outsider.token)).andExpect(status().isForbidden());
        String publicProblem=mvc.perform(get("/api/runs/"+run+"/problems/1").header("Authorization","Bearer "+p.owner.token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertFalse(publicProblem.contains("setter_notes"));assertFalse(publicProblem.contains("reference"));
        assertFalse(publicProblem.contains("4 5"));
    }

    @Test void officialSchedulingSubmissionAndPauseUseServerTime() throws Exception {
        Problem p=validation();pass(p);UUID officialWorker=worker("official",2);User entrant=user(false);
        UUID contest=contests.create(p.owner.actor,Map.of("slug","official-"+UUID.randomUUID(),"title","Official contest","languages",List.of("CPP"),"durationSeconds",60));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        contests.rehearsal(p.owner.actor,contest,Map.of());
        java.time.Instant start=java.time.Instant.now().plusSeconds(2);
        UUID run=contests.schedule(p.owner.actor,contest,start,"PUBLIC");
        contests.register(entrant.actor,contest,null);
        assertThrows(ResponseStatusException.class,()->submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")));
        while(java.time.Instant.now().isBefore(start))Thread.sleep(20);
        UUID submission=submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID job=db.jdbc.queryForObject("SELECT id FROM judging_jobs WHERE submission_id=?",UUID.class,submission);
        var claim=judge.claim(job,officialWorker,0).orElseThrow();
        judge.complete(job,officialWorker,Api.uuid(claim.get("leaseToken")),accepted(claim));
        assertEquals(1,db.jdbc.queryForObject("SELECT count(*) FROM official_submission_results WHERE run_id=? AND verdict='ACCEPTED'",Integer.class,run));
        contests.control(p.owner.actor,run,Map.of("action","pause","reason","Testing admission gate"));
        assertThrows(ResponseStatusException.class,()->submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->db.jdbc.update(
                "INSERT INTO submissions(run_id,competition_version_id,entry_id,submitted_by,problem_slot,problem_version_id,language_code,source_code,idempotency_key,submitted_at) SELECT run_id,competition_version_id,entry_id,submitted_by,problem_slot,problem_version_id,language_code,source_code,?,now()-interval '1 day' FROM submissions WHERE id=?",
                UUID.randomUUID(),submission));
    }
    @Test void analyticsCoverServerPlatformAndContestRuns() throws Exception {
        var analytics=context.getBean(com.cpplatform.analytics.AnalyticsService.class);
        Problem p=validation();pass(p);UUID officialWorker=worker("official",2);User entrant=user(false);
        UUID contest=contests.create(p.owner.actor,Map.of("slug","analytics-"+UUID.randomUUID(),"title","Analytics contest","languages",List.of("CPP"),"durationSeconds",120));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        contests.rehearsal(p.owner.actor,contest,Map.of());
        java.time.Instant start=java.time.Instant.now().plusSeconds(2);
        UUID run=contests.schedule(p.owner.actor,contest,start,"PUBLIC");
        contests.register(entrant.actor,contest,null);
        while(java.time.Instant.now().isBefore(start))Thread.sleep(20);
        UUID submission=submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID job=db.jdbc.queryForObject("SELECT id FROM judging_jobs WHERE submission_id=?",UUID.class,submission);
        var claim=judge.claim(job,officialWorker,0).orElseThrow();
        judge.complete(job,officialWorker,Api.uuid(claim.get("leaseToken")),accepted(claim));
        analytics.sample();
        assertTrue(db.jdbc.queryForObject("SELECT count(*) FROM metric_samples",Integer.class)>=1);
        analytics.closeDays();analytics.closeDays();
        assertEquals(db.jdbc.queryForObject("SELECT count(DISTINCT day) FROM daily_reports",Integer.class),db.jdbc.queryForObject("SELECT count(*) FROM daily_reports",Integer.class));
        assertTrue(((Number)analytics.day(java.time.LocalDate.now(java.time.ZoneOffset.UTC)).get("submissions")).longValue()>=1);
        assertTrue(((List<?>)analytics.timeseries(24).get("activity")).size()>=240);
        var stats=analytics.run(p.owner.actor,run);
        assertEquals(1L,((Map<?,?>)stats.get("totals")).get("accepted"));
        assertEquals(1L,((Map<?,?>)((List<?>)stats.get("problems")).get(0)).get("solved"));
        assertTrue(analytics.contests(p.owner.actor).stream().anyMatch(r->run.equals(r.get("run_id"))));
        assertThrows(ResponseStatusException.class,()->analytics.run(entrant.actor,run));
        mvc.perform(get("/api/admin/analytics/overview").header("Authorization","Bearer "+p.owner.token)).andExpect(status().isOk()).andExpect(jsonPath("$.server.cpus").isNumber());
        mvc.perform(get("/api/admin/analytics/daily").header("Authorization","Bearer "+p.owner.token)).andExpect(status().isOk()).andExpect(jsonPath("$.today.day").isString());
        mvc.perform(get("/api/admin/analytics/overview").header("Authorization","Bearer "+entrant.token)).andExpect(status().isForbidden());
    }
    @Test void usersShowRolesAndRoleChangesAreGuardedAndAudited() throws Exception {
        User admin=user(true),target=user(false);String bearer="Bearer "+admin.token;
        String handle=(String)db.one("SELECT handle FROM users WHERE id=?",target.actor.id()).get("handle");
        mvc.perform(get("/api/admin/users").param("q",handle).header("Authorization",bearer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.users[0].roles[0]").value("PARTICIPANT"));
        mvc.perform(put("/api/admin/users/"+target.actor.id()+"/role").header("Authorization",bearer).contentType("application/json")
                .content("{\"role\":\"ADMIN\",\"reason\":\"Runs the spring round\"}")).andExpect(status().isOk());
        mvc.perform(put("/api/admin/users/"+target.actor.id()+"/role").header("Authorization",bearer).contentType("application/json")
                .content("{\"role\":\"MODERATOR\",\"reason\":\"Now writes problems\"}")).andExpect(status().isOk());
        assertEquals(List.of("MODERATOR","PARTICIPANT"),db.jdbc.queryForList("SELECT role_code FROM user_roles WHERE user_id=? ORDER BY role_code",String.class,target.actor.id()));
        mvc.perform(get("/api/admin/users").param("q",handle).param("role","MODERATOR").header("Authorization",bearer)).andExpect(jsonPath("$.total").value(1));
        mvc.perform(get("/api/admin/users").param("q",handle).param("role","PARTICIPANT").header("Authorization",bearer)).andExpect(jsonPath("$.total").value(0));
        // Cannot demote yourself; suspension signs the user out.
        mvc.perform(put("/api/admin/users/"+admin.actor.id()+"/role").header("Authorization",bearer).contentType("application/json")
                .content("{\"role\":\"PARTICIPANT\",\"reason\":\"oops\"}")).andExpect(status().isConflict());
        mvc.perform(put("/api/admin/users/"+target.actor.id()+"/status").header("Authorization",bearer).contentType("application/json")
                .content("{\"status\":\"SUSPENDED\",\"reason\":\"Shared an account\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/admin/users").header("Authorization","Bearer "+target.token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/users/"+target.actor.id()).header("Authorization",bearer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED")).andExpect(jsonPath("$.audit.length()").value(4))
                .andExpect(jsonPath("$.audit[0].action").value("USER_SUSPEND"));
        String adminHandle=(String)db.one("SELECT handle FROM users WHERE id=?",admin.actor.id()).get("handle");
        mvc.perform(get("/api/admin/audit").param("latest","true").param("actor",adminHandle).header("Authorization",bearer))
                .andExpect(jsonPath("$.length()").value(4)).andExpect(jsonPath("$[2].target_handle").value(handle));
    }
    @Test void privateContestRequiresAnInvitation() {
        Problem p=validation();pass(p);worker("official",2);User entrant=user(false);
        UUID contest=contests.create(p.owner.actor,Map.of("slug","private-"+UUID.randomUUID(),"title","Private contest","languages",List.of("CPP")));
        contests.attach(p.owner.actor,contest,p.version,1,"A");contests.rehearsal(p.owner.actor,contest,Map.of());
        contests.schedule(p.owner.actor,contest,java.time.Instant.now().plusSeconds(60),"PRIVATE");
        assertThrows(ResponseStatusException.class,()->contests.register(entrant.actor,contest,null));
        db.jdbc.update("INSERT INTO competition_invitations VALUES (?,?,?)",contest,entrant.actor.id(),p.owner.actor.id());
        assertNotNull(contests.register(entrant.actor,contest,null));
    }
    @Test void registeredTeamCannotChangeItsMembershipSnapshot() throws Exception {
        Problem p=validation();pass(p);worker("official",2);User captain=user(false),second=user(false),third=user(false);
        String created=mvc.perform(post("/api/teams").header("Authorization","Bearer "+captain.token).contentType("application/json").content("{\"name\":\"Test team\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        UUID team=UUID.fromString(JSON.readTree(created).get("teamId").asText());String invite=JSON.readTree(created).get("inviteToken").asText();
        mvc.perform(post("/api/teams/join").header("Authorization","Bearer "+second.token).contentType("application/json").content(JSON.writeValueAsString(Map.of("inviteToken",invite))))
                .andExpect(status().isOk());
        UUID contest=contests.create(p.owner.actor,Map.of("slug","teams-"+UUID.randomUUID(),"title","Team contest","languages",List.of("CPP"),"mode","TEAM","maxTeamSize",3));
        contests.attach(p.owner.actor,contest,p.version,1,"A");
        contests.rehearsal(p.owner.actor,contest,Map.of("teamIds",List.of(team)));
        UUID run=contests.schedule(p.owner.actor,contest,java.time.Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(captain.actor,contest,team);
        mvc.perform(post("/api/teams/join").header("Authorization","Bearer "+third.token).contentType("application/json").content(JSON.writeValueAsString(Map.of("inviteToken",invite))))
                .andExpect(status().isConflict());
        assertEquals(2,db.jdbc.queryForObject("SELECT count(*) FROM run_entry_members WHERE run_id=?",Integer.class,run));
    }


    @Test void sealedProblemRuntimeSurvivesGlobalImageRollout() {
        Problem p=validation();String replacement="sha256:"+"b".repeat(64);
        UUID other=(UUID)judge.register(Map.of("name","rollout-"+UUID.randomUUID(),"capacity",1,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",replacement),"maxMemoryMb",1024,"lane","internal"))).get("workerId");
        db.jdbc.update("UPDATE languages SET runtime_image_id=? WHERE code='CPP'",replacement);
        assertTrue(judge.claim(p.job,other,0).isEmpty());
        assertTrue(judge.claim(p.job,p.worker,0).isPresent());
        assertEquals(IMAGE,db.one("SELECT image_id FROM problem_runtime_pins WHERE problem_version_id=?",p.version).get("image_id"));
        assertThrows(org.springframework.dao.DataAccessException.class,()->db.jdbc.update("UPDATE problem_runtime_pins SET image_id=? WHERE problem_version_id=?",replacement,p.version));
    }


    @Test void outboxRequiresBrokerConfirmationAndRetriesUnroutablePublishes() {
        Problem p=validation();
        db.jdbc.update("UPDATE judge_outbox SET available_at=now()+interval '1 day' WHERE job_id<>?",p.job);
        class Broker extends org.springframework.amqp.rabbit.core.RabbitTemplate {
            boolean ack=false,unroutable=false;int sent=0;
            @Override public void send(String exchange,String routing,org.springframework.amqp.core.Message message,
                    org.springframework.amqp.rabbit.connection.CorrelationData correlation) {
                sent++;assertEquals("cp.judge",exchange);assertEquals("internal.CPP",routing);
                assertEquals(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT,message.getMessageProperties().getDeliveryMode());
                if(unroutable)correlation.setReturned(new org.springframework.amqp.core.ReturnedMessage(message,312,"NO_ROUTE",exchange,routing));
                correlation.getFuture().complete(new org.springframework.amqp.rabbit.connection.CorrelationData.Confirm(ack,null));
            }
        }
        Broker broker=new Broker();
        var dispatcher=new OutboxDispatcher(db,broker,context.getBean(PlatformTransactionManager.class));
        dispatcher.dispatch();
        assertNull(db.one("SELECT published_at FROM judge_outbox WHERE job_id=?",p.job).get("published_at"));
        broker.ack=true;broker.unroutable=true;
        db.jdbc.update("UPDATE judge_outbox SET available_at=now() WHERE job_id=?",p.job);
        dispatcher.dispatch();
        assertNull(db.one("SELECT published_at FROM judge_outbox WHERE job_id=?",p.job).get("published_at"));
        broker.unroutable=false;
        db.jdbc.update("UPDATE judge_outbox SET available_at=now() WHERE job_id=?",p.job);
        dispatcher.dispatch();
        assertNotNull(db.one("SELECT published_at FROM judge_outbox WHERE job_id=?",p.job).get("published_at"));
        assertEquals(3,broker.sent);
    }

}