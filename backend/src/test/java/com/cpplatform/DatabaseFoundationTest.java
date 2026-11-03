package com.cpplatform;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.boot.SpringApplication;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.*;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL tests; no H2 compatibility mode and no Docker daemon required. */
class DatabaseFoundationTest {
    private static EmbeddedPostgres postgres;
    private static Flyway flyway;
    private Connection connection;

    @BeforeAll
    static void migrate() throws Exception {
        postgres = EmbeddedPostgres.builder().setPort(0)
                .setServerConfig("listen_addresses", "127.0.0.1").start();
        flyway = Flyway.configure().dataSource(postgres.getPostgresDatabase())
                .locations("classpath:db/migration").cleanDisabled(true).load();
        assertEquals(25, flyway.migrate().migrationsExecuted);
    }

    @AfterAll
    static void closeDatabase() throws Exception {
        if (postgres != null) postgres.close();
    }

    @BeforeEach
    void openTransaction() throws Exception {
        connection = postgres.getPostgresDatabase().getConnection();
        connection.setAutoCommit(false);
    }

    @AfterEach
    void rollback() throws Exception {
        connection.rollback();
        connection.close();
    }

    @Test
    void migrationsAreRepeatableAndChecksumsValidate() {
        flyway.validate();
        assertEquals(0, flyway.migrate().migrationsExecuted);
    }

    @Test
    void identitiesAreUniqueIgnoringHandleCase() throws Exception {
        user("alice", "alice@example.test");
        rejected("23505", "INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,?)",
                "second@example.test", "ALICE", "Alice", "test-hash");
        rejected("23505", "INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,?)",
                "alice@example.test", "other", "Alice", "test-hash");
        rejected("23514", "INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,?)",
                "UPPER@example.test", "upper", "Alice", "test-hash");
    }

    @Test
    void moderatorsDoNotReceiveApprovalOrPlatformPermissions() throws Exception {
        assertEquals(0, count("SELECT count(*) FROM role_permissions WHERE role_code='MODERATOR' AND " +
                "permission_code IN ('platform:manage','problem:approve_assigned','competition:publish_assigned')"));
        assertEquals(0, count("SELECT count(*) FROM users"));
        assertEquals(0, count("SELECT count(*) FROM languages WHERE enabled"));
    }

    @Test
    void problemLifecycleRejectsSkippingReview() throws Exception {
        UUID owner = user("setter", "setter@example.test");
        UUID version = problem(owner);
        rejected("P0001", "UPDATE problem_versions SET status='PUBLISHED',sealed_at=now() WHERE id=?", version);
        execute("UPDATE problem_versions SET status='IN_TESTING' WHERE id=?", version);
        execute("UPDATE problem_versions SET status='READY_FOR_REVIEW' WHERE id=?", version);
        execute("UPDATE problem_versions SET status='DRAFT' WHERE id=?", version);
    }

    @Test
    void sealedProblemContentAndAssetsCannotChange() throws Exception {
        UUID owner = user("setter", "setter@example.test");
        UUID version = problem(owner);
        UUID group = id("INSERT INTO test_case_groups(problem_version_id,name,position) VALUES (?,'hidden',0) RETURNING id", version);
        UUID test = id("INSERT INTO test_cases(problem_version_id,group_id,position,input_data,expected_output) " +
                "VALUES (?,?,0,'1 2','3') RETURNING id", version, group);
        execute("UPDATE problem_versions SET sealed_at=now() WHERE id=?", version);
        rejected("P0001", "UPDATE problem_versions SET title='Changed' WHERE id=?", version);
        rejected("P0001", "UPDATE test_cases SET expected_output='4' WHERE id=?", test);
        rejected("P0001", "DELETE FROM test_cases WHERE id=?", test);
        rejected("P0001", "INSERT INTO test_case_groups(problem_version_id,name,position) VALUES (?,'extra',1)", version);
        rejected("P0001", "DELETE FROM problem_versions WHERE id=?", version);
    }

    @Test
    void testGroupsCannotCrossProblemVersions() throws Exception {
        UUID owner = user("setter", "setter@example.test");
        UUID first = problem(owner);
        UUID second = problem(owner);
        UUID group = id("INSERT INTO test_case_groups(problem_version_id,name,position) VALUES (?,'hidden',0) RETURNING id", first);
        rejected("23503", "INSERT INTO test_cases(problem_version_id,group_id,position,input_data,expected_output) " +
                "VALUES (?,?,0,'1','1')", second, group);
    }

    @Test
    void competitionLifecycleRejectsDirectLaunch() throws Exception {
        Fixture f = fixture();
        rejected("P0001", "UPDATE competitions SET status='RUNNING' WHERE id=?", f.competition);
    }

    @Test
    void sealedContestSnapshotAndProblemOrderCannotChange() throws Exception {
        Fixture f = fixture();
        rejected("P0001", "UPDATE competition_versions SET wrong_attempt_penalty_seconds=0 WHERE id=?", f.competitionVersion);
        rejected("P0001", "DELETE FROM competition_problems WHERE competition_version_id=?", f.competitionVersion);
        rejected("P0001", "UPDATE competition_version_languages SET language_code='JAVA' WHERE competition_version_id=?", f.competitionVersion);
    }

    @Test
    void onlyOneOfficialRunButMultipleRehearsalsAreAllowed() throws Exception {
        Fixture f = fixture();
        run(f, "OFFICIAL");
        rejected("23505", runSql(), f.competition, f.competitionVersion, "OFFICIAL", f.owner);
        run(f, "REHEARSAL");
        run(f, "REHEARSAL");
        assertEquals(2, count("SELECT count(*) FROM contest_runs WHERE kind='REHEARSAL'"));
    }

    @Test
    void runClockAndIdentityAreImmutable() throws Exception {
        Fixture f = fixture();
        UUID run = run(f, "REHEARSAL");
        rejected("P0001", "UPDATE contest_runs SET kind='OFFICIAL' WHERE id=?", run);
        rejected("P0001", "UPDATE contest_runs SET ends_at=ends_at+interval '1 hour' WHERE id=?", run);
        rejected("P0001", "INSERT INTO contest_runs(competition_id,competition_version_id,kind,created_by,starts_at,ends_at) " +
                "VALUES (?,?,'REHEARSAL',?,now(),now()+interval '1 minute')", f.competition, f.competitionVersion, f.owner);
    }

    @Test
    void rehearsalMembershipCannotSubmitToOfficialRun() throws Exception {
        Fixture f = fixture();
        UUID official = run(f, "OFFICIAL");
        UUID rehearsal = run(f, "REHEARSAL");
        UUID rehearsalEntry = entry(f, rehearsal);
        rejected("23503", submissionSql(), official, f.competitionVersion, rehearsalEntry, f.owner,
                f.problemVersion, UUID.randomUUID());
    }

    @Test
    void submissionMustUseTheProblemVersionAssignedToItsContest() throws Exception {
        Fixture f = fixture();
        UUID run = run(f, "OFFICIAL");
        UUID entry = entry(f, run);
        UUID unrelated = problem(f.owner);
        rejected("23503", submissionSql(), run, f.competitionVersion, entry, f.owner, unrelated, UUID.randomUUID());
    }

    @Test
    void duplicateSubmissionAndJobDeliveryCannotCreateDuplicateRows() throws Exception {
        Fixture f = fixture();
        UUID run = run(f, "OFFICIAL");
        UUID entry = entry(f, run);
        UUID key = UUID.randomUUID();
        UUID submission = id(submissionSql(), run, f.competitionVersion, entry, f.owner, f.problemVersion, key);
        rejected("23505", submissionSql(), run, f.competitionVersion, entry, f.owner, f.problemVersion, key);
        id("INSERT INTO judging_jobs(submission_id,problem_version_id) VALUES (?,?) RETURNING id", submission, f.problemVersion);
        rejected("23505", "INSERT INTO judging_jobs(submission_id,problem_version_id) VALUES (?,?)", submission, f.problemVersion);
    }

    @Test
    void officialResultsExcludeRehearsalsAndUseLatestCompletedRejudge() throws Exception {
        Fixture f = fixture();
        UUID official = run(f, "OFFICIAL");
        UUID rehearsal = run(f, "REHEARSAL");
        UUID officialSubmission = submission(f, official, entry(f, official));
        UUID rehearsalSubmission = submission(f, rehearsal, entry(f, rehearsal));
        result(f, officialSubmission, 1, "WRONG_ANSWER");
        result(f, officialSubmission, 2, "ACCEPTED");
        result(f, rehearsalSubmission, 1, "ACCEPTED");
        assertEquals(1, count("SELECT count(*) FROM official_submission_results"));
        assertEquals(1, count("SELECT count(*) FROM official_submission_results WHERE verdict='ACCEPTED' AND generation=2"));
    }

    @Test
    void judgeResultsCannotAcceptEmptySuitesOrInvalidLeases() throws Exception {
        Fixture f = fixture();
        UUID run = run(f, "OFFICIAL");
        UUID submission = submission(f, run, entry(f, run));
        UUID job = id("INSERT INTO judging_jobs(submission_id,problem_version_id) VALUES (?,?) RETURNING id", submission, f.problemVersion);
        rejected("23514", "INSERT INTO judging_results(job_id,problem_version_id,verdict,passed_tests,total_tests) " +
                "VALUES (?,?,'ACCEPTED',0,0)", job, f.problemVersion);
        rejected("23514", "UPDATE judging_jobs SET status='RUNNING' WHERE id=?", job);
    }

    @Test
    void auditLogIsAppendOnly() throws Exception {
        execute("INSERT INTO audit_logs(action,resource_type) VALUES ('TEST','test')");
        rejected("P0001", "UPDATE audit_logs SET action='FORGED'");
        rejected("P0001", "DELETE FROM audit_logs");
    }

    @Test
    void backendHealthChecksDatabaseAndOtherRoutesAreClosed() throws Exception {
        SpringApplication application = new SpringApplication(CpPlatformApplication.class);
        try (var context = application.run("--server.port=0",
                "--spring.datasource.url=" + postgres.getJdbcUrl("postgres", "postgres"),
                "--spring.datasource.username=postgres", "--spring.datasource.password=",
                "--spring.main.banner-mode=off", "--cp.dispatch.enabled=false", "--cp.scheduling.enabled=false", "--management.health.rabbit.enabled=false", "--management.endpoint.health.group.readiness.include=readinessState,db")) {
            int port = ((org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext) context)
                    .getWebServer().getPort();
            HttpClient client = HttpClient.newHttpClient();
            var health = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/health/readiness"))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, health.statusCode());
            assertTrue(health.body().contains("UP"));
            var denied = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/lab/problems"))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(401, denied.statusCode());
        }
    }

    private UUID user(String handle, String email) throws SQLException {
        return id("INSERT INTO users(handle,email,display_name,password_hash) VALUES (?,?,'Test user','test-hash') RETURNING id", handle, email);
    }

    private UUID problem(UUID owner) throws SQLException {
        UUID problem = id("INSERT INTO problems(slug,owner_id) VALUES (?,?) RETURNING id", "problem-" + UUID.randomUUID(), owner);
        UUID version = id("INSERT INTO problem_versions(problem_id,version_number,title,created_by) VALUES (?,1,'Sum',?) RETURNING id", problem, owner);
        execute("INSERT INTO problem_version_languages VALUES (?,'CPP')", version);
        return version;
    }

    private Fixture fixture() throws SQLException {
        UUID owner = user("organizer", "organizer@example.test");
        UUID problemVersion = problem(owner);
        UUID competition = id("INSERT INTO competitions(slug,title,owner_id) VALUES ('contest','Contest',?) RETURNING id", owner);
        UUID competitionVersion = id("INSERT INTO competition_versions(competition_id,version_number,duration_seconds,created_by) " +
                "VALUES (?,1,3600,?) RETURNING id", competition, owner);
        execute("INSERT INTO competition_problems(competition_version_id,slot,label,problem_id,problem_version_id) " +
                "SELECT ?,1,'A',problem_id,id FROM problem_versions WHERE id=?", competitionVersion, problemVersion);
        execute("INSERT INTO competition_version_languages VALUES (?,'CPP')", competitionVersion);
        execute("UPDATE problem_versions SET sealed_at=now() WHERE id=?", problemVersion);
        execute("UPDATE competition_versions SET sealed_at=now() WHERE id=?", competitionVersion);
        return new Fixture(owner, problemVersion, competition, competitionVersion);
    }

    private String runSql() {
        return "INSERT INTO contest_runs(competition_id,competition_version_id,kind,created_by,starts_at,ends_at) " +
                "VALUES (?,?,?,?,now(),now()+interval '1 hour') RETURNING id";
    }

    private UUID run(Fixture f, String kind) throws SQLException {
        return id(runSql(), f.competition, f.competitionVersion, kind, f.owner);
    }

    private UUID entry(Fixture f, UUID run) throws SQLException {
        UUID entry = id("INSERT INTO run_entries(run_id,display_name,user_id) VALUES (?,'Tester',?) RETURNING id", run, f.owner);
        execute("INSERT INTO run_entry_members VALUES (?,?,?)", entry, run, f.owner);
        return entry;
    }

    private String submissionSql() {
        return "INSERT INTO submissions(run_id,competition_version_id,entry_id,submitted_by,problem_slot,problem_version_id," +
                "language_code,source_code,idempotency_key) VALUES (?,?,?,?,1,?,'CPP','int main() {}',?) RETURNING id";
    }

    private UUID submission(Fixture f, UUID run, UUID entry) throws SQLException {
        return id(submissionSql(), run, f.competitionVersion, entry, f.owner, f.problemVersion, UUID.randomUUID());
    }

    private UUID result(Fixture f, UUID submission, int generation, String verdict) throws SQLException {
        UUID job = id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation,status,completed_at) " +
                "VALUES (?,?,?,'COMPLETED',now()) RETURNING id", submission, f.problemVersion, generation);
        execute("INSERT INTO judging_results(job_id,problem_version_id,verdict,passed_tests,total_tests) VALUES (?,?,?,1,1)",
                job, f.problemVersion, verdict);
        return job;
    }

    private PreparedStatement statement(String sql, Object... values) throws SQLException {
        PreparedStatement statement = connection.prepareStatement(sql);
        for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
        return statement;
    }

    private UUID id(String sql, Object... values) throws SQLException {
        try (PreparedStatement statement = statement(sql, values); ResultSet rows = statement.executeQuery()) {
            assertTrue(rows.next());
            return rows.getObject(1, UUID.class);
        }
    }

    private void execute(String sql, Object... values) throws SQLException {
        try (PreparedStatement statement = statement(sql, values)) { statement.execute(); }
    }

    private long count(String sql) throws SQLException {
        try (PreparedStatement statement = statement(sql); ResultSet rows = statement.executeQuery()) {
            assertTrue(rows.next());
            return rows.getLong(1);
        }
    }

    private void rejected(String state, String sql, Object... values) throws SQLException {
        Savepoint savepoint = connection.setSavepoint();
        SQLException error = assertThrows(SQLException.class, () -> execute(sql, values));
        assertEquals(state, error.getSQLState(), error.getMessage());
        connection.rollback(savepoint);
    }

    private record Fixture(UUID owner, UUID problemVersion, UUID competition, UUID competitionVersion) {}
}
