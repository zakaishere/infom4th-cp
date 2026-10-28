CREATE TABLE submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL,
    competition_version_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    submitted_by uuid NOT NULL,
    problem_slot integer NOT NULL,
    problem_version_id uuid NOT NULL,
    language_code varchar(24) NOT NULL,
    source_code text NOT NULL CHECK (btrim(source_code) <> '' AND octet_length(source_code) <= 262144),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    idempotency_key uuid NOT NULL,
    FOREIGN KEY (run_id, competition_version_id) REFERENCES contest_runs(id, competition_version_id),
    FOREIGN KEY (entry_id, run_id, submitted_by) REFERENCES run_entry_members(entry_id, run_id, user_id),
    FOREIGN KEY (competition_version_id, problem_slot, problem_version_id)
        REFERENCES competition_problems(competition_version_id, slot, problem_version_id),
    FOREIGN KEY (competition_version_id, language_code)
        REFERENCES competition_version_languages(competition_version_id, language_code),
    FOREIGN KEY (problem_version_id, language_code)
        REFERENCES problem_version_languages(problem_version_id, language_code),
    UNIQUE (submitted_by, idempotency_key),
    UNIQUE (id, problem_version_id)
);
CREATE INDEX submissions_standings ON submissions(run_id, entry_id, problem_slot, submitted_at, id);
CREATE INDEX submissions_own_history ON submissions(submitted_by, submitted_at DESC);
CREATE INDEX submissions_version ON submissions(problem_version_id);

CREATE FUNCTION reject_submission_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Submission source and identity are immutable; create a new submission';
END;
$$;
CREATE TRIGGER submission_immutable BEFORE UPDATE OR DELETE ON submissions
    FOR EACH ROW EXECUTE FUNCTION reject_submission_mutation();

CREATE TABLE judge_workers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL UNIQUE,
    status varchar(16) NOT NULL CHECK (status IN ('ONLINE', 'DRAINING', 'OFFLINE')),
    capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1024),
    last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
    runtime_manifest jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(runtime_manifest) = 'object')
);
-- Durable jobs are committed in the same transaction as submissions. A future
-- worker claims with FOR UPDATE SKIP LOCKED; no DB/broker dual-write race.
CREATE TABLE judging_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    problem_version_id uuid NOT NULL,
    generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
    priority integer NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'RETRY', 'COMPLETED', 'FAILED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    worker_id uuid REFERENCES judge_workers(id),
    lease_token uuid,
    lease_expires_at timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    last_error_code varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    FOREIGN KEY (submission_id, problem_version_id) REFERENCES submissions(id, problem_version_id),
    UNIQUE (submission_id, generation),
    UNIQUE (id, problem_version_id),
    CHECK (attempt_count <= max_attempts),
    CHECK ((status = 'RUNNING' AND worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL)),
    CHECK ((status IN ('COMPLETED', 'FAILED') AND completed_at IS NOT NULL)
        OR (status NOT IN ('COMPLETED', 'FAILED') AND completed_at IS NULL))
);
CREATE INDEX judging_jobs_claim ON judging_jobs(priority DESC, available_at, created_at)
    WHERE status IN ('QUEUED', 'RETRY');
CREATE INDEX judging_jobs_expired ON judging_jobs(lease_expires_at) WHERE status = 'RUNNING';
CREATE TABLE judging_results (
    job_id uuid PRIMARY KEY,
    problem_version_id uuid NOT NULL,
    verdict varchar(32) NOT NULL CHECK (verdict IN
        ('ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED',
         'RUNTIME_ERROR', 'COMPILATION_ERROR', 'OUTPUT_LIMIT_EXCEEDED', 'JUDGE_ERROR')),
    execution_time_ms bigint CHECK (execution_time_ms >= 0),
    peak_memory_kb bigint CHECK (peak_memory_kb >= 0),
    passed_tests integer NOT NULL CHECK (passed_tests >= 0),
    total_tests integer NOT NULL CHECK (total_tests > 0 AND passed_tests <= total_tests),
    public_feedback text NOT NULL DEFAULT '',
    private_diagnostics text NOT NULL DEFAULT '',
    judged_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (job_id, problem_version_id) REFERENCES judging_jobs(id, problem_version_id),
    UNIQUE (job_id, problem_version_id),
    CHECK (verdict <> 'ACCEPTED' OR passed_tests = total_tests)
);
CREATE TABLE test_case_results (
    job_id uuid NOT NULL,
    problem_version_id uuid NOT NULL,
    test_case_id uuid NOT NULL,
    verdict varchar(32) NOT NULL CHECK (verdict IN
        ('ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED',
         'RUNTIME_ERROR', 'COMPILATION_ERROR', 'OUTPUT_LIMIT_EXCEEDED', 'JUDGE_ERROR')),
    execution_time_ms bigint CHECK (execution_time_ms >= 0),
    peak_memory_kb bigint CHECK (peak_memory_kb >= 0),
    actual_output text,
    private_diagnostics text NOT NULL DEFAULT '',
    FOREIGN KEY (job_id, problem_version_id) REFERENCES judging_results(job_id, problem_version_id),
    FOREIGN KEY (test_case_id, problem_version_id) REFERENCES test_cases(id, problem_version_id),
    PRIMARY KEY (job_id, test_case_id)
);

CREATE TABLE announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES contest_runs(id),
    author_id uuid NOT NULL REFERENCES users(id),
    title varchar(255) NOT NULL CHECK (btrim(title) <> ''),
    body_md text NOT NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_run ON announcements(run_id, published_at);
CREATE TABLE clarifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    asked_by uuid NOT NULL,
    question text NOT NULL CHECK (btrim(question) <> ''),
    answer text,
    answered_by uuid REFERENCES users(id),
    answered_at timestamptz,
    is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (entry_id, run_id, asked_by) REFERENCES run_entry_members(entry_id, run_id, user_id),
    CHECK (num_nonnulls(answer, answered_by, answered_at) IN (0, 3)),
    CHECK (NOT is_public OR answer IS NOT NULL)
);
CREATE INDEX clarifications_run ON clarifications(run_id, created_at);
CREATE TABLE audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid REFERENCES users(id),
    action varchar(100) NOT NULL,
    resource_type varchar(64) NOT NULL,
    resource_id uuid,
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- The scoring service will consume only these rows for official standings.
-- This is an internal view, not a public API; user-safe DTOs are still required.
CREATE VIEW official_submission_results AS
SELECT s.id AS submission_id, s.run_id, s.entry_id, s.problem_slot, s.submitted_at,
       latest.generation, latest.verdict, latest.judged_at
FROM submissions s
JOIN contest_runs r ON r.id = s.run_id AND r.kind = 'OFFICIAL'
LEFT JOIN LATERAL (
    SELECT j.generation, result.verdict, result.judged_at
    FROM judging_jobs j
    JOIN judging_results result ON result.job_id = j.id
    WHERE j.submission_id = s.id AND j.status = 'COMPLETED'
    ORDER BY j.generation DESC LIMIT 1
) latest ON true;
