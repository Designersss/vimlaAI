# packages/billing — Codex guidance

This file extends the root `AGENTS.md` for billing, subscriptions, usage reservations and ledger logic.

## Money and accounting
- `1 RUB = 1_000_000 microRUB`.
- Authoritative money uses PostgreSQL `BIGINT` / TypeScript `bigint` only.
- Never use JS floating point for authoritative monetary values.
- Customer payment, retail price, user allowance, provider COGS, user-settled usage and corporate provider balance are distinct concepts.

## Reservation protocol
Every provider-consuming action must preserve the reservation protocol:
1. conservatively estimate maximum cost;
2. atomically reserve usage in PostgreSQL;
3. reject before provider call if reserve fails;
4. call provider;
5. capture actual cost/usage;
6. settle actual user usage;
7. release unused reservation;
8. retain anomaly/reconciliation state for ambiguous provider outcomes.

Never replace this with `check -> provider -> deduct`.

## Concurrency / idempotency
- `spent + reserved <= total` must hold under parallel requests.
- Payment events, reservations, settlement/release and grants must be idempotent.
- Duplicate events must never grant/charge twice.
- Ambiguous outcomes must not be blindly released as free usage.
- Use durable PostgreSQL constraints/transactions/locks as appropriate.

## Ledger / historical state
- Ledger is append-only; corrections use compensating entries.
- Historical plan/price/allowance versions must not be silently recalculated or rewritten.
- Non-expiring top-up buckets remain non-expiring unless product policy is explicitly changed.

Financial changes require real-PostgreSQL integration regression tests, including duplicate/replay/concurrent paths.

Read `.cursor/rules/40-billing-usage.mdc`, `41-payments.mdc`, `30-database.mdc`, `70-security.mdc`, and relevant finance docs before editing.
