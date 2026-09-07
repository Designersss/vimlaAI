# Vimla — Project Instructions

## Product
Vimla is a consumer/prosumer AI workspace that gives users one account and one interface for multiple AI capabilities.

Core product direction:
- multi-model chat (GPT, Claude, Gemini and additional models);
- manual model selection and future `Auto` routing;
- image generation;
- video generation;
- projects and files;
- AI agents/workflows;
- subscription plans plus arbitrary top-ups;
- simple usage UI for users instead of token accounting.

The first AI provider/gateway is ProxyAPI. Vimla must never be architecturally coupled to ProxyAPI. All provider access goes through Vimla's own AI provider abstraction.

## Current commercial model
Vimla is operated by the user's Russian LLC. Customer revenue is received by the LLC. ProxyAPI is replenished from the LLC settlement account under the provider's B2B flow.

Initial pricing assumptions (business configuration, not hard-coded constants):
- Lite: 150 RUB;
- Start: 300 RUB;
- Pro: 990 RUB;
- arbitrary top-up amount.

Current target maximum AI/provider-cost ratios are assumptions and must be configurable/versioned:
- Lite: about 20%;
- Start: about 25%;
- Pro: about 30%;
- top-up: about 35%.

These values can change. Code must not scatter them as literals.

## User-facing usage model
For subscriptions, users see a simple percentage such as `62% used / 38% remaining`.

The percentage is presentation only. It is never authoritative financial state.

The backend stores exact integer usage/billing values and derives the percentage.

Top-ups create a separate non-expiring (unless policy changes) usage bucket. Subscription allowance is spent before top-up allowance.

## Financial invariants
These are non-negotiable:
1. Never call an AI provider before checking and reserving sufficient user allowance.
2. Use reservation -> provider call -> settlement/release.
3. PostgreSQL is the source of truth for payments, subscriptions, usage and provider-cost accounting.
4. Redis is never the source of truth for money or usage.
5. Never use JS floating-point numbers as authoritative money values.
6. Use integer monetary units (microRUB) in domain/storage (`BIGINT`/`bigint`).
7. Every payment/provider webhook and ledger mutation must be idempotent.
8. Ledger history is append-only. Corrections are compensating entries, not destructive edits.
9. User allowance and ProxyAPI corporate balance are separate systems.
10. A user reaching 100% must be blocked before an expensive provider request is sent.

## Architecture
Start as a modular monolith plus a separate worker process.

Monorepo target:

```text
apps/
  web/        Next.js frontend
  api/        NestJS + Fastify modular monolith
  worker/     BullMQ workers

packages/
  contracts/  shared schemas/contracts
  database/   Prisma schema/client/migrations
  config/     validated configuration
  auth/       Better Auth configuration
  ai/         provider abstractions/model metadata
  billing/    framework-independent billing domain
  shared/     genuinely shared utilities
```

Core path:

```text
Browser
  -> Vimla Web
  -> Vimla API
  -> Auth / Rate Limit
  -> Usage Reservation
  -> AI Gateway
  -> AiProvider
  -> ProxyAPIProvider
  -> ProxyAPI
  -> model
  -> actual cost / usage
  -> settlement
  -> usage ledger
```

Async path:

```text
API -> PostgreSQL job record -> BullMQ -> Worker -> AI Gateway -> provider
```

## Stack
Frontend:
- Next.js 16 App Router;
- React 19;
- TypeScript strict;
- MobX for client-domain UI state only;
- SCSS Modules.

Backend:
- Node.js 24 LTS;
- TypeScript strict;
- NestJS;
- Fastify adapter.

Data/infrastructure:
- PostgreSQL;
- Prisma;
- Redis;
- BullMQ;
- S3-compatible object storage;
- pnpm workspaces;
- Turborepo;
- Docker Compose for local development.

## General engineering rules
- No `any`. Use explicit types, generics or `unknown` with validation/narrowing.
- Avoid unsafe type assertions. Validate external data at boundaries.
- Do not expose provider API keys to the browser.
- Do not call ProxyAPI directly from frontend code.
- Controllers/routes are transport adapters, not business logic containers.
- Keep domain logic framework-independent where practical.
- Do not add microservices, Kafka, Kubernetes or other distributed complexity until justified by measured load.
- Prefer small focused modules and functions over giant files.
- New external integrations must sit behind interfaces/adapters.
- Validate every external input: HTTP, webhook, provider response, environment variable and queue payload.
- Never log secrets, authorization headers, full payment data or raw sensitive file contents.

## Sources of truth
Use these documents in this order when making architectural decisions:
1. `AGENTS.md`
2. relevant `.cursor/rules/*.mdc`
3. `docs/PROJECT.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DOMAIN_MODEL.md`
6. `docs/IMPLEMENTATION_PLAN.md`

If requirements conflict, stop expanding scope and choose the safer, simpler option consistent with billing/security invariants.
