# Vimla — Initial Decisions

## Accepted
- Product name: Vimla.
- Frontend: Next.js 16 + React 19 + TypeScript + MobX + SCSS Modules.
- Backend: Node.js TypeScript, NestJS + Fastify.
- Database: PostgreSQL + Prisma.
- Queue/cache: Redis + BullMQ.
- Architecture: modular monolith API + separate worker.
- Authentication: Better Auth, self-hosted, PostgreSQL/Prisma, email/password plus email OTP verification and optional verified-phone SMS login, cookie and database-backed sessions.
- First AI gateway/provider: ProxyAPI.
- ProxyAPI is hidden behind Vimla provider abstraction.
- Corporate model for first commercial release: Russian LLC -> provider/payment accounts.
- Subscription UX uses 0–100% usage.
- Arbitrary top-up is supported.
- PostgreSQL is source of truth for money/usage.
- Money/provider cost uses integer microRUB.
- Reservation/settlement is mandatory before/after AI calls.
- Billing core: versioned plans, T-Bank hosted checkout + mock provider, usage buckets, reservation/settlement, append-only ledger, PostgreSQL constraints and locking.
- Phase 3 text chat: AiGateway + ProxyApiProvider, curated versioned model catalog, reservation before provider, Vimla SSE, no blind provider retry.
- Phase 3.5 identity: next-intl RU/EN, UserPreference locale, email OTP (HMAC-stored), link-based password reset with session revocation, phone linking after verified email (no phone-first signup), notification provider abstraction without a commercial vendor.

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
- Email verification uses Better Auth Email OTP (6 digits / 5 minutes / 3 attempts / 60s resend), not a signup magic link. Password recovery stays link-based.
- `requireEmailVerification` stays false at the Better Auth session layer so unverified users can reach `/verify-email`; expensive operations are gated by `VerifiedEmailGuard`.
- OTP storage uses HMAC with the server Better Auth secret. Unsalted SHA of a 6-digit code is not acceptable if the verification table leaks.
- Phone-first signup is off so one person cannot accidentally create a second account by entering an unknown number. Link phone from a verified account, then allow SMS login.
- Notification delivery: Better Auth / identity → `@vimla/notifications` → `EmailProvider` / `SmsProvider` → SMTP or HTTP gateway adapter. Local/test uses an in-memory inbox. Staging/production require real SMTP + HTTP SMS configuration and fail startup on memory/logging providers. A commercial email/SMS vendor is not chosen.
- Frontend localization is `next-intl` with dictionaries in `apps/web/messages`. Default locale is `ru`.
- Phase 5 Admin is a separate Next.js app (`apps/admin`) with Better Auth TOTP + passkey, hashed AdminSession, default-deny permissions, and append-only audit. Ordinary user sessions cannot be reused.
- Verified expensive mutations: `@SensitiveArea()` on AI/billing controllers with default-deny for mutating methods, not a global verified-email guard.
- Browser E2E uses Playwright + test infrastructure only (`pnpm test:e2e`).
- Signup HTTP validation is a layered limiter (`AUTH_SIGNUP_IP_LIMIT_PER_MINUTE`, default 20), overriding Better Auth's built-in `/sign-up*` 3/10s rule so a legitimate email typo is not treated as abuse. OTP send/verify, SMS and password-reset remain stricter. Notification budget keys HMAC destination and IP; they never store raw email.

## Billing
- Authoritative money is integer microRUB (`bigint` / `BIGINT`). JSON uses decimal strings. JavaScript `number` is forbidden for money.
- Plan commercial terms are versioned. Changing a future price does not rewrite historical subscriptions or payments.
- Subscription periods in Phase 2/4 are fixed-length (default 30 days). Recurring MIT/T-Bank auto-renew is explicitly disabled until a tested business flow exists.
- Usage is granted only after an idempotent payment event. Duplicate provider events grant once.
- Top-up provider budget is `floor(amount * ratioBps / 10000)` with published `TopupPolicyVersion` min/max (env is bootstrap fallback). Remainder below 1 microRUB is discarded; Vimla never rounds up the **grant**.
- Estimated payment/fiscalization/tax **costs** use **ceil** basis points so we do not understate merchant cost. Actual reconciled fees are never recalculated.
- **TOPUP never expires.** No 3-month, 90-day, or lastActiveAt timer.
- Checkout snapshots freeze plan version / top-up ratio / `topupPolicyVersionId` at Init time. Later catalog changes do not rewrite an in-flight or historical payment.
- `PlanVersion` / fee / top-up / fiscalization / tax-reserve policies are DRAFT → PUBLISHED (immutable commercial fields) → RETIRED.
- Finance metrics are owner-only and stay inside `@vimla/billing`. There is no `/v1/finance`. Missing fee policy must not block Usage grant.
- T-Bank Internet Acquiring is the Phase 4 processor (hosted page, `/v2` EACQ). 1 kopeck = 10_000 microRUB. Amounts that are not whole kopecks are rejected.
- If an ACTIVE subscription exists, a second concurrent subscription checkout is rejected. No upgrade/proration in Phase 4.
- Full refunds append compensating `BUCKET_REVOKED` ledger entries and never make a bucket negative. Partial subscription refunds are not automated (`RECONCILIATION_REQUIRED`). Chargebacks are anomalies, not ordinary refunds.
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
- top-up target provider-cost ratio ~35%;
- these ratios are **not** final product economics; new grants are published PlanVersions after simulation.

## Not decided yet
- email/SMS vendor (SMTP and HTTP SMS adapters exist; commercial provider not chosen);
- S3-compatible object storage vendor;
- hosting/VPS/cloud provider;
- exact plan feature limits;
- exact models exposed at launch;
- whether top-up UI displays ruble face value, extra percentage, or both;
- accountant/cash-register confirmation of Receipt Taxation/VAT/FFD before enabling fiscalization.

Do not invent final choices for `Not decided yet` items without explicit user instruction. Implement abstractions/foundations that keep these choices replaceable.
