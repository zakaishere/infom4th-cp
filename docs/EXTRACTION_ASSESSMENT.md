# Extraction assessment and implementation status

Source reference: ../backend (original PFE), preserved unchanged.
Requirements reference: ../../promtp.txt.
Updated 2026-10-25 for the RabbitMQ backend implementation.

The original backend supplies competition, asynchronous judging and identity
concepts, but its academic entities and unsafe execution implementation were not
copied into the standalone runtime. The standalone database foundation is retained
and upgraded through V5-V7, with resource-scoped APIs implemented above it.

## Reused concepts

- Compile once and judge asynchronously.
- Problems with public samples and private hidden cases.
- Solo/team contests and server-controlled timing.
- Live status/standings events, now available through cursor/polling APIs.
- PostgreSQL and Spring Security concepts without Student/Teacher/module coupling.

## Replaced defects

- Publish-before-commit became an atomic outbox plus RabbitMQ confirms.
- Long-running worker transactions became short leased claims/result commits.
- Stdout marker parsing became separate process exit/resource/control channels.
- Incorrect interpreter timeouts and unbounded output became external deadlines
  and bounded streaming.
- Generic public submission/result access became authenticated owner/team/jury APIs.
- Hidden expected-output feedback is not included in participant responses.
- Point-decay/order-dependent scoring became deterministic timestamp-based ICPC.
- Mutable problem associations became sealed snapshots and explicit rejudging.
- Shared academic/planning execution became distinct contest/lab/practice contexts.

## Current architecture

A modular Spring Boot/JDBC API serves identity, laboratory, contest, scoring,
communications and operations. PostgreSQL stores state, snapshots and dispatch
intents. RabbitMQ durable per-language queues have separate official/internal
lanes. Independent Python/Linux workers execute disposable hardened Docker cases
and report fenced results through private authenticated HTTP endpoints.

The earlier proposal to use only PostgreSQL queue polling is superseded by the
explicit RabbitMQ requirement. PostgreSQL remains the durable source of truth for
dispatch recovery, not a replacement for the broker.

See README and docs/OPERATIONS.md for what has been tested and the remaining
runtime/load/security gates. No frontend or production deployment is claimed.
