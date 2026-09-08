# Vimla — Domain Model

This document defines concepts, not final Prisma syntax.

## User
Owns conversations, files, projects, subscriptions and usage buckets. `User.id` is the canonical identity. Email/password credentials live in Better Auth `account` rows. `emailVerified` is false until a valid email OTP. `phoneNumber` is canonical E.164 and unique when set; `phoneNumberVerified` is true only after SMS OTP while authenticated.

## UserPreference
Separate from Better Auth `User`. Stores UI/locale settings (`locale`, timestamps). Timezone and other preferences can be added later without stuffing Better Auth user fields.

## Plan / PlanVersion
`Plan` is stable identity (`LITE`, `START`, `PRO`). `PlanVersion` snapshots commercial values for a time range so old subscriptions remain auditable.

Fields:
- retail price microRUB;
- provider-cost allowance microRUB;
- provider-cost ratio in basis points (20% = 2000);
- validFrom / validTo.

## Subscription
References the purchased plan version and current billing period/status (`ACTIVE`, `CANCELED`, `EXPIRED`). One active subscription per user.

## Payment
Represents a customer payment intent/result. Contains provider IDs, amount, currency, purpose (`SUBSCRIPTION`, `TOPUP`), status (`PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`). Amounts and plan versions are resolved server-side.

## PaymentEvent
Stores processed provider webhook/event identity `(provider, providerEventId)` to prevent duplicate effects.

## UsageBucket
Authoritative pool of spendable provider-cost allowance.

Types:
- `MONTHLY` — created for a paid subscription period, expires at period end;
- `TOPUP` — created after a succeeded top-up payment, non-expiring in Phase 2.

Invariant: `spentMicroRub + reservedMicroRub <= totalMicroRub`. Unique `(sourceType, sourceId)` prevents duplicate grants from the same payment or subscription.

## UsageReservation
Temporary hold for a pending provider-consuming operation.

States:
- `ACTIVE`;
- `SETTLED`;
- `RELEASED`;
- `ANOMALY` (actual cost exceeded estimate and extra usage was unavailable).

`requestId` is unique per user for idempotency.

## UsageReservationAllocation
One reservation may consume several buckets. Allocations are created at reserve time and reused at settle; they are not recomputed after the provider call.

## UsageLedgerEntry
Append-only event describing authoritative usage movement.

Types:
- `BUCKET_GRANTED`;
- `TOPUP_GRANTED`;
- `RESERVATION_CREATED`;
- `USAGE_SETTLED`;
- `RESERVATION_RELEASED`;
- `ADJUSTMENT`.

Sign convention: grants are positive microRUB, settled usage is negative. PostgreSQL rejects UPDATE/DELETE on this table; corrections are new compensating rows.

## AiModel / AiModelPriceVersion
Curated catalog identity (`slug`, `displayName`, `providerModelId`) plus versioned token prices in microRUB per million. A model is user-visible only when `active`, `visible`, and a current price version exists. Price changes insert a new version; historical rows are not edited.

## AiRequest
Metered provider-facing text operation. Provider `status` and `financialStatus` are separate state machines. Unique `(userId, clientRequestId)`.

Provider status: `CREATED`, `RESERVED`, `PROVIDER_STARTED`, `STREAMING`, `SUCCEEDED`, `FAILED`, `RECONCILIATION_REQUIRED`.

Financial status: `NONE`, `RESERVED`, `SETTLED`, `RELEASED`, `ANOMALY`, `RECONCILIATION_HOLD`.

Stores `providerActualCostMicroRub` (full COGS, always retained when known) and `userSettledUsageMicroRub` (what buckets could cover). `providerRequestId` stores ProxyAPI `X-Request-ID` for support/reconciliation, not for the browser.

## Conversation / Message
User-owned chat history. Roles in Phase 3: `USER`, `ASSISTANT`. The API builds provider context from PostgreSQL; the browser never submits a `messages[]` array or system prompt.

## GenerationJob
Persistent async image/video/agent job state. Queue IDs are execution references, not source of truth.

## ProviderAccountSnapshot
Operational treasury data such as ProxyAPI balance at a point in time. Never used as user allowance.
