# Vimla — Project Agent Guide

## Product identity
Vimla is a global consumer/prosumer AI workspace. Users get one account, one interface, one usage system, and access to multiple AI capabilities without needing separate subscriptions to each AI provider.

Vimla is the final product name. Use `Vimla` consistently in product copy, documentation, package naming, code comments, and architecture diagrams. The project domain has already been purchased; do not invent or hardcode a domain value until it is explicitly configured.

## Product idea
Vimla should let a user:
- use text models such as GPT, Claude, Gemini and others;
- explicitly select a model or use `Auto`;
- generate images;
- generate videos;
- work with files and projects;
- later run agents/workflows;
- buy a subscription and arbitrary additional usage;
- see simple usage as a percentage instead of token prices per prompt.

The initial AI provider is ProxyAPI. Provider-specific code must be isolated behind adapters so ProxyAPI can later be replaced or complemented by direct OpenAI, Anthropic, Google, or other providers without changing Vimla product logic.

## Commercial model
Initial provisional plans are configurable business data, not hardcoded product logic:
- Lite: 150 RUB;
- Start: 300 RUB;
- Pro: 990 RUB;
- arbitrary top-up: any supported amount.

The user does not buy provider tokens. The user buys access/usage inside Vimla.

The percentage shown to the user is only presentation. The authoritative state is stored in the billing/usage domain.

Initial provisional maximum provider-cost budgets:
- Lite: up to 20% of plan price;
- Start: up to 25%;
- Pro: up to 30%;
- top-up: up to 35% of top-up amount.

These ratios must be versioned/configurable and must never be scattered as magic constants through the codebase.

## Business/payment context
The product is initially operated by a Russian LLC (ООО) with a business account at T-Bank.
- Customer acquiring must be hidden behind a `PaymentProvider` abstraction.
- The first real acquiring provider will be selected later (T-Kassa, CloudPayments, YooKassa, or another compliant provider).
- ProxyAPI is funded by the company and provides closing documents/business billing.
- Vimla must maintain its own per-user usage ledger. Users never receive ProxyAPI keys or direct access to the corporate provider balance.

## Initial product scope
MVP capabilities, in order:
1. Repository and infrastructure foundation.
2. Authentication and user account.
3. Plans, subscriptions, arbitrary top-up, payment-domain foundation.
4. Usage Engine with reservation -> provider call -> settlement -> append-only ledger.
5. Text chat with streaming and model selection through ProxyAPI.
6. Real payment adapter.
7. Provider treasury/admin finance dashboard.
8. Auto model routing.
9. Image generation.
10. Video generation through asynchronous jobs.
11. Projects/files.
12. Agents/workflows through workers.
13. Production hardening.

Do not implement later phases before earlier foundations are correct and tested.

## Technology stack
- Monorepo: pnpm workspaces + Turborepo.
- Frontend: Next.js 16 App Router, React 19, TypeScript strict, MobX, SCSS Modules.
- Backend: Node.js 24 LTS, TypeScript strict, NestJS with Fastify adapter.
- Worker: Node.js 24 LTS, TypeScript strict, BullMQ.
- Database: PostgreSQL + Prisma.
- Cache/queues: Redis.
- Object storage: S3-compatible.
- AI: internal provider abstraction; ProxyAPI adapter first.
- Shared validation/contracts: Zod where appropriate.
- Logging: Pino structured logs.
- Observability: Sentry-ready; OpenTelemetry later.
- MVP deployment: Docker Compose on a VPS; no Kubernetes initially.

## Target repository layout
```text
apps/
  web/        # Next.js frontend
  api/        # NestJS/Fastify modular-monolith backend
  worker/     # BullMQ background workers
packages/
  contracts/  # shared schemas and API-safe types
  database/   # Prisma schema/client/migrations
  config/     # typed environment/configuration
  ai/         # provider interfaces, model metadata, routing contracts
  billing/    # framework-independent billing/usage domain helpers
  shared/     # framework-independent utilities only
docs/
.cursor/rules/
```

## Non-negotiable invariants
1. Never expose ProxyAPI keys, payment secrets, database credentials, or private infrastructure secrets to browser code.
2. PostgreSQL is the source of truth for money, quota, subscriptions, payments, and settlements.
3. Redis is never the source of truth for balances or money.
4. Never use floating-point arithmetic for money/provider cost. Use integer micro-rubles (`BIGINT`) or an equally precise integer representation.
5. Never store displayed usage percentage as authoritative state. Calculate it from usage buckets/allocations.
6. Every financial/usage mutation must be idempotent, traceable, and auditable.
7. Every AI operation that can consume quota must reserve allowance before provider execution and settle afterward.
8. Payment success is accepted only from a verified provider webhook/server-side confirmation, never from browser redirect state.
9. Long-running image/video/agent operations run in workers, not long-lived request handlers.
10. Provider integrations are replaceable adapters. Product/domain code must not depend on ProxyAPI-specific response shapes.
11. Start as a modular monolith plus worker process. Do not introduce premature microservices.
12. No Kubernetes, Kafka, event-sourcing framework, CQRS framework, or similarly heavy infrastructure without measured need.
13. No direct mutation of financial state from frontend.
14. Financial operations must be transactional and safe under concurrent requests.
15. Top-up usage and subscription-period usage are separate buckets. Monthly usage is consumed first; top-up is preserved unless business rules change explicitly.

## Cursor workflow
Before changing architecture or financial code, read:
- `docs/PROJECT.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- relevant `.cursor/rules/*.mdc`

Implement the current phase only. Do not opportunistically build later phases.

When an implementation decision changes an important invariant, data model, public contract, or phase status, update the relevant file under `docs/`.

Never weaken type safety, financial safety, idempotency, validation, or security just to make implementation faster.
