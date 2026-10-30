-- Where judging time goes: compiling, running tests, and the rest (sandbox setup and cleanup).
-- Reported by workers; empty for results judged before this version or by an older worker.
ALTER TABLE judging_results
    ADD COLUMN compile_ms integer CHECK (compile_ms >= 0),
    ADD COLUMN tests_ms integer CHECK (tests_ms >= 0),
    ADD COLUMN judge_total_ms integer CHECK (judge_total_ms >= 0);

-- What the contestant experienced, measured in their browser: from the click on Submit until the
-- server accepted it, and until the verdict appeared on screen. Only for analytics; never scoring.
CREATE TABLE submission_client_timings (
    submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    accepted_ms integer NOT NULL CHECK (accepted_ms BETWEEN 0 AND 86400000),
    verdict_ms integer CHECK (verdict_ms BETWEEN 0 AND 86400000),
    reported_at timestamptz NOT NULL DEFAULT now()
);
