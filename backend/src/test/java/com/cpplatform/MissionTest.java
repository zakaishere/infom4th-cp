package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.competition.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.*;
import com.cpplatform.judging.*;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Missions: points from the best submission of each problem, attempts that cost nothing, ranking, staff and closing. */
class MissionTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;static PracticeService practice;static SubmissionService submissions;static MissionService missions;
    static UUID worker;static Actor admin;
    static final String IMAGE="sha256:"+"c".repeat(64);
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);practice=context.getBean(PracticeService.class);
        submissions=context.getBean(SubmissionService.class);missions=context.getBean(MissionService.class);
        worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",8,
                "runtimes",Map.of("CPP",Map.of("verified",true,"imageId",IMAGE),"maxMemoryMb",1024,"lane","internal"))).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code='CPP'",IMAGE);
        db.jdbc.update("UPDATE judging_settings SET pending_submissions_per_user=50,submissions_per_minute=600 WHERE id=1");
        admin=user(true);
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    static Actor user(boolean staff) {
        String key="u"+UUID.randomUUID().toString().replace("-","");
        UUID id=(UUID)auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!")).get("userId");
        if(staff)db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",id);
        return new Actor(id,staff?Set.of("SUPER_ADMIN","PARTICIPANT"):Set.of("PARTICIPANT"));
    }
    static void verdict(UUID submission,String verdict,int passed) {
        UUID job=db.id("SELECT id FROM judging_jobs WHERE submission_id=? ORDER BY generation DESC LIMIT 1",submission);
        var claimed=judge.claim(job,worker,0).orElseThrow();
        List<?> tests=(List<?>)claimed.get("tests");
        var cases=new ArrayList<Map<String,Object>>();
        for(int i=0;i<tests.size();i++)cases.add(Map.of("id",((Map<?,?>)tests.get(i)).get("id"),"verdict",i<passed?"ACCEPTED":verdict,"executionTimeMs",10,"peakMemoryKb",1024));
        if(verdict.equals("COMPILATION_ERROR"))cases.clear();
        judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict",verdict,"cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
    }
    /** An approved problem with one example and one hidden test, placed in the mission. */
    static UUID missionProblem(String title,int position,double weight) {
        UUID version=lab.create(admin,Map.of("slug","mission-"+UUID.randomUUID(),"title",title,"statement","Add two integers","languages",List.of("CPP")));
        lab.tests(admin,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(admin,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(admin,version);
        verdict(db.id("SELECT s.id FROM submissions s WHERE s.validation_id=?",validation),"ACCEPTED",2);
        judge.finishValidations();lab.approve(admin,version,"Reference validation passed");
        lab.publishPractice(admin,version,Map.of("mission",Map.of("slug","python-test","title","Python test","description","A TP","position",position,"weight",weight),"tags",List.of("python")));
        return version;
    }
    static UUID attempt(Actor player,UUID version,String verdict,int passed) {
        UUID id=submissions.submit(player,null,null,version,UUID.randomUUID(),Map.of("language","CPP","sourceCode","int main() {}"));
        verdict(id,verdict,passed);return id;
    }
    @SuppressWarnings("unchecked")
    static Map<String,Object> row(Map<String,Object> detail,String handle) {
        return ((List<Map<String,Object>>)detail.get("leaderboard")).stream().filter(r->handle.equals(r.get("handle"))).findFirst().orElseThrow();
    }
    static String handle(Actor actor){return (String)db.one("SELECT handle FROM users WHERE id=?",actor.id()).get("handle");}

    @Test void pointsComeFromTheBestSubmissionAndAttemptsAreFree() {
        UUID first=missionProblem("First",1,60),second=missionProblem("Second",2,40);
        assertTrue(practice.catalog(admin).isEmpty(),"mission problems stay off the Practice list");
        assertFalse(practice.allTags().contains("python"));
        assertEquals(2,((Number)missions.list(admin).get(0).get("problems")).intValue());

        Actor a=user(false),b=user(false),staff=user(true);
        // A: first problem half right, then fully right, then a worse retry; second problem half right.
        attempt(a,first,"WRONG_ANSWER",1);
        attempt(a,first,"ACCEPTED",2);
        attempt(a,first,"COMPILATION_ERROR",0);
        attempt(a,second,"WRONG_ANSWER",1);
        // B solves both on the first try; staff submissions never count.
        attempt(b,first,"ACCEPTED",2);attempt(b,second,"ACCEPTED",2);
        attempt(staff,first,"ACCEPTED",2);

        var detail=missions.detail(a,"python-test");
        assertEquals(100.0,((Number)detail.get("totalPoints")).doubleValue());
        assertEquals(2,((Number)detail.get("participants")).intValue(),"staff are left off the board");
        var rowA=row(detail,handle(a));var rowB=row(detail,handle(b));
        assertEquals(80.0,((Number)rowA.get("points")).doubleValue(),"60 for the best of the first + 20 for half of the second; the worse retry costs nothing");
        assertEquals(4,((Number)rowA.get("attempts")).intValue());
        assertEquals(1,((Number)rowA.get("solved")).intValue());
        assertEquals(100.0,((Number)rowB.get("points")).doubleValue());
        assertEquals(1,((Number)rowB.get("rank")).intValue());
        assertEquals(2,((Number)rowA.get("rank")).intValue());

        var card=missions.card("python-test",handle(a));
        var problems=(List<Map<String,Object>>)((Map<String,Object>)card.get("card")).get("problems");
        assertEquals(60.0,((Number)problems.get(0).get("points")).doubleValue());
        assertEquals(3,((Number)problems.get(0).get("attempts")).intValue());
        assertEquals(1,((Number)problems.get(1).get("passed")).intValue());
        assertEquals(2,((Number)problems.get(1).get("total")).intValue());
        assertThrows(ResponseStatusException.class,()->missions.card("python-test",handle(staff)));

        // A participant cannot change a mission; an organizer can reweigh and close it, and later submissions stop counting.
        assertThrows(ResponseStatusException.class,()->missions.update(a,"python-test",Map.of("open",false)));
        missions.update(admin,"python-test",Map.of("weights",Map.of(String.valueOf(problems.get(1).get("problemId")),20)));
        assertEquals(70.0,((Number)row(missions.detail(a,"python-test"),handle(a)).get("points")).doubleValue(),"60 + half of the reweighed 20");
        missions.update(admin,"python-test",Map.of("open",false));
        assertFalse((Boolean)missions.detail(a,"python-test").get("open"));
        attempt(a,second,"ACCEPTED",2);
        assertEquals(70.0,((Number)row(missions.detail(a,"python-test"),handle(a)).get("points")).doubleValue(),"a closed mission ignores new submissions");
        missions.update(admin,"python-test",Map.of("open",true));
        attempt(a,second,"ACCEPTED",2);
        assertEquals(80.0,((Number)row(missions.detail(a,"python-test"),handle(a)).get("points")).doubleValue());
    }

    /** A validated problem waiting for review: the state a bulk import in "validate" mode leaves. */
    static UUID reviewable() {
        UUID version=lab.create(admin,Map.of("slug","review-"+UUID.randomUUID(),"title","Review me","statement","Add two integers","languages",List.of("CPP")));
        lab.tests(admin,version,List.of(Map.of("input","2 3","expected","5","sample",true),Map.of("input","4 5","expected","9","sample",false)));
        lab.reference(admin,version,Map.of("label","Correct","language","CPP","sourceCode","int main() {}","expectedVerdict","ACCEPTED"));
        UUID validation=lab.validate(admin,version);
        verdict(db.id("SELECT s.id FROM submissions s WHERE s.validation_id=?",validation),"ACCEPTED",2);
        judge.finishValidations();
        return version;
    }

    @Test void organizersCreateMissionsAndAddReviewedProblems() {
        assertThrows(ResponseStatusException.class,()->missions.create(user(false),Map.of("title","Nope")));
        String slug=missions.create(admin,Map.of("title","Mon TP é Python","description","Session 3"));
        assertEquals("mon-tp-e-python",slug);
        assertThrows(ResponseStatusException.class,()->missions.create(admin,Map.of("title","Mon TP é Python")));
        UUID one=reviewable(),two=reviewable();
        var candidates=missions.candidates(admin);
        assertTrue(candidates.stream().anyMatch(c->one.equals(c.get("version_id"))),"a problem ready for review can be added");
        assertThrows(ResponseStatusException.class,()->missions.candidates(user(false)));

        missions.addProblems(admin,slug,Map.of("items",List.of(Map.of("version",one.toString(),"weight",30),Map.of("version",two.toString(),"weight",70))));
        assertEquals("PUBLISHED",db.one("SELECT status FROM problem_versions WHERE id=?",one).get("status"),"approved on the way");
        assertTrue(missions.candidates(admin).stream().noneMatch(c->one.equals(c.get("version_id"))));
        assertTrue(practice.catalog(admin).stream().noneMatch(c->one.equals(c.get("id"))),"never visible in public Practice");
        var detail=missions.detail(admin,slug);
        assertEquals(100.0,((Number)detail.get("totalPoints")).doubleValue());
        var problems=(List<Map<String,Object>>)((Map<String,Object>)detail.get("me")).get("problems");
        assertEquals(2,problems.size());assertEquals(one,problems.get(0).get("version"),"added in the order given");

        UUID problem=(UUID)problems.get(1).get("problemId");
        assertThrows(ResponseStatusException.class,()->missions.removeProblem(user(false),slug,problem));
        missions.removeProblem(admin,slug,problem);
        assertEquals(30.0,((Number)missions.detail(admin,slug).get("totalPoints")).doubleValue());
        assertTrue(practice.catalog(admin).stream().noneMatch(c->two.equals(c.get("id"))),"a removed problem is hidden, not leaked to Practice");
    }
}
