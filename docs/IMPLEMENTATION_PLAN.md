# ONE — Implementation Plan

This file is the execution order. Do not skip ahead because a later feature looks more visible.

## Phase 0 — Repository foundation
Goal: a clean monorepo that builds locally and in CI.

Tasks:
- Initialize pnpm workspace + Turborepo.
- Create `apps/web`, `apps/api`, `apps/worker`.
- Create shared packages: `contracts`, `database`, `config`, `ai`, `billing`, `shared`.
- Add TypeScript strict configs shared from root.
- Add ESLint/formatting conventions.
- Add `.env.example` files; add typed env parsing.
- Add Docker Compose for PostgreSQL + Redis and optional app containers.
- Add root commands: `dev`, `build`, `lint`, `typecheck`, `test`.
- Add basic CI pipeline.

Acceptance:
- fresh clone -> documented install -> `pnpm dev` works;
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass;
- API exposes `/health`;
- worker can connect to Redis;
- web can call API health through configured public API URL.

## Phase 1 — Persistence + auth foundation
Goal: users can register/login and protected API boundaries exist.

Tasks:
- Prisma schema and migrations.
- User/session/auth domain.
- Choose a simple secure MVP auth method; keep it behind AuthModule.
- Add role (`user`, `admin`).
- Add request correlation ids.
- Add basic rate-limiting infrastructure.

Acceptance:
- register/login/logout works;
- protected endpoint rejects anonymous user;
- user cannot access another user's resource;
- auth secrets never reach frontend JS.

## Phase 2 — Billing domain without real acquiring
Goal: make the difficult financial core correct before real payments.

Tasks:
- Implement plans + plan versions.
- Seed provisional 150/300/990 plans as configurable DB data, not constants.
- Implement `usage_bucket`, `usage_reservation`, allocations and append-only ledger.
- Implement atomic `reserve`, `settle`, `release`.
- Implement monthly vs top-up spending order.
- Create PaymentProvider interface and `MockPaymentProvider`.
- Mock verified webhook flow for subscription and arbitrary top-up.
- Add idempotency throughout.

Acceptance:
- duplicate payment webhook cannot double-grant;
- concurrent usage requests cannot overspend;
- top-up creates separate non-expiring bucket;
- monthly bucket is spent before top-up;
- all invariants in `.cursor/rules/40-billing-usage.mdc` have tests.

## Phase 3 — ProxyAPI text MVP
Goal: a paid-entitlement-safe multi-model streaming chat.

Tasks:
- Create AIProvider interface and ProxyAPI adapter.
- Create model catalog in DB/config with stable ONE ids.
- Implement text generation using a ProxyAPI endpoint appropriate for multi-model chat.
- Implement streaming to frontend.
- Bound maximum output tokens.
- Save provider request id and reported usage.
- Add versioned cost calculation.
- Integrate Usage reservation + settlement around provider call.
- Handle insufficient ONE allowance before calling ProxyAPI.
- Handle ProxyAPI 402/429/provider errors safely.
- Persist conversations/messages.
- Frontend: model selector, composer, streamed assistant message, usage percentage.

Acceptance:
- choose at least three configured models and chat through ONE;
- stream works without exposing provider key;
- actual response usage settles quota;
- failed unbilled request releases reservation;
- exhausted account cannot call provider;
- UI usage refreshes from backend truth.

## Phase 4 — Real payment adapter
Goal: real company payments can grant entitlements safely.

Tasks:
- Select first acquiring provider (T-Kassa / CloudPayments / YooKassa based on business decision).
- Implement provider adapter behind existing PaymentProvider interface.
- Verify signatures/webhooks.
- Add checkout creation.
- Add refunds/cancellations if required by chosen provider.
- Add receipt/fiscal integration requirements according to provider/accounting setup.

Acceptance:
- sandbox/test payment -> verified webhook -> exactly one grant;
- frontend redirect cannot forge activation;
- replayed webhook is harmless.

## Phase 5 — Provider treasury + admin finance
Goal: owner can see if the AI business is healthy.

Tasks:
- Poll/store ProxyAPI balance snapshots with a dedicated key/permission.
- Calculate 24h/7d burn and estimated runway.
- Admin dashboard: payments, recognized sales events, AI calculated COGS, COGS/revenue, top models, errors.
- Add low-balance and abnormal-spend alerts.
- Add scheduled reconciliation architecture against ProxyAPI request/transaction data.

Acceptance:
- provider low balance warning exists before production scale;
- admin can trace an AI operation from user -> reservation -> provider request id -> ledger settlement.

## Phase 6 — Images
Goal: image generation uses the same billing guarantees.

Tasks:
- Image provider capability in AI Gateway.
- Reserve before generation.
- Worker/job if operation is not reliably short.
- Store result in S3-compatible storage.
- Persist file metadata.
- Image library UI.

Acceptance:
- no image operation bypasses Usage Engine;
- failure/retry cannot double-charge;
- media is not stored as large blobs in PostgreSQL.

## Phase 7 — Video
Goal: asynchronous video generation with predictable max spend.

Tasks:
- `generation_job` lifecycle.
- BullMQ video queue.
- Provider submit/status/result adapter.
- Strong max-cost reservation based on model/duration/resolution.
- User cancellation where provider semantics allow it.
- SSE/polling progress UI.

Acceptance:
- request returns quickly with job id;
- worker crash/retry is idempotent;
- user cannot launch a video whose estimated max cost exceeds allowance.

## Phase 8 — Auto Router
Goal: lower COGS while improving normal-user UX.

Tasks:
- Separate RoutingService/policy from provider adapter.
- Classify request complexity/capabilities.
- Select from allowed model set based on capability, quality tier, cost and health.
- Persist routing decision + policy version.
- Add fallback logic.

Acceptance:
- manual selection remains deterministic;
- Auto decisions are auditable;
- routing cannot select a model not entitled/enabled for user/action.

## Phase 9 — Agents/workflows
Goal: multi-step tasks while preserving a hard spend ceiling.

Tasks:
- Agent run entity and worker queue.
- Explicit per-run budget/reservation.
- Child AI/tool operations linked to the parent run.
- Maximum iterations/tool calls/time.
- Abort/cancellation.

Acceptance:
- an agent cannot exceed its reserved/allowed run budget;
- retries cannot duplicate external side effects or billing.

## Phase 10 — Production hardening
Before public paid launch:
- DB backups tested.
- object storage retention/deletion policy.
- Sentry/error alerts.
- provider balance/spend alerts.
- abuse/rate/concurrency limits.
- payment webhook replay tests.
- dependency/security scan.
- privacy-safe logging review.
- load test text streaming and quota reservation concurrency.
- terms/privacy/offer/payment UX reviewed outside the codebase with legal/accounting specialists.
