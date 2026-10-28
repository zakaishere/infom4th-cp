-- Contest scoring is chosen per contest version:
--   ICPC       solved count, then time + penalty per rejected attempt (all-or-nothing)
--   IOI        partial points per passed test, best submission per problem, all tests run
--   CODEFORCES points decay with time, minus 50 per rejected attempt, floor 30%
--   ATCODER    fixed points; ties broken by last score time + 5 min per rejected attempt
ALTER TABLE competition_versions DROP CONSTRAINT IF EXISTS competition_versions_scoring_system_check;
ALTER TABLE competition_versions ADD CONSTRAINT competition_versions_scoring_system_allowed
    CHECK (scoring_system IN ('ICPC', 'IOI', 'CODEFORCES', 'ATCODER'));
-- Points used by IOI, CODEFORCES and ATCODER; NULL means the system default.
ALTER TABLE competition_problems ADD COLUMN points integer CHECK (points BETWEEN 1 AND 100000);

-- Additional judge runtimes; each stays disabled until a worker verifies its image.
INSERT INTO languages(code, display_name) VALUES
    ('GO', 'Go'), ('RUST', 'Rust'), ('CSHARP', 'C#'), ('PYPY', 'PyPy 3')
ON CONFLICT (code) DO NOTHING;
UPDATE languages SET display_name = 'JavaScript (Node.js)' WHERE code = 'JAVASCRIPT';
