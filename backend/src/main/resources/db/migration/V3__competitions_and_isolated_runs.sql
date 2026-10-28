CREATE TABLE competitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(120) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    owner_id uuid NOT NULL REFERENCES users(id),
    title varchar(255) NOT NULL CHECK (btrim(title) <> ''),
    status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
        ('DRAFT', 'INTERNAL_TESTING', 'READY', 'SCHEDULED', 'RUNNING', 'FINISHED', 'ARCHIVED')),
    visibility varchar(16) NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'UNLISTED', 'PUBLIC')),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX competitions_discovery ON competitions(status, published_at) WHERE published_at IS NOT NULL;
CREATE INDEX competitions_owner ON competitions(owner_id);
CREATE TABLE competition_staff (
    competition_id uuid NOT NULL REFERENCES competitions(id),
    user_id uuid NOT NULL REFERENCES users(id),
    access_level varchar(16) NOT NULL CHECK (access_level IN ('MANAGER', 'JURY', 'TESTER')),
    can_publish boolean NOT NULL DEFAULT false,
    granted_by uuid NOT NULL REFERENCES users(id),
    PRIMARY KEY (competition_id, user_id),
    CHECK (NOT can_publish OR access_level = 'MANAGER')
);
CREATE INDEX competition_staff_user ON competition_staff(user_id);

CREATE TABLE competition_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id),
    version_number integer NOT NULL CHECK (version_number > 0),
    description_md text NOT NULL DEFAULT '',
    rules_md text NOT NULL DEFAULT '',
    banner_key text,
    mode varchar(16) NOT NULL DEFAULT 'INDIVIDUAL' CHECK (mode IN ('INDIVIDUAL', 'TEAM')),
    max_team_size integer NOT NULL DEFAULT 1 CHECK (max_team_size BETWEEN 1 AND 100),
    duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
    display_timezone varchar(64) NOT NULL DEFAULT 'UTC',
    scoring_system varchar(24) NOT NULL DEFAULT 'ICPC' CHECK (scoring_system = 'ICPC'),
    wrong_attempt_penalty_seconds integer NOT NULL DEFAULT 1200 CHECK (wrong_attempt_penalty_seconds >= 0),
    penalize_compilation_errors boolean NOT NULL DEFAULT false,
    freeze_before_end_seconds integer NOT NULL DEFAULT 0 CHECK (freeze_before_end_seconds >= 0),
    registration_opens_at timestamptz,
    registration_closes_at timestamptz,
    eligibility_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility_rules) = 'object'),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    sealed_at timestamptz,
    UNIQUE (competition_id, version_number),
    UNIQUE (id, competition_id),
    CHECK (mode = 'TEAM' OR max_team_size = 1),
    CHECK (freeze_before_end_seconds < duration_seconds),
    CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_closes_at > registration_opens_at)
);
CREATE TABLE competition_version_languages (
    competition_version_id uuid NOT NULL REFERENCES competition_versions(id),
    language_code varchar(24) NOT NULL REFERENCES languages(code),
    PRIMARY KEY (competition_version_id, language_code)
);
CREATE TABLE competition_problems (
    competition_version_id uuid NOT NULL REFERENCES competition_versions(id),
    slot integer NOT NULL CHECK (slot > 0),
    label varchar(8) NOT NULL CHECK (btrim(label) <> ''),
    problem_id uuid NOT NULL REFERENCES problems(id),
    problem_version_id uuid NOT NULL,
    FOREIGN KEY (problem_version_id, problem_id) REFERENCES problem_versions(id, problem_id),
    PRIMARY KEY (competition_version_id, slot),
    UNIQUE (competition_version_id, label),
    UNIQUE (competition_version_id, problem_id),
    UNIQUE (competition_version_id, slot, problem_version_id)
);
CREATE INDEX competition_problems_version ON competition_problems(problem_version_id);

CREATE TABLE teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    captain_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id),
    user_id uuid NOT NULL REFERENCES users(id),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members(user_id);
CREATE TABLE registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id),
    user_id uuid REFERENCES users(id),
    team_id uuid REFERENCES teams(id),
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    decided_by uuid REFERENCES users(id),
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, team_id) = 1)
);
CREATE UNIQUE INDEX registrations_user ON registrations(competition_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX registrations_team ON registrations(competition_id, team_id) WHERE team_id IS NOT NULL;

-- Every official contest and rehearsal has its own run, clock and membership.
-- Rehearsals use the same judging rules without sharing any scoring rows.
CREATE TABLE contest_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id),
    competition_version_id uuid NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('OFFICIAL', 'REHEARSAL')),
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'FINISHED', 'ARCHIVED')),
    created_by uuid NOT NULL REFERENCES users(id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    submissions_paused boolean NOT NULL DEFAULT false,
    final_standings_released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (competition_version_id, competition_id) REFERENCES competition_versions(id, competition_id),
    CHECK (ends_at > starts_at),
    UNIQUE (id, competition_version_id)
);
CREATE UNIQUE INDEX one_official_run ON contest_runs(competition_id) WHERE kind = 'OFFICIAL';
CREATE INDEX contest_runs_schedule ON contest_runs(status, starts_at);
CREATE INDEX contest_runs_version ON contest_runs(competition_version_id);
CREATE TABLE run_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES contest_runs(id),
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    user_id uuid REFERENCES users(id),
    team_id uuid REFERENCES teams(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(user_id, team_id) = 1),
    UNIQUE (id, run_id),
    UNIQUE (run_id, user_id),
    UNIQUE (run_id, team_id)
);
-- Snapshot memberships per run. Changing a global team cannot change past scores.
CREATE TABLE run_entry_members (
    entry_id uuid NOT NULL,
    run_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    FOREIGN KEY (entry_id, run_id) REFERENCES run_entries(id, run_id),
    PRIMARY KEY (entry_id, run_id, user_id),
    UNIQUE (run_id, user_id)
);

CREATE FUNCTION guard_competition_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT' OR NEW.published_at IS NOT NULL THEN
            RAISE EXCEPTION 'Competitions must start as private unpublished drafts';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> OLD.status AND NOT (
        (OLD.status = 'DRAFT' AND NEW.status = 'INTERNAL_TESTING') OR
        (OLD.status = 'INTERNAL_TESTING' AND NEW.status IN ('DRAFT', 'READY')) OR
        (OLD.status = 'READY' AND NEW.status IN ('INTERNAL_TESTING', 'SCHEDULED')) OR
        (OLD.status = 'SCHEDULED' AND NEW.status IN ('READY', 'RUNNING')) OR
        (OLD.status = 'RUNNING' AND NEW.status = 'FINISHED') OR
        (OLD.status = 'FINISHED' AND NEW.status = 'ARCHIVED')
    ) THEN
        RAISE EXCEPTION 'Invalid competition lifecycle transition: % -> %', OLD.status, NEW.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER competition_state_guard BEFORE INSERT OR UPDATE ON competitions
    FOR EACH ROW EXECUTE FUNCTION guard_competition_state();

CREATE FUNCTION guard_competition_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    problem_snapshot record;
BEGIN
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
CREATE TRIGGER competition_version_guard BEFORE INSERT OR UPDATE OR DELETE ON competition_versions
    FOR EACH ROW EXECUTE FUNCTION guard_competition_version();

CREATE FUNCTION guard_competition_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_parent uuid;
    new_parent uuid;
    parent record;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.competition_version_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.competition_version_id; END IF;
    FOR parent IN SELECT id, sealed_at FROM competition_versions
        WHERE id IN (old_parent, new_parent) ORDER BY id FOR UPDATE
    LOOP
        IF parent.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Assets of a sealed competition version are immutable';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER competition_problem_guard BEFORE INSERT OR UPDATE OR DELETE ON competition_problems
    FOR EACH ROW EXECUTE FUNCTION guard_competition_asset();
CREATE TRIGGER competition_language_guard BEFORE INSERT OR UPDATE OR DELETE ON competition_version_languages
    FOR EACH ROW EXECUTE FUNCTION guard_competition_asset();

CREATE FUNCTION guard_run_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    snapshot competition_versions%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND
       (NEW.competition_id, NEW.competition_version_id, NEW.kind, NEW.starts_at, NEW.ends_at)
       IS DISTINCT FROM
       (OLD.competition_id, OLD.competition_version_id, OLD.kind, OLD.starts_at, OLD.ends_at) THEN
        RAISE EXCEPTION 'Run identity, snapshot and clock are immutable; create a new rehearsal';
    END IF;
    SELECT * INTO snapshot FROM competition_versions WHERE id = NEW.competition_version_id FOR SHARE;
    IF snapshot.sealed_at IS NULL THEN
        RAISE EXCEPTION 'Runs require a sealed competition version';
    END IF;
    IF extract(epoch FROM (NEW.ends_at - NEW.starts_at)) <> snapshot.duration_seconds THEN
        RAISE EXCEPTION 'Run duration must match its competition snapshot';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER run_snapshot_guard BEFORE INSERT OR UPDATE ON contest_runs
    FOR EACH ROW EXECUTE FUNCTION guard_run_snapshot();
