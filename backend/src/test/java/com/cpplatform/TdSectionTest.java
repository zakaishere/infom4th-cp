package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.competition.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.*;
import com.cpplatform.judging.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The bundled TD bank installs into the academic section: practice problems grouped by TD, kept off the Practice list. */
class TdSectionTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;static AuthService auth;static LaboratoryService lab;static JudgeService judge;static PracticeService practice;
    static final String IMAGE="sha256:"+"b".repeat(64);
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
    }
    @AfterAll static void stop() throws Exception {if(context!=null)context.close();if(postgres!=null)postgres.close();}

    static int count(String sql,Object... args){return db.jdbc.queryForObject(sql,Integer.class,args);}

    @Test void bundledTdProblemsInstallIntoTheirTds() {
        var seeder=new ProblemSeeder(db,lab,context.getBean(ObjectMapper.class),List.of("td-problems"));
        String key="u"+UUID.randomUUID().toString().replace("-","");
        UUID admin=(UUID)auth.register(Map.of("email",key+"@example.test","handle",key.substring(0,25),"displayName",key,"password","TestPassword1!")).get("userId");
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN')",admin);
        Actor actor=new Actor(admin,Set.of("SUPER_ADMIN"));
        var runtimes=new HashMap<String,Object>(Map.of("maxMemoryMb",1024,"lane","internal"));
        for(String language:List.of("C","CPP","JAVA","PYTHON"))runtimes.put(language,Map.of("verified",true,"imageId",IMAGE));
        UUID worker=(UUID)judge.register(Map.of("name","test-"+UUID.randomUUID(),"capacity",16,"runtimes",runtimes)).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true,runtime_image_id=? WHERE code IN ('C','CPP','JAVA','PYTHON')",IMAGE);

        seeder.tick();
        int total=count("SELECT count(*) FROM seeded_problems WHERE bank='td-problems'");
        assertTrue(total>=20,"the TD bank has every TD exercise");
        seeder.tick();
        var jobs=db.jdbc.queryForList("SELECT j.id FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.context='LABORATORY' AND j.status='QUEUED'",UUID.class);
        assertEquals(total,jobs.size());
        for(UUID job:jobs) {
            var claimed=judge.claim(job,worker,0).orElseThrow();
            var cases=((List<?>)claimed.get("tests")).stream().map(t->Map.of("id",((Map<?,?>)t).get("id"),"verdict","ACCEPTED","executionTimeMs",10,"peakMemoryKb",1024)).toList();
            judge.complete(job,worker,Api.uuid(claimed.get("leaseToken")),Map.of("verdict","ACCEPTED","cases",cases,"executionTimeMs",10,"peakMemoryKb",1024));
        }
        judge.finishValidations();
        seeder.tick();seeder.tick();
        assertEquals(total,count("SELECT count(*) FROM seeded_problems WHERE bank='td-problems' AND status='DONE'"));
        assertEquals(0,count("SELECT count(*) FROM duel_problems"),"TD problems never go to duels");

        // The TD page lists them in course order; the Practice list does not show them.
        var td=practice.tdCatalog(actor);
        assertEquals(total,td.size());
        assertEquals("td1-incrementations",td.get(0).get("slug"));
        assertEquals(1,((Number)td.get(0).get("td_number")).intValue());
        for(int i=1;i<td.size();i++) {
            int a=((Number)td.get(i-1).get("td_number")).intValue(),b=((Number)td.get(i).get("td_number")).intValue();
            assertTrue(a<b || (a==b && ((Number)td.get(i-1).get("td_position")).intValue()<((Number)td.get(i).get("td_position")).intValue()),"ordered by TD then position");
        }
        assertTrue(((List<?>)td.get(0).get("tags")).contains("operateurs"));
        assertTrue(practice.catalog(actor).isEmpty());
        assertFalse(practice.allTags().contains("operateurs"));

        // An organizer moves one problem back to Practice, and rejects a bad TD number.
        UUID problem=(UUID)td.get(0).get("problem_id");
        assertThrows(ResponseStatusException.class,()->practice.update(actor,problem,Map.of("td",0)));
        var back=new HashMap<String,Object>();back.put("td",null);
        practice.update(actor,problem,back);
        assertEquals(1,practice.catalog(actor).size());
        assertEquals(total-1,practice.tdCatalog(actor).size());
        practice.update(actor,problem,Map.of("td",1,"tdPosition",1));
        assertEquals(total,practice.tdCatalog(actor).size());
    }
}
