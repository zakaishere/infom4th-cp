-- 1v1 blitz duels. Two players race through short rounds; each round is one practice problem.
-- The first accepted submission wins the round (ordered by submission time, so a slow judge
-- never decides a race). The first player to win rounds_to_win rounds wins the duel.
CREATE TABLE duels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by uuid NOT NULL REFERENCES users(id),
    opponent_id uuid REFERENCES users(id),
    status varchar(16) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','ACTIVE','FINISHED','CANCELLED')),
    rounds_to_win integer NOT NULL CHECK (rounds_to_win BETWEEN 1 AND 3),
    round_seconds integer NOT NULL CHECK (round_seconds BETWEEN 60 AND 1800),
    lockout_seconds integer NOT NULL CHECK (lockout_seconds BETWEEN 0 AND 120),
    difficulty varchar(16) CHECK (difficulty IN ('EASY','MEDIUM','HARD')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    winner_id uuid REFERENCES users(id),
    end_reason varchar(16) CHECK (end_reason IN ('ROUNDS','FORFEIT','DRAW','EXPIRED')),
    CHECK (opponent_id IS NULL OR opponent_id <> created_by),
    CHECK ((status = 'WAITING') = (opponent_id IS NULL) OR status = 'CANCELLED'),
    CHECK (winner_id IS NULL OR winner_id IN (created_by, opponent_id))
);
CREATE INDEX duels_created_by ON duels(created_by, created_at DESC);
CREATE INDEX duels_opponent ON duels(opponent_id, created_at DESC);
CREATE INDEX duels_active ON duels(status) WHERE status IN ('WAITING','ACTIVE');

-- Rounds are drawn when the opponent joins, easiest first, so a match warms up before it gets hard.
-- A round with no ends_at yet has not started; result is set once the round is decided.
CREATE TABLE duel_rounds (
    duel_id uuid NOT NULL REFERENCES duels(id),
    number integer NOT NULL CHECK (number > 0),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    starts_at timestamptz,
    ends_at timestamptz,
    winner_id uuid REFERENCES users(id),
    result varchar(16) CHECK (result IN ('ACCEPTED','TESTS','DRAW','FORFEIT')),
    decided_at timestamptz,
    PRIMARY KEY (duel_id, number),
    UNIQUE (duel_id, problem_version_id),
    CHECK ((starts_at IS NULL) = (ends_at IS NULL) AND (ends_at IS NULL OR ends_at > starts_at)),
    CHECK ((result IS NULL) = (decided_at IS NULL)),
    CHECK (winner_id IS NULL OR result IN ('ACCEPTED','TESTS','FORFEIT'))
);

ALTER TABLE submissions
    ADD COLUMN duel_id uuid,
    ADD COLUMN duel_round integer,
    ADD FOREIGN KEY (duel_id, duel_round) REFERENCES duel_rounds(duel_id, number);
ALTER TABLE submissions DROP CONSTRAINT submissions_context_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_context_check CHECK (context IN ('CONTEST','LABORATORY','PRACTICE','BENCHMARK','DUEL'));
ALTER TABLE submissions DROP CONSTRAINT submission_context;
ALTER TABLE submissions ADD CONSTRAINT submission_context CHECK (
    (context='CONTEST' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=4
        AND validation_id IS NULL AND reference_solution_id IS NULL)
    OR (context='PRACTICE' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0)
    OR (context='LABORATORY' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot)=0
        AND validation_id IS NOT NULL AND reference_solution_id IS NOT NULL)
    OR (context='BENCHMARK' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0)
    OR (context='DUEL' AND num_nonnulls(run_id,competition_version_id,entry_id,problem_slot,validation_id,reference_solution_id)=0));
ALTER TABLE submissions ADD CONSTRAINT submission_duel CHECK ((context='DUEL') = (duel_id IS NOT NULL) AND (duel_id IS NULL) = (duel_round IS NULL));
CREATE INDEX submissions_duel ON submissions(duel_id, duel_round, submitted_at) WHERE duel_id IS NOT NULL;

-- Duel submissions take the database clock like contest submissions: the race is ordered by it.
CREATE OR REPLACE FUNCTION gate_submission() RETURNS trigger LANGUAGE plpgsql AS $$
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
    ELSIF NEW.context='DUEL' THEN
        NEW.submitted_at:=clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;
