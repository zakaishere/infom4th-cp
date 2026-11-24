-- Flexible contest categories (STANDARD = Normal, BASIC = Basic, WARMUP = Warmup) and unified timing.
-- Every contest category can use any duration (short or multi-day), any scoring system, and optional full-screen enforcement.
ALTER TABLE competition_versions
    DROP CONSTRAINT IF EXISTS competition_versions_contest_format_check,
    DROP CONSTRAINT IF EXISTS competition_versions_warmup_rules,
    ADD COLUMN require_fullscreen boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT competition_versions_contest_format_check CHECK (contest_format IN ('STANDARD', 'BASIC', 'WARMUP'));

UPDATE competition_versions SET require_fullscreen = false WHERE contest_format = 'WARMUP';
