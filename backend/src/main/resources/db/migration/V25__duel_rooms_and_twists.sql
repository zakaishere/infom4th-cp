-- Duels become rooms: 1v1 (DUEL), two teams (TEAMS, 2v2 or 3v3) or free-for-all (FFA, up to 10).
-- DUEL and TEAMS are races: a side wins a round, the first side to rounds_to_win rounds wins.
-- FFA plays rounds_total rounds; every round gives placement points, the most points wins.
-- Each round can carry a twist (modifier) drawn from the ones the host enabled.
ALTER TABLE duels
    ADD COLUMN mode varchar(8) NOT NULL DEFAULT 'DUEL' CHECK (mode IN ('DUEL','TEAMS','FFA')),
    ADD COLUMN max_players integer NOT NULL DEFAULT 2 CHECK (max_players BETWEEN 2 AND 10),
    ADD COLUMN rounds_total integer CHECK (rounds_total BETWEEN 1 AND 7),
    ADD COLUMN modifiers text[] NOT NULL DEFAULT '{}',
    ADD COLUMN winner_team smallint CHECK (winner_team IN (1,2));

CREATE TABLE duel_players (
    duel_id uuid NOT NULL REFERENCES duels(id),
    user_id uuid NOT NULL REFERENCES users(id),
    team smallint CHECK (team IN (1,2)),
    joined_at timestamptz NOT NULL DEFAULT now(),
    -- A player who leaves a running room forfeits; they stay listed with their points.
    left_at timestamptz,
    PRIMARY KEY (duel_id, user_id)
);
CREATE INDEX duel_players_user ON duel_players(user_id);
INSERT INTO duel_players(duel_id,user_id,joined_at) SELECT id,created_by,created_at FROM duels;
INSERT INTO duel_players(duel_id,user_id,joined_at) SELECT id,opponent_id,coalesce(started_at,created_at) FROM duels WHERE opponent_id IS NOT NULL;

-- Checks written for exactly two players (opponent_id) go away with that column.
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='duels'::regclass AND contype='c'
             AND pg_get_constraintdef(oid) ~ '(opponent_id|winner_id)' LOOP
        EXECUTE format('ALTER TABLE duels DROP CONSTRAINT %I', c.conname);
    END LOOP;
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='duel_rounds'::regclass AND contype='c'
             AND pg_get_constraintdef(oid) ~ 'result' LOOP
        EXECUTE format('ALTER TABLE duel_rounds DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
DROP INDEX duels_opponent;
ALTER TABLE duels DROP COLUMN opponent_id;
ALTER TABLE duels ADD CHECK ((mode = 'FFA') = (rounds_total IS NOT NULL));
ALTER TABLE duels ADD CHECK (mode <> 'DUEL' OR max_players = 2);
ALTER TABLE duels ADD CHECK (mode <> 'TEAMS' OR max_players IN (4,6));
ALTER TABLE duels ADD CHECK (winner_team IS NULL OR mode = 'TEAMS');

-- Round results: ACCEPTED (first accepted), TESTS (most tests), SHORTEST (code golf),
-- FASTEST (quickest run), POINTS (free-for-all placement), DRAW, FORFEIT.
ALTER TABLE duel_rounds
    ADD COLUMN modifier varchar(16) NOT NULL DEFAULT 'CLASSIC'
        CHECK (modifier IN ('CLASSIC','BLIND','NO_FOR','NO_PLUS','GOLF','FASTEST','LANGUAGE')),
    ADD COLUMN forced_language varchar(24),
    ADD COLUMN winner_team smallint CHECK (winner_team IN (1,2)),
    ADD CHECK (result IN ('ACCEPTED','TESTS','SHORTEST','FASTEST','POINTS','DRAW','FORFEIT')),
    ADD CHECK ((result IS NULL) = (decided_at IS NULL)),
    ADD CHECK ((modifier = 'LANGUAGE') = (forced_language IS NOT NULL));

-- Every player's place and points in every decided round (teammates share their team's place).
CREATE TABLE duel_round_results (
    duel_id uuid NOT NULL,
    number integer NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    place integer NOT NULL CHECK (place > 0),
    points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
    PRIMARY KEY (duel_id, number, user_id),
    FOREIGN KEY (duel_id, number) REFERENCES duel_rounds(duel_id, number) ON DELETE CASCADE
);
