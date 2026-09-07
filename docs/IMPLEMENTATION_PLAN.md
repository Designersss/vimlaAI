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

## Phase 4 — Real payment provider
Goal: real subscription/top-up money activates existing billing domain.

- [ ] choose payment provider (do not assume until user decides).
- [ ] implement PaymentProvider adapter.
- [ ] checkout endpoints.
- [ ] verified webhook.
- [ ] subscription purchase/renewal.
- [ ] arbitrary top-up amount with server-side min/max rules.
- [ ] duplicate webhook protection.
- [ ] cancellation/refund domain paths.
- [ ] billing history UI.

Exit criteria: browser redirects cannot grant value; verified idempotent webhook does.

## Phase 5 — Admin + provider treasury
Goal: operator can see whether Vimla is profitable/safe.

- [ ] admin authorization/audit.
- [ ] ProxyAPI balance sync/snapshots.
- [ ] daily provider spend.
- [ ] provider runway estimate.
- [ ] low-balance alerts.
- [ ] revenue vs provider COGS dashboard.
- [ ] per-plan/per-user provider cost.
- [ ] cost anomaly alert thresholds.
- [ ] reconciliation job comparing Vimla accounting to provider data.

Exit criteria: operator can detect low provider balance/cost anomalies before outage/material loss.

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
