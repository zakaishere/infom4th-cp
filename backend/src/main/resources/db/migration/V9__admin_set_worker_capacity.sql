-- Worker slot counts are fully administrator-set; the deployment value becomes a
-- default. Workers report detected hardware so the admin view can warn about risky values.
ALTER TABLE judge_workers ADD COLUMN detected_cpus integer CHECK (detected_cpus > 0);
ALTER TABLE judge_workers ADD COLUMN detected_memory_mb integer CHECK (detected_memory_mb > 0);
ALTER TABLE judge_workers DROP CONSTRAINT IF EXISTS judge_workers_desired_concurrency_check;
ALTER TABLE judge_workers ADD CONSTRAINT judge_workers_desired_concurrency_range CHECK (desired_concurrency BETWEEN 1 AND 256);
