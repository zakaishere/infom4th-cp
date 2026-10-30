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
        assertEquals(200,http("GET","/api/admin/analytics/latency",owner.token,null).statusCode());
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
