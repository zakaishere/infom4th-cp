-- Persist problem bank collections so empty collections survive page reloads,
-- and backfill any existing problems.folder paths.
CREATE TABLE problem_collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX problem_collections_name_lower ON problem_collections (lower(name));

INSERT INTO problem_collections (name)
SELECT DISTINCT p.folder
FROM problems p
WHERE p.folder IS NOT NULL AND btrim(p.folder) <> ''
  AND NOT EXISTS (SELECT 1 FROM problem_collections c WHERE lower(c.name) = lower(p.folder));
