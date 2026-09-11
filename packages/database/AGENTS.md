# Codex Instructions — Database

Scope: `packages/database/**`.

Before editing, read:
- `.cursor/rules/30-database.mdc`
- `.cursor/rules/40-billing-usage.mdc` for financial schema
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- PostgreSQL is authoritative for durable and financial state.
- Historical applied migrations are immutable. Add a new migration; never rewrite applied SQL.
- Never replace migration history with `prisma db push` for production paths.
- Money uses `BIGINT` / `bigint` microRUB.
- Use DB constraints, unique/partial indexes and checks to protect critical invariants where appropriate.
- For concurrency-critical behavior, use explicit transactions/locks/isolation and prove it with integration tests.
- Raw SQL must be parameterized; avoid unsafe interpolation.
- Do not cascade-delete financial/audit evidence for convenience.
- Preserve append-only ledger/audit semantics.
- Destructive migrations require an explicit task, rollout/backfill/recovery plan and review.
- Test DBs must remain isolated from staging/production.
