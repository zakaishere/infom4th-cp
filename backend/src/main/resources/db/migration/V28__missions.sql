-- Missions: a set of practice problems (a TP given in a training session) with points per problem.
-- Participants solve them through the practice routes; the mission score is computed from their
-- submissions made while the mission is open: points = weight x share of tests passed by the best
-- submission of each problem. Mission problems are kept off the general Practice list and the TD list.
CREATE TABLE missions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(64) NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    title varchar(120) NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL DEFAULT '',
    opens_at timestamptz NOT NULL DEFAULT now(),
    closes_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (closes_at IS NULL OR closes_at > opens_at)
);
CREATE UNIQUE INDEX missions_slug ON missions(slug);

CREATE TABLE mission_problems (
    mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    problem_id uuid NOT NULL REFERENCES problems(id),
    position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 999),
    weight numeric(6,2) NOT NULL DEFAULT 10 CHECK (weight > 0 AND weight <= 1000),
    PRIMARY KEY (mission_id, problem_id),
    UNIQUE (problem_id)
);
