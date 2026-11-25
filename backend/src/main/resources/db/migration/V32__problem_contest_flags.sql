-- Organizer-managed contest pool / flag on problems (e.g. BASIC, WARMUP, STANDARD, or custom label)
-- to simplify filtering in Problem Lab, Problem Set, Bulk Import, and Contest Builder.
ALTER TABLE problems
    ADD COLUMN contest_flag varchar(32);

CREATE INDEX problems_contest_flag ON problems(contest_flag) WHERE contest_flag IS NOT NULL;
