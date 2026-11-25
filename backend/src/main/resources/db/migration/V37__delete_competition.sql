-- Allow organizers to permanently delete a competition (and its runs, entries, and submissions)
-- via CompetitionService.delete(), gated by the transaction-local session flag cp.contest_delete = 'on'.

CREATE OR REPLACE FUNCTION guard_competition_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    problem_snapshot record;
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('cp.contest_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Competition versions must start unsealed';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sealed competition versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.sealed_at IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM competition_problems WHERE competition_version_id = NEW.id) THEN
            RAISE EXCEPTION 'Cannot seal a competition version without problems';
        END IF;
        FOR problem_snapshot IN
            SELECT pv.id, pv.sealed_at FROM problem_versions pv
            JOIN competition_problems cp ON cp.problem_version_id = pv.id
            WHERE cp.competition_version_id = NEW.id ORDER BY pv.id FOR SHARE OF pv
        LOOP
            IF problem_snapshot.sealed_at IS NULL THEN
                RAISE EXCEPTION 'Competition snapshots require sealed problem versions';
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_competition_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_parent uuid;
    new_parent uuid;
    parent record;
    pv_sealed timestamptz;
    editable_pending boolean;
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('cp.contest_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION reject_submission_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('cp.contest_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Submission source and identity are immutable; create a new submission';
END;
$$;
