# Operations and contest readiness

## Topology

PostgreSQL is the source of truth. A trigger inserts an outbox intent in the same
transaction as every new/retried judging job. The dispatcher leases a small batch,
publishes persistent AMQP messages, checks broker confirms and unroutable returns,
then marks intents published. Broker communication is outside database transactions.

RabbitMQ exchange cp.judge routes official.CPP, internal.CPP, and equivalent keys
for each language to separate durable quorum queues. cp.judge.dead receives
rejected deliveries. Quorum queues use per-consumer prefetch (global QoS is not
supported). Each worker slot executes one job at a time; prefetched deliveries
are bounded by the number of subscribed language queues.

Workers use a shared private worker credential, not participant credentials or DB
passwords. Each claim lasts 60 seconds and renews every 15 seconds. Worker heartbeats
arrive every 20 seconds. The recovery scheduler scans every five seconds.
Infrastructure failures retry at increasing delays, at most three claims by default.
Expired workers cannot overwrite a reclaimed result. Unclaimed published jobs get
redispatched after two minutes, which also covers lost/abandoned broker deliveries.

A single-node broker with persistent storage supports restart recovery; it is not
high availability against losing the host/disk. Use separate broker nodes and tested
replication for that requirement. Back up the PostgreSQL volume and problem assets.

## Judging capacity

Since V9, worker slot counts are fully administrator-set (1-256 per worker) from
Control room → Judging settings, applied live: the worker starts extra slot threads
on its next heartbeat. JUDGE_SLOTS and JUDGE_MAX_SLOTS are only deployment defaults.
The admin view warns, but does not block, when a value exceeds the default maximum,
the detected CPU cores or memory, or the configured memory budgets. Running more
parallel submissions than physical cores makes time limits unreliable, so treat
those warnings seriously before a real contest. The sections below describe the
original model; where they say a value "cannot exceed JUDGE_MAX_SLOTS", read
"produces a warning above JUDGE_MAX_SLOTS".

A slot is one submission being compiled and run at a time. It is not a participant
and not a server. 100 participants submitting together with 16 official slots means
at most 16 submissions execute; the other 84 stay queued (PostgreSQL job rows and
RabbitMQ messages) and start in order as slots free up.

Two kinds of settings exist:

| Kind | Where | Applies |
| --- | --- | --- |
| Physical ceilings: JUDGE_MAX_SLOTS, JUDGE_MAX_MEMORY_MB, JUDGE_MEMORY_BUDGET_MB, JUDGE_HOST_ID, JUDGE_HOST_MEMORY_BUDGET_MB, JUDGE_LANE, runtime images | Worker environment (.env / compose) | Worker restart |
| Desired limits: global official/internal limits, worker execution limit, drain, admission limits | Admin UI, Judging settings, or PATCH /api/admin/judging/... | Live, within about 5 seconds |

JUDGE_SLOTS is only the initial concurrency of a worker until an administrator saves
a worker execution limit. Defaults are unchanged: two official slots, one internal
slot, 1024 MiB per slot, no global limits, 5 pending submissions per user, 12 per
minute and 5000 queued platform-wide.

Enforcement happens twice. In the backend, every claim runs one short transaction
that takes PostgreSQL advisory locks for its lane and host (always lane, then host,
then worker row), counts RUNNING jobs and compares them with the global lane limit,
the worker's effective limit and the host memory budget. Because the locks live in
PostgreSQL, several API instances share them, so a global limit of 16 means 16
official jobs across all official workers. No transaction is held during Docker
execution or broker I/O; RabbitMQ prefetch is not relied on for totals. In the
worker, a scheduler keeps one thread per possible slot (up to JUDGE_MAX_SLOTS) but
lets only `target` of them hold claims. A slot subscribes to its lane queues only
while idle and allowed to run, and cancels its consumers as soon as a delivery
arrives, so idle capacity elsewhere is not starved by prefetched messages.

### How changes reach workers

Workers send a heartbeat every JUDGE_CONTROL_INTERVAL_SECONDS (default 5). The reply
carries the worker's effective target (0 while drained). Raising a limit lets
more slots claim at the next heartbeat, but never beyond JUDGE_MAX_SLOTS. Lowering
a limit never stops running submissions: running jobs finish with their real
verdicts and nothing new starts until running < limit. The admin view shows
OVER_TARGET until then. If a claim returns 429 (global, worker or host capacity
full), the worker keeps the RabbitMQ delivery and retries every 1-3 seconds; the
job stays QUEUED and no attempt is consumed. A drained or offline worker gets 409
and returns the delivery to the queue for another worker.

Restarts and outages are handled conservatively. Registration updates only trusted facts
(ceiling, budgets, host, runtimes), never the saved worker limit or drain flag, so
both survive reconnects and restarts. If a worker restarts with a lower
JUDGE_MAX_SLOTS, its saved limit is capped and the view reports CEILING. If heartbeats fail,
the worker keeps its last limit (never increasing it). After 60 seconds without a
successful exchange it stops starting new work until the backend answers again;
running submissions continue. The backend marks a worker offline after 90 seconds
without a heartbeat; its next heartbeat gets 409 and it re-registers automatically.

### Admission limits

Pending submissions per user counts unfinished jobs (QUEUED, RUNNING, RETRY) of the
user's submissions in every context, including rejudges and laboratory validation.
Submissions per minute counts that user's stored contest and practice submissions
in the last 60 seconds, checked under the per-user row lock, so it is exact across
API instances. Maximum queued submissions counts all unfinished jobs in both lanes.
Idempotent replays never count. The separate 200 submissions/second burst guard per
API process remains a fixed safety valve, not a setting.

### Example: small VPS (everything on one 4 vCPU / 8 GB machine)

~~~ini
OFFICIAL_JUDGE_SLOTS=2
OFFICIAL_JUDGE_MAX_SLOTS=2
INTERNAL_JUDGE_SLOTS=1
INTERNAL_JUDGE_MAX_SLOTS=1
JUDGE_MAX_MEMORY_MB=1024
OFFICIAL_MEMORY_BUDGET_MB=2048
INTERNAL_MEMORY_BUDGET_MB=1024
JUDGE_HOST_ID=vps-1
JUDGE_HOST_MEMORY_BUDGET_MB=3072
~~~

This leaves about 5 GB for the OS, Docker, PostgreSQL, RabbitMQ and the API. Leave
both global limits empty (null); to keep practice from slowing a live round, set
"Concurrent internal submissions" to 0 during the contest and back afterwards.

### Example: 16 official slots plus reserved internal capacity

A dedicated Linux judge host with at least 16 physical cores reserved for judging and
32+ GB RAM (verify timing stability on the real machine first):

~~~ini
OFFICIAL_JUDGE_SLOTS=16
OFFICIAL_JUDGE_MAX_SLOTS=16
OFFICIAL_MEMORY_BUDGET_MB=16384
INTERNAL_JUDGE_SLOTS=2
INTERNAL_JUDGE_MAX_SLOTS=4
INTERNAL_MEMORY_BUDGET_MB=4096
JUDGE_MAX_MEMORY_MB=1024
JUDGE_HOST_ID=judge-a
JUDGE_HOST_MEMORY_BUDGET_MB=20480
~~~

Restart the workers (`docker compose up -d`), then in the UI set
"Concurrent official submissions" to 16 and "Concurrent internal submissions" to 2,
or call:

~~~sh
curl -X PATCH http://127.0.0.1:8081/api/admin/judging/settings \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"version": 1, "reason": "Contest sizing", "officialConcurrencyLimit": 16, "internalConcurrencyLimit": 2}'
~~~

Use the version from GET /api/admin/judging/settings. The API rejects 16 if the
registered official workers support fewer than 16 slots in total. Internal work
cannot borrow official slots; the two lanes have separate workers and limits.

### Example: several worker hosts sharing one global official limit

Host A and host B each run one official worker; the API, PostgreSQL and RabbitMQ run
elsewhere on a private network. On each judge host, set a distinct identity:

~~~ini
# host A                               # host B
OFFICIAL_WORKER_NAME=official-a        OFFICIAL_WORKER_NAME=official-b
OFFICIAL_JUDGE_MAX_SLOTS=8             OFFICIAL_JUDGE_MAX_SLOTS=8
OFFICIAL_JUDGE_SLOTS=8                 OFFICIAL_JUDGE_SLOTS=8
OFFICIAL_MEMORY_BUDGET_MB=8192         OFFICIAL_MEMORY_BUDGET_MB=8192
JUDGE_HOST_ID=judge-a                  JUDGE_HOST_ID=judge-b
JUDGE_HOST_MEMORY_BUDGET_MB=10240      JUDGE_HOST_MEMORY_BUDGET_MB=10240
JUDGE_API_URL=http://api.internal:8081 JUDGE_API_URL=http://api.internal:8081
JUDGE_RABBITMQ_URL=amqp://cp:...@mq.internal:5672/%2F   (same on both)
~~~

Start only the worker there: `docker compose up -d --no-deps judge-official`.
Setting "Concurrent official submissions" to 12 then allows at most 12 official jobs
across A and B together (for example 8 + 4 or 6 + 6), never 12 each. Use different
worker names on different hosts, and the same JUDGE_HOST_ID only for workers that
really share one machine: the backend never assumes that different worker names
mean different machines. Protect /internal/judge and the broker with TLS or a
private network between hosts.

### Host sizing

The 1024 MiB slot budget includes compiler executions; actual program memory uses the
problem limit. Reserve additional RAM for API, PostgreSQL, broker, OS and filesystem
cache. Add CPU slots only after measuring compilation and full-suite execution.
Memory budgets are configured values, not measurements; the admin view labels them
that way and never claims a machine can run more than its registered ceilings.

An isolated 100-submission burst with eight slots and a measured five-second
whole-job duration needs approximately 65 seconds to drain, before overhead.
This is an illustration, not a measured result for this project or your server.

Jobs that wait longer than two minutes in a long queue are redispatched by recovery
as a safety net for lost messages. The original delivery stays valid: whichever
copy reaches a free slot first claims the job, and later copies are acknowledged as
duplicates, so a long backlog no longer pushes jobs to the back of the queue.

Do not increase DB connection pools to match participant count. Transactions are
brief; judge execution does not hold a database connection. Official/internal
slots are separate, so internal validation cannot occupy the official pool.

## Verification commands

1. Run Maven verify and Python unit tests.
2. Build all four runtime images; start the judge profile on Linux/cgroup v2.
3. Run the opt-in real Docker tests in README. Check accepted/wrong programs,
   infinite loops, output floods, actual OOM, non-root execution, read-only root,
   network denial, and marker-forgery resistance.
4. Enable only the tested language image IDs using the admin API.
5. Run scripts/verify-live.py --users 100 --official-limit N. It uses real registration,
   reference validation, scheduling, submissions, RabbitMQ and Docker results, sets
   the global official limit to N, samples running official jobs during the burst
   and fails if the observed peak exceeds N.
6. Record API p50/p95, queue-to-start delay, whole-job time, CPU, peak RAM and disk
   usage on the intended contest host. The script reports API latency/drain time;
   use Docker/host metrics and the job first_started_at/last_started_at timestamps for the remaining measures.
7. Repeat sustained mixed-language traffic at the expected contest submission
   frequency, alongside scoreboard polling. A one-shot burst is not a soak test.

## Recovery drills

Use an isolated local test deployment. Never remove volumes during these drills.

- Stop an official worker while jobs are executing. Start it again and verify
  lease recovery, original submission IDs, one authoritative result and correct
  scores. Inspect older lease attempts and audit history.
- Restart RabbitMQ while the API accepts submissions. Committed outbox intents
  must eventually publish and drain; duplicate delivery must not duplicate scores.
- Stop the API briefly after submitting. Workers may lose leases and retry; they
  must not invent contestant verdicts for infrastructure errors.
- Pause admission: new submissions are rejected, existing queued work continues.
- Allow the official clock to expire while jobs are queued. Submissions admitted
  before the deadline still count; new ones fail.
- Freeze standings, submit accepted solutions, compare public and jury views,
  then release final standings after contest end.
- Run rehearsals concurrently and confirm official standings remain unchanged.
- Drain a worker: new claims are refused and active jobs finish. Restarting the
  process with the same worker name keeps it drained until an administrator resumes it.
- Lower "Concurrent official submissions" below the running count during a burst:
  running jobs finish, OVER_TARGET is shown, and new jobs start only below the limit.
  Raise it again and confirm more jobs start within one heartbeat interval.
- Stop the API for two minutes while workers run: workers keep their last limit,
  stop starting new work after 60 seconds, then re-register and resume when the
  API returns.

## Deployment configuration

- Generate private DB_PASSWORD, RABBITMQ_PASSWORD and WORKER_TOKEN; never commit .env.
- For URLs in RABBITMQ_URL use percent-encoded broker credentials. Generated hex
  passwords need no additional encoding.
- Use TLS at the reverse proxy; restrict internal judge routes to the worker network.
- API_BIND defaults to 127.0.0.1. Set LAN binding and firewall rules intentionally.
- Use separate migration/runtime database accounts in deployment; the Compose
  bootstrap database owner is for local development.
- Configure SMTP and test actual reset delivery. SMTP failure does not disclose
  account existence; no reset token is logged or returned by the API.
- Back up volumes before migrations; never edit V1-V4 or run Flyway clean.
- Disable bootstrap password environment configuration after creating the admin.

## Remaining release gates

A browser end-to-end run of the frontend against a live stack, real hardware benchmarks, actual broker/worker restart drills, SMTP
delivery checks and external sandbox review are still required before a public
event. Advanced eligibility/approval queues, problem-package imports, test
generators, custom checkers, attachments, SSE/WebSockets, role revocation UI and
contest-clock extensions are not included in this backend increment.
