# packages/database — Engineering guidance

> **Current product/platform inheritance:** new CommunicationSurface/ClientInstallation/realtime-sync/channel/group/project models must be clean, constraint-backed and platform-neutral; additive-only evolution is not required before a real deployed-data boundary exists. Do not encode Next/Desktop/Mobile presentation in persistence. PostgreSQL remains durable truth for sync/outbox state. See #78/#79/#80.


This file extends the root `AGENTS.md` for Prisma/PostgreSQL work.

## Persistence invariants
- PostgreSQL is authoritative for users, sessions, payments, subscriptions, usage, AI request accounting, Admin permissions/audit state, durable notifications and other durable business state.
- Before first real deployment/data boundary, development migrations may be rewritten/squashed to match the clean target schema; reset dev/test DBs consistently.
- Do not retain obsolete columns/tables/backfills solely for self-compatibility.
- After a migration crosses a real deployed/shared data boundary, treat it as immutable and use forward versioned migrations.
- Never replace real production migration history with `db push`.
- Add DB constraints/unique indexes/checks/partial indexes when they materially protect invariants.
- Financial values use PostgreSQL `BIGINT` and TypeScript `bigint`.
- Raw SQL must be parameterized. Avoid unsafe interpolation with untrusted values.
- Never cascade-delete financial/audit history merely because a user/resource is removed.
- Append-only financial/audit records are corrected with compensating entries.

## Concurrency
- Critical count/limit/idempotency invariants must survive multiple API replicas and parallel requests.
- Use explicit transactions, row/advisory locking, isolation or durable unique constraints as appropriate.
- Do not replace durable concurrency controls with in-memory locks.
- Add integration tests against real PostgreSQL for concurrency/constraint behavior.

## Migration discipline
- Prefer the simplest correct schema transition for the actual deployment state. Pre-production cleanup may be destructive to development data; deployed data requires forward/recoverable changes.
- For a new unique/not-null/check constraint, consider existing data and deployment ordering.
- Do not silently destroy data behind a real deployed/shared boundary. Development/test data has no preservation requirement unless the task explicitly establishes one.
- Production-impacting destructive changes require explicit task approval and recovery/rollback consideration.

Read `.cursor/rules/30-database.mdc`, `40-billing-usage.mdc`, `70-security.mdc` and `80-testing.mdc` where relevant.
