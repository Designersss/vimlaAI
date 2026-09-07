# Vimla — Implementation Plan

Do not implement every phase in one Cursor run. Complete, test and review each phase before moving on.

## Phase 0 — Repository foundation
Goal: clean runnable monorepo, no real AI or payments.

- [ ] pnpm workspace + Turborepo.
- [ ] `apps/web`: Next.js 16 + React 19 + strict TypeScript + SCSS Modules + MobX foundation.
- [ ] `apps/api`: NestJS + Fastify + strict TypeScript.
- [ ] `apps/worker`: Node + BullMQ foundation.
- [ ] packages: contracts, database, config, ai, billing, shared.
- [ ] PostgreSQL + Prisma foundation.
- [ ] Redis foundation.
- [ ] Docker Compose for local PostgreSQL/Redis.
- [ ] centralized typed env validation.
- [ ] `.env.example`.
- [ ] structured logging/correlation ID foundation.
- [ ] `GET /health`.
- [ ] web can call configurable API health endpoint.
- [ ] worker can connect to Redis.
- [ ] root scripts: dev/build/lint/typecheck/test.
- [ ] basic CI.
- [ ] README with exact local setup.

Exit criteria: fresh clone can be configured and all baseline commands pass.

## Phase 1 — Persistence + authentication
Goal: real users and secure sessions, still no real billing/AI.

- [ ] finalise Prisma conventions/migrations.
- [ ] users/auth/session schema.
- [ ] authentication flow.
- [ ] server-side authorization/ownership helpers.
- [ ] protected app shell.
- [ ] user settings/profile minimum.
- [ ] tests for unauthorized/ownership paths.

Exit criteria: user can register/login/logout and access only own protected resources.

## Phase 2 — Billing/Usage domain with mock money
Goal: prove financial correctness before integrating payments or AI.

- [ ] Plan + PlanVersion.
- [ ] Subscription.
- [ ] Payment + PaymentEvent.
- [ ] UsageBucket.
- [ ] UsageReservation.
- [ ] UsageLedgerEntry.
- [ ] integer microRUB money type/helpers.
- [ ] grant monthly subscription allowance.
- [ ] create arbitrary top-up bucket.
- [ ] subscription-first bucket allocation policy.
- [ ] `reserve()` transaction.
- [ ] `settle()` transaction.
- [ ] `release()`/failure path.
- [ ] expiration handling.
- [ ] MockPaymentProvider.
- [ ] mock subscription purchase.
- [ ] mock top-up purchase.
- [ ] derived percentage endpoint.

Required tests:
- [ ] concurrent requests cannot overspend;
- [ ] insufficient allowance prevents execution;
- [ ] duplicate payment event grants only once;
- [ ] failure releases reservation;
- [ ] partial settlement releases difference;
- [ ] subscription allowance is consumed before top-up;
- [ ] expired subscription allowance cannot be spent;
- [ ] ledger can explain balance.

Exit criteria: billing invariant suite passes against real PostgreSQL.

## Phase 3 — AI Gateway + ProxyAPI text chat
Goal: first real AI value with financially safe metering.

- [ ] AiProvider interfaces.
- [ ] ProxyAPIProvider.
- [ ] validated ProxyAPI configuration.
- [ ] Vimla model catalog/mappings.
- [ ] model enable/disable controls.
- [ ] text generation/chat endpoint.
- [ ] SSE streaming.
- [ ] reservation before provider call.
- [ ] settle actual/derived provider cost.
- [ ] ai_request/provider-cost records.
- [ ] conversations/messages.
- [ ] frontend chat UI.
- [ ] manual model selector.
- [ ] usage meter.
- [ ] rate/concurrency limits.
- [ ] provider timeout/retry/error mapping.

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
