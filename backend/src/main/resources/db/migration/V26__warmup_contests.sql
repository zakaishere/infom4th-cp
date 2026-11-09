-- Warmup contests: a multi-day contest whose problems open day by day. Problems of day N open at
-- run start + (N - 1) days; earlier days stay open until the end. Scoring is the best submission on
-- each problem (IOI), with no full-screen rule, and the problems can go to Practice once it ends.
ALTER TABLE competition_versions
    ADD COLUMN contest_format varchar(16) NOT NULL DEFAULT 'STANDARD' CHECK (contest_format IN ('STANDARD', 'WARMUP')),
    ADD COLUMN publish_to_practice boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT competition_versions_warmup_rules CHECK (
        contest_format = 'STANDARD'
        OR (scoring_system = 'IOI' AND freeze_before_end_seconds = 0 AND duration_seconds % 86400 = 0)
    );

ALTER TABLE competition_problems
    ADD COLUMN release_day integer NOT NULL DEFAULT 1 CHECK (release_day BETWEEN 1 AND 31);

-- Set once the finished contest's problems were published to Practice, so it happens only once.
ALTER TABLE competitions ADD COLUMN practice_published_at timestamptz;
