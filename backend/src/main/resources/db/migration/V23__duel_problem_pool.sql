-- Duels draw their rounds only from this pool, kept apart from the practice set so duel
-- problems are not public (and cannot be rehearsed) before a duel. One version per problem.
CREATE TABLE duel_problems (
    problem_id uuid PRIMARY KEY REFERENCES problems(id),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    published_by uuid NOT NULL REFERENCES users(id),
    published_at timestamptz NOT NULL DEFAULT now(),
    hidden boolean NOT NULL DEFAULT false
);

-- "Run examples" inside a duel is a DUEL submission judged on the examples only. It never
-- takes part in the race: rounds, the feed and the wrong-answer penalty ignore it.
ALTER TABLE submissions DROP CONSTRAINT submissions_samples_only_practice;
ALTER TABLE submissions ADD CONSTRAINT submissions_samples_only_context CHECK (NOT samples_only OR context IN ('PRACTICE','DUEL'));
