-- Problems the server installs by itself from banks bundled with the backend (seed/*.json.gz).
-- One row per slug, kept forever: a seeded problem is never imported twice, even after an
-- administrator deletes, renames or hides it.
CREATE TABLE seeded_problems (
    slug varchar(120) PRIMARY KEY,
    bank varchar(32) NOT NULL,
    problem_version_id uuid REFERENCES problem_versions(id),
    -- IMPORTED: being validated; DONE: in its pool; SKIPPED: the slug already existed; FAILED: see detail
    status varchar(16) NOT NULL CHECK (status IN ('IMPORTED','DONE','SKIPPED','FAILED')),
    detail text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
