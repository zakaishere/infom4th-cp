-- Allow organizers to add, remove, or adjust release_day of problems while a scheduled/manual-start
-- contest is still waiting to start (OFFICIAL run PENDING and starts_at > now()).
CREATE OR REPLACE FUNCTION guard_competition_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_parent uuid;
    new_parent uuid;
    parent record;
    pv_sealed timestamptz;
    editable_pending boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.competition_version_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.competition_version_id; END IF;
    FOR parent IN SELECT id, sealed_at FROM competition_versions
        WHERE id IN (old_parent, new_parent) ORDER BY id FOR UPDATE
    LOOP
        IF parent.sealed_at IS NOT NULL THEN
            editable_pending := (TG_TABLE_NAME = 'competition_problems')
                AND EXISTS (
                    SELECT 1 FROM contest_runs r
                    WHERE r.competition_version_id = parent.id
                      AND r.kind = 'OFFICIAL'
                      AND r.status = 'PENDING'
                      AND r.starts_at > now()
                )
                AND NOT EXISTS (
                    SELECT 1 FROM contest_runs r
                    WHERE r.competition_version_id = parent.id
                      AND r.kind = 'OFFICIAL'
                      AND (r.status <> 'PENDING' OR r.starts_at <= now())
                );
            IF NOT editable_pending THEN
                RAISE EXCEPTION 'Assets of a sealed competition version are immutable';
            END IF;
            IF TG_OP IN ('INSERT', 'UPDATE') THEN
                SELECT sealed_at INTO pv_sealed FROM problem_versions WHERE id = NEW.problem_version_id;
                IF pv_sealed IS NULL THEN
                    RAISE EXCEPTION 'Sealed competitions require approved problem versions';
                END IF;
            END IF;
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
