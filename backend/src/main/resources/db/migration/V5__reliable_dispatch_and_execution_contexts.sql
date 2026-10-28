ALTER TABLE refresh_tokens ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX refresh_tokens_family ON refresh_tokens(family_id);
CREATE TABLE access_tokens (
    token_digest char(64) PRIMARY KEY,
    refresh_token_id uuid NOT NULL REFERENCES refresh_tokens(id),
    expires_at timestamptz NOT NULL
);
CREATE INDEX access_tokens_expiry ON access_tokens(expires_at);
CREATE TABLE password_reset_tokens (
    token_digest char(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
ALTER TABLE submissions ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN competition_version_id DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN problem_slot DROP NOT NULL;
ALTER TABLE submissions ADD COLUMN context varchar(16) NOT NULL DEFAULT 'CONTEST'
    CHECK (context IN ('CONTEST','LABORATORY','PRACTICE'));
ALTER TABLE submissions ADD COLUMN validation_id uuid REFERENCES problem_validation_results(id);
ALTER TABLE submissions ADD COLUMN reference_solution_id uuid REFERENCES reference_solutions(id);
ALTER TABLE submissions ADD CONSTRAINT submission_context CHECK (
    (context='CONTEST' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=4
        AND validation_id IS NULL AND reference_solution_id IS NULL)
    OR (context='PRACTICE' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0)
    OR (context='LABORATORY' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=0
        AND validation_id IS NOT NULL AND reference_solution_id IS NOT NULL));
ALTER TABLE problem_validation_results ADD UNIQUE (id,problem_version_id);
ALTER TABLE submissions ADD FOREIGN KEY (validation_id,problem_version_id)
    REFERENCES problem_validation_results(id,problem_version_id);
ALTER TABLE submissions ADD FOREIGN KEY (reference_solution_id,problem_version_id)
    REFERENCES reference_solutions(id,problem_version_id);
CREATE INDEX submissions_validation ON submissions(validation_id) WHERE validation_id IS NOT NULL;
ALTER TABLE judging_jobs ADD COLUMN dispatch_sequence integer NOT NULL DEFAULT 0 CHECK (dispatch_sequence>=0);
CREATE TABLE judge_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES judging_jobs(id),
    dispatch_sequence integer NOT NULL,
    lane varchar(16) NOT NULL CHECK (lane IN ('OFFICIAL','INTERNAL')),
    available_at timestamptz NOT NULL DEFAULT now(),
    claim_token uuid,
    claim_expires_at timestamptz,
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(job_id,dispatch_sequence),
    CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);
CREATE INDEX judge_outbox_pending ON judge_outbox(available_at,created_at) WHERE published_at IS NULL;
CREATE INDEX judging_jobs_submission_latest ON judging_jobs(submission_id,generation DESC);
CREATE TABLE team_invites (
    token_digest char(64) PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES teams(id),
    expires_at timestamptz NOT NULL
);
CREATE TABLE run_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES contest_runs(id),
    kind varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_events_poll ON run_events(run_id,id);
CREATE FUNCTION enqueue_judge_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lane_name text;
BEGIN
    IF NEW.status NOT IN ('QUEUED','RETRY') THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.dispatch_sequence=OLD.dispatch_sequence THEN RETURN NEW; END IF;
    SELECT CASE WHEN r.kind='OFFICIAL' THEN 'OFFICIAL' ELSE 'INTERNAL' END INTO lane_name
      FROM submissions s LEFT JOIN contest_runs r ON r.id=s.run_id WHERE s.id=NEW.submission_id;
    INSERT INTO judge_outbox(job_id,dispatch_sequence,lane,available_at)
      VALUES (NEW.id,NEW.dispatch_sequence,lane_name,NEW.available_at);
    RETURN NEW;
END;
$$;
CREATE TRIGGER judge_dispatch AFTER INSERT OR UPDATE ON judging_jobs
    FOR EACH ROW EXECUTE FUNCTION enqueue_judge_dispatch();
INSERT INTO judge_outbox(job_id,dispatch_sequence,lane,available_at)
SELECT j.id,j.dispatch_sequence,CASE WHEN r.kind='OFFICIAL' THEN 'OFFICIAL' ELSE 'INTERNAL' END,j.available_at
FROM judging_jobs j JOIN submissions s ON s.id=j.submission_id
LEFT JOIN contest_runs r ON r.id=s.run_id WHERE j.status IN ('QUEUED','RETRY');
