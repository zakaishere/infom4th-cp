ALTER TABLE languages ADD COLUMN runtime_image_id varchar(80);
ALTER TABLE languages ADD CHECK (NOT enabled OR (runtime_image_id IS NOT NULL AND runtime_image_id ~ '^sha256:[0-9a-f]{64}$'));
ALTER TABLE judging_jobs ADD COLUMN runtime_image_id varchar(80);
CREATE TABLE competition_invitations (
    competition_id uuid NOT NULL REFERENCES competitions(id),
    user_id uuid NOT NULL REFERENCES users(id),
    invited_by uuid NOT NULL REFERENCES users(id),
    PRIMARY KEY(competition_id,user_id)
);
CREATE FUNCTION gate_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r contest_runs%ROWTYPE;
BEGIN
    IF NEW.context='CONTEST' THEN
        -- Serialize admission with pause/end actions; the database clock decides.
        SELECT * INTO r FROM contest_runs WHERE id=NEW.run_id FOR SHARE;
        IF NOT FOUND OR r.status NOT IN ('PENDING','RUNNING') OR r.submissions_paused
           OR clock_timestamp()<r.starts_at OR clock_timestamp()>=r.ends_at THEN
            RAISE EXCEPTION 'Contest is not accepting submissions' USING ERRCODE='23514';
        END IF;
        NEW.submitted_at:=clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER submission_gate BEFORE INSERT ON submissions
    FOR EACH ROW EXECUTE FUNCTION gate_submission();
