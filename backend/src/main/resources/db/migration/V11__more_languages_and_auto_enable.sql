-- More judge runtimes. C++20 shares the C++ runtime image with different compiler flags.
INSERT INTO languages(code, display_name) VALUES
    ('CPP20', 'C++20 (GCC)'), ('RUBY', 'Ruby 3'), ('PHP', 'PHP 8')
ON CONFLICT (code) DO NOTHING;
UPDATE languages SET display_name = 'C++17 (GCC)' WHERE code = 'CPP';
-- A language is enabled automatically the first time a worker verifies its runtime,
-- unless a super administrator has decided its state explicitly (admin_locked).
ALTER TABLE languages ADD COLUMN admin_locked boolean NOT NULL DEFAULT false;
UPDATE languages SET admin_locked = true WHERE runtime_image_id IS NOT NULL;

-- Organizers may start a scheduled contest early, extend it or end it early. Those audited
-- actions set cp.run_clock_change for their own transaction; every other clock change is refused.
CREATE OR REPLACE FUNCTION guard_run_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    snapshot competition_versions%ROWTYPE;
    clock_change boolean := coalesce(current_setting('cp.run_clock_change', true), '') = 'on';
BEGIN
    IF TG_OP = 'UPDATE' AND
       (NEW.competition_id, NEW.competition_version_id, NEW.kind)
       IS DISTINCT FROM (OLD.competition_id, OLD.competition_version_id, OLD.kind) THEN
        RAISE EXCEPTION 'Run identity and snapshot are immutable; create a new rehearsal';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT clock_change AND
       (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at) THEN
        RAISE EXCEPTION 'Run identity, snapshot and clock are immutable; create a new rehearsal';
    END IF;
    SELECT * INTO snapshot FROM competition_versions WHERE id = NEW.competition_version_id FOR SHARE;
    IF snapshot.sealed_at IS NULL THEN
        RAISE EXCEPTION 'Runs require a sealed competition version';
    END IF;
    IF NOT clock_change AND extract(epoch FROM (NEW.ends_at - NEW.starts_at)) <> snapshot.duration_seconds THEN
        RAISE EXCEPTION 'Run duration must match its competition snapshot';
    END IF;
    RETURN NEW;
END;
$$;
