# Backend API

All business routes require Authorization: Bearer <accessToken>. Tokens are opaque,
random values; only their SHA-256 digests are stored. No cookie authentication is
used. Business errors return an HTTP status and a safe error message.

The browser UI lives in ../frontend (see README). There is no default administrator. Configure BOOTSTRAP_EMAIL and
BOOTSTRAP_PASSWORD once to create the first super administrator. Bootstrap uses
a database advisory lock and never replaces an existing administrator.

## Identity

| Method | Route | Body / result |
| --- | --- | --- |
| POST | /api/auth/register | email, handle, displayName, password; returns accessToken, refreshToken, userId, expiresIn |
| POST | /api/auth/login | email, password; same session response |
| POST | /api/auth/refresh | refreshToken; rotates both tokens |
| POST | /api/auth/logout | refreshToken; requires access token and revokes its refresh family |
| POST | /api/auth/forgot-password | email; generic response; reset link delivered through configured SMTP |
| POST | /api/auth/reset-password | token, password; single-use token, invalidates active sessions |
| GET | /api/me | Current identity and roles |

Passwords require uppercase, number, special character and 8-72 UTF-8 bytes.
Access tokens expire after 15 minutes; refresh tokens after 30 days. Refresh-token
replay revokes that session family. Rate limits allow a shared campus NAT, but are
per API process; put shared limits at the reverse proxy before adding replicas.

## Problem laboratory

Setters require ownership or a matching resource grant. Approval/publication
additionally requires organizer authority and reviewer/manager access.

| Method | Route | Body |
| --- | --- | --- |
| GET/POST | /api/lab/problems | Create: slug, title, statement, languages |
| GET/PATCH | /api/lab/problems/{versionId} | Read private content or edit an unsealed draft |
| POST | /api/lab/problems/{versionId}/clone | New editable version; copies tests and reference solutions |
| PUT | /api/lab/problems/{versionId}/tests | Replace suite with array of input, expected, sample |
| POST | /api/lab/problems/{versionId}/references | label, language, sourceCode, expectedVerdict |
| POST | /api/lab/problems/{versionId}/validate | Seal content and enqueue reference solutions; returns validationId |
| POST | /api/lab/problems/{versionId}/approve | reason; passing validation required |
| POST | /api/lab/problems/{versionId}/publish-practice | Explicitly publish approved version |
| PUT | /api/lab/problems/{versionId}/collaborators/{userId} | accessLevel: EDITOR/REVIEWER/MANAGER, owner only |

Draft fields: title, statement, inputFormat, outputFormat, constraints, explanation,
setterNotes, difficulty, checker, languages, timeLimitMs, memoryLimitMb, outputLimitKb.
Checkers are EXACT, TRIMMED_LINES and TOKENS. A suite has 1-200 tests, at most 4 MiB
combined input/expected UTF-8 data. Both sample and hidden tests are required.

At least one reference must expect ACCEPTED. Other references can expect
WRONG_ANSWER, TIME_LIMIT_EXCEEDED, MEMORY_LIMIT_EXCEEDED, COMPILATION_ERROR,
RUNTIME_ERROR or OUTPUT_LIMIT_EXCEEDED. Every reference must match its expected
verdict. Failed sealed versions must be cloned to edit and revalidate.

## Competition management

| Method | Route | Body |
| --- | --- | --- |
| GET/POST | /api/manage/competitions | Create: slug, title, durationSeconds, languages, optional mode/team/freeze/scoring settings |
| GET/PATCH | /api/manage/competitions/{id} | Private detail / edit current unsealed configuration |
| POST | /api/manage/competitions/{id}/clone-version | Clone a sealed configuration before editing |
| POST | /api/manage/competitions/{id}/problems | versionId, slot (1-based), label |
| DELETE | /api/manage/competitions/{id}/problems/{slot} | Remove from editable snapshot |
| GET | /api/manage/competitions/{id}/readiness | ready and blocking errors |
| POST | /api/manage/competitions/{id}/rehearsals | Individual: optional userIds (default organizer); team: teamIds |
| POST | /api/manage/competitions/{id}/schedule | startsAt (UTC ISO-8601), visibility PUBLIC/UNLISTED/PRIVATE |
| PUT | /api/manage/competitions/{id}/staff/{userId} | accessLevel MANAGER/JURY/TESTER, canPublish, reason; owner/super admin |
| PUT | /api/manage/competitions/{id}/invitations/{userId} | Invite a participant to a private contest |
| POST | /api/manage/runs/{runId}/control | action, reason |

Create settings include mode INDIVIDUAL/TEAM, maxTeamSize, description, rules,
wrongAttemptPenaltySeconds (default 1200), penalizeCompilationErrors (default
false), freezeBeforeEndSeconds (default 0). Editable snapshots additionally accept
registrationOpensAt and registrationClosesAt. Registration is self-service approval
before the start; configurable approval queues/advanced eligibility are not added.

Controls: pause, resume, end-rehearsal, release-standings. Official clocks are
immutable; pausing admission does not extend duration. Standings may be released
after the end. Rehearsal reset means starting another isolated rehearsal.

Launch requires approved immutable problems, passing reference validation, common
allowed languages and online official workers with matching image pins/memory.
Actual submission acceptance always checks database server time, independently of
the lifecycle scheduler. Accepted submissions continue judging after contest end.

## Participants and teams

| Method | Route | Behavior |
| --- | --- | --- |
| POST/GET | /api/teams | Create with name / list own teams |
| POST | /api/teams/{teamId}/invite | Captain rotates a seven-day invite token |
| POST | /api/teams/join | inviteToken; membership locks while registered for scheduled/running contests |
| GET | /api/competitions | Public released competitions |
| POST | /api/competitions/{id}/register | Empty body for individual or teamId for captain |
| GET | /api/me/runs | Runs the caller is an entrant of (official, rehearsal, unlisted, private), with entry_id |
| GET | /api/runs/{runId} | Metadata, serverTime; problem list withheld before start |
| GET | /api/runs/{runId}/problems/{slot} | Released statement and samples only |
| POST | /api/runs/{runId}/problems/{slot}/submissions | language, sourceCode, Idempotency-Key UUID header |
| GET | /api/submissions/{submissionId} | Own/team/jury source and safe latest judging result |
| GET | /api/submissions?run={runId}&offset=0 | Own history, 50 rows per page, with latest status, verdict, tests and time |
| GET | /api/runs/{runId}/standings | Public standings |
| GET | /api/runs/{runId}/standings?jury=true | Authorized unfrozen jury standings |
| GET | /api/runs/{runId}/events?after=0 | Monotonic event cursor; no private verdict payload |
| GET | /api/practice | Explicitly published practice |
| GET | /api/practice/{versionId} | Statement and samples |
| POST | /api/practice/{versionId}/submissions | Same submission body/header |
| GET | /api/leaderboard | Global Sigma boards: top 100 players and teams, the caller's places, cached 30 seconds. Players who submitted in practice or a public contest but have no counted solve share last place on Σ 0 |
| GET | /api/profiles/{handle} | Public profile: Sigma, rating history, activity, skills, badges, medals, contests. Public results only; never email, source or private contests |
| GET | /api/profiles/{a}/vs/{b} | Head to head: record in shared contests and problems only one of them solved |
| GET | /api/profiles/{handle}/contests/{runId}/replay | That player's rank through a finished public contest, 60 samples plus solves |
| PATCH | /api/me/profile | bio, school, country (two letters), github, codeforces; the last two are usernames, not URLs |
| GET | /api/me/rivals, /api/me/rivals/handles | Your pinned rivals with their standing / handles only (cheap, for scoreboards) |
| PUT/DELETE | /api/me/rivals/{handle} | Pin (at most 10) or unpin a rival; private to you |
| GET | /api/teams/{teamId}/profile | Members, Sigma, medals and public contest history |
| POST | /api/manage/competitions/{id}/rated | rated (boolean), reason; organizers keep a contest out of the rating. Audited |

Submission returns 202 and submissionId. Repeat the same idempotency key and body
to recover a lost response. Reusing a key with changed content returns 409.
Admission limits are administrator settings (defaults: five unfinished jobs per
user, twelve submissions per minute, 5000 queued platform-wide); see "Judging
capacity administration". Rejections return 429 and store nothing.

Poll own pending submissions every 1-2 seconds, events every 2 seconds, and
standings every 2-5 seconds. Standings computation is shared/cached for one second.
WebSocket/SSE transport is not implemented; polling is the current live-update API.
Frozen public standings exclude post-freeze verdicts/penalties until release.
Own verdicts remain visible; jury standings remain accurate.

ICPC order: solved descending, accumulated solve seconds plus applicable penalties
ascending, deterministic entry-ID tie break. Only attempts before the first
accepted submission count toward penalties; judge errors never penalize.
Rehearsal submissions never enter the official result projection.

## Communications and operations

| Method | Route | Body / access |
| --- | --- | --- |
| GET | /api/runs/{runId}/announcements | Published announcements |
| POST | /api/manage/runs/{runId}/announcements | title, body; manager |
| GET/POST | /api/runs/{runId}/clarifications | Own/team/public questions; POST question |
| POST | /api/manage/clarifications/{id}/answer | answer, public; jury |
| GET | /api/admin/users?offset=0 | Super administrator |
| PUT | /api/admin/users/{id}/roles | role, reason; additive grant, super administrator |
| PUT | /api/admin/languages/{code} | enabled, imageId, reason; super administrator |
| GET | /api/admin/judge | Jobs, worker manifests, capacity, unpublished outbox count (legacy summary) |
| POST | /api/admin/judge/workers/{id}/drain | reason; running jobs finish, new claims refused; persists across restarts |
| POST | /api/admin/judge/workers/{id}/resume | reason; clears an administrator drain |
| GET | /api/admin/languages | Language codes, enabled flag and active image |
| GET | /api/manage/runs/{runId}/submissions?offset=0 | Jury monitor: 100 rows with entrant, problem and latest verdict |
| POST | /api/manage/submissions/{id}/rejudge | reason; new generation, no source mutation |
| GET | /api/admin/audit?after=0&type=&latest=false | Append-only audit cursor with actor handle and metadata (previous/new values); latest=true returns the newest 200 |

Language enablement requires a currently online, verified worker advertising the
requested immutable imageId. Read image IDs from /api/admin/judge. Validation snapshots the selected image IDs into the immutable problem version.
Existing contests keep those snapshots during later global runtime rollouts.
New job claims must match the problem snapshot pin, worker lane, memory budget and available worker slots.

## Judging capacity administration

SUPER_ADMIN only. A slot is one submission being compiled and run at a time; it
is not a participant and not a server. Physical ceilings (JUDGE_MAX_SLOTS, per-slot
memory, lane and host memory budgets, host identity) are trusted deployment
configuration reported by workers; changing them needs a worker restart. The
settings below are desired limits and apply live, without restarting anything.
Docker sockets, images, credentials and commands are never settings.

| Method | Route | Body / result |
| --- | --- | --- |
| GET | /api/admin/judging/settings | Settings, per-lane capacity, workers, hosts, queue metrics |
| PATCH | /api/admin/judging/settings | version, reason, any of the settings below; returns the GET body |
| PATCH | /api/admin/judging/workers/{id}/settings | version (that worker's settingsVersion), reason, desiredConcurrency and/or draining |

Global settings (table judging_settings, one row):

| Setting | UI label | Range; default | Exactly what it counts |
| --- | --- | --- | --- |
| officialConcurrencyLimit | Concurrent official submissions | 0-1024 or null; null | RUNNING jobs on official-lane workers, across all workers and API instances. null = no global limit (sum of worker limits, the pre-V8 behaviour); 0 = start nothing new |
| internalConcurrencyLimit | Concurrent internal submissions | 0-1024 or null; null | RUNNING jobs on internal-lane workers: practice, rehearsals, laboratory validation, rejudges outside official runs |
| pendingSubmissionsPerUser | Pending submissions per user | 1-100; 5 | Unfinished jobs (QUEUED, RUNNING, RETRY) of submissions created by that user in any context, including rejudges and laboratory validation |
| submissionsPerMinute | Submissions per minute | 1-600; 12 | Contest and practice submissions stored for that user in the last 60 seconds. Database rolling window, exact across API instances; idempotent replays and rejected attempts do not count |
| maxQueuedSubmissions | Maximum queued submissions | 1-100000; 5000 | Platform-wide unfinished jobs (QUEUED, RUNNING, RETRY) in both lanes, including rejudges and validation. New submissions are refused at this level |

Per worker: desiredConcurrency (UI "Worker execution limit": 1 to that worker's
maxConcurrency, or null to return to the worker's JUDGE_SLOTS default) and draining
(true stops new claims; running jobs finish; persists across restarts and
re-registration until set to false).

Validation returns 400 with an explanation for unknown keys, out-of-range values,
a global limit above the sum of registered maximums of that lane's workers seen in
the last 24 hours, a worker limit above its JUDGE_MAX_SLOTS or its lane memory
budget, or an increase that makes the configured demand of all online workers on
the same host exceed that host's JUDGE_HOST_MEMORY_BUDGET_MB. Reductions are always
accepted. A missing reason is 400. A stale version is 409 because another
administrator saved first: reload, review and resubmit. Every change writes an
audit row (JUDGING_SETTINGS_UPDATE or WORKER_SETTINGS_UPDATE) with actor, timestamp,
reason and metadata {"previous": {...}, "new": {...}}.

Example request, PATCH /api/admin/judging/settings:

~~~json
{"version": 3, "reason": "Final round sizing", "officialConcurrencyLimit": 16, "internalConcurrencyLimit": 2}
~~~

GET response (abridged):

~~~json
{
  "settings": {"officialConcurrencyLimit": 16, "internalConcurrencyLimit": 2, "pendingSubmissionsPerUser": 5,
               "submissionsPerMinute": 12, "maxQueuedSubmissions": 5000, "version": 4},
  "lanes": {"official": {"configuredLimit": 16, "registeredMaximum": 16, "workerCapacity": 16,
            "effectiveCapacity": 16, "running": 9, "availableSlots": 7, "overTarget": false,
            "onlineWorkers": 1, "constraints": []}},
  "workers": [{"name": "official-1", "lane": "official", "hostId": "judge-a", "status": "ONLINE",
               "maxConcurrency": 16, "defaultConcurrency": 16, "configuredConcurrency": null,
               "effectiveConcurrency": 16, "running": 9, "availableSlots": 7, "reportedActive": 9,
               "slotMemoryMb": 1024, "constraints": [], "settingsVersion": 1}],
  "hosts": [{"hostId": "judge-a", "memoryBudgetMb": 20480, "configuredDemandMb": 18432,
             "reservedMb": 9216, "overcommitted": false,
             "budgetSource": "configured (JUDGE_HOST_MEMORY_BUDGET_MB), not measured"}],
  "queue": {"databaseJobs": {"official": {"queued": 84, "retry": 0, "running": 9}},
            "unpublishedDispatchIntents": {},
            "broker": {"available": true, "official": {"readyMessages": 80, "consumers": 16},
                       "unacknowledgedMessages": null}}
}
~~~

registeredMaximum is the sum of online workers' hard maximums; workerCapacity is
the sum of their effective limits (0 while drained); effectiveCapacity is
min(global limit, workerCapacity). Host memory budgets can lower actual claims
further and appear as HOST_MEMORY constraints. constraints explain every reduction
(OFFLINE, DRAINING, CEILING, LANE_MEMORY, HOST_MEMORY, GLOBAL_LIMIT,
WORKER_CAPACITY, PAUSED, NO_WORKERS, OVER_TARGET). OVER_TARGET means more jobs are
running than the new limit: they finish normally and nothing new starts until the
count is below the limit.

Queue metrics keep their sources apart. databaseJobs are PostgreSQL judging_jobs
rows, the source of truth. unpublishedDispatchIntents are outbox rows not yet
confirmed by RabbitMQ. broker.readyMessages are RabbitMQ messages waiting for a
consumer. Unacknowledged broker messages need the RabbitMQ management API and are
reported as null rather than estimated.

### Changes in V9: administrator-set worker counts

desiredConcurrency accepts 1-256 for any worker, including values above its
JUDGE_MAX_SLOTS, lane memory budget, detected CPU cores or detected memory. Such
values are saved and applied live; the response and the worker view return
`warnings` (also stored in the audit metadata) instead of a 400. Workers report
detectedCpus and detectedMemoryMb at registration. A global lane limit above the
current worker capacity is also accepted with a warning; effectiveCapacity stays
min(limit, worker slots). Host memory budgets are advisory warnings and no longer
block claims. Global and per-worker limits are still enforced exactly at claim time.

### Users, participants and languages

| Method | Route | Body / result |
| --- | --- | --- |
| POST | /api/admin/users/bulk | reason, users: [{email, handle, displayName?, role? (PARTICIPANT/MODERATOR/ADMIN), password?}] up to 300; per-row result with generated password shown once |
| POST | /api/manage/competitions/{id}/participants | users: [handle or email] up to 1000; individual contests before the start; per-row REGISTERED / ALREADY_REGISTERED / NOT_FOUND / INACTIVE |
| GET | /api/manage/competitions/{id}/participants | Registrations with handle, name, email or team |
| GET | /api/languages | code, display_name, enabled (any signed-in user) |

## Scoring systems (V10)

Contests choose `scoringSystem` at creation (POST /api/manage/competitions) or while
editable (PATCH): ICPC (default), IOI, CODEFORCES or ATCODER. Attach problems with an
optional `points`; defaults are IOI 100 each, Codeforces 500/1000/1500..., AtCoder
100/200/300.... IOI submissions run every test so partial points are exact; other
systems stop at the first failed test. GET /api/runs/{runId}/standings returns
`scoring`, `standings` rows (rank, entry, solved, score, penaltySeconds, problems
with solved/attempts/solveSeconds/frozen/score), `entries` with team `members`,
`problems` with effective points, and `problemStats` (solved/tried per problem).

GET /api/submissions/{id} also returns `cases`: test number, sample flag, verdict,
time and memory per test in order (verdict null = not run). Test data is never
returned. GET /api/submissions?run= returns every team member's submissions for team
entries, with `submitted_by_handle`. GET /api/teams includes `members` and `locked`.

## Trusted worker protocol

Only WORKER_TOKEN authenticates /internal/judge/**; participant bearer tokens do
not grant worker access. Keep these routes inside a private service network.

- POST /internal/judge/workers: name, capacity (hard maximum, JUDGE_MAX_SLOTS 1-32),
  runtimes manifest (lane, maxMemoryMb, per-language verified/imageId), and optional
  defaultConcurrency (JUDGE_SLOTS), laneMemoryBudgetMb, hostId, hostMemoryBudgetMb.
  Re-registration updates these trusted facts only; it never changes the saved
  desired concurrency or drain state. Reply: workerId plus the control block below.
- POST /internal/judge/workers/{id}/heartbeat: optional active/target counters.
  Reply (control block): desiredConcurrency (effective target, 0 while draining),
  draining, maxConcurrency, settingsVersion. 409 means the worker was marked offline
  and must register again.
- POST /internal/judge/jobs/{id}/claim: workerId, dispatchSequence. 200 claimed;
  204 stale, duplicate or not claimable (acknowledge the delivery); 429 the job is
  claimable but lane, worker or host capacity is full (keep the delivery and retry);
  409 the worker is offline or draining (requeue the delivery). A delivery whose
  sequence is not newer than the job's current sequence may claim it once; status,
  availability and lease fencing prevent duplicate execution after a redispatch.
- POST /internal/judge/jobs/{id}/heartbeat: workerId, leaseToken.
- POST /internal/judge/jobs/{id}/complete: workerId, leaseToken, verdict, cases, resource metrics.

A claim receives source, exact sealed tests/checker/limits and a random lease token.
Every result write is fenced by worker/token/expiry. ACCEPTED requires one accepted
result for every expected case. Only committed results are acknowledged in RabbitMQ.
