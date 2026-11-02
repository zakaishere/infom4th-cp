-- Function problems (LeetCode style). NULL keeps standard input/output. Otherwise a JSON object
-- {"functionName", "params": [{"name", "type"}], "returnType"}: contestants write only that
-- function and the judge generates the code that reads the input and prints the result.
-- Each test input then holds one JSON value per parameter line, the expected output one JSON value.
ALTER TABLE problem_versions ADD COLUMN function_signature text
    CHECK (function_signature IS NULL OR jsonb_typeof(function_signature::jsonb) = 'object');

-- More judge runtimes; each stays disabled until a worker verifies its image.
INSERT INTO languages(code, display_name) VALUES
    ('ZIG', 'Zig 0.13'), ('BRAINFUCK', 'Brainfuck')
ON CONFLICT (code) DO NOTHING;
