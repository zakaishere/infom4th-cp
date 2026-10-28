-- A global runtime rollout must not silently change an already validated problem.
CREATE TABLE problem_runtime_pins (
    problem_version_id uuid NOT NULL,
    language_code varchar(24) NOT NULL,
    image_id varchar(80) NOT NULL CHECK (image_id ~ '^sha256:[0-9a-f]{64}$'),
    FOREIGN KEY(problem_version_id,language_code)
        REFERENCES problem_version_languages(problem_version_id,language_code),
    PRIMARY KEY(problem_version_id,language_code)
);
CREATE TRIGGER problem_runtime_pin_guard BEFORE INSERT OR UPDATE OR DELETE ON problem_runtime_pins
    FOR EACH ROW EXECUTE FUNCTION guard_problem_asset();

ALTER TABLE judging_jobs ADD COLUMN first_started_at timestamptz;
ALTER TABLE judging_jobs ADD COLUMN last_started_at timestamptz;
