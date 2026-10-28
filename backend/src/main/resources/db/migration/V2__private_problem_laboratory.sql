CREATE TABLE languages (
    code varchar(24) PRIMARY KEY,
    display_name varchar(80) NOT NULL,
    enabled boolean NOT NULL DEFAULT false
);
-- Runtime profiles exist in the reference project, but none are enabled until
-- the standalone isolated worker has passed execution tests for that runtime.
INSERT INTO languages(code, display_name) VALUES
    ('JAVA', 'Java'), ('CPP', 'C++'), ('C', 'C'), ('PYTHON', 'Python'),
    ('JAVASCRIPT', 'JavaScript'), ('KOTLIN', 'Kotlin');

CREATE TABLE problems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(120) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    owner_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);
CREATE INDEX problems_owner ON problems(owner_id);
CREATE TABLE problem_collaborators (
    problem_id uuid NOT NULL REFERENCES problems(id),
    user_id uuid NOT NULL REFERENCES users(id),
    access_level varchar(16) NOT NULL CHECK (access_level IN ('EDITOR', 'REVIEWER', 'MANAGER')),
    granted_by uuid NOT NULL REFERENCES users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (problem_id, user_id)
);
CREATE INDEX problem_collaborators_user ON problem_collaborators(user_id);

CREATE TABLE problem_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id uuid NOT NULL REFERENCES problems(id),
    version_number integer NOT NULL CHECK (version_number > 0),
    title varchar(255) NOT NULL CHECK (btrim(title) <> ''),
    difficulty varchar(16) NOT NULL DEFAULT 'MEDIUM' CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    statement_md text NOT NULL DEFAULT '',
    input_format_md text NOT NULL DEFAULT '',
    output_format_md text NOT NULL DEFAULT '',
    constraints_md text NOT NULL DEFAULT '',
    explanation_md text NOT NULL DEFAULT '',
    setter_notes text NOT NULL DEFAULT '',
    time_limit_ms integer NOT NULL DEFAULT 2000 CHECK (time_limit_ms BETWEEN 1 AND 60000),
    memory_limit_mb integer NOT NULL DEFAULT 256 CHECK (memory_limit_mb BETWEEN 16 AND 4096),
    output_limit_kb integer NOT NULL DEFAULT 1024 CHECK (output_limit_kb BETWEEN 1 AND 65536),
    checker varchar(32) NOT NULL DEFAULT 'TRIMMED_LINES' CHECK (checker IN ('EXACT', 'TRIMMED_LINES', 'TOKENS')),
    status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
        ('DRAFT', 'IN_TESTING', 'READY_FOR_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sealed_at timestamptz,
    UNIQUE (problem_id, version_number),
    UNIQUE (id, problem_id),
    CHECK (status NOT IN ('APPROVED', 'PUBLISHED', 'ARCHIVED') OR sealed_at IS NOT NULL)
);
CREATE INDEX problem_versions_review ON problem_versions(status);
CREATE TABLE problem_version_languages (
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    language_code varchar(24) NOT NULL REFERENCES languages(code),
    PRIMARY KEY (problem_version_id, language_code)
);
CREATE TABLE tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(64) NOT NULL UNIQUE CHECK (btrim(name) <> '')
);
CREATE TABLE problem_version_tags (
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    tag_id uuid NOT NULL REFERENCES tags(id),
    PRIMARY KEY (problem_version_id, tag_id)
);
CREATE TABLE test_case_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    name varchar(100) NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    UNIQUE (problem_version_id, position),
    UNIQUE (id, problem_version_id)
);
-- Private data: never serialize these rows directly to participant APIs.
CREATE TABLE test_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    group_id uuid NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    is_sample boolean NOT NULL DEFAULT false,
    input_data text NOT NULL,
    expected_output text NOT NULL,
    explanation_md text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (group_id, problem_version_id) REFERENCES test_case_groups(id, problem_version_id),
    UNIQUE (group_id, position),
    UNIQUE (id, problem_version_id)
);
CREATE INDEX test_cases_version ON test_cases(problem_version_id);
CREATE TABLE reference_solutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    label varchar(100) NOT NULL,
    language_code varchar(24) NOT NULL,
    source_code text NOT NULL CHECK (btrim(source_code) <> ''),
    expected_verdict varchar(32) NOT NULL CHECK (expected_verdict IN
        ('ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED',
         'COMPILATION_ERROR', 'RUNTIME_ERROR', 'OUTPUT_LIMIT_EXCEEDED')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (problem_version_id, language_code)
        REFERENCES problem_version_languages(problem_version_id, language_code),
    UNIQUE (id, problem_version_id)
);
CREATE TABLE problem_validation_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'JUDGE_ERROR')),
    report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((status IN ('PENDING', 'RUNNING') AND completed_at IS NULL)
        OR (status IN ('PASSED', 'FAILED', 'JUDGE_ERROR') AND completed_at IS NOT NULL))
);
CREATE INDEX problem_validation_version ON problem_validation_results(problem_version_id, created_at DESC);
CREATE TABLE problem_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_version_id uuid NOT NULL REFERENCES problem_versions(id),
    reviewer_id uuid NOT NULL REFERENCES users(id),
    decision varchar(16) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'OVERRIDE')),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_reviews_version ON problem_reviews(problem_version_id);

-- Practice publication is independent of contest publication.
CREATE TABLE practice_publications (
    problem_id uuid PRIMARY KEY REFERENCES problems(id),
    problem_version_id uuid NOT NULL UNIQUE,
    published_by uuid NOT NULL REFERENCES users(id),
    published_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (problem_version_id, problem_id) REFERENCES problem_versions(id, problem_id)
);

CREATE FUNCTION guard_problem_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT' OR NEW.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Problem versions must start as unsealed drafts';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Sealed problem versions cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.sealed_at IS NOT NULL AND
       (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'updated_at') THEN
        RAISE EXCEPTION 'Sealed problem version content is immutable; create a new version';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
        (OLD.status = 'DRAFT' AND NEW.status = 'IN_TESTING') OR
        (OLD.status = 'IN_TESTING' AND NEW.status IN ('DRAFT', 'READY_FOR_REVIEW')) OR
        (OLD.status = 'READY_FOR_REVIEW' AND NEW.status IN ('DRAFT', 'APPROVED')) OR
        (OLD.status = 'APPROVED' AND NEW.status IN ('PUBLISHED', 'ARCHIVED')) OR
        (OLD.status = 'PUBLISHED' AND NEW.status IN ('APPROVED', 'ARCHIVED'))
    ) THEN
        RAISE EXCEPTION 'Invalid problem lifecycle transition: % -> %', OLD.status, NEW.status;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER problem_version_guard BEFORE INSERT OR UPDATE OR DELETE ON problem_versions
    FOR EACH ROW EXECUTE FUNCTION guard_problem_version();

-- Lock the parent while checking sealing, so sealing cannot race an asset edit.
CREATE FUNCTION guard_problem_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_parent uuid;
    new_parent uuid;
    parent record;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.problem_version_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.problem_version_id; END IF;
    FOR parent IN SELECT id, sealed_at FROM problem_versions
        WHERE id IN (old_parent, new_parent) ORDER BY id FOR UPDATE
    LOOP
        IF parent.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Assets of a sealed problem version are immutable';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER test_case_group_guard BEFORE INSERT OR UPDATE OR DELETE ON test_case_groups
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();
CREATE TRIGGER test_case_guard BEFORE INSERT OR UPDATE OR DELETE ON test_cases
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();
CREATE TRIGGER reference_solution_guard BEFORE INSERT OR UPDATE OR DELETE ON reference_solutions
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();
CREATE TRIGGER problem_language_guard BEFORE INSERT OR UPDATE OR DELETE ON problem_version_languages
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();
CREATE TRIGGER problem_tag_guard BEFORE INSERT OR UPDATE OR DELETE ON problem_version_tags
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();
