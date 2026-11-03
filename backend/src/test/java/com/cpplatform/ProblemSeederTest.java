package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.*;
import com.cpplatform.judging.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The bundled duel problems install themselves once judges are online, exactly once per short name. */
class ProblemSeederTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;
    static final String IMAGE="sha256:"+"a".repeat(64);
    @BeforeAll static void start() throws Exception {
        postgres=EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses","127.0.0.1").start();
        context=new SpringApplication(CpPlatformApplication.class).run("--server.port=0",
                "--spring.datasource.url="+postgres.getJdbcUrl("postgres","postgres"),
                "--spring.datasource.username=postgres","--spring.datasource.password=",
                "--cp.dispatch.enabled=false","--cp.scheduling.enabled=false","--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token="+"w".repeat(40),"--spring.main.banner-mode=off");
        db=context.getBean(Database.class);auth=context.getBean(AuthService.class);lab=context.getBean(LaboratoryService.class);
        judge=context.getBean(JudgeService.class);
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    static ProblemSeeder seeder(){return new ProblemSeeder(db,lab,context.getBean(ObjectMapper.class),true);}
    static int count(String sql,Object... args){return db.jdbc.queryForObject(sql,Integer.class,args);}

    @Test void bundledDuelProblemsInstallOnceWhenJudgesAreOnline() {
        var seeder=seeder();
        // Nothing happens before there is an administrator to act as.
        seeder.tick();
        assertEquals(0,count("SELECT count(*) FROM seeded_problems"));
        String key="u"+UUID.randomUUID().toString().replace("-","");
        UUID admin=(UUID)auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!")).get("userId");
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",admin);
        Actor actor=new Actor(admin,Set.of("SUPER_ADMIN"));
        // Problems need enabled languages, which judges turn on when they register: until then it waits.
        seeder.tick();
        assertEquals(0,count("SELECT count(*) FROM seeded_problems"));
        assertEquals(0,count("SELECT count(*) FROM problems"));

        // Judges for every language come online.
        var runtimes=new HashMap<String,Object>(Map.of("maxMemoryMb",1024,"lane","internal"));
        for(String language:List.of("C","CPP","JAVA","PYTHON"))runtimes.put(language,Map.of("verified",true,"imageId",IMAGE));
        UUID worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",16,"runtimes",runtimes)).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code IN ('C','CPP','JAVA','PYTHON')",IMAGE);
        // A short name that already exists is left alone.
        lab.create(actor,Map.of("slug","blitz-digit-sum","title","Mine","statement","Already here","languages",List.of("CPP")));

        // Import the drafts, then validate, approve and add them to the duel pool.
        seeder.tick();
        assertEquals(11,count("SELECT count(*) FROM seeded_problems WHERE status='IMPORTED'"));
        assertEquals("SKIPPED",db.one("SELECT status FROM seeded_problems WHERE slug='blitz-digit-sum'").get("status"));
        assertEquals("Mine",db.one("SELECT v.title FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE p.slug='blitz-digit-sum'").get("title"));
        seeder.tick();
        var jobs=db.jdbc.queryForList("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.context='LABORATORY' AND j.status='QUEUED'",UUID.class);
        assertEquals(11,jobs.size());
        for(UUID job:jobs) {
            var claimed=judge.claim(job,worker,0).orElseThrow();
            var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
            judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        }
        judge.finishValidations();
        seeder.tick();seeder.tick();
        assertEquals(11,count("SELECT count(*) FROM seeded_problems WHERE status='DONE'"));
        assertEquals(11,count("SELECT count(*) FROM duel_problems dp JOIN problems p ON p.id=dp.problem_id WHERE p.slug LIKE 'blitz-%' AND NOT dp.hidden"));
        assertEquals(0,count("SELECT count(*) FROM practice_publications"),"duel problems never go to practice");
        assertEquals(12,count("SELECT count(*) FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE p.slug LIKE 'blitz-%'"));

        // A restart (a new seeder) imports nothing twice, even after a problem is deleted.
        UUID deleted=db.id("SELECT problem_version_id FROM seeded_problems WHERE slug='blitz-binary'");
        lab.delete(actor,deleted,"Not wanted");
        var restarted=seeder();
        restarted.tick();restarted.tick();
        assertEquals(12,count("SELECT count(*) FROM problems WHERE slug LIKE 'blitz-%'"));
        assertEquals(10,count("SELECT count(*) FROM duel_problems WHERE NOT hidden"));
    }
}
