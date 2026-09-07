# Vimla — Architecture

## Monorepo

```text
vimla/
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    database/
    config/
    auth/
    ai/
    billing/
    shared/
  .cursor/rules/
  docs/
```

## Runtime components

```text
Client
  |
Cloudflare/CDN (later/production)
  |
Next.js web
  |
Node/NestJS API
  |-----------------------|
  |           |           |
PostgreSQL   Redis      Object Storage
              |
            BullMQ
              |
            Worker
              |
          AI Gateway
              |
         ProxyAPIProvider
              |
           ProxyAPI
```

## Authentication
Phase 1 uses self-hosted Better Auth (email/password, database-backed HttpOnly cookie sessions). The API is the auth authority; the browser is not.

```text
Browser
  -> Vimla Web (`/sign-in`, `/sign-up`, `/app`)
  -> Vimla API `/api/auth/*`
  -> Better Auth (`@vimla/auth`)
  -> PostgreSQL (`user`, `session`, `account`, `verification`)

Protected Vimla routes:
  AuthGuard -> Better Auth getSession -> AuthenticatedUser.id
  GET /v1/me
```

`User.id` is the canonical identifier for later billing, usage, conversations and generations. Public routes such as `GET /health` stay unauthenticated.

## Core synchronous chat flow

```text
1. authenticate user
2. authorize account/resource
3. validate request/model
4. resolve plan/buckets
5. estimate maximum provider cost
6. reserve allowance transactionally
7. create ai_request record
8. call AI Gateway -> ProxyAPIProvider
9. stream response through Vimla
10. capture final usage/cost
11. settle actual charge and release unused reservation
12. persist message/result
13. emit metrics/logs
```

Provider call must never happen before step 6 succeeds.

## Async generation flow

```text
HTTP request
 -> validate/auth
 -> estimate/reserve usage
 -> create generation_job in PostgreSQL
 -> enqueue BullMQ job
 -> 202 Accepted + job id

Worker
 -> load job + reservation
 -> invoke AI gateway
 -> poll/await provider
 -> persist output to object storage
 -> settle usage
 -> mark job completed
```

## Financial state
PostgreSQL tables/domains will include:
- plans + plan_versions;
- subscriptions;
- payments + payment_events;
- usage_buckets;
- usage_reservations;
- usage_ledger;
- ai_requests;
- provider_cost_records;
- provider_balance_snapshots.

## Monetary representation
Use microRUB integers:

```text
1 RUB = 1,000,000 microRUB
```

Database: `BIGINT`.
Domain TypeScript: `bigint`.
Public JSON: decimal string or explicit amount DTO.

Do not use floats for authoritative calculations.

## Usage buckets
### Monthly subscription bucket
- created per billing period;
- expires at period end;
- provider-cost allowance derived from the plan version;
- used before top-up.

### Top-up bucket
- created after confirmed top-up payment;
- separate from subscription;
- default non-expiring unless product policy changes;
- retail amount and provider-cost budget are distinct values.

## Reservation/settlement
Reservation protects against concurrency/overspend.

```text
available = bucket total - settled charges - active reservations
```

Reservation must be atomic across concurrent requests. Settlement converts reserved amount into actual charge and releases the difference.

## Billing and usage (Phase 2)

Money is integer microRUB (`bigint` / PostgreSQL `BIGINT`). 1 RUB = 1,000,000 microRUB. JSON uses decimal strings. Redis is never authoritative for money, usage, reservations or payments.

### Versioned plans
`Plan` is stable identity (`LITE`, `START`, `PRO`). `PlanVersion` snapshots `priceMicroRub`, `providerBudgetMicroRub` and `providerCostRatioBps`. Historical subscriptions keep the version they bought.

Seed (idempotent `pnpm db:seed`):
- Lite 150 RUB / 30 RUB provider budget / 2000 bps
- Start 300 RUB / 75 RUB / 2500 bps
- Pro 990 RUB / 297 RUB / 3000 bps

### Subscriptions and payments
A subscription references one `PlanVersion` and a 30-day period (configurable). Statuses: `ACTIVE`, `CANCELED`, `EXPIRED`. At most one `ACTIVE` subscription per user (partial unique index).

Payments are created server-side. Grants happen only after a verified `PaymentEvent`. Unique `(provider, providerEventId)` makes duplicate/replay events a no-op. Browser "I paid" is never trusted.

`MockPaymentProvider` exists only for `local`/`test`. HTTP helpers `POST /dev/mock-purchases/*` are not registered when `APP_ENV` is staging or production.

### Usage buckets
Types: `MONTHLY` (expires at period end) and `TOPUP` (`expiresAt` null). CHECK constraint: `spent + reserved <= total` and all amounts `>= 0`.

Top-up provider budget:

```text
floor(amountMicroRub * 3500 / 10000)
```

Integer division truncates toward zero. Vimla never rounds up. Min/max top-up amounts are centralized config.

### Reservation protocol
`reserveUsage` → (future provider call) → `settleUsage` / `releaseUsage`.

A reservation may allocate across several buckets (`UsageReservationAllocation`). Priority: active MONTHLY first, earlier `expiresAt` first, then TOPUP. Expired MONTHLY buckets are ignored.

Idempotency: `(userId, requestId)` is unique. Repeat settle/release with the same outcome is safe. A second settle with a different amount is a conflict.

If actual cost exceeds the estimate, the engine tries to reserve the difference in the same transaction. If that fails it settles only the reserved amount, marks the reservation `ANOMALY`, and logs a financial incident. It never creates a negative balance.

### Concurrency
Transactions use PostgreSQL `READ COMMITTED` plus `SELECT ... FOR UPDATE` on the user's buckets (and the payment/reservation row being processed). Reserve locks only unexpired buckets. Settle/release also lock buckets already allocated to that reservation, even if they expired while the reservation was active, so holds cannot get stuck. Bounded retry (3 attempts, exponential backoff + jitter) only for deadlock/serialization failures. Exhausted retries fail closed: the request is rejected, no provider call.

### Ledger
`UsageLedgerEntry` is append-only. A PostgreSQL trigger rejects `UPDATE`/`DELETE`; corrections are new `ADJUSTMENT` entries. Sign convention: grants are positive, settled usage is negative, reservation holds/releases are type-tagged with amounts in metadata. Each bucket is unique on `(sourceType, sourceId)` so a payment/subscription cannot grant twice even if application logic is retried.

### Derived usage
`GET /v1/usage` is authenticated and uses `AuthenticatedUser.id` only. Percentage uses `committed = spent + reserved` so in-flight work moves the meter.

## AI abstraction (Phase 3)

```text
Chat / TextChatService
  -> VimlaAiGateway
  -> AiProvider
       -> ProxyApiProvider | MockAiProvider
  -> ProxyAPI POST /v1/chat/completions
```

The browser sends only an internal Vimla `modelId`. The API resolves `AiModel` + active `AiModelPriceVersion` and the server-owned `providerModelId`. Curated catalog seed, never auto-import from ProxyAPI `/v1/models`.

Initial models (prices verified 2026-09-07, source `proxyapi-manual-2026-09-07`):
- GPT-5.6 Luna (`openai/gpt-5.6-luna`): 60 / 360 / cache 6 / 75 RUB per 1M tokens
- Claude Haiku 4.5 (`anthropic/claude-haiku-4-5`): 295 / 1474 / cache 30 / 369
- Gemini 3.5 Flash Lite (`google/gemini-3.5-flash-lite`): 91 / 758, no cache prices

Cost uses bigint ceiling: `ceil(tokens * priceMicroRubPerMillion / 1_000_000)`. Cached input is billed at cache-read price, not also as uncached input. Reasoning tokens are not added on top of output tokens.

Reservation = estimated input + max output, plus `AI_RESERVATION_SAFETY_BPS` (default +20%), capped by `AI_MAX_RESERVATION_MICRORUB` (default 10 RUB). Provider is never called before `reserveUsage()`.

`providerActualCostMicroRub` is always the full calculated COGS. `userSettledUsageMicroRub` is what buckets could cover. If actual > reserved and extra usage is unavailable, financial status is `ANOMALY` and buckets never go negative.

Streaming: ProxyAPI SSE is parsed internally and rewritten as Vimla events (`start`, `delta`, `done`, `error`). Terminal usage may arrive as `{ choices: [], usage }`. ProxyAPI `X-Request-ID` is stored on `AiRequest.providerRequestId` and is not returned to the browser. Missing usage or ambiguous network failure → `RECONCILIATION_REQUIRED` and the reservation is held, never settled at 0 or blindly released. Client disconnect does not abort an in-flight provider call. No automatic retry of billable provider requests.

Kill switch: `AI_TEXT_ENABLED=false` blocks new provider calls; auth/billing/conversation reads continue. Rate limit and per-user concurrency use Redis for coordination (fail closed in staging/production if Redis is down). Cookie mutating chat routes require `Origin === WEB_ORIGIN`.

Default tests use `MockAiProvider`. Optional live smoke: `VIMLA_PROXYAPI_LIVE=1 pnpm test:proxyapi` (not CI).

## Payments
Use `PaymentProvider` abstraction. Build with mock first. Real provider selection can be T-Kassa/CloudPayments/etc. Domain must not depend on a specific SDK.

## Storage
PostgreSQL stores metadata. Files/images/video live in S3-compatible object storage. Use signed URLs or backend-mediated access as appropriate.

## Observability
At minimum record:
- request/correlation ID;
- user/account id (safe internal ID);
- Vimla model;
- provider/model;
- latency;
- token/media usage;
- actual/derived provider cost;
- reservation/settlement ID;
- error classification.

Never log secrets or sensitive raw customer content by default.
