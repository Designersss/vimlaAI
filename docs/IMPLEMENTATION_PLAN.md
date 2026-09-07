# Vimla — Implementation Plan

This is the execution order. Do not skip ahead because a later feature is more visible.

## Phase 0 — Repository foundation
Goal: a clean monorepo that builds locally and in CI.

Tasks:
- Initialize pnpm workspace + Turborepo.
- Create `apps/web`, `apps/api`, `apps/worker`.
- Create shared packages: `contracts`, `database`, `config`, `ai`, `billing`, `shared`.
- Add shared TypeScript strict configuration.
- Add ESLint/formatting conventions.
- Add typed environment parsing and `.env.example`.
- Add Docker Compose for PostgreSQL + Redis.
- Add root commands: `dev`, `build`, `lint`, `typecheck`, `test`.
- Add basic CI pipeline.
- Add API `/health`.
- Add worker Redis connectivity foundation.
- Add structured logging foundation.

Acceptance:
- fresh clone -> documented install -> `pnpm dev` works;
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass;
- API exposes `/health`;
- worker can connect to Redis;
- web can call API health using configured public API URL.

## Phase 1 — Persistence + authentication foundation
Goal: users can register/login and protected boundaries exist.

Tasks:
- Prisma schema/migrations foundation.
- User/session/auth domain.
- Choose a simple secure MVP auth implementation behind `AuthModule`.
- Add user role: `user`, `admin`.
- Add request correlation IDs.
- Add rate-limit foundation.
- Add ownership checks pattern.

Acceptance:
- register/login/logout works;
- protected endpoint rejects anonymous users;
- one user cannot access another user's resource;
- auth/server secrets never reach frontend JS.

## Phase 2 — Billing/Usage domain without real acquiring
Goal: make the difficult financial core correct before real money or real AI calls.

Tasks:
- Implement `plans` + immutable/versioned `plan_versions`.
- Seed provisional 150/300/990 plans as configurable DB data, not code constants.
- Store provider-cost budget ratios per plan version.
- Implement arbitrary top-up product flow in domain model.
- Implement `usage_buckets`.
- Implement `usage_reservations`.
- Implement `usage_allocations` if needed for multi-bucket settlement.
- Implement append-only `usage_ledger`.
- Implement atomic `reserve`, `settle`, `release`.
- Consume expiring/monthly buckets before non-expiring top-up buckets.
- Create `PaymentProvider` interface.
- Implement `MockPaymentProvider` and mock verified webhook flow.
- Add idempotency keys/events.
- Use integer micro-rubles; no floating-point money math.

Acceptance:
- duplicate payment webhook cannot double-grant;
- concurrent usage requests cannot overspend;
- top-up creates a separate bucket;
- monthly bucket is consumed before top-up;
- failed/aborted mock usage releases reservation;
- settled usage cannot be settled twice;
- every financial mutation has an auditable ledger trail;
- all invariants in `.cursor/rules/40-billing-usage.mdc` have tests.

## Phase 3 — ProxyAPI text MVP
Goal: entitlement-safe multi-model streaming chat.

Tasks:
- Create `AiProvider` interface.
- Implement ProxyAPI adapter.
- Create Vimla-owned model catalog with stable IDs.
- Configure at least three text models representing different price/performance tiers.
- Implement streaming text generation.
- Bound maximum output tokens.
- Persist provider request ID and provider-reported usage/cost metadata where available.
- Add versioned provider pricing/cost calculation.
- Wrap every provider call in Usage reservation/settlement.
- Handle insufficient Vimla allowance before provider execution.
- Handle provider 402/429/timeouts/errors safely.
- Persist conversations/messages.
- Frontend: chat shell, model selector, composer, streaming message, usage percentage.

Acceptance:
- at least three configured models work through Vimla;
- provider key never reaches browser;
- actual usage settles quota;
- failed unbilled request releases reservation;
- exhausted user allowance prevents provider call;
- frontend usage always refreshes from backend truth.

## Phase 4 — Real payment adapter
Goal: real company payments grant Vimla entitlements safely.

Tasks:
- Select first acquiring provider based on business decision (T-Kassa / CloudPayments / YooKassa or other compliant provider).
- Implement adapter behind `PaymentProvider`.
- Implement checkout creation.
- Verify webhook signatures/server confirmation.
- Implement subscription purchase.
- Implement arbitrary top-up purchase.
- Add refund/cancellation behavior required by provider/business rules.
- Add receipt/fiscalization integration requirements according to the selected setup.

Acceptance:
- sandbox/test payment -> verified webhook -> exactly one entitlement grant;
- frontend redirect cannot forge activation;
- replayed webhook is harmless;
- payment amount/currency/product are verified server-side.

## Phase 5 — Provider treasury + admin finance
Goal: owner can see whether Vimla is financially healthy.

Tasks:
- Poll/store ProxyAPI balance snapshots using appropriately scoped credentials.
- Calculate 24h/7d burn and estimated runway.
- Admin dashboard:
  - successful customer payments;
  - subscription/top-up revenue events;
  - calculated AI COGS;
  - AI COGS / revenue;
  - usage by plan/model/capability;
  - provider errors;
  - provider balance/runway.
- Add low-balance alerts.
- Add abnormal-spend alerts.
- Add reconciliation job comparing Vimla-calculated provider cost with ProxyAPI logs/reporting.

Acceptance:
- owner receives warning before provider balance becomes critical;
- an AI operation can be traced user -> reservation -> provider request -> settlement;
- reconciliation differences above configured threshold alert admins.

## Phase 6 — Auto Router
Goal: reduce COGS and simplify normal-user UX.

Tasks:
- Keep RoutingService separate from provider adapter.
- Classify request capabilities/complexity.
- Choose from allowed models using capability, quality tier, cost, entitlement and health.
- Persist routing decision and routing-policy version.
- Add fallback behavior.

Acceptance:
- manual model selection remains deterministic;
- Auto decisions are auditable;
- router cannot choose disabled/unauthorized models;
- fallback cannot bypass Usage Engine.

## Phase 7 — Images
Goal: image generation uses the same financial guarantees.

Tasks:
- Add image capability to AI Gateway.
- Reserve maximum estimated cost before generation.
- Use worker/job for asynchronous providers where appropriate.
- Store media in S3-compatible object storage.
- Persist metadata.
- Add image generation UI/library.

Acceptance:
- no image operation bypasses Usage Engine;
- retry/failure cannot double-charge;
- media blobs are not stored in PostgreSQL.

## Phase 8 — Video
Goal: asynchronous video generation with predictable maximum spend.

Tasks:
- Add `generation_jobs` lifecycle.
- Add BullMQ video queue.
- Provider submit/status/result adapter.
- Strong max-cost reservation using model/duration/resolution.
- Cancellation where provider semantics support it.
- SSE or polling progress UI.

Acceptance:
- API returns quickly with a job ID;
- worker retry is idempotent;
- user cannot launch video whose estimated max cost exceeds allowance;
- ambiguous provider billing state is traceable/reconcilable.

## Phase 9 — Projects and files
Goal: persistent workspaces instead of isolated chats.

Tasks:
- Project entity.
- Attach conversations, files and generations to projects.
- File upload metadata/object storage.
- Ownership/access controls.
- Context selection rules for future agents.

Acceptance:
- users cannot access another user's project/files;
- deletion/retention is explicit and testable.

## Phase 10 — Agents/workflows
Goal: multi-step tasks with a hard spend ceiling.

Tasks:
- Agent run entity.
- Agent queue/worker.
- Explicit per-run budget/reservation.
- Child AI/tool operations linked to parent run.
- Maximum iterations/tool calls/time.
- Cancellation/abort.

Acceptance:
- agent cannot exceed its budget;
- retries cannot duplicate billing/external side effects;
- every child operation is traceable.

## Phase 11 — Production hardening
Before public paid launch:
- test DB backups/restores;
- object storage retention/deletion policy;
- Sentry/error alerts;
- provider balance/spend alerts;
- abuse/rate/concurrency limits;
- payment webhook replay tests;
- dependency/security scanning;
- privacy-safe logging review;
- load test streaming and quota reservation concurrency;
- legal/accounting review of offer/privacy/payment UX outside the codebase;
- admin emergency switches for expensive capabilities/models.
