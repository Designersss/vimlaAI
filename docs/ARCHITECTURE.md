# Vimla — Architecture

## High-level architecture
```text
User
  |
  v
Cloudflare / CDN
  |
  v
Next.js Web
  |
  v
NestJS/Fastify API
  |
  +-------------------- PostgreSQL
  |
  +-------------------- Redis
  |                         |
  |                         v
  |                       BullMQ
  |                         |
  |                         v
  |                       Worker
  |
  v
Usage Engine
  |
  v
AI Gateway
  |
  v
ProxyAPI adapter
  |
  +---- GPT / OpenAI-family models
  +---- Claude / Anthropic-family models
  +---- Gemini / Google-family models
  +---- image models
  +---- video models
```

## Architectural style
Start with:
- one modular-monolith API application;
- one separate worker process;
- one PostgreSQL database;
- one Redis instance;
- S3-compatible object storage when media/files are introduced.

Do not start with microservices.

## Backend modules
Target modules:
```text
AuthModule
UsersModule
PlansModule
SubscriptionsModule
PaymentsModule
UsageModule
AiModule
ChatsModule
FilesModule
GenerationsModule
AgentsModule
AdminModule
```

Not all modules must exist in Phase 0.

## Money representation
Never use JS `number` for authoritative money math.

Canonical internal representation:
- integer micro-rubles;
- `1 RUB = 1_000_000 microRUB`;
- PostgreSQL `BIGINT`;
- TypeScript `bigint` in domain/internal layers.

Public JSON contracts cannot serialize native `bigint` directly. Convert deliberately to validated decimal strings or another explicit API-safe representation at boundaries.

## Usage model
The UI percentage is derived.

Authoritative entities:
- plan version;
- subscription;
- usage bucket;
- usage reservation;
- usage allocation;
- usage ledger entry.

### Subscription bucket
A subscription creates a time-bounded provider-cost allowance.

Example only:
```text
Pro price: 990 RUB
Provider-cost budget ratio: 30%
Provider-cost allowance: 297 RUB
```

### Top-up bucket
A top-up creates a separate non-expiring (unless business rules later change) allowance.

Example only:
```text
Top-up paid: 1000 RUB
Provider-cost ratio: 35%
Provider-cost allowance: 350 RUB
```

Monthly buckets are consumed before top-up buckets.

## Critical request flow
Every billable AI operation follows:
```text
request
  |
  v
auth + validation + rate limit
  |
  v
estimate maximum provider cost
  |
  v
reserve allowance atomically
  |
  v
call provider
  |
  +---- provider succeeds -> settle actual cost + release excess reservation
  |
  +---- provider fails unbilled -> release reservation
  |
  +---- ambiguous billing state -> preserve trace and reconcile; never guess silently
```

The provider must never be called before allowance is reserved.

## Concurrency
Reservation must be protected by a PostgreSQL transaction/locking strategy so simultaneous requests cannot overspend the same allowance.

Example failure that must be impossible:
```text
available = 5 RUB
10 concurrent requests each see 5 RUB
all execute
provider cost = 50 RUB
```

## Ledger
Use append-only financial/usage ledger semantics.

Example entry types:
- `SUBSCRIPTION_GRANT`
- `TOPUP_GRANT`
- `RESERVATION_CREATED`
- `RESERVATION_RELEASED`
- `AI_USAGE_SETTLED`
- `MANUAL_ADJUSTMENT`
- `REFUND_ADJUSTMENT`
- `EXPIRATION`

Do not mutate historical ledger entries to “fix” balances. Use compensating entries.

## Plan versioning
Never mutate historical commercial terms.

Use:
```text
plans
plan_versions
```

A subscription references the version effective when it was purchased/renewed.

Version at minimum:
- retail price;
- currency;
- provider-cost budget ratio/allowance policy;
- feature entitlements;
- effective dates.

## AI provider abstraction
Domain code calls an internal interface, not ProxyAPI directly.

Conceptual interface:
```ts
interface AiProvider {
  streamText(...): ...;
  generateImage(...): ...;
  submitVideo(...): ...;
  getVideoStatus(...): ...;
}
```

Provider-specific DTOs remain inside the adapter.

## Model catalog
Vimla owns stable model IDs independent of provider model IDs.

Example:
```text
vimlaModelId: text-fast-v1
provider: proxyapi
providerModelId: ...
capabilities: [text, vision]
status: enabled
usageTier: low
```

The catalog must allow model availability/prices to change without frontend redeploy where practical.

## Price versioning
Provider/model pricing changes over time.

Persist price versions with effective ranges. A historical request must remain explainable using the price/version active at execution.

## Streaming text
Preferred MVP flow:
```text
ProxyAPI stream
  -> API server
  -> SSE/streaming response
  -> browser
```

The final provider usage metadata is used for settlement where available.

## Long-running generations
Images that are asynchronous, videos, and agents use jobs:
```text
API request
  -> reserve
  -> create generation/agent job
  -> enqueue BullMQ
  -> worker executes/polls provider
  -> persist result
  -> settle/release
```

Do not keep an HTTP request alive for multi-minute video jobs.

## Payments
Use:
```ts
interface PaymentProvider {
  createCheckout(...): ...;
  verifyWebhook(...): ...;
  refund(...): ...;
}
```

Start with `MockPaymentProvider`.
Add the real acquiring adapter only after the billing domain is tested.

Payment redirect is never proof of payment.
A verified webhook/provider confirmation is authoritative.

All webhook events require idempotency.

## ProxyAPI treasury
Corporate ProxyAPI balance is not a user balance.

Store periodic snapshots:
- provider balance;
- 24h burn;
- 7d burn;
- estimated runway;
- timestamp.

Admin alerts should eventually warn before the provider balance is critically low.

## Reconciliation
Vimla calculates provider cost per operation and stores provider request identifiers.
Periodically compare internal calculated totals to provider-reported/logged costs.
Meaningful differences must generate alerts.

## Redis responsibilities
Redis may be used for:
- BullMQ;
- cache;
- rate limits;
- ephemeral locks/coordination where safe.

Redis must not be authoritative for:
- payment state;
- subscription state;
- remaining financial allowance;
- historical ledger.

## Files/media
Do not store large media blobs in PostgreSQL.
Use object storage and persist metadata/storage keys in PostgreSQL.

## Security basics
- secrets server-side only;
- validate every untrusted payload;
- webhook signature verification;
- ownership checks on every user resource;
- redact prompts/files/secrets from logs where appropriate;
- rate/concurrency limits;
- provider keys scoped/budgeted/IP-restricted when supported.
