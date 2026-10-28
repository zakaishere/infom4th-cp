-- Public practice set: organizer-managed tags and visibility, and "run examples" submissions.
ALTER TABLE practice_publications
    ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN hidden boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT practice_publications_tags_limit CHECK (cardinality(tags) <= 8);

-- A practice "run" judges only the example tests and never counts in statistics.
ALTER TABLE submissions
    ADD COLUMN samples_only boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT submissions_samples_only_practice CHECK (NOT samples_only OR context = 'PRACTICE');

CREATE INDEX submissions_practice_stats ON submissions(problem_version_id, submitted_by)
    WHERE context = 'PRACTICE' AND NOT samples_only;
