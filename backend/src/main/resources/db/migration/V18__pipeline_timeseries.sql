-- Fine-grained pipeline charts (arrivals, claims, verdicts, retries per bucket).
-- Both columns are queried per time window; without these indexes every bucket scans the table.
CREATE INDEX judging_jobs_started ON judging_jobs(first_started_at) WHERE first_started_at IS NOT NULL;
CREATE INDEX judging_results_judged ON judging_results(judged_at);
