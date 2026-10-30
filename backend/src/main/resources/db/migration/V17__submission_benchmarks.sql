-- Administrator load tests: real judging of many copies of a program on a private problem.
-- These submissions never count in practice statistics, Sigma, ratings or contests.
ALTER TABLE problems ADD COLUMN system_benchmark boolean NOT NULL DEFAULT false;

CREATE TABLE benchmark_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by uuid NOT NULL REFERENCES users(id),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    language_code varchar(24) NOT NULL REFERENCES languages(code),
    lane varchar(16) NOT NULL CHECK (lane IN ('official','internal')),
    submission_count integer NOT NULL CHECK (submission_count > 0),
    spread_seconds integer NOT NULL DEFAULT 0 CHECK (spread_seconds >= 0),
    custom_source boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz
);

ALTER TABLE submissions
    ADD COLUMN benchmark_id uuid REFERENCES benchmark_runs(id),
    ADD COLUMN benchmark_position integer CHECK (benchmark_position > 0);
ALTER TABLE submissions DROP CONSTRAINT submissions_context_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_context_check CHECK (context IN ('CONTEST','LABORATORY','PRACTICE','BENCHMARK'));
ALTER TABLE submissions DROP CONSTRAINT submission_context;
ALTER TABLE submissions ADD CONSTRAINT submission_context CHECK (
    (context='CONTEST' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=4
        AND validation_id IS NULL AND reference_solution_id IS NULL)
    OR (context='PRACTICE' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0)
    OR (context='LABORATORY' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=0
        AND validation_id IS NOT NULL AND reference_solution_id IS NOT NULL)
    OR (context='BENCHMARK' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0));
ALTER TABLE submissions ADD CONSTRAINT submission_benchmark CHECK ((context='BENCHMARK') = (benchmark_id IS NOT NULL) AND (benchmark_id IS NULL) = (benchmark_position IS NULL));
CREATE UNIQUE INDEX submissions_benchmark ON submissions(benchmark_id,benchmark_position) WHERE benchmark_id IS NOT NULL;

-- A benchmark can use the contest judges, so it measures what a contest would get.
CREATE OR REPLACE FUNCTION enqueue_judge_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lane_name text;
BEGIN
    IF NEW.status NOT IN ('QUEUED','RETRY') THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.dispatch_sequence=OLD.dispatch_sequence THEN RETURN NEW; END IF;
    SELECT CASE WHEN r.kind='OFFICIAL' OR b.lane='official' THEN 'OFFICIAL' ELSE 'INTERNAL' END INTO lane_name
      FROM submissions s LEFT JOIN contest_runs r ON r.id=s.run_id LEFT JOIN benchmark_runs b ON b.id=s.benchmark_id WHERE s.id=NEW.submission_id;
    INSERT INTO judge_outbox(job_id,dispatch_sequence,lane,available_at)
      VALUES (NEW.id,NEW.dispatch_sequence,lane_name,NEW.available_at);
    RETURN NEW;
END;
$$;
