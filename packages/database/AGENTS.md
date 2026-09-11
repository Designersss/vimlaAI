# packages/database — Codex guidance

This file extends the root `AGENTS.md` for Prisma/PostgreSQL work.

## Persistence invariants
- PostgreSQL is authoritative for users, sessions, payments, subscriptions, usage, AI request accounting, Admin permissions/audit state, durable notifications and other durable business state.
- Use versioned Prisma migrations. Never rewrite already-applied historical migrations.
- Never replace production migration history with `db push`.
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
- Prefer additive, reversible changes.
- For a new unique/not-null/check constraint, consider existing data and deployment ordering.
- Do not silently drop or mutate historical user data to make a migration pass.
- Production-impacting destructive changes require explicit task approval and recovery/rollback consideration.

Read `.cursor/rules/30-database.mdc`, `40-billing-usage.mdc`, `70-security.mdc` and `80-testing.mdc` where relevant.
