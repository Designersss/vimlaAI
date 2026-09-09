# Vimla — Architecture

## Monorepo

```text
vimla/
  apps/
    web/
    admin/
    api/
    worker/
  packages/
    contracts/
    database/
    config/
    auth/
    ai/
    billing/
    notifications/
    workspace/
    shared/
    ui/
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
Phase 3.5 keeps self-hosted Better Auth as the identity library. The API is the auth authority; the browser is not.

```text
Browser
  -> Vimla Web (`/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/settings/security`, `/app`)
  -> Vimla API `/api/auth/*`
  -> Better Auth (`@vimla/auth`)
  -> Vimla NotificationService
       -> EmailProvider / SmsProvider
  -> PostgreSQL (`user`, `session`, `account`, `verification`, `user_preference`)

Protected Vimla routes:
  AuthGuard -> Better Auth getSession -> AuthenticatedUser.id
  SensitiveAreaGuard (@SensitiveArea on AI/billing controllers) -> emailVerified=true for POST/PUT/PATCH/DELETE
  VerifiedEmailGuard remains available for explicit method-level checks
  GET /v1/me
  PATCH /v1/me/preferences (locale and/or IANA timezone; OriginGuard)
  /v1/workspace/* personal objects (AuthGuard + OriginGuard + SensitiveArea + mutation rate limit)
```

`User.id` is the canonical identifier for later billing, usage, conversations and generations. Public routes such as `GET /health` stay unauthenticated. Verification, password-reset and session endpoints stay available for unverified sessions.

## Frontend design system (Phase 5.5)

Web and Admin share `@vimla/ui` (`packages/ui`): semantic tokens, light/dark/system appearance, primitives, AppShell, and chat presentational components. Feature SCSS is layout-only. Production UI renders real API/session data; screenshot values are not hardcoded. `/dev/ui` is registered only for `APP_ENV=local|test`. See `docs/DESIGN_SYSTEM.md`.

OTP policy is centralized in `@vimla/config`: 6 digits, 5 minutes, 3 attempts, 60s resend cooldown. Email OTP is stored as HMAC (not unsalted SHA). Phone OTP is hashed the same way after Better Auth writes the verification row. Verification rows are stored in PostgreSQL (`verification.storeInDatabase`) so Redis is not the OTP source of truth.

Phone-first registration is disabled: a verified Vimla account links a canonical E.164 number, then that number can sign in with SMS OTP. Unknown phones do not silently create users.

Locale resolution (next-intl, no URL prefix): authenticated `UserPreference.locale` → `vimla_locale` cookie → `Accept-Language` → `ru`.

Error UX: API `error.code` → translation key → localized copy. Do not render `error.message` as the primary user string.

## Notifications (Phase 3.6)

```text
Better Auth / identity
  -> Vimla NotificationService
  -> EmailProvider / SmsProvider
  -> Memory (local/test) | SMTP | HTTP SMS gateway
```

Commercial email/SMS vendor is not chosen. Staging/production cannot use Memory or Logging providers; `loadApiConfig` fails fast unless `EMAIL_PROVIDER=smtp` and `SMS_PROVIDER=http` are fully configured. SMTP is a protocol adapter (nodemailer transport). SMS uses a configured HTTP endpoint plus server-side authorization header.

Sender domain (manual DNS, not automated by Vimla):

- `EMAIL_FROM` must be a Vimla domain mailbox, not Gmail/Mail.ru/Yandex/etc.
- Production mail requires SPF, DKIM and DMARC on the sender domain.
- Reply-To is optional (`EMAIL_REPLY_TO`) and must also be a controlled address.

Reset links are `${WEB_ORIGIN}/reset-password?token=...` only. Browser `redirectTo` / callback host cannot choose the emailed URL.

OTP and reset tokens are never logged. Application logs use destination HMAC hashes, template id, provider name, success/failure, latency, error category and retry count.

Delivery retries: email up to `NOTIFY_EMAIL_RETRY_MAX` (default 2) with backoff, only on network/timeout; SMS is single-attempt (`NOTIFY_SMS_RETRY_MAX=1`) so a user resend cannot fan out into a retry storm. Each `queue*` call has a `notificationId` with Redis SET NX so application retries of the same dispatch are not sent twice.

Cost-abuse limits (config-driven, Redis): per destination, per IP, per account (SMS), and global rolling windows, in addition to Better Auth per-minute rules and the 60s OTP cooldown. Signup HTTP (`/sign-up*`) is intentionally looser than OTP/SMS/reset so a user can correct an existing-email mistake and retry immediately.

Local/test inbox: in-process `MemoryNotificationInbox` singleton shared by `MemoryEmailProvider` / `MemorySmsProvider` and `GET /dev/notifications/latest`. The inspector is registered only when `APP_ENV` is `local` or `test` and is absent from staging/production. Startup logs `GET /dev/notifications/latest registered`. An empty inbox returns `notification_not_found`, not a generic missing-route `not_found`. Query params `channel` and `to` are optional filters.

## Verified-user route policy

Do not install a global verified-email guard (it would break login, verification, password reset and public reads).

Controllers that own expensive mutations (`ConversationsController`, `MockPurchaseController`) are tagged `@SensitiveArea()`. `SensitiveAreaGuard` then default-denies POST/PUT/PATCH/DELETE unless the handler has `@AllowUnverified()`. New AI/billing/payment mutation endpoints inherit the deny unless a developer explicitly opts out. `@SensitiveMutation()` can mark a single handler outside a sensitive controller.

## Browser E2E

`pnpm test:e2e` runs Playwright against dedicated origins so it does not attach to a local `pnpm dev` process: consumer web `http://localhost:3100` / API `http://localhost:3101`, Admin `http://localhost:3202` / API `http://localhost:3201`. The suite uses `APP_ENV=test`, test PostgreSQL, test Redis, memory notifications, `MockAiProvider` and mock purchases. It must not target production or send real email, SMS, ProxyAPI or payment traffic. Chromium runs the full consumer/admin suites plus responsive smoke (320 / 390 / 768 / 1280). WebKit and Firefox run a focused shell smoke only.

Hijacked AI SSE responses include CORS credentials headers (`Access-Control-Allow-Origin` = `WEB_ORIGIN`) because `reply.hijack()` skips Nest's CORS plugin. Without that, the browser cannot read the stream.

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
- **never expires** (`expiresAt` is NULL; CHECK-enforced);
- remaining balance is outstanding AI obligation, not profit;
- retail amount and provider-cost budget are distinct values.

## Phase 4.5 finance & tariff economics
Internal `FinanceQueryService` / `TariffEconomicsSimulator` compute contribution (realized vs conservative), not “net profit”. No public finance HTTP API. Payment method is taken from signed notification PAN presence or trusted GetState `Params.Source` (`cards` → CARD). Nested unsigned webhook Params are not used.

```text
Revenue (gross customer payment)
≠ usage grant
≠ AI COGS (AiRequest.providerActualCostMicroRub)
≠ outstanding obligation (unexpired MONTHLY remaining + all TOPUP remaining)
```

Estimated acquiring/fiscalization fees use **ceil** basis-point rounding. Actual reconciled fees are stored separately and preferred when present. A new published fee/top-up/plan version never rewrites historical PaymentEconomics or checkout snapshots.

`EffectivePlanResolver`: ACTIVE paid subscription, else published FREE. Target 199/499/999 PlanVersions stay DRAFT until monthly grants are decided in Admin.

Phase 5 Admin: `apps/admin` on a distinct origin; `/admin/v1/*` with AdminSession, MFA and default-deny permissions. Finance Overview uses `FinanceQueryService`. See `docs/ADMIN_SECURITY.md`.

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

### Phase 4 T-Bank acquiring
Hosted payment page only. Billing domain talks to `PaymentProvider`; `TBankPaymentProvider` owns `/v2/Init`, `GetState`, `CheckOrder`, `Cancel`, Token signing and notification verification. Browser never sends card data, prices, grants or redirect URLs.

Checkout snapshot is immutable (`planVersionId` / `topupRatioBps` + amounts). Fulfillment uses the snapshot, not the current catalog. Grant happens in the same DB transaction as marking `SUCCEEDED`. Domain status is separate from raw `providerStatus`. One-stage `PayType=O`: grant only on `CONFIRMED`, never `AUTHORIZED`.

Webhook `POST /webhooks/tbank/payments` is unauthenticated but not unverified: signature, terminal, order mapping and amount must match. Success body is plain `OK`. Browser `/payment/result` only polls `GET /v1/payments/:id` (owner-scoped 404). Worker reconciliation reuses the same `processPaymentEvent` path.

Recurring MIT charges are off (`TBANK_RECURRING_ENABLED` must stay false). UI says “Active until”, never “next charge”. Fiscalization `Receipt` is config-gated; production cannot enable it without accountant-supplied Taxation/Tax/FFD fields.

### Fiscalization
T-Bank `Receipt` is not invented in code. `TBANK_FISCALIZATION_ENABLED=true` requires accountant/cash-register values: `Taxation`, item `Tax`, `PaymentMethod`, `PaymentObject`, FFD version. If those are missing, the process refuses to start. Line items are server-defined and `sum(Items.Amount)` equals Init `Amount`. Refund receipts are not user-supplied.

Future Projects: application layer separates authenticated actor from billing subject. Today the resolver always returns the current user's `USER` subject. No polymorphic payment FK. Project `PERSONAL_USAGE` / `PROJECT_USAGE` payment source selection is documented only.

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
Use `PaymentProvider` abstraction (`MockPaymentProvider` | `TBankPaymentProvider`). Billing domain does not call T-Bank HTTP. Token/notification verification lives in the adapter. Domain must not depend on a T-Bank SDK.

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
