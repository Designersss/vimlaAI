# Vimla — Product Description

## Vision
Vimla is a unified AI workspace for everyday users, creators and power users. Instead of maintaining separate subscriptions and interfaces for many AI tools, a user works in one product and can use different models/capabilities from the same account.

Long-term positioning: **one workspace, many AIs, finished work rather than model complexity**.

Vimla is treated as a future public production SaaS with real users, real money and hostile Internet traffic. Security, financial correctness and abuse resistance are product requirements, not later polish.

## Target users
Initial audience:
- regular AI users who currently switch between several products;
- creators who need text + image + video workflows;
- students/knowledge workers;
- developers/power users who care about explicit model selection;
- users who want simple pricing/usage instead of token accounting.

## Product and commercial model
Vimla is operated by a Russian LLC. Customer payments go to the LLC. ProxyAPI is the first AI gateway/provider and is replenished from the LLC settlement account under the provider's B2B flow.

Vimla maintains its own user usage ledger. The ProxyAPI corporate balance is treasury state, not a user wallet.

Initial pricing hypotheses (business configuration, not hard-coded constants):
- Lite: 150 RUB/month;
- Start: 300 RUB/month;
- Pro: 990 RUB/month;
- top-up: arbitrary RUB amount.

Current target maximum AI/provider-cost ratios are also assumptions and must stay configurable/versioned:
- Lite: about 20%;
- Start: about 25%;
- Pro: about 30%;
- top-up: about 35%.

Exact plan benefits and provider-cost budgets are adjusted from measured COGS and retention.

## Usage experience
Users see a simple percentage such as `62% used / 38% remaining`. The percentage is presentation only. Authoritative state is integer microRUB in PostgreSQL.

```text
Monthly usage
████████████░░░░░░░░ 62%
38% remaining
Resets Oct 7

[ Top up ]
```

Users are not shown token pricing for every prompt. Expensive models/media consume allowance faster. In-flight reservations move the meter because the UI percentage is derived from `spent + reserved`.

Subscription allowance is spent before top-up allowance. Top-ups create a separate non-expiring (unless policy changes) usage bucket.

---

## Current implemented product (Phase 0–3)

Phases 0–3 are accepted. Later phases must preserve this foundation.

### Phase 0 — Repository foundation
Runnable pnpm + Turborepo monorepo:

```text
apps/web        Next.js 16 App Router, React 19, SCSS Modules, MobX UI state
apps/api        NestJS + Fastify modular monolith
apps/worker     BullMQ worker process
packages/
  contracts     shared schemas/error codes
  database      Prisma schema/client/migrations
  config        validated environment
  auth          Better Auth
  ai            provider abstractions, catalog, cost, streaming
  billing       framework-independent billing domain
  shared        shared utilities
```

Local PostgreSQL/Redis via Docker Compose, typed `@vimla/config`, structured logging/correlation IDs, `GET /health`, CI, and a quality gate of lint/typecheck/test/integration/build.

### Phase 1 — Identity and sessions (current)
Self-hosted Better Auth, email/password, PostgreSQL-backed HttpOnly cookie sessions. The API is the auth authority. `User.id` is the canonical identifier.

Implemented:
- `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, sign-out;
- `GET /v1/me`;
- protected `/app` shell;
- ownership scoping by authenticated user id.

Not yet implemented, but mandatory before public production:
- email OTP verification;
- phone/SMS OTP login;
- password-reset email link;
- session list/revoke-other-sessions;
- RU/EN localized auth UX.

Local sign-up currently works without SMTP. Email verification and password-reset delivery are architectural hooks only in Phase 1.

### Phase 2 — Billing and usage
PostgreSQL is the source of truth for payments, subscriptions, usage and provider-cost accounting. Redis is never financial truth.

Implemented:
- versioned `Plan` / `PlanVersion` (`LITE`, `START`, `PRO`);
- `Subscription`, `Payment`, `PaymentEvent`;
- `UsageBucket` (`MONTHLY`, `TOPUP`);
- `UsageReservation` + allocations;
- append-only `UsageLedgerEntry`;
- integer microRUB (`1 RUB = 1_000_000 microRUB`);
- `reserveUsage` → provider-consuming work → `settleUsage` / `releaseUsage`;
- derived `GET /v1/usage` and `GET /v1/subscription`;
- `GET /v1/plans` without exposing provider budgets;
- local/test-only `POST /dev/mock-purchases/subscription` and `POST /dev/mock-purchases/topup`.

Mock payment routes are not registered in staging/production. Browser "I paid" is never trusted. Duplicate payment events grant once. Concurrent overspend is rejected. Actual cost above reservation that cannot be covered becomes `ANOMALY` without negative bucket balances.

### Phase 3 — Production AI Gateway + ProxyAPI + streaming text chat
First real AI value is financially metered text chat. Images, video, files, tools, agents, Auto Router and real acquiring are out of scope until later phases.

#### Architecture
```text
Browser
  -> Vimla Web `/app`
  -> Vimla API
  -> Auth / Origin / Rate limit / Concurrency / AI kill switch
  -> Conversation ownership
  -> Resolve Vimla model + active price version
  -> Estimate maximum provider cost
  -> reserveUsage()
  -> VimlaAiGateway
  -> AiProvider
       -> ProxyApiProvider | MockAiProvider
  -> ProxyAPI POST {base}/chat/completions
  -> stream, terminal usage, actual cost
  -> settleUsage()
  -> persist assistant message
  -> refresh Usage
```

Billing, conversations and controllers do not know ProxyAPI HTTP details. ProxyAPI is a replaceable adapter. The browser never calls ProxyAPI and never receives `PROXYAPI_API_KEY`.

#### Models
The catalog is curated and versioned. ProxyAPI `/v1/models` is not auto-imported.

A model is user-visible only when `AiModel` exists, `active = true`, `visible = true`, and an active `AiModelPriceVersion` exists.

The browser sends only an internal Vimla `modelId`. The API resolves `providerModelId`, vendor, price version and limits.

Initial catalog (prices verified 2026-09-07, source `proxyapi-manual-2026-09-07`):

| Display name | providerModelId | Input / output / cache read / cache write (RUB per 1M tokens) |
|---|---|---|
| GPT-5.6 Luna | `openai/gpt-5.6-luna` | 60 / 360 / 6 / 75 |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4-5` | 295 / 1474 / 30 / 369 |
| Gemini 3.5 Flash Lite | `google/gemini-3.5-flash-lite` | 91 / 758 / none |

Price changes insert a new version. Historical versions are not edited.

#### Conversations
Implemented:
- `GET /v1/ai/models`;
- `POST /v1/conversations`;
- `GET /v1/conversations`;
- `GET /v1/conversations/:id`;
- `POST /v1/conversations/:id/messages` (SSE).

Conversation history is built by the backend from PostgreSQL. The browser does not submit `messages[]`, system prompts, provider model IDs, prices or `max_completion_tokens`. Message roles in Phase 3 are `USER` and `ASSISTANT`. User B cannot read or append to User A's conversation.

#### Streaming
ProxyAPI SSE is parsed internally and rewritten as stable Vimla events:

```text
event: start
event: delta
event: done
event: error
```

The frontend uses `fetch` POST, not `EventSource`. Terminal usage may arrive as `{ choices: [], usage }`. ProxyAPI `X-Request-ID` is stored on `AiRequest.providerRequestId` for support/reconciliation and is not shown to the user.

#### Reservations and provider-cost accounting
Every provider-consuming request:

1. conservatively estimates input (UTF-8 bytes + overhead, not `characters / 4`);
2. applies server output cap `min(AI_DEFAULT_MAX_OUTPUT_TOKENS, model.maxOutputTokens)` (default 2048);
3. adds reservation safety margin (default +20%);
4. rejects above `AI_MAX_RESERVATION_MICRORUB` (default 10 RUB) before any provider call;
5. calls `reserveUsage()`;
6. only then calls the provider;
7. calculates actual provider cost with bigint ceiling:
   `ceil(tokens * priceMicroRubPerMillion / 1_000_000)`;
8. settles user usage and always retains full provider COGS.

Cached input is not double-billed as uncached input. Reasoning tokens are not added on top of output tokens.

Two money fields are distinct:
- `providerActualCostMicroRub` — full calculated COGS, always retained when known;
- `userSettledUsageMicroRub` — what user buckets could cover.

If actual cost exceeds the reservation and extra usage is unavailable, financial status is `ANOMALY`. Buckets never go negative.

Insufficient user usage means provider call count is 0. ProxyAPI 402/corporate balance failure is `AI_PROVIDER_BALANCE_UNAVAILABLE`, not user `INSUFFICIENT_USAGE`.

#### Reconciliation states
`AiRequest` keeps separate provider and financial state machines.

Provider status: `CREATED`, `RESERVED`, `PROVIDER_STARTED`, `STREAMING`, `SUCCEEDED`, `FAILED`, `RECONCILIATION_REQUIRED`.

Financial status: `NONE`, `RESERVED`, `SETTLED`, `RELEASED`, `ANOMALY`, `RECONCILIATION_HOLD`.

Missing terminal usage, timeout, 502/504, unexpected EOF or other ambiguous network failure does not become a free request and is not blindly released. The reservation is held for later reconciliation. Client disconnect after the provider has started does not abort financial settlement. Billable provider requests are not automatically retried.

Idempotency uses unique `(userId, clientRequestId)`. Duplicate in-progress requests return `AI_REQUEST_IN_PROGRESS`. A succeeded request is replayed without a second provider call.

Emergency kill switch: `AI_TEXT_ENABLED=false` blocks new provider calls while auth, billing reads and conversation reads continue.

Default tests use `MockAiProvider` and never spend ProxyAPI money. Optional live smoke is `VIMLA_PROXYAPI_LIVE=1 pnpm test:proxyapi` and is not part of CI.

---

## Production threat model
Vimla assumes malicious users and hostile traffic. High-value assets include credentials/sessions, conversations, payment/usage state, provider/payment/email/SMS secrets, corporate provider balance, admin privileges and audit history.

Trust boundaries:
1. Browser/client → Vimla API.
2. Vimla API → PostgreSQL/Redis/object storage.
3. Vimla → AI/payment/email/SMS providers.
4. Queue → worker.
5. Consumer surface → admin/control plane.

Everything crossing a boundary is untrusted until authenticated, validated and authorized.

Primary threat classes that later phases must keep designing against:
- credential stuffing, brute force, OTP spam/replay;
- session theft/fixation;
- account enumeration/recovery abuse;
- IDOR/privilege escalation;
- malformed/oversized payloads;
- XSS via user or AI content;
- CSRF against cookie-authenticated mutations;
- SQL/raw-query injection;
- SSRF when URL fetching/tools exist;
- upload abuse when files exist;
- concurrent financial overspend and webhook replay;
- AI provider spend abuse, duplicate requests and retry storms;
- secret leakage via client, logs, errors or build artifacts;
- admin/control-plane compromise.

Financial and security outcomes fail closed when ambiguous if failing closed avoids new spend or access. Evidence needed for reconciliation/audit is never discarded.

## Mandatory identity lifecycle
Phase 1 email/password cookies are not the complete production identity system.

All later consumer/admin work must remain compatible with this lifecycle:
- email/password registration and login;
- mandatory email OTP verification before sensitive paid/AI access according to policy;
- phone/SMS OTP login and verification behind a replaceable provider adapter;
- password-reset email link with short-lived single-use tokens and session revocation on completed reset;
- change email/phone only after re-verification;
- session list, revoke other sessions, and sign-out;
- strong MFA/passkey/TOTP for privileged/admin identities;
- no automatic linking of unverified email/phone claims;
- dedicated auth/OTP rate limits, expiry, attempt bounds, replay protection and resend cooldown;
- enumeration-safe responses where detailed errors would leak account existence.

Email/SMS vendors are not chosen yet. Auth domain logic must not depend on a specific delivery SDK.

## Localization
Vimla supports at least Russian (`ru`) and English (`en`).

Permanent rules:
- no hard-coded end-user strings in UI, validators, notifications or email/SMS templates;
- centralized translation keys that describe meaning;
- locale-aware dates, numbers, pluralization and currency formatting;
- UTC internally; localize only at presentation;
- persist locale preference with browser-locale fallback;
- auth/security email and SMS use the recipient locale when known;
- a flow is not complete until it is usable in both RU and EN.

Phase 3 chat currently uses English UI copy. Localization is a mandatory hardening item, not an optional later cosmetic pass.

## Validation and error UX
Backend/domain returns stable machine-readable error codes. Clients map codes to localized human-readable text.

Permanent rules:
- do not expose raw Prisma, SQL, provider, stack-trace or English internal errors to users;
- mutating financial/auth/admin/AI DTOs are strict: unknown sensitive fields such as `userId`, `providerModelId`, `price`, `role` or `systemPrompt` are rejected, not silently stripped;
- validation remains server-enforced even when the frontend validates first;
- field errors appear next to fields; form errors appear in the form;
- native browser validation bubbles are not the primary UX;
- UI must handle loading, empty, partial, retryable and terminal error states.

## Admin / control plane
Basic financial observability is a V1 capability, but it is not a page inside the consumer app.

The future control plane is an isolated privileged boundary:

```text
Internet
  -> infrastructure access policy where practical
  -> separate admin hostname/app
  -> privileged authentication + strong MFA
  -> explicit permission boundary
  -> admin API/application services
  -> append-only audit log
```

Permanent rules:
- no consumer-app admin navigation;
- hidden URL is not a security control;
- default deny; no `email === ownerEmail` authorization;
- OWNER/admin identities are bootstrapped, not publicly signed up;
- mandatory MFA/passkey/TOTP and step-up for dangerous actions;
- all dangerous actions audited; audit history cannot be erased through normal admin UI;
- local/mock admin shortcuts are absent from production.

Initial operator surfaces include users/support, plans/subscriptions/payments/usage, provider COGS/balance/burn/runway, model catalog enable/disable, feature flags/circuit breakers, incidents/security signals and the audit log.

## Production security and observability
Before public launch, later phases must leave room for and not contradict:
- TLS, HSTS, CSP and other security headers;
- WAF/DDoS/bot layer plus application rate/concurrency/cost limits;
- PostgreSQL/Redis on a private network;
- least-privilege containers and secret rotation without code changes;
- backups and restore drills;
- monitoring/alerts for 5xx, auth abuse, payment/provider failures, unusual AI burn, queue/DB health and financial anomalies;
- dependency scanning/update policy;
- emergency AI/provider kill switches independent from login and read-only access;
- stronger ingress/auth for admin than for the consumer app.

Logging may include request ID, user ID, conversation ID, aiRequest ID, reservation ID, model IDs, provider request ID, estimated/actual/settled microRUB, latency and status. Logging must not include API keys, cookies, Authorization headers, passwords, OTP/recovery tokens, payment secrets, full prompts or full AI responses by default.

Application logs, security/admin audit logs and the append-only financial ledger remain distinct.

---

## Later capabilities
- Auto model router;
- image generation;
- video generation;
- file uploads;
- projects/context workspaces;
- agents/workflows;
- model comparison;
- provider fallback/direct-provider adapters;
- advanced memory/context;
- real acquiring (T-Kassa/CloudPayments/etc. not chosen yet).

## Non-goals for early MVP
- no custom foundation model training;
- no direct provider accounts required initially;
- no microservices;
- no unlimited expensive compute;
- no blockchain/internal transferable currency;
- no user-supplied provider keys as the primary business model;
- no architectural coupling to ProxyAPI, a payment SDK, or a specific email/SMS vendor.

## Architecture invariants for every later phase
1. Never call an AI/payment provider before checking and reserving sufficient user allowance.
2. Reservation → provider call → settlement/release. Ambiguous outcomes are reconciliation, not free usage.
3. PostgreSQL is authoritative for persistent and financial state. Redis is coordination only.
4. Money is integer microRUB (`bigint` / `BIGINT`). JavaScript floats are not authoritative money.
5. Browser is never authoritative for identity, ownership, prices, plans, model IDs, costs, roles or limits.
6. External integrations sit behind replaceable adapters.
7. Modular monolith + separate worker until measured load justifies more complexity.
8. Every public/expensive feature needs auth, ownership, bounded input, rate/concurrency/cost limits, stable errors and tests.
9. Fail closed for expensive/security-sensitive actions when critical checks are unavailable.
10. Implement only the requested phase. Do not silently start images, video, files, agents, Auto Router, real payments or admin UI.
