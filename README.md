# Standalone competitive programming platform

This project is independent of the original academic backend in ../backend.
It has authenticated APIs, a private problem laboratory, versioned contests,
teams, rehearsals, ICPC standings, RabbitMQ dispatch, a separate Linux judge with
administrator-controlled judging capacity, and an InfoM4th-themed browser UI in
frontend/.

## Quick start (any machine with Docker)

~~~sh
cd cp-platform
sh scripts/setup-env.sh you@example.com   # Windows: .\scripts\setup-env.ps1
docker compose up -d --build              # database, broker, backend, website, judges
~~~

Open `http://<this-machine>/` and sign in with the admin login the script printed. The
first start builds the language images (15–30 min); see [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md).

## What is implemented

- Opaque bearer access tokens, hashed rotating refresh tokens, replay revocation,
  BCrypt passwords, SMTP password reset, explicit administrator bootstrap.
- Resource authorization, private contestant DTOs, private contest invitations,
  delegated setters/jury/managers, audited privileged operations.
- Problem versions, bulk test replacement, reference solutions, asynchronous
  validation, approval, cloning and explicit practice publication.
- Contest creation/editing, immutable snapshots, individual/team registration,
  server-clock submission gates, private rehearsals, pause/resume, freeze,
  public/jury standings, announcements, clarifications, source/result ownership.
- Atomic submission/job/outbox persistence. RabbitMQ durable quorum queues per
  language and lane, persistent publishes, confirms and unroutable-message checks.
- Worker capacity, immutable runtime-image pins, renewable fenced leases, bounded
  infrastructure retries, delayed redispatch, abandoned-job recovery and rejudging.
- Separate official/internal worker capacity. Contestant execution never occurs
  inside the backend process, and the backend never receives a Docker socket.
- Bounded output, per-test containers, compile once, UID 10001 contestant processes,
  CPU/memory/PID/file limits, network denial, read-only root, cgroup-v2 accounting,
  deadline termination and container cleanup.
- Live judging capacity: SUPER_ADMIN global official/internal concurrency limits,
  per-worker execution limits, persistent drain/resume and admission limits,
  enforced in the claim transaction (PostgreSQL advisory locks, shared by all API
  instances) and in the worker scheduler, within trusted physical ceilings and host
  memory budgets. See "Judging capacity" in docs/OPERATIONS.md.
- Four scoring systems per contest (ICPC, IOI partial points, Codeforces decaying
  points, AtCoder), per-test results for every submission, shared team submissions,
  and ten judge languages (C++, C, Java, Python, PyPy, JavaScript, Go, Rust, Kotlin, C#;
  the last six are not yet verified on a real judge host).
- Browser UI: sign-in, contest lobby with server-clock countdown, full-screen
  contest arena (statements, editor, submissions, standings, clarifications), practice,
  teams, and a control room (contests and live run monitor, problem lab, judging
  settings, languages, users and roles, audit log).
- Community: global Sigma leaderboards for players and teams, player profiles (activity,
  skills, contest rating, medals and badges), head to head, private rivals, contest
  replays, team pages and a downloadable share card. All of it reads public results only.
- Benchmark (Control room, super administrators): send up to 1000 submissions through the
  real queue and judges on a private problem, see every timing, and download an Excel report.

See [API](docs/API.md), [operations](docs/OPERATIONS.md),
[database](docs/DATABASE.md), and [security assumptions](docs/SECURITY.md).

## Verification status

Verified on 2026-10-28 on Windows with Docker Desktop (Linux engine, cgroup v2, 8 CPUs,
4 GB RAM), using the real Compose stack (PostgreSQL, RabbitMQ, backend, website, two judges):

- Maven: 60 backend tests pass (including start-now / extend / end-now, late registration,
  automatic language enabling and all four scoring systems).
- Python: 40 judge unit tests pass, and the 6 real Docker sandbox tests pass (time limit,
  output flood, cgroup out-of-memory, non-root read-only no-network sandbox, forged output
  markers, nothing leaks between tests of one submission).
- End to end through the HTTP API with real judging: a problem validated by the judge,
  a Codeforces contest started with "start now", a late entrant, and 19 submissions:
  accepted programs in all 13 languages plus wrong answer, compilation error, time limit,
  runtime error and memory limit, each with the expected verdict and per-test results.
- Throughput measured there: 19 submissions (4 tests each) in 168 s with 2 official
  slots. Docker Desktop on Windows is slower than native Linux; measure on the real VPS
  with `scripts/verify-live.py` before a large contest.

The judge sandbox design (per-submission container, read-only, no network, non-root,
cgroup CPU and memory accounting, output never used as a control channel) is stricter
than running all tests in one shell with printed markers; markers printed by a contestant
cannot change a verdict (tested).

## Deploying on a VPS

See [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md): every number you normally change
(judge slots, memory, languages) is in `cp-platform/.env`.

## Local services

On Windows, from cp-platform:

~~~powershell
.\scripts\setup-env.ps1
# Set BOOTSTRAP_EMAIL and a strong BOOTSTRAP_PASSWORD in the ignored .env.
# No privileged account exists unless explicitly configured.
docker compose up --build -d database rabbitmq backend
Invoke-RestMethod http://localhost:8081/actuator/health/readiness
~~~

The API is on localhost:8081, PostgreSQL on localhost:5433 and RabbitMQ management
on localhost:15672. Database and broker ports bind only to loopback. The default
API bind is also loopback; set API_BIND deliberately when LAN access is needed.

If the old local PostgreSQL helper is running on 5433, stop it with
scripts/local-database.ps1 -Action Stop before using the Compose database.
Compose down retains both database and broker volumes.

SMTP configuration is necessary to deliver password reset links. Remove
BOOTSTRAP_PASSWORD from the startup environment after initial administrator setup.

## Linux judging

The judges are part of the normal Compose project and need a Linux Docker engine with
cgroup v2 (a Linux host or Docker Desktop). On first start each judge builds the missing
language images from `judge/images/` (or prebuild them with `sh scripts/build-runtimes.sh`):

~~~sh
sh scripts/setup-env.sh you@example.com
docker compose up --build -d
~~~

Set JUDGE_HOST_WORK_ROOT to an absolute path on the Docker engine host. The same
directory is mounted at /judge/work inside both trusted workers. Contestant
containers receive only their own artifact directory; test input arrives on stdin.

Each worker verifies local images using accepted/wrong-answer reference programs,
then registers their immutable image IDs. A verified language is enabled
automatically unless a super administrator has turned it on or off explicitly
(Control room → Languages). A language that fails its self-test is skipped and
logged; the judge keeps serving the others. Both official and internal workers must
use the same image ID for a language. To check every language by hand:
`docker compose run --rm --no-deps --entrypoint python judge-official diagnose.py`.

Defaults reserve two official execution slots and one internal slot. Each slot
has a 1024 MiB maximum compile/execution budget. Tune slots, CPU and aggregate
memory for the actual host; participant count is not execution-slot count.
*_JUDGE_MAX_SLOTS and memory budgets are physical ceilings (restart workers to
change them); the global and per-worker limits under Control room → Judging settings
apply live. To run 16 official submissions at once, set OFFICIAL_JUDGE_MAX_SLOTS=16
with a matching memory budget on suitable hardware, restart the workers, then set
"Concurrent official submissions" to 16 (docs/OPERATIONS.md has full examples).

## Frontend

~~~powershell
cd frontend
npm install
npm run dev      # http://localhost:3000, proxies /api to http://127.0.0.1:8081
npm run build    # static files in frontend/dist
~~~

Serve frontend/dist from the same origin as /api in production (for example, a
reverse proxy that routes /api to the backend), or add the UI origin to
CORS_ORIGINS. Set PUBLIC_URL to the UI origin so password-reset links open it.
The UI shows sections according to roles: participants see contests, practice and
teams; ADMIN and MODERATOR users also get the control room; SUPER_ADMIN additionally
manages judging settings, languages, roles and the audit log. Full screen in the
arena is a client-side deterrent that blocks the screen when left; it is not
proctoring or anti-cheat.

## Tests

Bulk problem import is available under **Problem lab → Bulk import**. Generate one
file with `node scripts/package-problem-bank.mjs`, then upload
`examples/problem-bank.import.json.gz` (smaller) or the plain `.json` copy. Choose draft import, validation, approval, or
publication to Practice. Existing slugs are skipped. See
[the import guide](docs/PROBLEM_BANK_IMPORT.md) for details and limits.

Importer/package checks (after installing frontend dependencies):

~~~sh
node --test scripts/tests/problem-import.test.mjs
~~~

With JDK 17 on JAVA_HOME and PATH:

~~~powershell
cd backend
.\mvnw.cmd verify
~~~

These tests download/start temporary PostgreSQL and never target the persistent
academic or CP database. If Windows temporary-directory permissions interfere,
create a writable temporary directory and pass it through Surefire argLine:

~~~powershell
New-Item -ItemType Directory -Force target/test-tmp | Out-Null
.\mvnw.cmd "-DargLine=-Djava.io.tmpdir=$((Get-Location).Path)/target/test-tmp" verify
~~~

Worker unit tests (sandbox pipeline, live capacity scheduler, control exchange and
slot consumers with fake RabbitMQ/API objects) use Python 3.12+ and do not require
Docker or pika:

~~~sh
python -m unittest discover -s judge/tests -v
~~~

Five real Docker sandbox tests are skipped unless explicitly enabled. On the
Linux judge host with runtime images built:

~~~sh
docker compose run --rm --no-deps -e CP_DOCKER_TESTS=1 --entrypoint python judge-internal -m unittest discover -s tests -v
~~~

Run the actual live API/broker/Docker burst test only against a local test database.
It creates test accounts, a problem, reference validation and a competition:

~~~sh
export CP_TEST_ADMIN_EMAIL='your-local-admin@example.test'
export CP_TEST_ADMIN_PASSWORD='your-local-admin-password'
python scripts/verify-live.py --users 100 --timeout 900 --official-limit 4
~~~

Reports go to the ignored .local directory. Read docs/OPERATIONS.md for restart
recovery checks, throughput measurements and the remaining release gates.
