# Vimla — Implementation Plan

Do not implement every phase in one Cursor run. Complete, test and review each phase before moving on.

## Phase 0 — Repository foundation
Goal: clean runnable monorepo, no real AI or payments.

- [x] pnpm workspace + Turborepo.
- [x] `apps/web`: Next.js 16 + React 19 + strict TypeScript + SCSS Modules + MobX foundation.
- [x] `apps/api`: NestJS + Fastify + strict TypeScript.
- [x] `apps/worker`: Node + BullMQ foundation.
- [x] packages: contracts, database, config, ai, billing, shared.
- [x] PostgreSQL + Prisma foundation.
- [x] Redis foundation.
- [x] Docker Compose for local PostgreSQL/Redis.
- [x] centralized typed env validation.
- [x] `.env.example`.
- [x] structured logging/correlation ID foundation.
- [x] `GET /health`.
- [x] web can call configurable API health endpoint.
- [x] worker can connect to Redis.
- [x] root scripts: dev/build/lint/typecheck/test.
- [x] basic CI.
- [x] README with exact local setup.

Exit criteria: fresh clone can be configured and all baseline commands pass.

## Phase 1 — Persistence + authentication
Goal: real users and secure sessions, still no real billing/AI.

- [x] finalise Prisma conventions/migrations.
- [x] users/auth/session schema.
- [x] authentication flow.
- [x] server-side authorization/ownership helpers.
- [x] protected app shell.
- [x] user settings/profile minimum.
- [x] tests for unauthorized/ownership paths.

Exit criteria: user can register/login/logout and access only own protected resources.

## Phase 2 — Billing/Usage domain with mock money
Goal: prove financial correctness before integrating payments or AI.

- [x] Plan + PlanVersion.
- [x] Subscription.
- [x] Payment + PaymentEvent.
- [x] UsageBucket.
- [x] UsageReservation.
- [x] UsageLedgerEntry.
- [x] integer microRUB money type/helpers.
- [x] grant monthly subscription allowance.
- [x] create arbitrary top-up bucket.
- [x] subscription-first bucket allocation policy.
- [x] `reserve()` transaction.
- [x] `settle()` transaction.
- [x] `release()`/failure path.
- [x] expiration handling.
- [x] MockPaymentProvider.
- [x] mock subscription purchase.
- [x] mock top-up purchase.
- [x] derived percentage endpoint.

Required tests:
- [x] concurrent requests cannot overspend;
- [x] insufficient allowance prevents execution;
- [x] duplicate payment event grants only once;
- [x] failure releases reservation;
- [x] partial settlement releases difference;
- [x] subscription allowance is consumed before top-up;
- [x] expired subscription allowance cannot be spent;
- [x] ledger can explain balance.

Exit criteria: billing invariant suite passes against real PostgreSQL.

## Phase 3 — AI Gateway + ProxyAPI text chat
Goal: first real AI value with financially safe metering.

- [x] AiProvider interfaces.
- [x] ProxyAPIProvider.
- [x] validated ProxyAPI configuration.
- [x] Vimla model catalog/mappings.
- [x] model enable/disable controls.
- [x] text generation/chat endpoint.
- [x] SSE streaming.
- [x] reservation before provider call.
- [x] settle actual/derived provider cost.
- [x] ai_request/provider-cost records.
- [x] conversations/messages.
- [x] frontend chat UI.
- [x] manual model selector.
- [x] usage meter.
- [x] rate/concurrency limits.
- [x] provider timeout/retry/error mapping.

Exit criteria: paid-cost text calls cannot occur without allowance and every completed request is auditable.

## Phase 3.5 — Identity, authentication UX and localization
Goal: production-ready identity and RU/EN UX without real payments or admin.

- [x] next-intl RU/EN dictionaries; no hard-coded user-facing chat/auth copy.
- [x] locale cookie + `UserPreference` + Accept-Language fallback, default `ru`.
- [x] Better Auth email OTP on signup; HMAC OTP storage; 6/300s/3/60s policy.
- [x] `/verify-email` UI; unverified users blocked from AI send and mock purchases.
- [x] Existing unverified users enter verification after login (not auto-verified).
- [x] Link-based `/forgot-password` + `/reset-password`; generic enumeration-safe response; session revocation.
- [x] `@vimla/notifications` EmailProvider/SmsProvider + localized templates + local/test mocks.
- [x] Verified phone linking (E.164 unique) and SMS OTP login; no phone-first signup.
- [x] `/settings/security`: password change, sessions list/revoke, phone link.
- [x] Dedicated auth/OTP rate limits and resend cooldown; no OTP/password/reset token in logs.
- [x] Stable API error codes mapped to translation keys.
- [x] Prisma migration `20260908000000_add_identity_preferences` only (no rewrite of old migrations).
- [x] Integration tests against PostgreSQL with mocked email/SMS.

Exit criteria: a real user can register, verify email, reset password, link a phone, manage sessions, and use chat in RU or EN without native browser bubbles or raw backend errors.

## Phase 3.6 — Production notification delivery + browser E2E
Goal: identity is safe to expose to real users for email/SMS delivery wiring, and critical flows are proven in a real browser.

- [x] Keep `NotificationService` → `EmailProvider` / `SmsProvider`; no Better Auth vendor SDK coupling.
- [x] Do not silently pick a commercial vendor; SMTP + HTTP SMS protocol adapters only.
- [x] local/test = memory adapters; staging/production fail startup on memory/logging providers.
- [x] Secrets via `@vimla/config`, not `NEXT_PUBLIC_*`, redacted in logs.
- [x] Document SPF/DKIM/DMARC and sender-domain policy (DNS not automated).
- [x] Reset URLs from trusted `WEB_ORIGIN` only; ignore client redirect/callback host.
- [x] Never log OTP, reset token, full email/phone, or message bodies.
- [x] Bounded email retries, no SMS retry storm, notificationId idempotency.
- [x] Config-driven email/SMS abuse limits (IP, destination, account, global) plus 60s cooldown.
- [x] Local/test inbox; HTTP inspector only for `APP_ENV=local|test`.
- [x] Playwright E2E for registration, invalid password/OTP, reset, phone link/login, sessions, AI gate, RU/EN, errors.
- [x] Change-email UI on `/settings/security` with Better Auth OTP (current then new).
- [x] `@SensitiveArea` default-deny for AI/billing mutations.
- [x] Stable `notification_temporarily_unavailable` / `rate_limited` codes; no raw vendor errors.
- [x] Sanitized delivery metrics/logs for a future admin dashboard (no Admin UI).
- [x] Default CI does not send real email/SMS/ProxyAPI/payments. No live smoke tests until a vendor is chosen.

Exit criteria: identity works from first click to verified account in a browser, and production cannot start pretending to deliver mail/SMS.

## Phase 4 — Real payment provider
Goal: real subscription/top-up money activates existing billing domain.

- [x] choose payment provider (T-Bank Internet Acquiring, hosted page).
- [x] implement PaymentProvider adapter.
- [x] checkout endpoints.
- [x] verified webhook.
- [x] subscription purchase/renewal.
- [x] arbitrary top-up amount with server-side min/max rules.
- [x] duplicate webhook protection.
- [x] cancellation/refund domain paths.
- [x] billing history UI.

Exit criteria: browser redirects cannot grant value; verified idempotent webhook does.

## Phase 4.5 — Finance & tariff economics foundation
Goal: truthful unit economics and versioned tariffs for a future Admin, without exposing finance to end users.

- [x] TOPUP never expires (`expiresAt` NULL, CHECK-enforced).
- [x] PlanVersion DRAFT / PUBLISHED / RETIRED lifecycle.
- [x] FREE fallback entitlement (no fake Subscription).
- [x] typed PlanEntitlement registry (unlimited without magic -1).
- [x] TopupPolicyVersion as PostgreSQL truth (env bootstrap fallback).
- [x] PaymentFeePolicyVersion / FiscalizationFeePolicyVersion / optional tax reserve.
- [x] PaymentEconomics estimated vs actual; missing policy does not block grant.
- [x] FinanceQueryService (revenue, fees, AI COGS, outstanding, contribution, quality).
- [x] TariffEconomicsSimulator + worst-case guardrails.
- [x] no public `/v1/finance`.

Exit criteria: Admin can later show real contribution/obligation/quality; historical payments are not rewritten by new policies.

## Phase 5 — Protected Admin / Finance & Tariff Control Plane
Goal: owner-only control plane, separate from consumer web.

- [x] `apps/admin` on `:3002` / production `admin.<domain>`.
- [x] `/admin/v1/*` + `AdminGuard` + `@RequireAdminPermission` (default deny).
- [x] `AdminPrincipal` / `AdminRole` / `AdminSession` / `AdminAuditLog`.
- [x] CLI bootstrap / disable / revoke-sessions.
- [x] Better Auth TOTP + passkey plugins; AdminSession distinct from user session.
- [x] Finance Overview via `FinanceQueryService`; top-up outstanding highlighted; no net profit as fact.
- [x] Tariff drafts, simulator, negative-margin confirmation; no top-up expiry UI.
- [x] Canonical project entitlement keys (Projects not implemented).
- [x] Admin E2E on ports `3202` / `3201` (user E2E remains `3100` / `3101`).
- [ ] ProxyAPI balance sync/snapshots / provider runway (Phase 5.x).
- [ ] Bounded CSV export (Phase 5.x).
- [ ] Model price write editor (Phase 5.x; catalog is read-only).
- [ ] Reconciliation compensating write actions (Phase 5.x; inspect-only now).

Exit criteria: ordinary users cannot reach Admin API; quality gate includes Admin tests. See `docs/ADMIN_SECURITY.md` and `docs/FINANCE_ADMIN.md`.

## Phase 6 — Images
- [ ] image capability interface/provider mapping.
- [ ] async/sync strategy by model.
- [ ] reservation by selected parameters.
- [ ] object storage.
- [ ] generation history/UI.
- [ ] settlement/failure rules.

## Phase 7 — Video
- [ ] video job API.
- [ ] persistent job lifecycle.
- [ ] BullMQ worker.
- [ ] provider polling/status handling.
- [ ] object storage.
- [ ] progress UI.
- [ ] strict reservation/cost caps.
- [ ] ambiguous-provider-charge reconciliation path.

## Phase 8 — Projects + files
- [ ] projects.
- [ ] files/object metadata.
- [ ] signed access/upload.
- [ ] ownership/security.
- [ ] project context in chats.

## Phase 9 — Auto Router
- [ ] task/capability classification.
- [ ] configurable routing rules.
- [ ] cost/quality/latency weighting.
- [ ] fallback handling.
- [ ] routing telemetry and evaluation.

## Phase 10 — Agents
- [ ] agent-run domain.
- [ ] run-level provider-cost budget.
- [ ] tool/step ledger.
- [ ] BullMQ execution.
- [ ] max steps/time/cost.
- [ ] interruption/recovery.
- [ ] user-visible progress.

## Deferred until justified
- microservices;
- Kubernetes;
- Kafka;
- direct OpenAI/Anthropic/Google providers;
- marketplace;
- mobile apps;
- complex organization/team billing.
