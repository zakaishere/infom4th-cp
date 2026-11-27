package com.cpplatform;

import com.cpplatform.common.*;
import com.cpplatform.competition.*;
import com.cpplatform.identity.*;
import com.cpplatform.judging.*;
import com.cpplatform.laboratory.*;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Verifies persisted collections, bulk approval, bulk tags, and unified Problem Bank assignment across surfaces. */
class ProblemBankAssignTest {
    static EmbeddedPostgres postgres;
    static ConfigurableApplicationContext context;
    static Database db;
    static AuthService auth;
    static LaboratoryService lab;
    static JudgeService judge;
    static PracticeService practice;
    static DuelService duels;
    static MissionService missions;
    static CompetitionService contests;
    static CompetitionQueries contestViews;
    static UUID worker;
    static Actor admin;
    static final String IMAGE = "sha256:" + "d".repeat(64);

    @BeforeAll
    static void start() throws Exception {
        postgres = EmbeddedPostgres.builder().setPort(0).setServerConfig("listen_addresses", "127.0.0.1").start();
        context = new SpringApplication(CpPlatformApplication.class).run(
                "--server.port=0",
                "--spring.datasource.url=" + postgres.getJdbcUrl("postgres", "postgres"),
                "--spring.datasource.username=postgres",
                "--spring.datasource.password=",
                "--cp.dispatch.enabled=false",
                "--cp.scheduling.enabled=false",
                "--management.health.rabbit.enabled=false",
                "--management.endpoint.health.group.readiness.include=readinessState,db",
                "--cp.judge.worker-token=" + "w".repeat(40),
                "--spring.main.banner-mode=off"
        );
        db = context.getBean(Database.class);
        auth = context.getBean(AuthService.class);
        lab = context.getBean(LaboratoryService.class);
        judge = context.getBean(JudgeService.class);
        practice = context.getBean(PracticeService.class);
        duels = context.getBean(DuelService.class);
        missions = context.getBean(MissionService.class);
        contests = context.getBean(CompetitionService.class);
        contestViews = context.getBean(CompetitionQueries.class);

        worker = (UUID) judge.register(Map.of(
                "name", "test-" + UUID.randomUUID(),
                "capacity", 8,
                "runtimes", Map.of("CPP", Map.of("verified", true, "imageId", IMAGE), "maxMemoryMb", 1024, "lane", "internal")
        )).get("workerId");
        db.jdbc.update("UPDATE languages SET enabled=true, runtime_image_id=? WHERE code='CPP'", IMAGE);

        String key = "u" + UUID.randomUUID().toString().replace("-", "");
        UUID id = (UUID) auth.register(Map.of(
                "email", key + "@example.test",
                "handle", key.substring(0, 25),
                "displayName", key,
                "password", "TestPassword1!"
        )).get("userId");
        db.jdbc.update("INSERT INTO user_roles(user_id, role_code) VALUES (?, 'SUPER_ADMIN')", id);
        admin = new Actor(id, Set.of("SUPER_ADMIN", "PARTICIPANT"));
    }

    @AfterAll
    static void stop() throws Exception {
        if (context != null) context.close();
        if (postgres != null) postgres.close();
    }

    static UUID validatedReviewReadyProblem(String title) {
        UUID version = lab.create(admin, Map.of(
                "slug", "bank-" + UUID.randomUUID(),
                "title", title,
                "statement", "Compute sum",
                "languages", List.of("CPP")
        ));
        lab.tests(admin, version, List.of(
                Map.of("input", "1 2", "expected", "3", "sample", true),
                Map.of("input", "4 5", "expected", "9", "sample", false)
        ));
        lab.reference(admin, version, Map.of(
                "label", "Main",
                "language", "CPP",
                "sourceCode", "int main() {}",
                "expectedVerdict", "ACCEPTED"
        ));
        UUID validation = lab.validate(admin, version);
        UUID submission = db.id("SELECT s.id FROM submissions s WHERE s.validation_id=?", validation);
        UUID job = db.id("SELECT id FROM judging_jobs WHERE submission_id=? ORDER BY generation DESC LIMIT 1", submission);
        var claimed = judge.claim(job, worker, 0).orElseThrow();
        var cases = ((List<?>) claimed.get("tests")).stream()
                .map(t -> Map.of("id", ((Map<?, ?>) t).get("id"), "verdict", "ACCEPTED", "executionTimeMs", 5, "peakMemoryKb", 512))
                .toList();
        judge.complete(job, worker, Api.uuid(claimed.get("leaseToken")), Map.of(
                "verdict", "ACCEPTED",
                "cases", cases,
                "executionTimeMs", 5,
                "peakMemoryKb", 512
        ));
        judge.finishValidations();
        return version;
    }

    @Test
    void collectionsPersistAndUnifiedAssignmentsRouteProblemsAcrossSurfaces() {
        // Empty collection survives without problems, can be renamed and deleted.
        assertEquals("C Course/Week 1", lab.createCollection(admin, "C Course/Week 1"));
        assertTrue(lab.collections(admin).stream().anyMatch(c -> "C Course/Week 1".equals(c.get("name"))));

        UUID v1 = validatedReviewReadyProblem("Arrays A");
        UUID v2 = validatedReviewReadyProblem("Loops B");

        // Assign draft/review problem into a collection and bulk-tag it.
        lab.assign(admin, Map.of("versionIds", List.of(v1.toString(), v2.toString()), "surface", "COLLECTION", "collection", "C Course/Week 1"));
        lab.renameCollection(admin, "C Course/Week 1", "C Course/Session 1");
        lab.bulkTags(admin, List.of(v1, v2), List.of("arrays", "math"), true);

        // Assigning a READY_FOR_REVIEW problem auto-approves and publishes to Practice.
        lab.assign(admin, Map.of("versionIds", List.of(v1.toString()), "surface", "PRACTICE"));
        assertEquals(1, practice.catalog(admin).size());

        // Assigning v1 to TD 2 moves it out of general Practice into TD 2.
        lab.assign(admin, Map.of("versionIds", List.of(v1.toString()), "surface", "TD", "tdNumber", 2));
        assertTrue(practice.catalog(admin).isEmpty());
        assertEquals(1, practice.tdCatalog(admin).size());

        // Assigning v2 to a new Mission creates the mission and keeps v2 off Practice & TD.
        var mRes = lab.assign(admin, Map.of(
                "versionIds", List.of(v2.toString()),
                "surface", "MISSION",
                "missionTitle", "Spring TP 1",
                "weight", 25
        ));
        assertEquals("spring-tp-1", mRes.get("missionSlug"));
        assertEquals(1, ((Number) missions.detail(admin, "spring-tp-1").get("totalPoints")).intValue() / 25);
        assertEquals(1, practice.manage(admin).get("published") instanceof List<?> l ? l.size() : -1,
                "Mission exercises do not clutter the Practice & TDs manager");

        // Assigning v1 to Duel Pool and an existing draft Contest populates both and reflects in lab.list().
        lab.assign(admin, Map.of("versionIds", List.of(v1.toString()), "surface", "DUEL"));
        UUID contestId = contests.create(admin, Map.of(
                "slug", "cup-" + UUID.randomUUID().toString().substring(0, 8),
                "title", "Test Cup",
                "languages", List.of("CPP"),
                "durationSeconds", 3600
        ));
        lab.assign(admin, Map.of("versionIds", List.of(v1.toString(), v2.toString()), "surface", "CONTEST", "competitionId", contestId.toString()));
        var contestProblems = (List<?>) contestViews.managed(admin, contestId).get("problems");
        assertEquals(2, contestProblems.size());

        var rows = lab.list(admin, false);
        var row1 = rows.stream().filter(r -> v1.equals(r.get("version_id"))).findFirst().orElseThrow();
        assertEquals("C Course/Session 1", row1.get("folder"));
        assertEquals(2, ((Number) row1.get("td_number")).intValue());
        assertEquals(Boolean.TRUE, row1.get("in_duel_pool"));
        assertEquals(1, ((Number) row1.get("contest_count")).intValue());

        // Removing from Mission hides v2 cleanly back into Private Bank (apart from Contest).
        lab.assign(admin, Map.of("versionIds", List.of(v2.toString()), "surface", "MISSION", "action", "remove"));
        assertTrue(practice.catalog(admin).isEmpty());

        // Deleting collection clears folder without deleting problems.
        assertEquals(2, lab.deleteCollection(admin, "C Course/Session 1"));
    }
}
