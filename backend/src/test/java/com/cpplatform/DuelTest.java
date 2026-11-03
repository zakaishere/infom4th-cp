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

/** Blitz rooms: race order, penalties, timeouts, forfeits, teams, free-for-all points, twists and what spectators see. */
@SuppressWarnings("unchecked")
class DuelTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;static DuelService duels;
    static UUID worker,practiceOnly;static Actor owner;
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
        owner=user(true);
        for(int i=0;i<3;i++)lab.publishDuel(owner,approvedProblem(owner));
        // A practice problem is never drawn for a duel.
        practiceOnly=approvedProblem(owner);
        lab.publishPractice(owner,practiceOnly);
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    static Actor user(boolean admin) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        var session=auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!"));
        UUID id=(UUID)session.get("userId");
        if(admin)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new Actor(id,admin?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT"));
    }
    /** An approved problem with one example and one hidden test. */
    static UUID approvedProblem(Actor owner) {
        UUID version=lab.create(owner,Map.of("slug","duel-"+UUID.randomUUID(),"title","Sum","statement","Add two integers","languages",List.of("CPP")));
        lab.tests(owner,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(owner,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(owner,version);
        verdict(db.id("SELECT s.id FROM submissions s WHERE s.validation_id=?",validation),"ACCEPTED",2);
        judge.finishValidations();lab.approve(owner,version,"Reference validation passed");
        return version;
    }
    /** Judges a submission: the first `passed` tests pass, and the rest get the verdict. */
    static void verdict(UUID submission,String verdict,int passed){verdict(submission,verdict,passed,10);}
    static void verdict(UUID submission,String verdict,int passed,int ms) {
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=? ORDER BY generation DESC LIMIT 1",submission);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        List<?> tests=(List<?>)claimed.get("tests");
        var cases=new ArrayList<Map<String,Object>>();
        for(int i=0;i<tests.size();i++)cases.add(Map.of("id",((Map<?,?>)tests.get(i)).get("id"),"verdict",i<passed?"ACCEPTED":verdict,"executionTimeMs",ms,"peakMemoryKb",1024));
        if(verdict.equals("COMPILATION_ERROR"))cases.clear();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict",verdict,"cases",cases,"executionTimeMs",ms,"peakMemoryKb",1024));
    }
    static UUID submit(Actor player,UUID duel){return duels.submit(player,duel,UUID.randomUUID(),CODE);}
    static UUID submit(Actor player,UUID duel,String source){return duels.submit(player,duel,UUID.randomUUID(),Map.of("language","CPP","sourceCode",source));}
    /** Skips the countdown before the current round. */
    static void openRound(UUID duel) {
        db.jdbc.update("UPDATE duel_rounds SET ends_at=ends_at-(starts_at-clock_timestamp())-interval '1 second',starts_at=clock_timestamp()-interval '1 second' WHERE duel_id=? AND result IS NULL AND starts_at>clock_timestamp()",duel);
    }
    static void endRound(UUID duel,int number){db.jdbc.update("UPDATE duel_rounds SET ends_at=clock_timestamp()-interval '1 second' WHERE duel_id=? AND number=?",duel,number);}
    static Map<String,Object> round(UUID duel,int number){return db.one("SELECT * FROM duel_rounds WHERE duel_id=? AND number=?",duel,number);}
    static Map<String,Object> room(UUID duel){return db.one("SELECT * FROM duels WHERE id=?",duel);}
    static int points(UUID duel,Actor player){return db.jdbc.queryForObject("SELECT coalesce(sum(points),0) FROM duel_round_results WHERE duel_id=? AND user_id=?",Integer.class,duel,player.id());}
    static String reason(Runnable action){return assertThrows(ResponseStatusException.class,action::run).getReason();}
    static int team(Number n){return n.intValue();}

    @Test void bestOfThreeIsDecidedBySubmissionOrderPenaltiesAndTests() {
        Actor a=user(false),b=user(false),spectator=user(false);
        UUID duel=duels.create(a,Map.of("bestOf",3,"roundMinutes",5,"lockoutSeconds",30));
        assertTrue(reason(()->duels.join(a,duel,null)).contains("already in this room"));
        duels.join(b,duel,null);
        assertEquals("ACTIVE",room(duel).get("status"),"a full 1v1 starts by itself");
        assertTrue(reason(()->duels.join(spectator,duel,null)).contains("no longer open"));
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
        // Running the examples is allowed during the penalty and never takes part in the race.
        UUID run=duels.submit(a,duel,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}","mode","samples"));
        verdict(run,"ACCEPTED",1);
        duels.tick();
        assertNull(round(duel,2).get("result"),"an accepted example run does not win the round");
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
        endRound(duel,3);
        duels.tick();
        assertEquals("TESTS",round(duel,3).get("result"));
        var d=room(duel);
        assertEquals("FINISHED",d.get("status"));
        assertEquals(a.id(),d.get("winner_id"));
        assertEquals("ROUNDS",d.get("end_reason"));
        assertEquals(2,points(duel,a));assertEquals(1,points(duel,b));
        assertEquals(3,db.jdbc.queryForObject("SELECT count(*) FROM duel_rounds WHERE duel_id=?",Integer.class,duel),"unplayed rounds are dropped");

        // Spectators see every verdict but no submission IDs; players see their own.
        var feed=(List<Map<String,Object>>)duels.state(spectator,duel).get("feed");
        assertEquals(7,feed.size());
        assertTrue(feed.stream().noneMatch(s->s.containsKey("id") || s.containsKey("submitted_by")));
        var mine=(List<Map<String,Object>>)duels.state(a,duel).get("feed");
        assertEquals(3,mine.stream().filter(s->s.containsKey("id")).count());
        assertEquals(1,db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE duel_id=? AND samples_only",Integer.class,duel));
        // Rounds come from the duel pool only, and duel submissions never count as practice.
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM duel_rounds WHERE duel_id=? AND problem_version_id NOT IN (SELECT problem_version_id FROM duel_problems)",Integer.class,duel));
        assertEquals(0,db.jdbc.queryForObject("SELECT count(*) FROM submissions WHERE duel_id=? AND context<>'DUEL'",Integer.class,duel));
    }

    @Test void duelSubmissionsRunEveryTest() {
        // "Most tests passed" must count every test, not the tests before the first failure.
        Actor p=user(false),q=user(false);
        UUID duel=duels.create(p,Map.of("bestOf",1));duels.join(q,duel,null);openRound(duel);
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=?",submit(p,duel));
        assertEquals(Boolean.TRUE,judge.claim(job,worker,0).orElseThrow().get("run_all_tests"));
        duels.leave(q,duel);
    }

    @Test void drawnRoundsForfeitsAndOneRoomAtATime() {
        Actor a=user(false),b=user(false),c=user(false);
        UUID duel=duels.create(a,Map.of("bestOf",1,"roundMinutes",1,"lockoutSeconds",0));
        duels.join(b,duel,null);
        assertTrue(reason(()->duels.create(a,Map.of("bestOf",1))).contains("current room"));
        openRound(duel);
        // Nobody passes a test: the round is drawn and another one starts.
        endRound(duel,1);
        duels.tick();
        assertEquals("DRAW",round(duel,1).get("result"));
        assertNotNull(round(duel,2).get("starts_at"));
        // b gives up: a wins by forfeit.
        assertThrows(ResponseStatusException.class,()->duels.leave(c,duel));
        duels.leave(b,duel);
        var d=room(duel);
        assertEquals("FORFEIT",d.get("end_reason"));
        assertEquals(a.id(),d.get("winner_id"));
        assertTrue(reason(()->submit(a,duel)).contains("not running"));

        // Open rooms: a guest can leave, only the host cancels, and a player holds one room at a time.
        UUID open=duels.create(c,Map.of("mode","FFA","maxPlayers",4,"rounds",2));
        assertTrue(reason(()->duels.create(c,Map.of())).contains("current room"));
        assertTrue(reason(()->duels.start(c,open)).contains("at least one opponent"));
        assertTrue(((List<?>)duels.list(a).get("open")).stream().anyMatch(x->open.equals(((Map<?,?>)x).get("id"))));
        duels.join(a,open,null);
        assertThrows(ResponseStatusException.class,()->duels.start(a,open));
        duels.leave(a,open);
        assertEquals(1,db.jdbc.queryForObject("SELECT count(*) FROM duel_players WHERE duel_id=?",Integer.class,open));
        duels.leave(c,open);
        assertEquals("CANCELLED",room(open).get("status"));
        assertTrue(reason(()->duels.create(c,Map.of("mode","FFA","rounds",5))).contains("Not enough duel problems"));
    }

    @Test void teamsShareRoundsAndLoseWhenEveryoneLeaves() {
        Actor a=user(false),b=user(false),c=user(false),d=user(false);
        UUID room=duels.create(a,Map.of("mode","TEAMS","teamSize",2,"bestOf",3));
        duels.join(b,room,null);
        duels.join(c,room,1);
        assertEquals(2,team((Number)db.one("SELECT team FROM duel_players WHERE duel_id=? AND user_id=?",room,b.id()).get("team")),"joins the smaller team");
        assertTrue(reason(()->duels.team(b,room,1)).contains("full"));
        duels.join(d,room,null);
        assertEquals("ACTIVE",room(room).get("status"),"a full room starts by itself");
        assertEquals(2,team((Number)db.one("SELECT team FROM duel_players WHERE duel_id=? AND user_id=?",room,d.id()).get("team")));

        // Round 1: b (team 2) is first; the whole team takes the round.
        openRound(room);
        UUID fromC=submit(c,room);UUID fromB=submit(b,room);
        verdict(fromC,"WRONG_ANSWER",1);verdict(fromB,"ACCEPTED",2);
        duels.tick();
        assertEquals(2,team((Number)round(room,1).get("winner_team")));
        assertEquals(1,points(room,d),"teammates share the round");
        assertEquals(0,points(room,a));
        // Team 1 walks out: team 2 wins.
        duels.leave(a,room);
        assertEquals("ACTIVE",room(room).get("status"),"c still plays for team 1");
        duels.leave(c,room);
        var r=room(room);
        assertEquals("FINISHED",r.get("status"));assertEquals("FORFEIT",r.get("end_reason"));
        assertEquals(2,team((Number)r.get("winner_team")));
        var players=(List<Map<String,Object>>)((Map<String,Object>)duels.state(a,room).get("duel")).get("players");
        assertEquals(4,players.size());
    }

    @Test void freeForAllGolfGivesPlacementPoints() {
        Actor a=user(false),b=user(false),c=user(false);
        UUID room=duels.create(a,Map.of("mode","FFA","maxPlayers",3,"rounds",2,"modifiers",List.of("GOLF")));
        duels.join(b,room,null);duels.join(c,room,null);
        assertEquals("ACTIVE",room(room).get("status"));
        var state=duels.state(c,room);
        assertEquals("GOLF",((List<Map<String,Object>>)state.get("rounds")).get(0).get("modifier"),"the twist shows during the countdown");
        openRound(room);
        // Golf stays open after an accepted answer, so a can improve; b's shorter code still wins.
        verdict(submit(a,room,"int main() {     return 0; }"),"ACCEPTED",2);
        verdict(submit(b,room,"int main(){}"),"ACCEPTED",2);
        verdict(submit(c,room),"WRONG_ANSWER",1);
        duels.tick();
        assertNull(round(room,1).get("result"),"golf runs until the clock ends");
        verdict(submit(a,room,"int main() {}"),"ACCEPTED",2);
        endRound(room,1);
        duels.tick();
        assertEquals("POINTS",round(room,1).get("result"));
        assertEquals(b.id(),round(room,1).get("winner_id"));
        assertEquals(3,points(room,b));assertEquals(2,points(room,a));assertEquals(1,points(room,c));
        // Round 2: nobody submits, a draw; b wins the room on points.
        openRound(room);endRound(room,2);
        duels.tick();
        assertEquals("DRAW",round(room,2).get("result"));
        var r=room(room);
        assertEquals("FINISHED",r.get("status"));assertEquals(b.id(),r.get("winner_id"));
    }

    @Test void twistsBanCodeHideExamplesAndForceLanguages() {
        assertTrue(reason(()->DuelService.checkTwist("NO_FOR",null,"CPP","for(int i=0;i<n;i++){}",false)).contains("for"));
        DuelService.checkTwist("NO_FOR",null,"CPP","int format=0; // before",false);
        assertTrue(reason(()->DuelService.checkTwist("NO_PLUS",null,"CPP","#include <bits/stdc++.h>",false)).contains("+"));
        DuelService.checkTwist("NO_PLUS",null,"CPP","int x=a-(-b);",false);
        assertTrue(reason(()->DuelService.checkTwist("LANGUAGE","PYTHON","CPP","x",false)).contains("PYTHON"));
        DuelService.checkTwist("CLASSIC",null,"CPP","for(;;)a+b;",true);

        Actor a=user(false),b=user(false);
        UUID room=duels.create(a,Map.of("bestOf",1,"modifiers",List.of("BLIND")));
        duels.join(b,room,null);openRound(room);
        assertEquals(List.of(),duels.problem(a,room,1).get("samples"),"blind rounds hide the examples");
        assertTrue(reason(()->duels.submit(a,room,UUID.randomUUID(),Map.of("language","CPP","sourceCode","x","mode","samples"))).contains("Blind"));
        // Fastest: the quicker accepted run ranks first even when submitted later.
        var race=List.<Map<String,Object>>of(
                Map.of("submitted_by",a.id(),"submitted_at",java.sql.Timestamp.from(java.time.Instant.now()),"status","COMPLETED","verdict","ACCEPTED","passed_tests",2,"length",50,"execution_time_ms",90),
                Map.of("submitted_by",b.id(),"submitted_at",java.sql.Timestamp.from(java.time.Instant.now().plusSeconds(5)),"status","COMPLETED","verdict","ACCEPTED","passed_tests",2,"length",50,"execution_time_ms",20));
        var players=List.<Map<String,Object>>of(new HashMap<>(Map.of("user_id",a.id())),new HashMap<>(Map.of("user_id",b.id())));
        assertEquals(b.id(),DuelService.ranking("DUEL","FASTEST",race,players,false).get(0).user());
        assertEquals(a.id(),DuelService.ranking("DUEL","CLASSIC",race,players,false).get(0).user());
        duels.leave(b,room);
    }

    @Test void organizersManageThePool() {
        Actor player=user(false);
        assertThrows(ResponseStatusException.class,()->duels.manage(player));
        assertThrows(ResponseStatusException.class,()->lab.publishDuel(player,practiceOnly));
        var pool=(List<Map<String,Object>>)duels.manage(owner).get("pool");
        assertEquals(3,pool.size());
        assertTrue(((List<Map<String,Object>>)duels.manage(owner).get("candidates")).stream().anyMatch(c->practiceOnly.equals(c.get("version_id"))));
        // Hiding one of the three leaves too few for a best of 3; showing it again restores it.
        UUID problem=(UUID)pool.get(0).get("problem_id");
        duels.update(owner,problem,Map.of("hidden",true));
        assertTrue(reason(()->duels.create(player,Map.of("bestOf",3))).contains("Not enough duel problems"));
        duels.update(owner,problem,Map.of("hidden",false));
        UUID duel=duels.create(player,Map.of("bestOf",3));
        duels.leave(player,duel);
    }
}
