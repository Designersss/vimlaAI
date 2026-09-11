# Codex Instructions — Billing

Scope: `packages/billing/**`.

Before editing, read:
- `.cursor/rules/40-billing-usage.mdc`
- `.cursor/rules/41-payments.mdc`
- `.cursor/rules/30-database.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Billing correctness and auditability outrank convenience.

Rules:
- `1 RUB = 1_000_000 microRUB`; use bigint end-to-end for authoritative money.
- Never use browser/client prices, grants, provider costs, statuses or user IDs as authority.
- Preserve reservation-first provider spending and append-only ledger semantics.
- Duplicate requests/webhooks/retries must not grant or charge twice.
- `spent + reserved <= total` must hold under concurrency.
- TOPUP usage is non-expiring unless a future explicit product decision changes policy.
- Historical plan/price/policy versions are immutable facts; create new versions rather than rewriting history.
- Payment confirmation comes from verified provider state, never redirect/UI claims.
- Refunds/corrections use explicit compensating accounting.
- Ambiguous outcomes become reconciliation/anomaly/hold states rather than optimistic success/free release.
- Avoid external payment/provider network calls while holding broad/long DB locks; split durable state transitions from I/O when possible.
- Financial changes require concurrency/idempotency integration tests and auditability review.
