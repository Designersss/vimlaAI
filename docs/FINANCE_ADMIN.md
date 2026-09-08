# Finance Admin

Admin finance UI is a presentation layer over Phase 4.5 `FinanceQueryService` and `TariffEconomicsSimulator`. It does not reimplement money math. Integer microRUB / BPS remain authoritative.

## KPIs

Shown with quality badges `ACTUAL` / `ESTIMATED` / `PARTIAL` / `UNKNOWN`:

Gross revenue, refunds, chargebacks, net sales, payment costs, fiscalization costs, actual AI COGS, outstanding monthly usage, **top-up outstanding**, expired monthly usage, realized contribution, conservative contribution, realized/conservative margin.

Do not label contribution as net profit. Tax reserve is an estimate, not a tax-authority result.

## Top-up

TOPUP never expires (`expiresAt` is always NULL). Admin has no expiry / inactivity / calendar-timer field. Unspent top-up remains an obligation until consumed, refunded, or explicitly compensated by a future append-only operation.

## Tariffs

PlanVersion lifecycle: DRAFT → PUBLISH → RETIRE. Published commercial fields are immutable (DB trigger). New prices require a new version. Negative or below-target margin publish requires recent step-up, explicit acknowledgement, reason, typed plan code, and an audit row.

Canonical project entitlements (schema only; Projects are not implemented):

- `projects.ownedActiveMax`
- `projects.externalActiveMax`
- `projects.membersPerOwnedProjectMax`

Deprecated `projects.max` / `projects.membersPerProject` remain readable on historical versions and are rejected on new drafts.

Anti-churn knobs (`projectCreationWindowDays`, creation limits, reallocation cooldown, trash retention) live on `BusinessGuardrailVersion`, not on Plan entitlements. Seeded values are UNVERIFIED; do not invent production numbers.

## Project policy (documented now, not implemented)

- Owner plan determines project capability. A paid participant cannot rescue a project.
- No automatic ownership transfer and no billing fallback to another member.
- Downgrade to FREE: most recently meaningfully active owned project stays ACTIVE; others `PLAN_LOCKED` (read-only for all members). No data deletion.
- In the remaining Free owned project: owner + most recently active other member stay ACTIVE; other memberships `READ_ONLY_BY_OWNER_PLAN`.
- External memberships beyond `externalActiveMax` become `READ_ONLY_BY_MEMBER_PLAN`.
- AI usage is billed to the initiating user unless a future explicit `PROJECT_USAGE` mode is selected.

## Merchant / accounting values still required from the owner

Real T-Bank CARD / SBP / T-Pay fees, fiscalization cost, tax regime, final 199/499/999 monthly AI grants, `targetMinimumMarginBps`, 499/999 `externalActiveMax`, production anti-churn numbers. Until verified, Admin must show that real fees are not configured rather than invent a percentage.

## Reporting timezone

Aggregations store UTC and group by `ADMIN_REPORTING_TIMEZONE` (default `Europe/Moscow`). Admin date filters send an explicit IANA timezone. Overview presets (today / 7 / 30 / custom) are calendar bounds in that timezone.

## CSV export

Bounded CSV for payments and finance aggregates is Phase 5.x. Phase 5 keeps server-side pagination and on-screen exact totals.

## Reconciliation writes

Phase 5 reconciliation is inspect-only. There is no balance editor. Future compensating operations must be permissioned, step-up gated, reasoned, idempotent, and audited.
