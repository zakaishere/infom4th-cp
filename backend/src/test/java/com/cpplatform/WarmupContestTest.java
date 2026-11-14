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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Warmup contests: problems open day by day, best submission scoring, and Practice once it ends. */
class WarmupContestTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;
    static CompetitionService contests;static CompetitionQueries views;static StandingsService standings;
    static String base;static UUID worker;
    static final String IMAGE="sha256:"+"b".repeat(64);
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
        views=context.getBean(CompetitionQueries.class);standings=context.getBean(StandingsService.class);
        base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        worker=(UUID)judge.register(Map.of("name","internal-"+UUID.randomUUID(),"capacity",4,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","internal"))).get("workerId");
        judge.register(Map.of("name","official-"+UUID.randomUUID(),"capacity",4,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","official")));
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
    /** An approved, validated problem version. */
    UUID problem(User owner,String title) {
        UUID version=lab.create(owner.actor,Map.of("slug","w-"+UUID.randomUUID(),"title",title,"statement","Add two integers","languages",List.of("CPP")));
        lab.tests(owner.actor,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner.actor,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner.actor,version);
        UUID job=db.jdbc.queryForObject("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.validation_id=?",UUID.class,validation);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        judge.finishValidations();lab.approve(owner.actor,version,"Reference validation passed");
        return version;
    }
    UUID warmup(User owner,int days) {
        return contests.create(owner.actor,new HashMap<>(Map.of("slug","warm-"+UUID.randomUUID(),"title","Warmup","languages",List.of("CPP"),
                "format","WARMUP","days",days,"scoringSystem","ICPC","freezeBeforeEndSeconds",600)));
    }
    /** Moves the run's clock back, as if it had started `seconds` earlier. */
    void startedAgo(UUID run,long seconds) {
        new TransactionTemplate(context.getBean(PlatformTransactionManager.class)).executeWithoutResult(status->{
            db.jdbc.queryForList("SELECT set_config('cp.run_clock_change','on',true)");
            db.jdbc.update("UPDATE contest_runs SET starts_at=starts_at-make_interval(secs=>?),ends_at=ends_at-make_interval(secs=>?) WHERE id=?",seconds,seconds,run);
        });
    }
    HttpResponse<String> http(String method,String path,String token,String json) throws Exception {
        var request=HttpRequest.newBuilder(URI.create(base+path)).method(method,json==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json));
        if(token!=null)request.header("Authorization","Bearer "+token);
        if(json!=null)request.header("Content-Type","application/json");
        request.header("Idempotency-Key",UUID.randomUUID().toString());
        return HTTP.send(request.build(),HttpResponse.BodyHandlers.ofString());
    }
    @SuppressWarnings("unchecked")
    static List<Map<String,Object>> list(Object value){return (List<Map<String,Object>>)value;}

    @Test void warmupUsesWholeDaysBestSubmissionScoringAndStaysUnrated() {
        User owner=user(true);UUID contest=warmup(owner,3);
        var v=contests.version(contest);
        assertEquals("WARMUP",v.get("contest_format"));
        assertEquals(3*86400,((Number)v.get("duration_seconds")).intValue());
        assertEquals("IOI",v.get("scoring_system"),"a warmup ignores the requested scoring");
        assertEquals(0,((Number)v.get("freeze_before_end_seconds")).intValue(),"a warmup never freezes");
        assertEquals(true,v.get("publish_to_practice"));
        assertEquals(false,db.one("SELECT rated FROM competitions WHERE id=?",contest).get("rated"));
        UUID p=problem(owner,"Late");
        var outside=assertThrows(RuntimeException.class,()->contests.attach(owner.actor,contest,p,1,"A",null,4));
        assertTrue(outside.getMessage().contains("day from 1 to 3"),outside.getMessage());
        var tooShort=assertThrows(RuntimeException.class,()->{
            contests.attach(owner.actor,contest,p,1,"A",null,3);
            contests.edit(owner.actor,contest,Map.of("days",2));
        });
        assertTrue(tooShort.getMessage().contains("after day 2"),tooShort.getMessage());
    }

    @Test void standardContestProblemsAllOpenAtTheStart() {
        User owner=user(true);
        UUID contest=contests.create(owner.actor,new HashMap<>(Map.of("slug","std-"+UUID.randomUUID(),"title","Standard","languages",List.of("CPP"),"durationSeconds",3600)));
        UUID p=problem(owner,"Only");
        assertThrows(RuntimeException.class,()->contests.attach(owner.actor,contest,p,1,"A",null,2));
        contests.edit(owner.actor,contest,Map.of("days",3));
        assertEquals(3600,((Number)contests.version(contest).get("duration_seconds")).intValue(),"days only apply to warmups");
    }

    @Test void problemsOpenDayByDayAndJoinPracticeWhenTheWarmupEnds() throws Exception {
        User owner=user(true),entrant=user(false);
        UUID contest=warmup(owner,3);
        UUID day1=problem(owner,"Day one"),day2=problem(owner,"Day two"),day3=problem(owner,"Day three");
        contests.attach(owner.actor,contest,day1,1,"A",null,1);
        contests.attach(owner.actor,contest,day2,2,"B",null,2);
        contests.attach(owner.actor,contest,day3,3,"C",null,1);
        contests.setReleaseDay(owner.actor,contest,3,3);
        contests.rehearsal(owner.actor,contest,Map.of());
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.register(entrant.actor,contest,null);
        contests.control(owner.actor,run,Map.of("action","start-now","reason","test"));

        // Day 1: only problem A, the titles of later days stay hidden.
        var view=views.run(entrant.actor,run);
        assertEquals(List.of("A"),list(view.get("problems")).stream().map(p->p.get("label")).toList());
        assertFalse(String.valueOf(view).contains("Day two"),"a locked problem's title must not leak");
        assertEquals(List.of(2,3),list(view.get("upcomingDays")).stream().map(d->((Number)d.get("day")).intValue()).toList());
        assertEquals(3,list(views.run(owner.actor,run).get("problems")).size(),"the jury sees every day");

        assertEquals(403,http("GET","/api/runs/"+run+"/problems/2",entrant.token,null).statusCode());
        assertEquals(403,http("POST","/api/runs/"+run+"/problems/2/submissions",entrant.token,"{\"language\":\"CPP\",\"sourceCode\":\"int main(){}\"}").statusCode());
        assertEquals(200,http("GET","/api/runs/"+run+"/problems/1",entrant.token,null).statusCode());
        var accepted=http("POST","/api/runs/"+run+"/problems/1/submissions",entrant.token,"{\"language\":\"CPP\",\"sourceCode\":\"int main(){}\"}");
        assertEquals(202,accepted.statusCode(),accepted.body());
        var board=(Map<?,?>)standings.get(entrant.actor,run,false);
        assertEquals(1,list(board.get("problems")).size(),"the board shows only opened days");

        // A day later (plus a second), day 2 is open and day 3 still locked.
        startedAgo(run,86401);
        view=views.run(entrant.actor,run);
        assertEquals(List.of("A","B"),list(view.get("problems")).stream().map(p->p.get("label")).toList());
        assertEquals(200,http("GET","/api/runs/"+run+"/problems/2",entrant.token,null).statusCode());
        assertEquals(403,http("GET","/api/runs/"+run+"/problems/3",entrant.token,null).statusCode());

        // Nothing goes to Practice while it runs.
        contests.tick();
        assertNull(db.one("SELECT practice_published_at FROM competitions WHERE id=?",contest).get("practice_published_at"));

        contests.control(owner.actor,run,Map.of("action","end-now","reason","test"));
        contests.tick();
        assertEquals("FINISHED",db.one("SELECT status FROM competitions WHERE id=?",contest).get("status"));
        for(UUID version:List.of(day1,day2,day3)) {
            assertTrue(db.exists("SELECT EXISTS(SELECT 1 FROM practice_publications WHERE problem_version_id=? AND NOT hidden)",version),"every warmup problem joins Practice");
            assertEquals("PUBLISHED",db.one("SELECT status FROM problem_versions WHERE id=?",version).get("status"));
        }
        Object publishedAt=db.one("SELECT practice_published_at FROM competitions WHERE id=?",contest).get("practice_published_at");
        assertNotNull(publishedAt);
        contests.tick();
        assertEquals(publishedAt,db.one("SELECT practice_published_at FROM competitions WHERE id=?",contest).get("practice_published_at"),"published once");
    }

    @Test void organizerCanKeepAWarmupOutOfPractice() {
        User owner=user(true);
        UUID contest=contests.create(owner.actor,new HashMap<>(Map.of("slug","warm-"+UUID.randomUUID(),"title","Private warmup","languages",List.of("CPP"),
                "format","WARMUP","days",2,"publishToPractice",false)));
        UUID p=problem(owner,"Kept");
        contests.attach(owner.actor,contest,p,1,"A",null,1);
        contests.rehearsal(owner.actor,contest,Map.of());
        UUID run=contests.schedule(owner.actor,contest,Instant.now().plusSeconds(60),"PUBLIC");
        contests.control(owner.actor,run,Map.of("action","start-now","reason","test"));
        contests.control(owner.actor,run,Map.of("action","end-now","reason","test"));
        contests.tick();
        assertFalse(db.exists("SELECT EXISTS(SELECT 1 FROM practice_publications WHERE problem_version_id=?)",p));
    }
}
