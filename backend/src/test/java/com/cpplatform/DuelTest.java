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
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Blitz duels: the race order, the wrong answer penalty, timeouts, forfeits and what spectators see. */
class DuelTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;static DuelService duels;
    static UUID worker;
    static final String IMAGE="sha256:"+"a".repeat(64);
    static final Map<String,Object> CODE=Map.of("language","CPP","sourceCode","int main() {}");
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);duels=context.getBean(DuelService.class);
        worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",8,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","internal"))).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        db.jdbc.update("UPDATE judging_settings SET pending_submissions_per_user=50,submissions_per_minute=600 WHERE id=1");
        Actor owner=user(true);
        for(int i=0;i<3;i++)practiceProblem(owner);
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    static Actor user(boolean admin) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        var session=auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!"));
        UUID id=(UUID)session.get("userId");
        if(admin)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new Actor(id,admin?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT"));
    }
    /** An approved two-test problem published to practice, so duels can draw it. */
    static void practiceProblem(Actor owner) {
        UUID version=lab.create(owner,Map.of("slug","duel-"+UUID.randomUUID(),"title","Sum","statement","Add two integers","languages",List.of("CPP")));
        lab.tests(owner,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner,version);
        verdict(db.id("SELECT s.id FROM submissions s WHERE s.validation_id=?",validation),"ACCEPTED",2);
        judge.finishValidations();lab.approve(owner,version,"Reference validation passed");
        lab.publishPractice(owner,version);
    }
    /** Judges a submission: the first `passed` tests pass, and the rest get the verdict. */
    static void verdict(UUID submission,String verdict,int passed) {
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=? ORDER BY generation DESC LIMIT 1",submission);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        List<?> tests=(List<?>)claimed.get("tests");
        var cases=new ArrayList<Map<String,Object>>();
        for(int i=0;i<tests.size();i++)cases.add(Map.of("id",((Map<?,?>)tests.get(i)).get("id"),"verdict",i<passed?"ACCEPTED":verdict,"executionTimeMs",10,"peakMemoryKb",1024));
        if(verdict.equals("COMPILATION_ERROR"))cases.clear();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict",verdict,"cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
    }
    static UUID submit(Actor player,UUID duel){return duels.submit(player,duel,UUID.randomUUID(),CODE);}
    /** Skips the countdown before the current round. */
    static void openRound(UUID duel) {
        db.jdbc.update("UPDATE duel_rounds SET ends_at=ends_at-(starts_at-clock_timestamp())-interval '1 second',starts_at=clock_timestamp()-interval '1 second' WHERE duel_id=? AND result IS NULL AND starts_at>clock_timestamp()",duel);
    }
    static Map<String,Object> round(UUID duel,int number){return db.one("SELECT * FROM duel_rounds WHERE duel_id=? AND number=?",duel,number);}
    static String reason(Runnable action){return assertThrows(ResponseStatusException.class,action::run).getReason();}

    @Test void bestOfThreeIsDecidedBySubmissionOrderPenaltiesAndTests() {
        Actor a=user(false),b=user(false),spectator=user(false);
        UUID duel=duels.create(a,Map.of("bestOf",3,"roundMinutes",5,"lockoutSeconds",30));
        assertTrue(reason(()->duels.join(a,duel)).contains("cannot duel yourself"));
        duels.join(b,duel);
        assertTrue(reason(()->duels.join(spectator,duel)).contains("no longer open"));
        // The countdown hides the problem and refuses code.
        assertNull(((List<Map<String,Object>>)duels.state(spectator,duel).get("rounds")).get(0).get("title"));
        assertThrows(ResponseStatusException.class,()->duels.problem(spectator,duel,1));
        assertTrue(reason(()->submit(a,duel)).contains("No round is open"));
        openRound(duel);
        assertNotNull(duels.problem(spectator,duel,1).get("title"));

        // Round 1: a submits first; b's later accepted answer must wait for a's verdict, and a wins.
        UUID first=submit(a,duel);
        assertTrue(reason(()->submit(a,duel)).contains("still being judged"));
        UUID second=submit(b,duel);
        verdict(second,"ACCEPTED",2);
        duels.tick();
        assertNull(round(duel,1).get("result"),"an earlier submission is still being judged");
        verdict(first,"ACCEPTED",2);
        duels.tick();
        assertEquals("ACCEPTED",round(duel,1).get("result"));
        assertEquals(a.id(),round(duel,1).get("winner_id"));
        assertNotNull(round(duel,2).get("starts_at"),"round 2 is scheduled");

        // Round 2: a wrong answer locks a out; a compilation error does not lock b; b wins.
        openRound(duel);
        verdict(submit(a,duel),"WRONG_ANSWER",1);
        assertTrue(reason(()->submit(a,duel)).contains("penalty"));
        assertTrue(((Number)duels.state(a,duel).get("lockedSeconds")).intValue()>0);
        verdict(submit(b,duel),"COMPILATION_ERROR",0);
        verdict(submit(b,duel),"ACCEPTED",2);
        duels.tick();
        assertEquals(b.id(),round(duel,2).get("winner_id"));

        // Round 3: time runs out; a passed one test, b none, so a wins on tests and takes the duel 2-1.
        openRound(duel);
        verdict(submit(a,duel),"WRONG_ANSWER",1);
        verdict(submit(b,duel),"WRONG_ANSWER",0);
        duels.tick();
        assertNull(round(duel,3).get("result"),"the round is still running");
        db.jdbc.update("UPDATE duel_rounds SET ends_at=clock_timestamp()-interval '1 second' WHERE duel_id=? AND number=3",duel);
        duels.tick();
        assertEquals("TESTS",round(duel,3).get("result"));
        var d=db.one("SELECT * FROM duels WHERE id=?",duel);
        assertEquals("FINISHED",d.get("status"));
        assertEquals(a.id(),d.get("winner_id"));
        assertEquals("ROUNDS",d.get("end_reason"));
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM duel_rounds WHERE duel_id=?",Integer.class,duel),"unplayed rounds are dropped");

        // Spectators see every verdict but no submission IDs; players see their own.
        var feed=(List<Map<String,Object>>)duels.state(spectator,duel).get("feed");
        assertEquals(7,feed.size());
        assertTrue(feed.stream().noneMatch(s->s.containsKey("id") || s.containsKey("submitted_by")));
        var mine=(List<Map<String,Object>>)duels.state(a,duel).get("feed");
        assertEquals(3,mine.stream().filter(s->s.containsKey("id")).count());
        // Duel submissions never count as practice.
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE duel_id=? AND context<>'DUEL'",Integer.class,duel));
    }

    @Test void drawnRoundsTimeoutsAndForfeits() {
        Actor a=user(false),b=user(false),c=user(false);
        UUID duel=duels.create(a,Map.of("bestOf",1,"roundMinutes",1,"lockoutSeconds",0));
        duels.join(b,duel);
        assertTrue(reason(()->duels.create(a,Map.of("bestOf",1))).contains("current duel"));
        openRound(duel);
        // Nobody passes a test: the round is drawn and another one starts.
        db.jdbc.update("UPDATE duel_rounds SET ends_at=clock_timestamp()-interval '1 second' WHERE duel_id=? AND number=1",duel);
        duels.tick();
        assertEquals("DRAW",round(duel,1).get("result"));
        assertNotNull(round(duel,2).get("starts_at"));
        // b gives up: a wins by forfeit.
        assertThrows(ResponseStatusException.class,()->duels.leave(c,duel));
        duels.leave(b,duel);
        var d=db.one("SELECT * FROM duels WHERE id=?",duel);
        assertEquals("FORFEIT",d.get("end_reason"));
        assertEquals(a.id(),d.get("winner_id"));
        assertTrue(reason(()->submit(a,duel)).contains("not running"));

        // Open challenges: only the challenger cancels, and too many open ones are refused.
        UUID open=duels.create(c,Map.of());
        assertThrows(ResponseStatusException.class,()->duels.leave(a,open));
        assertTrue(((List<?>)duels.list(a).get("open")).stream().anyMatch(x->open.equals(((Map<?,?>)x).get("id"))));
        duels.create(c,Map.of());duels.create(c,Map.of());
        assertTrue(reason(()->duels.create(c,Map.of())).contains("3 open challenges"));
        duels.leave(c,open);
        assertEquals("CANCELLED",db.one("SELECT status FROM duels WHERE id=?",open).get("status"));
        assertTrue(reason(()->duels.create(c,Map.of("bestOf",5))).contains("Not enough practice problems"));
    }
}
