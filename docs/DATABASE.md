# Database design

Independent PostgreSQL 17 database cp_platform, UUID identifiers and timestamptz
clocks, upgraded through additive Flyway migrations. The academic schema/data is
neither imported nor modified.

| Migration | Contents |
| --- | --- |
| V1 | Users, roles, permissions, hashed refresh credentials and disabled runtime catalog |
| V2 | Private problems, immutable versions/assets, tests, references, validations and practice publication |
| V3 | Contest snapshots, teams, registrations, official/rehearsal runs and membership snapshots |
| V4 | Immutable submissions, jobs/leases, results, private case results, communications and audit |
| V5 | Access/reset credentials, refresh families, non-contest execution contexts, atomic judge outbox, team invites and event cursors |
| V6 | Runtime image pins, private participant invitations and database-clock submission admission |
| V7 | Immutable per-problem runtime image snapshots captured during validation |
| V16 | Profile fields, the per-contest rated switch, saved final contest results and private rivals |
| V17 | Administrator benchmarks: benchmark_runs, the BENCHMARK submission context and the private problem flag |

Official submissions bind the submitting user, entry, run and exact problem snapshot
through composite foreign keys. Laboratory/practice submissions explicitly have no
contest run. Laboratory submissions bind a reference solution and validation to the
same problem version. No fake official run is used to execute internal work.

Submission source/identity and sealed problem/contest assets are immutable.
Later edits create a cloned version. A competition has one official run and any
number of independent rehearsals. Snapshot memberships prevent global team edits
from changing historical scoring; active registered teams also lock joins.

Every new/retried judging job atomically creates one judge_outbox row keyed by job
and dispatch sequence. A publish may repeat after a crash; worker claims, leases,
result uniqueness and generations make that safe. RabbitMQ is the work transport,
while PostgreSQL retains authoritative intent and results.

Workers claim by job ID with conditional updates and a per-worker capacity lock.
Each active lease has a random token, expiry and worker. Completion verifies all
three; no database transaction spans compilation, execution or broker confirmation.
Expired leases retry with bounded attempts. Rejudging creates another generation;
standings retain the latest completed generation while a new one is pending.

official_submission_results excludes rehearsals. The ICPC scorer additionally uses
run-specific submissions and original server timestamps. Public freeze projections
exclude post-freeze results; jury views do not. Judge errors never add penalties.
The INSERT admission trigger checks the real database clock and pause/end state
under a shared run lock and replaces client-supplied contest timestamps.

Database constraints supplement service authorization, readiness, language
availability and result completeness. Hidden test data remains private persistence
data. Only explicit participant DTOs reach public APIs.

Runtime image pins are captured before a problem version is sealed. Later global
runtime changes cannot silently replace that version's compiler/interpreter.
Keep workers for old image IDs available while contests using them are active.

contest_results saves final results of public contests whose scoreboard is released.
It is derived data, rebuilt automatically when a rejudge changes a verdict. The rating
is not stored: it is replayed from these rows in contest order, so a rejudge or a change
to a contest's rated switch flows through by itself. Sigma is calculated the same way.

V1-V4 were preserved. Never edit deployed migrations or use Flyway clean. Back up
persistent volumes before upgrading and use separate migration/runtime accounts
for deployment. Compose's development database owner is not a production privilege
model. No source-project users or passwords are automatically migrated.
