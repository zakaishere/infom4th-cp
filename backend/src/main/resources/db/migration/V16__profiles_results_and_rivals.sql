-- Optional public profile fields. Links are stored as usernames so a profile can never carry an arbitrary URL.
ALTER TABLE users
    ADD COLUMN bio varchar(280) NOT NULL DEFAULT '',
    ADD COLUMN school varchar(100) NOT NULL DEFAULT '',
    ADD COLUMN country varchar(2) CHECK (country ~ '^[A-Z]{2}$'),
    ADD COLUMN github varchar(39) CHECK (github ~ '^[A-Za-z0-9](-?[A-Za-z0-9])*$'),
    ADD COLUMN codeforces varchar(24) CHECK (codeforces ~ '^[A-Za-z0-9_.-]{3,24}$');

-- Organizers can keep a contest out of the rating, for example a training session.
ALTER TABLE competitions ADD COLUMN rated boolean NOT NULL DEFAULT true;

-- Final results of public contests, saved so profiles do not recalculate every contest.
-- Rebuilt whenever a rejudge changes a verdict; contest_result_runs records when.
CREATE TABLE contest_result_runs (
    run_id uuid PRIMARY KEY REFERENCES contest_runs(id),
    computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contest_results (
    run_id uuid NOT NULL REFERENCES contest_result_runs(run_id),
    entry_id uuid NOT NULL,
    rank integer NOT NULL CHECK (rank > 0),
    entrants integer NOT NULL CHECK (entrants > 0),
    solved integer NOT NULL CHECK (solved >= 0),
    score double precision NOT NULL,
    penalty_seconds bigint,
    submissions integer NOT NULL CHECK (submissions >= 0),
    first_bloods integer NOT NULL DEFAULT 0 CHECK (first_bloods >= 0),
    clean_sheet boolean NOT NULL DEFAULT false,
    buzzer_beater boolean NOT NULL DEFAULT false,
    freeze_breaker boolean NOT NULL DEFAULT false,
    PRIMARY KEY (run_id, entry_id),
    FOREIGN KEY (entry_id, run_id) REFERENCES run_entries(id, run_id)
);
CREATE INDEX contest_results_entry ON contest_results(entry_id);

-- Private to the person who pinned them.
CREATE TABLE rivals (
    user_id uuid NOT NULL REFERENCES users(id),
    rival_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, rival_id),
    CHECK (user_id <> rival_id)
);
