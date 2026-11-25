-- Nested folder paths for organizing problems in the Problem Library (e.g. "Warmup/Week 1", "Basic", "Contests").
ALTER TABLE problems
    ADD COLUMN folder varchar(120);

CREATE INDEX problems_folder ON problems(folder) WHERE folder IS NOT NULL;
