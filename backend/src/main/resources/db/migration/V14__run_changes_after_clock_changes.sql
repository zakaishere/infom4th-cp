-- A run's length only has to match its snapshot when it is created. Extending or ending a run
-- early legitimately changes its length, and checking it on every update made all later changes
-- to that run fail: releasing standings, pausing, and the scheduler's status changes for every
-- contest. Clock changes themselves stay refused unless an audited action allows them.
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
    IF TG_OP = 'INSERT' AND extract(epoch FROM (NEW.ends_at - NEW.starts_at)) <> snapshot.duration_seconds THEN
        RAISE EXCEPTION 'Run duration must match its competition snapshot';
    END IF;
    RETURN NEW;
END;
$$;
