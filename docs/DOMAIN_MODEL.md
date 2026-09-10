# Vimla — Domain Model

This document defines concepts, not final Prisma syntax.

## User
Owns conversations, files, projects, subscriptions and usage buckets. `User.id` is the canonical identity. Email/password credentials live in Better Auth `account` rows. `emailVerified` is false until a valid email OTP. `phoneNumber` is canonical E.164 and unique when set; `phoneNumberVerified` is true only after SMS OTP while authenticated.

## UserPreference
Separate from Better Auth `User`. Stores UI/locale settings (`locale`, optional IANA `timezone`, timestamps). Timezone is written only after explicit confirmation. Numeric offsets are rejected. Phase 6.5 stores reminder channel preferences: `reminderInAppEnabled` (default true) and `reminderEmailEnabled` (default false). Email stays off until the user opts in with a verified address. See `docs/NOTIFICATIONS.md`.

## Plan / PlanVersion
`Plan` is stable identity (`LITE`, `START`, `PRO`, `FREE`, draft `T199`/`T499`/`T999`). `PlanVersion` snapshots commercial values. Lifecycle: `DRAFT` (editable, not sellable) → `PUBLISHED` (immutable commercial fields) → `RETIRED` (not sellable; historical payments remain valid). Price changes insert a new version.

`providerBudgetMicroRub` is the monthly AI usage grant, not revenue. `EffectivePlanResolver` returns the ACTIVE paid subscription's version, otherwise the published `FREE` version. FREE does not create a fake Subscription.

`PlanEntitlement` is a typed registry (unknown keys rejected). Unlimited is `{ unlimited: true }`, never `-1`. Canonical project keys: `projects.ownedActiveMax`, `projects.externalActiveMax`, `projects.membersPerOwnedProjectMax`. Historical `projects.max` / `projects.membersPerProject` remain readable on old PlanVersions; new drafts reject them. Projects tables are not implemented in Phase 5.

## Project policy (documented, not implemented)

Owner plan determines project capability. A paid participant cannot rescue a project, there is no automatic ownership transfer, and billing never falls back to another member.

When the owner's paid plan ends, effective plan is FREE. The most recently meaningfully active owned project stays ACTIVE; other owned projects become `PLAN_LOCKED` (read-only for every member). No project data is deleted. Selection uses backend activity ordering, not UI list position.

In the remaining Free owned project, owner + the most recently active other member stay ACTIVE; other memberships become `READ_ONLY_BY_OWNER_PLAN`. External memberships beyond `projects.externalActiveMax` become `READ_ONLY_BY_MEMBER_PLAN`. Memberships are never auto-removed.

AI initiated by User A spends User A's Usage unless a future explicit `PROJECT_USAGE` mode is selected. Anti-churn knobs (creation window/limits, reallocation cooldown, trash retention) live on `BusinessGuardrailVersion`, not on Plan entitlements.

## AdminPrincipal / AdminSession / AdminAuditLog
Privileged identity is an explicit `AdminPrincipal` (OWNER today) plus hashed `AdminSession`. `AdminAuditLog` is append-only.

## TopupPolicyVersion / fee policies / PaymentEconomics
Published `TopupPolicyVersion` is production truth for min/max/ratio (`.env` is bootstrap fallback only). Checkout snapshots store `topupPolicyVersionId` + ratio. **TOPUP does not expire.**

`PaymentFeePolicyVersion` and `FiscalizationFeePolicyVersion` are versioned merchant-cost assumptions (`ESTIMATE` / `UNVERIFIED` / `VERIFIED`). Missing fee policy never blocks Usage fulfillment; `PaymentEconomics.economicsStatus` becomes `RECONCILIATION_REQUIRED`.

Estimated fees (ceil bps) and actual reconciled fees are stored separately and never added together. `FinanceQueryService` is internal (no public `/v1/finance`). AI COGS is `AiRequest.providerActualCostMicroRub`, not `userSettledUsageMicroRub`.

## Subscription
References the purchased plan version and current billing period/status (`ACTIVE`, `CANCELED`, `EXPIRED`). One active subscription per user.

## Payment
Represents a customer payment intent/result. Contains provider IDs, `providerOrderId`, domain status, raw `providerStatus`, amount, currency, purpose (`SUBSCRIPTION`, `TOPUP`), immutable `checkoutSnapshot`, and optional `idempotencyKey`. Domain statuses: `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `RECONCILIATION_REQUIRED`. Amounts and plan versions are resolved server-side. `billingSubjectType` is `USER` today (future Project billing subjects stay in the application layer).

## PaymentEvent
Stores processed provider webhook/event identity `(provider, providerEventId)` to prevent duplicate effects. Payload is sanitized (no PAN/Token/password). Fingerprint is computed only after signature verification.

## UsageBucket
Authoritative pool of spendable provider-cost allowance.

Types:
- `MONTHLY` — created for a paid subscription period, expires at period end;
- `TOPUP` — created after a succeeded top-up payment. **Never expires** (`expiresAt` MUST be NULL). No 3-month, 90-day, or activity-based expiry. Remaining top-up is outstanding AI obligation until spent or compensating refund accounting.

Invariant: `spentMicroRub + reservedMicroRub <= totalMicroRub`. Unique `(sourceType, sourceId)` prevents duplicate grants from the same payment or subscription.

PostgreSQL CHECK `usage_bucket_topup_never_expires` rejects TOPUP rows with a non-null `expiresAt`.

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

## WorkspaceObject
Personal (Phase 6) owned row for `TASK`, `REMINDER`, `LIST`, or `NOTE`. `scopeType` is `PERSONAL` only. Child tables hold kind-specific fields. Soft delete uses `deletedAt`; archive uses `archivedAt`. Source conversation/message IDs are server-only provenance for a later `@Vimla` writer. Phase 8 may add PROJECT scope with a real project FK; do not store a dangling `projectId` now. See `docs/PERSONAL_WORKSPACE.md`.

Reminders store schedule data (`PENDING` / `CANCELED` / `DELIVERED` / `FAILED`). Delivery is Phase 6.5: see `docs/NOTIFICATIONS.md`. PostgreSQL `notification_delivery` / `user_notification` are source of truth; Redis is transport only.

## GenerationJob
Persistent async image/video/agent job state. Queue IDs are execution references, not source of truth.

## ProviderAccountSnapshot
Operational treasury data such as ProxyAPI balance at a point in time. Never used as user allowance.
