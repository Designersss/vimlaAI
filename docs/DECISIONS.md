# Vimla — Initial Decisions

## Accepted
- Product name: Vimla.
- Frontend: Next.js 16 + React 19 + TypeScript + MobX + SCSS Modules.
- Backend: Node.js TypeScript, NestJS + Fastify.
- Database: PostgreSQL + Prisma.
- Queue/cache: Redis + BullMQ.
- Architecture: modular monolith API + separate worker.
- Authentication: Better Auth, self-hosted, PostgreSQL/Prisma, email/password V1, cookie and database-backed sessions.
- First AI gateway/provider: ProxyAPI.
- ProxyAPI is hidden behind Vimla provider abstraction.
- Corporate model for first commercial release: Russian LLC -> provider/payment accounts.
- Subscription UX uses 0–100% usage.
- Arbitrary top-up is supported.
- PostgreSQL is source of truth for money/usage.
- Money/provider cost uses integer microRUB.
- Reservation/settlement is mandatory before/after AI calls.
- Billing core: versioned plans, mock payments, usage buckets, reservation/settlement, append-only ledger, PostgreSQL constraints and locking.
- Phase 3 text chat: AiGateway + ProxyApiProvider, curated versioned model catalog, reservation before provider, Vimla SSE, no blind provider retry.

## AI / ProxyAPI
- Unified text endpoint: `POST {PROXYAPI_BASE_URL}/chat/completions` with full model ids (`openai/...`). Native `fetch`, no OpenAI SDK.
- Server sets `max_completion_tokens = min(AI_DEFAULT_MAX_OUTPUT_TOKENS, model.maxOutputTokens)`.
- Input estimate is UTF-8 bytes + overhead (never characters/4 as a financial guarantee). Settlement uses provider terminal usage.
- Failures: pre-execution reject/402 → release; timeout/502/504/missing usage/disconnect-after-send → `RECONCILIATION_REQUIRED`, no free request.
- Duplicate `clientRequestId`: at most one provider call. In-progress duplicates return `AI_REQUEST_IN_PROGRESS`. Failed/reconciliation requests are not auto-replayed.
- Production ProxyAPI key: separate from development; provider-side budget; restrict allowed models; IP whitelist when egress is static; least privilege; rotate on incident. Application security does not rely on those provider controls alone.
- ProxyAPI content logging is not required for Vimla. If enabled later it is a separate privacy/retention decision. Only safe `X-Request-ID` metadata is sent, never email/prompt/payment data.
- `AI_TEXT_ENABLED` is the emergency kill switch.

## Authentication
- Better Auth is the authentication library. Vimla does not implement its own password hashing, JWT refresh flow, or session store.
- Authentication is self-hosted. Clerk, Auth0, Supabase Auth and similar SaaS providers are not used.
- PostgreSQL via Prisma is the source of truth for users, sessions, accounts and verification records.
- V1 uses email/password. Social login is deferred until a product decision exists; adding it later should not require a new user identity model because `User.id` is already canonical.
- Browser sessions use HttpOnly cookies. The backend is the auth authority. Frontend MobX/localStorage is never the source of truth for identity.
- NestJS + Fastify integrates Better Auth through the official Fastify handler pattern. The community NestJS Better Auth wrapper is not used because its Fastify support is beta.
- Email verification and password-reset delivery are architectural hooks only in Phase 1. No SMTP/SaaS mailer is connected yet, and local sign-up is not blocked.

## Billing
- Authoritative money is integer microRUB (`bigint` / `BIGINT`). JSON uses decimal strings. JavaScript `number` is forbidden for money.
- Plan commercial terms are versioned. Changing a future price does not rewrite historical subscriptions or payments.
- Subscription periods in Phase 2 are fixed-length (default 30 days). Recurring billing/dunning is deferred.
- Usage is granted only after an idempotent payment event. Duplicate provider events grant once.
- Top-up provider budget is `floor(amount * ratioBps / 10000)` with centralized min/max bounds. Remainder below 1 microRUB is discarded; Vimla never rounds up.
- Bucket spend order: unexpired MONTHLY (earliest expiry first), then TOPUP.
- Concurrency: `READ COMMITTED` + `SELECT ... FOR UPDATE`. Deadlock/serialization retries are bounded (3). Fail closed.
- `MockPaymentProvider` and `/dev/mock-purchases/*` exist only for `local`/`test` and are absent from the production route registry.
- Redis may rate-limit mock purchase HTTP helpers. It is not a source of truth for balances, usage, reservations or payments.
- Ledger history is append-only (application plus a PostgreSQL trigger that rejects `UPDATE`/`DELETE`). The UI percentage is derived from `spent + reserved`.
- Each usage bucket is unique on `(sourceType, sourceId)`.

## Business assumptions, not permanent decisions
- Lite ~150 RUB;
- Start ~300 RUB;
- Pro ~990 RUB;
- target provider-cost ratios ~20% / 25% / 30%;
- top-up target provider-cost ratio ~35%.

## Not decided yet
- real payment/acquiring provider;
- S3-compatible object storage vendor;
- hosting/VPS/cloud provider;
- exact plan feature limits;
- exact models exposed at launch;
- whether top-up UI displays ruble face value, extra percentage, or both;
- refund/carryover policy details.

Do not invent final choices for `Not decided yet` items without explicit user instruction. Implement abstractions/foundations that keep these choices replaceable.
