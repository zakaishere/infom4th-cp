-- Administrator-controlled judging capacity. Physical ceilings stay in trusted
-- worker deployment configuration; these rows only hold desired limits.

-- Singleton row. A NULL lane limit means "no global limit": the lane can use the
-- sum of its workers' effective capacity, which is the pre-V8 behaviour.
CREATE TABLE judging_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    official_concurrency_limit integer CHECK (official_concurrency_limit BETWEEN 0 AND 1024),
    internal_concurrency_limit integer CHECK (internal_concurrency_limit BETWEEN 0 AND 1024),
    pending_submissions_per_user integer NOT NULL DEFAULT 5 CHECK (pending_submissions_per_user BETWEEN 1 AND 100),
    submissions_per_minute integer NOT NULL DEFAULT 12 CHECK (submissions_per_minute BETWEEN 1 AND 600),
    max_queued_submissions integer NOT NULL DEFAULT 5000 CHECK (max_queued_submissions BETWEEN 1 AND 100000),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES users(id)
);
INSERT INTO judging_settings(id) VALUES (1);

-- capacity remains the worker-advertised hard maximum (JUDGE_MAX_SLOTS).
-- desired_concurrency is administrator state and is never written by registration.
ALTER TABLE judge_workers ADD COLUMN lane varchar(16);
UPDATE judge_workers SET lane = CASE WHEN runtime_manifest->>'lane' = 'official' THEN 'official' ELSE 'internal' END;
ALTER TABLE judge_workers ALTER COLUMN lane SET NOT NULL;
ALTER TABLE judge_workers ADD CHECK (lane IN ('official', 'internal'));
ALTER TABLE judge_workers ADD COLUMN host_id varchar(100);
UPDATE judge_workers SET host_id = name;
ALTER TABLE judge_workers ALTER COLUMN host_id SET NOT NULL;
ALTER TABLE judge_workers ADD COLUMN slot_memory_mb integer;
UPDATE judge_workers SET slot_memory_mb = greatest(1, coalesce((runtime_manifest->>'maxMemoryMb')::integer, 1024));
ALTER TABLE judge_workers ALTER COLUMN slot_memory_mb SET NOT NULL;
ALTER TABLE judge_workers ADD CHECK (slot_memory_mb BETWEEN 1 AND 1048576);
ALTER TABLE judge_workers ADD COLUMN lane_memory_budget_mb integer;
UPDATE judge_workers SET lane_memory_budget_mb = capacity * slot_memory_mb;
ALTER TABLE judge_workers ALTER COLUMN lane_memory_budget_mb SET NOT NULL;
ALTER TABLE judge_workers ADD CHECK (lane_memory_budget_mb BETWEEN 1 AND 16777216);
ALTER TABLE judge_workers ADD COLUMN host_memory_budget_mb integer;
UPDATE judge_workers SET host_memory_budget_mb = lane_memory_budget_mb;
ALTER TABLE judge_workers ALTER COLUMN host_memory_budget_mb SET NOT NULL;
ALTER TABLE judge_workers ADD CHECK (host_memory_budget_mb BETWEEN 1 AND 16777216);
ALTER TABLE judge_workers ADD COLUMN default_concurrency integer;
UPDATE judge_workers SET default_concurrency = capacity;
ALTER TABLE judge_workers ALTER COLUMN default_concurrency SET NOT NULL;
ALTER TABLE judge_workers ADD CHECK (default_concurrency BETWEEN 1 AND 1024);
ALTER TABLE judge_workers ADD COLUMN desired_concurrency integer CHECK (desired_concurrency BETWEEN 1 AND 1024);
-- Drain is an administrator decision that survives restarts and re-registration.
ALTER TABLE judge_workers ADD COLUMN drain_requested boolean NOT NULL DEFAULT false;
UPDATE judge_workers SET drain_requested = true WHERE status = 'DRAINING';
ALTER TABLE judge_workers ADD COLUMN settings_version bigint NOT NULL DEFAULT 1 CHECK (settings_version > 0);
-- Last values reported by the worker scheduler; informational only.
ALTER TABLE judge_workers ADD COLUMN reported_active integer CHECK (reported_active >= 0);
ALTER TABLE judge_workers ADD COLUMN reported_target integer CHECK (reported_target >= 0);
ALTER TABLE judge_workers ADD COLUMN registered_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX judge_workers_host ON judge_workers(host_id);
CREATE INDEX judging_jobs_running_worker ON judging_jobs(worker_id) WHERE status = 'RUNNING';
CREATE INDEX judging_jobs_unfinished ON judging_jobs(status) WHERE status IN ('QUEUED', 'RUNNING', 'RETRY');
