-- Analytics: one row per minute of server and judging load (kept 14 days), and one
-- immutable summary per UTC day, written shortly after midnight.
CREATE TABLE metric_samples (
    id bigserial PRIMARY KEY,
    sampled_at timestamptz NOT NULL DEFAULT now(),
    host varchar(100) NOT NULL,
    process_cpu real,
    system_cpu real,
    load_average real,
    memory_used_mb integer,
    memory_total_mb integer,
    heap_used_mb integer,
    heap_max_mb integer,
    threads integer,
    disk_free_mb bigint,
    db_connections integer,
    queued_jobs integer NOT NULL,
    running_jobs integer NOT NULL,
    workers_online integer NOT NULL,
    judge_slots integer NOT NULL,
    submissions integer NOT NULL
);
CREATE INDEX metric_samples_time ON metric_samples(sampled_at);

CREATE TABLE daily_reports (
    day date PRIMARY KEY,
    summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submissions_time ON submissions(submitted_at);
CREATE INDEX judging_jobs_created ON judging_jobs(created_at);
