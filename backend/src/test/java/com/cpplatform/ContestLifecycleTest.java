package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.*;
import com.cpplatform.competition.*;
import com.cpplatform.judging.*;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The whole life of a contest over real HTTP: schedule, start, extend, pause, end, release. */
class ContestLifecycleTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;
    static CompetitionService contests;static SubmissionService submissions;static StandingsService standings;
    static String base;
    static final String IMAGE="sha256:"+"a".repeat(64);
    static final HttpClient HTTP=HttpClient.newHttpClient();
    static final com.fasterxml.jackson.databind.ObjectMapper JSON=new com.fasterxml.jackson.databind.ObjectMapper();
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);contests=context.getBean(CompetitionService.class);
        submissions=context.getBean(SubmissionService.class);standings=context.getBean(StandingsService.class);
        base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port");
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    record User(Actor actor,String token) {}
    User user(boolean admin) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        var session=auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!"));
        UUID id=(UUID)session.get("userId");
        if(admin)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new User(new Actor(id,admin?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT")),(String)session.get("accessToken"));
    }
    /** An approved problem and a contest ready to schedule; rehearsal moves it to INTERNAL_TESTING. */
    UUID contest(User owner,int freezeSeconds){return contest(owner,freezeSeconds,Map.of(),Map.of());}
    UUID contest(User owner,int freezeSeconds,Map<String,Object> settings,Map<String,Object> rehearsal) {
        UUID worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",2,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","internal"))).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        UUID version=lab.create(owner.actor,Map.of("slug","sum-"+UUID.randomUUID(),"title","Sum","statement","Add two integers","languages",List.of("CPP")));
        lab.tests(owner.actor,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner.actor,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner.actor,version);
        UUID job=db.jdbc.queryForObject("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.validation_id=?",UUID.class,validation);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        judge.finishValidations();lab.approve(owner.actor,version,"Reference validation passed");
        judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",2,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","official")));
        Map<String,Object> body=new HashMap<>(Map.of("slug","life-"+UUID.randomUUID(),"title","Lifecycle","languages",List.of("CPP"),"durationSeconds",3600,"freezeBeforeEndSeconds",freezeSeconds));
        body.putAll(settings);
        UUID contest=contests.create(owner.actor,body);
        contests.attach(owner.actor,contest,version,1,"A");
        contests.rehearsal(owner.actor,contest,rehearsal);
        return contest;
    }
    void control(User owner,UUID run,String action) {
        Map<String,Object> body=new HashMap<>(Map.of("action",action,"reason","test"));
        if(action.equals("extend"))body.put("minutes",10);
        contests.control(owner.actor,run,body);
    }
    HttpResponse<String> http(String method,String path,String token,String json) throws Exception {
        var request=HttpRequest.newBuilder(URI.create(base+path)).method(method,json==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json));
        if(token!=null)request.header("Authorization","Bearer "+token);
        if(json!=null)request.header("Content-Type","application/json");
        return HTTP.send(request.build(),HttpResponse.BodyHandlers.ofString());
    }

    @Test void extendedAndEndedContestCanStillBeControlledAndReleased() throws Exception {
        User owner=user(true),entrant=user(false);UUID contest=contest(owner,600);
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);
        control(owner,run,"start-now");
        control(owner,run,"extend");
        // Every later change to a run with a changed length used to fail in the database.
        contests.tick();
        control(owner,run,"pause");control(owner,run,"resume");
        control(owner,run,"end-now");
        assertEquals("FINISHED",db.one("SELECT status FROM contest_runs WHERE id=?",run).get("status"));
        assertEquals(true,((Map<?,?>)standings.get(entrant.actor,run,false)).get("frozen"));
        var released=http("POST","/api/manage/runs/"+run+"/control",owner.token,"{\"action\":\"release-standings\",\"reason\":\"Results are final\"}");
        assertEquals(200,released.statusCode(),released.body());
        Thread.sleep(1100);// standings are cached for one second
        assertEquals(false,((Map<?,?>)standings.get(entrant.actor,run,false)).get("frozen"));
        var board=http("GET","/api/runs/"+run+"/standings",entrant.token,null);
        assertEquals(200,board.statusCode(),board.body());
    }

    @Test void extendedContestFinishesByItselfWhenItsTimeRunsOut() throws Exception {
        User owner=user(true);UUID contest=contest(owner,0);
        UUID extended=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        control(owner,extended,"start-now");control(owner,extended,"extend");
        // Stands in for waiting until the extended end time has passed.
        new org.springframework.transaction.support.TransactionTemplate(context.getBean(org.springframework.transaction.PlatformTransactionManager.class)).executeWithoutResult(status->{
            db.jdbc.queryForList("SELECT set_config('cp.run_clock_change','on',true)");
            db.jdbc.update("UPDATE contest_runs SET ends_at=now()+interval '200 milliseconds' WHERE id=?",extended);
        });
        Thread.sleep(300);
        // This scheduler step covers every contest, so one failure here also stopped all the others from finishing.
        contests.tick();
        assertEquals("FINISHED",db.one("SELECT status FROM contest_runs WHERE id=?",extended).get("status"));
        assertEquals("FINISHED",db.one("SELECT status FROM competitions WHERE id=?",contest).get("status"));
    }

    @Test void submissionLatencyIsRecordedAndOnlyAdminsCanReadIt() throws Exception {
        User owner=user(true),entrant=user(false),other=user(false);UUID contest=contest(owner,0);
        var analytics=context.getBean(com.cpplatform.analytics.AnalyticsService.class);
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);
        control(owner,run,"start-now");
        UUID submission=submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",submission);
        var claimed=judge.claim(job,official,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,official,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024,
                "timings",Map.of("compileMs",3000,"testsMs",500,"totalMs",9000)));
        String timing="/api/submissions/"+submission+"/timing";
        assertEquals(403,http("POST",timing,other.token,"{\"acceptedMs\":1}").statusCode());
        assertEquals(200,http("POST",timing,entrant.token,"{\"acceptedMs\":120}").statusCode());
        assertEquals(200,http("POST",timing,entrant.token,"{\"acceptedMs\":999,\"verdictMs\":10400}").statusCode());
        assertEquals(200,http("POST",timing,entrant.token,"{\"acceptedMs\":999,\"verdictMs\":99999}").statusCode());
        var row=analytics.recentSubmissions(1,100,null,null,null,false).stream().filter(r->submission.equals(r.get("id"))).findFirst().orElseThrow();
        assertEquals(120,((Number)row.get("accepted_ms")).intValue());
        assertEquals(10400,((Number)row.get("verdict_ms")).intValue());
        assertEquals(3000,((Number)row.get("compile_ms")).intValue());
        assertEquals(5500,((Number)row.get("sandbox_ms")).intValue());
        assertEquals("Contest",row.get("kind"));assertEquals("ACCEPTED",row.get("verdict"));
        assertFalse(row.containsKey("source_code"));
        var latency=analytics.latency(1);
        assertTrue(((List<?>)latency.get("byKind")).stream().anyMatch(k->"Contest".equals(((Map<?,?>)k).get("kind"))));
        assertTrue(((List<?>)latency.get("lanes")).stream().anyMatch(l->"official".equals(((Map<?,?>)l).get("lane")) && ((Map<?,?>)l).get("avg_judge_ms")!=null));
        var contestKind=((List<?>)latency.get("byKind")).stream().map(k->(Map<?,?>)k).filter(k->"Contest".equals(k.get("kind"))).findFirst().orElseThrow();
        assertEquals(1,((Number)contestKind.get("avg_attempts")).intValue());
        assertEquals(0,((Number)contestKind.get("retried")).intValue());
        // Both lanes are always listed, even one with no online worker.
        assertEquals(2,((List<?>)latency.get("lanes")).size());
        // Other tests in this class share the database, so only the shape is asserted here.
        assertNotNull(latency.get("failures"));
        assertNotNull(latency.get("failureCodes"));
        assertTrue(((Number)((Map<?,?>)latency.get("failures")).get("total")).longValue()>=0);
        assertTrue(row.containsKey("last_error_code"));
        assertEquals(200,http("GET","/api/admin/analytics/latency",owner.token,null).statusCode());
        assertEquals(200,http("GET","/api/admin/analytics/api?minutes=10",owner.token,null).statusCode());
        var health=(Map<?,?>)analytics.overview().get("health");
        assertNotNull(health);assertTrue(List.of("ok","warn","bad").contains(health.get("level")));
        assertEquals(403,http("GET","/api/admin/analytics/submissions",entrant.token,null).statusCode());
        assertEquals(403,http("GET","/api/admin/analytics/latency",entrant.token,null).statusCode());
    }

    void accept(UUID submission,UUID worker) {
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",submission);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
    }
    long sigma(LeaderboardService leaderboard,User user) {
        return leaderboard.compute().players().stream().filter(r->r.key().equals(user.actor.id())).mapToLong(LeaderboardService.Row::score).sum();
    }

    @Test void leaderboardCountsOnlyPublicResultsAndNeverStaffOrExampleRuns() throws Exception {
        var leaderboard=context.getBean(LeaderboardService.class);
        User owner=user(true),entrant=user(false),sampler=user(false);UUID contest=contest(owner,600);
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);contests.register(owner.actor,contest,null);
        control(owner,run,"start-now");
        accept(submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        accept(submissions.submit(owner.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        assertEquals(0,sigma(leaderboard,entrant),"a live contest must not reveal results");
        control(owner,run,"end-now");
        assertEquals(0,sigma(leaderboard,entrant),"a frozen scoreboard must not be revealed");
        control(owner,run,"release-standings");
        assertTrue(sigma(leaderboard,entrant)>0);
        assertEquals(0,sigma(leaderboard,owner),"staff can read the tests");

        UUID version=db.id("SELECT cp.problem_version_id FROM competition_problems cp JOIN contest_runs r ON r.competition_version_id=cp.competition_version_id WHERE r.id=?",run);
        lab.publishPractice(owner.actor,version);
        UUID internal=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='internal' ORDER BY registered_at DESC LIMIT 1");
        accept(submissions.submit(sampler.actor,null,null,version,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}","mode","samples")),internal);
        assertEquals(0,sigma(leaderboard,sampler),"running the examples is not a solve");
        accept(submissions.submit(sampler.actor,null,null,version,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),internal);
        assertTrue(sigma(leaderboard,sampler)>0);
        db.jdbc.update("UPDATE practice_publications SET hidden=true WHERE problem_id=(SELECT problem_id FROM problem_versions WHERE id=?)",version);
        assertEquals(0,sigma(leaderboard,sampler),"a hidden practice problem stops paying");

        // Someone who only ran the examples is not listed; a real attempt lists them on Σ 0.
        User examples=user(false),tried=user(false);
        db.jdbc.update("UPDATE practice_publications SET hidden=false WHERE problem_id=(SELECT problem_id FROM problem_versions WHERE id=?)",version);
        accept(submissions.submit(examples.actor,null,null,version,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}","mode","samples")),internal);
        submissions.submit(tried.actor,null,null,version,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        var listed=leaderboard.compute().players().stream().map(LeaderboardService.Row::key).toList();
        assertTrue(listed.contains(tried.actor.id()));
        assertFalse(listed.contains(examples.actor.id()));
        assertFalse(listed.contains(owner.actor.id()),"staff are never listed");
        assertEquals(0,sigma(leaderboard,tried));
        db.jdbc.update("UPDATE practice_publications SET hidden=true WHERE problem_id=(SELECT problem_id FROM problem_versions WHERE id=?)",version);

        fresh();
        var response=http("GET","/api/leaderboard",entrant.token,null);
        assertEquals(200,response.statusCode(),response.body());
        var body=JSON.readTree(response.body());
        assertTrue(body.get("me").get("rank").asInt()>=1);
        assertTrue(body.get("me").get("score").asLong()>0);
        assertFalse(response.body().contains("@example.test"));
        assertFalse(response.body().contains(entrant.actor.id().toString()));
        assertEquals(401,http("GET","/api/leaderboard",null,null).statusCode());
    }

    String handle(User user){return (String)db.one("SELECT handle FROM users WHERE id=?",user.actor.id()).get("handle");}
    void fresh(){context.getBean(ContestResults.class).invalidate();context.getBean(LeaderboardService.class).invalidate();}
    com.fasterxml.jackson.databind.JsonNode json(HttpResponse<String> response) throws Exception {
        assertEquals(200,response.statusCode(),response.body());return JSON.readTree(response.body());
    }

    @Test void profilesShowOnlyPublicResultsAndRatingsFollowSavedContests() throws Exception {
        User owner=user(true),winner=user(false),loser=user(false);UUID contest=contest(owner,0);
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(winner.actor,contest,null);contests.register(loser.actor,contest,null);
        control(owner,run,"start-now");
        accept(submissions.submit(winner.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        submissions.submit(loser.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        fresh();
        String path="/api/profiles/"+handle(winner);
        var live=json(http("GET",path,loser.token,null));
        assertEquals(0,live.get("contests").size(),"a running contest stays off the profile");
        assertEquals(0,live.get("stats").get("submissions").asInt());
        assertEquals(0,live.get("sigma").get("score").asLong(),"listed on Σ 0 while the contest runs");
        control(owner,run,"end-now");
        fresh();
        var response=http("GET",path,loser.token,null);
        var done=json(response);
        assertEquals(1,done.get("contests").size());
        assertEquals(1,done.get("contests").get(0).get("rank").asInt());
        assertEquals(1,done.get("medals").get("gold").asInt());
        assertEquals(1,done.get("stats").get("solved").asInt());
        assertTrue(done.get("rating").asInt()>Rating.START);
        assertTrue(done.get("provisional").asBoolean());
        assertEquals(1,done.get("ratingHistory").size());
        assertFalse(done.get("own").asBoolean());
        assertTrue(done.get("sigma").get("score").asLong()>0);
        assertFalse(response.body().contains("@example.test"));
        assertFalse(response.body().contains("password"));
        assertFalse(response.body().contains("source_code"));
        assertFalse(response.body().contains(winner.actor.id().toString()));
        assertEquals(1,done.get("badges").size()-5,"six badges are always listed");
        assertEquals(404,http("GET","/api/profiles/nobody_here_at_all",loser.token,null).statusCode());

        // An unrated contest leaves the rating; the results stay.
        var forbidden=http("POST","/api/manage/competitions/"+contest+"/rated",loser.token,"{\"rated\":false}");
        assertEquals(403,forbidden.statusCode());
        assertEquals(200,http("POST","/api/manage/competitions/"+contest+"/rated",owner.token,"{\"rated\":false,\"reason\":\"Training\"}").statusCode());
        fresh();
        var unrated=json(http("GET",path,loser.token,null));
        assertTrue(unrated.get("rating").isNull());
        assertEquals(1,unrated.get("contests").size());
        http("POST","/api/manage/competitions/"+contest+"/rated",owner.token,"{\"rated\":true}");
        fresh();

        // Head to head from either side.
        var versus=json(http("GET",path+"/vs/"+handle(loser),owner.token,null));
        assertEquals(1,versus.get("record").get("a").asInt());
        assertEquals(0,versus.get("record").get("b").asInt());
        assertEquals(1,versus.get("onlyA").size());
        assertEquals(0,versus.get("onlyB").size());
        assertEquals(400,http("GET",path+"/vs/"+handle(winner),owner.token,null).statusCode());

        // Replay ends on the final rank; someone who did not play gets nothing.
        var replay=json(http("GET",path+"/contests/"+run+"/replay",loser.token,null));
        assertEquals(60,replay.get("ranks").size());
        assertEquals(1,replay.get("ranks").get(59).asInt());
        assertEquals(1,replay.get("solves").size());
        assertEquals(404,http("GET","/api/profiles/"+handle(owner)+"/contests/"+run+"/replay",loser.token,null).statusCode());
    }

    @Test void privateContestsNeverAppearOnProfiles() throws Exception {
        User owner=user(true),entrant=user(false),viewer=user(false);UUID contest=contest(owner,0);
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PRIVATE");
        contests.registerUsers(owner.actor,contest,List.of(handle(entrant)));
        control(owner,run,"start-now");
        accept(submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        control(owner,run,"end-now");
        fresh();
        var profile=json(http("GET","/api/profiles/"+handle(entrant),viewer.token,null));
        assertEquals(0,profile.get("contests").size());
        assertEquals(0,profile.get("stats").get("submissions").asInt());
        assertTrue(profile.get("sigma").isNull(),"a private contest does not list anyone on the board");
        assertEquals(404,http("GET","/api/profiles/"+handle(entrant)+"/contests/"+run+"/replay",viewer.token,null).statusCode());
    }

    @Test void playersEditTheirOwnProfileAndPinRivals() throws Exception {
        User me=user(false),other=user(false);
        var saved=http("PATCH","/api/me/profile",me.token,"{\"bio\":\"Hello\",\"school\":\"InfoM4th\",\"country\":\"MA\",\"github\":\"octo-cat\",\"codeforces\":\"tourist\"}");
        assertEquals(200,saved.statusCode(),saved.body());
        var mine=json(http("GET","/api/profiles/"+handle(me),other.token,null)).get("user");
        assertEquals("Hello",mine.get("bio").asText());assertEquals("MA",mine.get("country").asText());assertEquals("octo-cat",mine.get("github").asText());
        assertEquals(400,http("PATCH","/api/me/profile",me.token,"{\"github\":\"javascript:alert(1)\"}").statusCode());
        assertEquals(400,http("PATCH","/api/me/profile",me.token,"{\"country\":\"zz\"}").statusCode());
        assertEquals(400,http("PATCH","/api/me/profile",me.token,"{\"bio\":\""+"x".repeat(281)+"\"}").statusCode());

        String path="/api/me/rivals/"+handle(other);
        assertEquals(200,http("PUT",path,me.token,null).statusCode());
        assertEquals(200,http("PUT",path,me.token,null).statusCode(),"pinning twice changes nothing");
        assertEquals(400,http("PUT","/api/me/rivals/"+handle(me),me.token,null).statusCode());
        assertEquals(404,http("PUT","/api/me/rivals/nobody_here_at_all",me.token,null).statusCode());
        assertTrue(json(http("GET","/api/profiles/"+handle(other),me.token,null)).get("isRival").asBoolean());
        assertEquals(handle(other),json(http("GET","/api/me/rivals/handles",me.token,null)).get(0).asText());
        assertEquals(handle(other),json(http("GET","/api/me/rivals",me.token,null)).get(0).get("handle").asText());
        assertEquals(0,json(http("GET","/api/me/rivals",other.token,null)).size(),"rivals are private to whoever pinned them");
        assertEquals(200,http("DELETE",path,me.token,null).statusCode());
        assertEquals(0,json(http("GET","/api/me/rivals/handles",me.token,null)).size());
    }

    @Test void teamProfilesListMembersAndResults() throws Exception {
        User owner=user(true),captain=user(false),member=user(false);
        var created=JSON.readTree(http("POST","/api/teams",captain.token,"{\"name\":\"Team "+UUID.randomUUID()+"\"}").body());
        String team=created.get("teamId").asText();
        http("POST","/api/teams/join",member.token,"{\"inviteToken\":\""+created.get("inviteToken").asText()+"\"}");
        String crew=JSON.readTree(http("POST","/api/teams",owner.token,"{\"name\":\"Crew "+UUID.randomUUID()+"\"}").body()).get("teamId").asText();
        UUID contest=contest(owner,0,Map.of("mode","TEAM","maxTeamSize",3),Map.of("teamIds",List.of(crew)));
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(captain.actor,contest,UUID.fromString(team));
        control(owner,run,"start-now");
        accept(submissions.submit(member.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        control(owner,run,"end-now");
        fresh();
        var response=http("GET","/api/teams/"+team+"/profile",member.token,null);
        var body=json(response);
        assertEquals(2,body.get("members").size());
        assertEquals(1,body.get("contests").size());
        assertTrue(body.get("sigma").get("score").asLong()>0);
        assertFalse(response.body().contains("invite"));
        assertFalse(response.body().contains("@example.test"));
        var played=json(http("GET","/api/profiles/"+handle(member),captain.token,null));
        assertEquals(handle(captain),played.get("playedWith").get(0).get("handle").asText());
        assertEquals(404,http("GET","/api/teams/"+UUID.randomUUID()+"/profile",member.token,null).statusCode());
    }

    /** Other tests may leave a contest open, and that rightly keeps benchmarks off the contest judges. */
    void noOpenContests(){db.jdbc.update("UPDATE contest_runs SET status='FINISHED' WHERE kind='OFFICIAL' AND status IN ('PENDING','RUNNING')");}

    @Test void benchmarkMeasuresRealJudgingAndStaysPrivate() throws Exception {
        User admin=user(true),player=user(false);
        contest(admin,0);// registers the judges and enables C++
        noOpenContests();
        UUID internal=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='internal' ORDER BY registered_at DESC LIMIT 1");
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        assertEquals(403,http("GET","/api/admin/benchmark",player.token,null).statusCode());
        assertEquals(403,http("POST","/api/admin/benchmark/problem",player.token,null).statusCode());
        assertEquals("NONE",json(http("GET","/api/admin/benchmark",admin.token,null)).get("problem").get("state").asText());
        assertEquals(409,http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":2,\"language\":\"CPP\"}").statusCode(),"the problem must be ready first");

        var prepared=json(http("POST","/api/admin/benchmark/problem",admin.token,null));
        assertEquals("VALIDATING",prepared.get("state").asText());
        assertEquals(12,prepared.get("tests").asInt());
        UUID version=UUID.fromString(prepared.get("version_id").asText());
        accept(db.id("SELECT id FROM submissions WHERE problem_version_id=? AND context='LABORATORY'",version),internal);
        judge.finishValidations();
        var state=json(http("GET","/api/admin/benchmark",admin.token,null));
        assertEquals("READY",state.get("problem").get("state").asText());
        assertEquals("CPP",state.get("problem").get("languages").get(0).get("code").asText());

        // Hidden from the lab, Practice and contests.
        assertFalse(http("GET","/api/lab/problems",admin.token,null).body().contains(version.toString()));
        assertEquals(409,http("POST","/api/lab/problems/"+version+"/approve",admin.token,"{\"reason\":\"no\"}").statusCode());
        assertFalse(http("GET","/api/practice",player.token,null).body().contains(version.toString()));
        var practice=HttpRequest.newBuilder(URI.create(base+"/api/practice/"+version+"/submissions")).header("Authorization","Bearer "+player.token).header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString()).POST(HttpRequest.BodyPublishers.ofString("{\"language\":\"CPP\",\"sourceCode\":\"x\"}")).build();
        assertEquals(404,HTTP.send(practice,HttpResponse.BodyHandlers.ofString()).statusCode());
        UUID other=contests.create(admin.actor,new HashMap<>(Map.of("slug","bench-"+UUID.randomUUID(),"title","No","languages",List.of("CPP"),"durationSeconds",3600)));
        assertThrows(Exception.class,()->contests.attach(admin.actor,other,version,1,"A"));

        // Validation of limits, then a real run on the contest judges.
        assertEquals(400,http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":1001,\"language\":\"CPP\"}").statusCode());
        assertEquals(409,http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":2,\"language\":\"RUST\"}").statusCode());
        var started=http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":3,\"language\":\"CPP\",\"lane\":\"official\",\"reason\":\"Load test\"}");
        assertEquals(201,started.statusCode(),started.body());
        String run=JSON.readTree(started.body()).get("runId").asText();
        assertEquals(409,http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":1,\"language\":\"CPP\"}").statusCode(),"one benchmark at a time");
        assertEquals(409,http("POST","/api/admin/benchmark/problem",admin.token,null).statusCode());
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox o JOIN judging_jobs j ON j.id=o.job_id JOIN submissions s ON s.id=j.submission_id WHERE s.benchmark_id=?::uuid AND o.lane='OFFICIAL'",Long.class,run));

        var ids=db.jdbc.queryForList("SELECT id FROM submissions WHERE benchmark_id=?::uuid ORDER BY benchmark_position",UUID.class,run);
        assertEquals(3,ids.size());
        assertTrue(judge.claim(db.id("SELECT id FROM judging_jobs WHERE submission_id=?",ids.get(0)),internal,0).isEmpty(),"an official benchmark runs only on official judges");
        // complete() is exercised by hand so the worker's timing report is part of the test.
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",ids.get(0));
        var claimed=judge.claim(job,official,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",7,"peakMemoryKb",2048)).toList();
        judge.complete(job,official,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",7,"peakMemoryKb",2048,"timings",Map.of("compileMs",900,"testsMs",1500,"totalMs",3000)));
        accept(ids.get(1),official);
        assertEquals(403,http("POST","/api/admin/benchmark/runs/"+run+"/cancel",player.token,"{}").statusCode());
        assertEquals(1,json(http("POST","/api/admin/benchmark/runs/"+run+"/cancel",admin.token,"{\"reason\":\"Enough\"}")).get("cancelled").asInt());

        var report=json(http("GET","/api/admin/benchmark/runs/"+run,admin.token,null));
        assertFalse(report.get("active").asBoolean());
        assertFalse(report.toString().contains("source_code"));
        assertEquals(2,report.get("summary").get("finished").asInt());
        assertEquals(1,report.get("summary").get("failed").asInt());
        assertEquals(2,report.get("summary").get("accepted").asInt());
        var first=report.get("rows").get(0);
        assertEquals(900,first.get("compile_ms").asInt());
        assertEquals(1500,first.get("tests_ms").asInt());
        assertEquals(600,first.get("sandbox_ms").asInt());
        assertEquals(7,first.get("execution_time_ms").asInt());
        assertEquals(12,first.get("total_tests").asInt());
        assertTrue(first.get("total_ms").asLong()>=0);
        assertEquals("BENCHMARK_CANCELLED",report.get("rows").get(2).get("error").asText());
        assertEquals(900,report.get("summary").get("metrics").get("compile_ms").get("max").asInt());

        // The Excel file: a valid workbook with one row per submission and per test.
        assertEquals(403,http("GET","/api/admin/benchmark/runs/"+run+"/report.xlsx",player.token,null).statusCode());
        var download=HTTP.send(HttpRequest.newBuilder(URI.create(base+"/api/admin/benchmark/runs/"+run+"/report.xlsx")).header("Authorization","Bearer "+admin.token).build(),HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200,download.statusCode());
        assertTrue(download.headers().firstValue("content-disposition").orElse("").contains(".xlsx"));
        var parts=new HashMap<String,org.w3c.dom.Document>();
        try(var zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(download.body()))) {
            for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry())parts.put(entry.getName(),javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new java.io.ByteArrayInputStream(zip.readAllBytes())));
        }
        assertTrue(parts.keySet().containsAll(List.of("[Content_Types].xml","_rels/.rels","xl/workbook.xml","xl/_rels/workbook.xml.rels","xl/styles.xml","xl/worksheets/sheet1.xml","xl/worksheets/sheet2.xml","xl/worksheets/sheet3.xml")));
        assertEquals(1+3,parts.get("xl/worksheets/sheet2.xml").getElementsByTagName("row").getLength());
        assertEquals(1+24,parts.get("xl/worksheets/sheet3.xml").getElementsByTagName("row").getLength());
        assertTrue(parts.get("xl/worksheets/sheet2.xml").getDocumentElement().getTextContent().contains("BENCHMARK_CANCELLED"));

        // None of it reaches anyone's score, and the admin's own submission limit is untouched.
        fresh();
        assertEquals(0,context.getBean(LeaderboardService.class).compute().players().stream().filter(r->r.key().equals(admin.actor.id())).count());
        assertEquals(0,json(http("GET","/api/submissions",admin.token,null)).findValues("context").stream().filter(c->c.asText().equals("BENCHMARK")).count());
        assertEquals(200,http("GET","/api/admin/analytics/latency",admin.token,null).statusCode());
        var analytics=json(http("GET","/api/admin/analytics/submissions?kind=Benchmark",admin.token,null));
        assertTrue(analytics.size()>=3);
        assertEquals("official",analytics.get(0).get("lane").asText());
    }

    @Test void benchmarkKeepsOffContestJudgesDuringAContest() throws Exception {
        User admin=user(true);UUID contest=contest(admin,0);
        UUID internal=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='internal' ORDER BY registered_at DESC LIMIT 1");
        var problem=json(http("GET","/api/admin/benchmark",admin.token,null)).get("problem");
        if(!"READY".equals(problem.get("state").asText())) {
            // Other tests may have left a ready problem; otherwise prepare one.
            var prepared=json(http("POST","/api/admin/benchmark/problem",admin.token,null));
            accept(db.id("SELECT id FROM submissions WHERE problem_version_id=?::uuid AND context='LABORATORY'",prepared.get("version_id").asText()),internal);
            judge.finishValidations();
        }
        UUID run=contests.schedule(admin.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        var refused=http("POST","/api/admin/benchmark/runs",admin.token,"{\"count\":1,\"language\":\"CPP\",\"lane\":\"official\"}");
        assertEquals(409,refused.statusCode(),refused.body());
        assertTrue(refused.body().contains("A contest is running"),refused.body());
        noOpenContests();
        assertEquals("FINISHED",db.one("SELECT status FROM contest_runs WHERE id=?",run).get("status"));
    }

    String fullscreenEvent(String action,String kind,String reason,int agoMs) {
        return "{\"id\":\""+UUID.randomUUID()+"\",\"action\":\""+action+"\",\"kind\":\""+kind+"\",\"reason\":\""+reason+"\",\"agoMs\":"+agoMs+"}";
    }

    @Test void fullscreenExitsAreLoggedForTheJuryAndRaiseAnAlert() throws Exception {
        User owner=user(true),entrant=user(false),outsider=user(false);UUID contest=contest(owner,0);
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);
        String path="/api/runs/"+run+"/fullscreen-events",log="/api/manage/runs/"+run+"/fullscreen";
        control(owner,run,"start-now");
        Thread.sleep(1200);// so the events below can sit inside the contest clock

        assertEquals(403,http("POST",path,outsider.token,fullscreenEvent("left","LEFT_FULLSCREEN","EXITED",0)).statusCode());
        assertEquals(400,http("POST",path,entrant.token,fullscreenEvent("left","NONSENSE","EXITED",0)).statusCode());
        assertEquals(400,http("POST",path,entrant.token,fullscreenEvent("left","LEFT_FULLSCREEN","NONSENSE",0)).statusCode());
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LEFT_FULLSCREEN","EXITED",0)).statusCode());
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LEFT_FULLSCREEN","EXITED",0)).statusCode(),"a repeat while already away changes nothing");

        // Contestants and outsiders can't read it; the alert reaches the organizer while they are away.
        assertEquals(403,http("GET",log,entrant.token,null).statusCode());
        assertEquals(403,http("GET",log+"/report.xlsx",entrant.token,null).statusCode());
        var alert=json(http("GET","/api/manage/fullscreen/alerts",owner.token,null));
        assertTrue(alert.get("count").asInt()>=1);
        assertEquals(0,json(http("GET","/api/manage/fullscreen/alerts",entrant.token,null)).get("count").asInt(),"not their contest");
        String later=java.net.URLEncoder.encode(Instant.now().plusSeconds(5).toString(),java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(0,json(http("GET","/api/manage/fullscreen/alerts?after="+later,owner.token,null)).get("count").asInt(),"seen alerts stay quiet");

        var away=json(http("GET",log,owner.token,null));
        assertEquals(1,away.get("total").asInt());
        assertTrue(away.get("people").get(0).get("away_now").asBoolean());
        assertEquals(1,away.get("people").get(0).get("left_count").asInt());

        Thread.sleep(300);
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("returned","LEFT_FULLSCREEN","EXITED",0)).statusCode());
        accept(submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}")),official);
        // Reported late after losing the connection: the time away is still right.
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LEFT_FULLSCREEN","PAGE_RELOAD",800)).statusCode());
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("returned","LEFT_FULLSCREEN","PAGE_RELOAD",300)).statusCode());
        // A blink of lost focus is logged but raises no alert.
        String before=java.net.URLEncoder.encode(Instant.now().toString(),java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LOST_FOCUS","OTHER_WINDOW",0)).statusCode());
        assertEquals(0,json(http("GET","/api/manage/fullscreen/alerts?after="+before,owner.token,null)).get("count").asInt());
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("returned","LOST_FOCUS","OTHER_WINDOW",0)).statusCode());

        var response=http("GET",log,owner.token,null);
        var done=json(response);
        assertEquals(3,done.get("total").asInt());
        assertFalse(response.body().contains("@example.test"));
        var person=done.get("people").get(0);
        assertEquals(handle(entrant),person.get("handle").asText());
        assertEquals(2,person.get("left_count").asInt());
        assertEquals(1,person.get("focus_count").asInt());
        assertEquals(1,person.get("reload_count").asInt());
        assertFalse(person.get("away_now").asBoolean());
        assertTrue(person.get("total_away_ms").asLong()>=500,person.toString());
        com.fasterxml.jackson.databind.JsonNode reload=null,firstExit=null;
        for(var event:done.get("events")) {
            if(event.get("reason").asText().equals("PAGE_RELOAD"))reload=event;
            if(event.get("reason").asText().equals("EXITED"))firstExit=event;
        }
        assertNotNull(reload);assertNotNull(firstExit);
        long reloadAway=reload.get("away_ms").asLong();
        assertTrue(reloadAway>=400 && reloadAway<5000,"about 500 ms away, got "+reloadAway);
        assertFalse(firstExit.get("next_submission_seconds").isNull(),"the submission followed this return");
        assertTrue(firstExit.get("next_submission_seconds").asLong()>=0);

        var download=HTTP.send(HttpRequest.newBuilder(URI.create(base+log+"/report.xlsx")).header("Authorization","Bearer "+owner.token).build(),HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200,download.statusCode());
        var parts=new HashMap<String,org.w3c.dom.Document>();
        try(var zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(download.body()))) {
            for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry())parts.put(entry.getName(),javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new java.io.ByteArrayInputStream(zip.readAllBytes())));
        }
        assertEquals(1+1,parts.get("xl/worksheets/sheet1.xml").getElementsByTagName("row").getLength());
        assertEquals(1+3,parts.get("xl/worksheets/sheet2.xml").getElementsByTagName("row").getLength());
        assertTrue(parts.get("xl/worksheets/sheet2.xml").getDocumentElement().getTextContent().contains("Page reload"));

        // Someone who never came back: time away stops at the end, and nothing new is logged afterwards.
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LEFT_FULLSCREEN","EXITED",0)).statusCode());
        control(owner,run,"end-now");
        Thread.sleep(100);
        assertEquals(4,json(http("GET",log,owner.token,null)).get("total").asInt());
        assertEquals(200,http("POST",path,entrant.token,fullscreenEvent("left","LOST_FOCUS","OTHER_WINDOW",0)).statusCode());
        var over=json(http("GET",log,owner.token,null));
        assertEquals(4,over.get("total").asInt(),"the contest is over");
        assertFalse(over.get("people").get(0).get("away_now").asBoolean());
        assertEquals(0,json(http("GET","/api/manage/fullscreen/alerts",owner.token,null)).findValues("competition_id").stream().filter(c->c.asText().equals(contest.toString())).count(),"a finished contest raises no alert");
    }

    @Test void adminsCanSeeTeamsAndWhatTheyPlayed() throws Exception {
        User owner=user(true),captain=user(false),member=user(false),idle=user(false);
        var created=JSON.readTree(http("POST","/api/teams",captain.token,"{\"name\":\"Team "+UUID.randomUUID()+"\"}").body());
        String team=created.get("teamId").asText();
        http("POST","/api/teams/join",member.token,"{\"inviteToken\":\""+created.get("inviteToken").asText()+"\"}");
        String quiet=JSON.readTree(http("POST","/api/teams",idle.token,"{\"name\":\"Quiet "+UUID.randomUUID()+"\"}").body()).get("teamId").asText();
        String crew=JSON.readTree(http("POST","/api/teams",owner.token,"{\"name\":\"Crew "+UUID.randomUUID()+"\"}").body()).get("teamId").asText();
        UUID contest=contest(owner,600,Map.of("mode","TEAM","maxTeamSize",3),Map.of("teamIds",List.of(crew)));
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(captain.actor,contest,UUID.fromString(team));
        control(owner,run,"start-now");
        UUID submission=submissions.submit(member.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",submission);
        var claimed=judge.claim(job,official,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,official,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        Thread.sleep(1100);// standings are cached for one second
        assertEquals(403,http("GET","/api/admin/teams",captain.token,null).statusCode());
        assertEquals(403,http("GET","/api/admin/teams/"+team,captain.token,null).statusCode());
        var detailResponse=http("GET","/api/admin/teams/"+team,owner.token,null);
        assertEquals(200,detailResponse.statusCode(),detailResponse.body());
        assertFalse(detailResponse.body().contains("token"));
        var detail=JSON.readTree(detailResponse.body());
        assertEquals(2,detail.get("members").size());
        assertEquals(1,detail.get("contests").size());
        var played=detail.get("contests").get(0);
        assertEquals(1,played.get("rank").asInt());assertEquals(1,played.get("solved").asInt());assertEquals(1,played.get("submissions").asInt());
        // Member search, filters and the last contest on the list.
        String handle=(String)db.one("SELECT handle FROM users WHERE id=?",member.actor.id()).get("handle");
        var found=JSON.readTree(http("GET","/api/admin/teams?q="+handle,owner.token,null).body());
        assertEquals(1,found.get("total").asInt());
        assertEquals(team,found.get("teams").get(0).get("id").asText());
        assertEquals("Lifecycle",found.get("teams").get(0).get("last_contest").asText());
        assertTrue(found.get("teams").get(0).get("locked").asBoolean());
        var never=http("GET","/api/admin/teams?activity=never",owner.token,null).body();
        assertTrue(never.contains(quiet));assertFalse(never.contains(team));
        assertTrue(http("GET","/api/admin/teams?activity=locked",owner.token,null).body().contains(team));
    }

    @Test void clarificationsStayPrivateUntilAnsweredPubliclyAndOnlyStaffAnnounce() throws Exception {
        User owner=user(true),asker=user(false),other=user(false);UUID contest=contest(owner,0);
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(asker.actor,contest,null);contests.register(other.actor,contest,null);
        control(owner,run,"start-now");
        var asked=http("POST","/api/runs/"+run+"/clarifications",asker.token,"{\"question\":\"Is the input sorted?\"}");
        assertEquals(201,asked.statusCode(),asked.body());
        String id=JSON.readTree(asked.body()).get("clarificationId").asText();
        assertTrue(http("GET","/api/runs/"+run+"/clarifications",asker.token,null).body().contains("Is the input sorted?"));
        assertFalse(http("GET","/api/runs/"+run+"/clarifications",other.token,null).body().contains("Is the input sorted?"),"unanswered questions are private to the asker");
        assertEquals(403,http("POST","/api/manage/clarifications/"+id+"/answer",other.token,"{\"answer\":\"Yes\",\"public\":true}").statusCode());
        assertEquals(200,http("POST","/api/manage/clarifications/"+id+"/answer",owner.token,"{\"answer\":\"No, read the statement\",\"public\":true}").statusCode());
        assertTrue(http("GET","/api/runs/"+run+"/clarifications",other.token,null).body().contains("No, read the statement"));
        assertEquals(403,http("POST","/api/manage/runs/"+run+"/announcements",asker.token,"{\"title\":\"Hi\",\"body\":\"Not staff\"}").statusCode());
        assertEquals(201,http("POST","/api/manage/runs/"+run+"/announcements",owner.token,"{\"title\":\"Note\",\"body\":\"Limits were raised\"}").statusCode());
        assertTrue(http("GET","/api/runs/"+run+"/announcements",other.token,null).body().contains("Limits were raised"));
        assertEquals(List.of("ANNOUNCEMENT","CLARIFICATION_UPDATED"),db.jdbc.queryForList("SELECT kind FROM run_events WHERE run_id=? AND kind IN ('ANNOUNCEMENT','CLARIFICATION_UPDATED') ORDER BY kind",String.class,run));
        assertEquals(1L,db.jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action='ANNOUNCEMENT_PUBLISH' AND resource_id=?",Long.class,run));
        assertEquals(1L,db.jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action='CLARIFICATION_ANSWER' AND resource_id=?::uuid",Long.class,id));
    }

    @Test void delegationRejudgingAndRuntimeAdministrationKeepTheirRules() throws Exception {
        User owner=user(true),helper=user(false),entrant=user(false);UUID contest=contest(owner,0);
        // Invitations and staff grants: organizers invite, only the owner delegates.
        assertEquals(403,http("PUT","/api/manage/competitions/"+contest+"/invitations/"+entrant.actor.id(),entrant.token,null).statusCode());
        assertEquals(200,http("PUT","/api/manage/competitions/"+contest+"/invitations/"+entrant.actor.id(),owner.token,null).statusCode());
        assertTrue(db.exists("SELECT EXISTS(SELECT 1 FROM competition_invitations WHERE competition_id=? AND user_id=?)",contest,entrant.actor.id()));
        String jury="{\"accessLevel\":\"JURY\",\"reason\":\"Helps judge\"}";
        assertEquals(403,http("PUT","/api/manage/competitions/"+contest+"/staff/"+helper.actor.id(),entrant.token,jury).statusCode());
        assertEquals(200,http("PUT","/api/manage/competitions/"+contest+"/staff/"+helper.actor.id(),owner.token,jury).statusCode());
        assertEquals("JURY",db.one("SELECT access_level FROM competition_staff WHERE competition_id=? AND user_id=?",contest,helper.actor.id()).get("access_level"));
        // Problem collaborators: only the owner delegates, and the grant is audited.
        UUID version=db.id("SELECT cp.problem_version_id FROM competition_problems cp JOIN competition_versions v ON v.id=cp.competition_version_id WHERE v.competition_id=? LIMIT 1",contest);
        UUID problem=db.id("SELECT problem_id FROM problem_versions WHERE id=?",version);
        assertEquals(403,http("PUT","/api/lab/problems/"+version+"/collaborators/"+helper.actor.id(),entrant.token,"{\"accessLevel\":\"REVIEWER\"}").statusCode());
        assertEquals(200,http("PUT","/api/lab/problems/"+version+"/collaborators/"+helper.actor.id(),owner.token,"{\"accessLevel\":\"REVIEWER\"}").statusCode());
        assertEquals("REVIEWER",db.one("SELECT access_level FROM problem_collaborators WHERE problem_id=? AND user_id=?",problem,helper.actor.id()).get("access_level"));
        assertEquals(1L,db.jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action='COLLABORATOR_GRANT' AND resource_id=?",Long.class,problem));
        // Rejudging a judged contest submission starts a new generation, once at a time.
        UUID official=db.id("SELECT id FROM judge_workers WHERE runtime_manifest->>'lane'='official' ORDER BY registered_at DESC LIMIT 1");
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);control(owner,run,"start-now");
        UUID submission=submissions.submit(entrant.actor,run,1,null,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",submission);
        var claimed=judge.claim(job,official,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,official,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        String reason="{\"reason\":\"Tests were fixed\"}";
        assertEquals(403,http("POST","/api/manage/submissions/"+submission+"/rejudge",entrant.token,reason).statusCode());
        var rejudged=http("POST","/api/manage/submissions/"+submission+"/rejudge",owner.token,reason);
        assertEquals(202,rejudged.statusCode(),rejudged.body());
        assertEquals(2,((Number)db.one("SELECT generation FROM judging_jobs WHERE id=?",Api.uuid(JSON.readTree(rejudged.body()).get("jobId").asText())).get("generation")).intValue());
        assertEquals(409,http("POST","/api/manage/submissions/"+submission+"/rejudge",owner.token,reason).statusCode(),"judging is already active");
        // Judge overview and languages are super-administrator only; enabling needs a verified runtime.
        assertEquals(403,http("GET","/api/admin/judge",entrant.token,null).statusCode());
        assertTrue(http("GET","/api/admin/judge",owner.token,null).body().contains("\"workers\""));
        assertEquals(403,http("GET","/api/admin/languages",entrant.token,null).statusCode());
        assertTrue(http("GET","/api/admin/languages",owner.token,null).body().contains("\"PHP\""));
        assertEquals(409,http("PUT","/api/admin/languages/PHP",owner.token,"{\"enabled\":true,\"imageId\":\"sha256:"+"b".repeat(64)+"\",\"reason\":\"try\"}").statusCode());
        assertEquals(200,http("PUT","/api/admin/languages/PHP",owner.token,"{\"enabled\":false,\"reason\":\"Not offered\"}").statusCode());
        assertEquals(404,http("PUT","/api/admin/languages/NOPE",owner.token,"{\"enabled\":false,\"reason\":\"x\"}").statusCode());
        // The additive role endpoint is gone: it could grant SUPER_ADMIN without the last-administrator checks.
        assertNotEquals(200,http("PUT","/api/admin/users/"+helper.actor.id()+"/roles",owner.token,"{\"role\":\"SUPER_ADMIN\",\"reason\":\"x\"}").statusCode());
        assertFalse(db.exists("SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=? AND role_code='SUPER_ADMIN')",helper.actor.id()));
    }

    @Test void endingARehearsalMovesItsClock() throws Exception {
        User owner=user(true);UUID contest=contest(owner,0);
        UUID rehearsal=db.id("SELECT id FROM contest_runs WHERE competition_id=? AND kind='REHEARSAL'",contest);
        Thread.sleep(1100);// a run is never shorter than one second
        control(owner,rehearsal,"end-rehearsal");
        var r=db.one("SELECT status,ends_at<=now() AS over FROM contest_runs WHERE id=?",rehearsal);
        assertEquals("FINISHED",r.get("status"));assertEquals(true,r.get("over"));
    }

    @Test void clockChangesNotifyContestants() {
        User owner=user(true);
        UUID run=contests.schedule(owner.actor,contest(owner,0),Instant.now().plusSeconds(60),"PUBLIC");
        control(owner,run,"start-now");control(owner,run,"extend");control(owner,run,"pause");
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM run_events WHERE run_id=? AND kind='RUN_UPDATED'",Integer.class,run));
    }

    @Test void serverTimeIsPublicAndErrorsKeepTheirRealStatus() throws Exception {
        long before=System.currentTimeMillis();
        var time=http("GET","/api/time",null,null);
        assertEquals(200,time.statusCode(),time.body());
        assertTrue(time.body().contains("serverTime"));assertTrue(time.body().contains("timeZone"));
        assertTrue(System.currentTimeMillis()>=before);
        // Errors raised outside the error handlers used to come back as 401, which reads as "sign in again".
        User owner=user(true);
        var missingHeader=http("POST","/api/practice/"+UUID.randomUUID()+"/submissions",owner.token,"{}");
        assertEquals(400,missingHeader.statusCode(),missingHeader.body());
        assertEquals(401,http("GET","/api/me",null,null).statusCode());
    }
}
