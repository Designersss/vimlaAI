# ONE — Project Agent Guide

## Product
ONE is a consumer/prosumer AI workspace that gives users one account, one balance/usage system, and one interface for multiple AI capabilities.

Core idea:
- User can explicitly select a model or use `Auto`.
- ONE routes requests through an internal AI Gateway.
- Initial AI provider is ProxyAPI. Provider-specific code must be isolated behind adapters so ProxyAPI can later be replaced or complemented by direct OpenAI/Anthropic/Google providers without changing product logic.
- The user never sees token prices per prompt. Subscription usage is displayed as a percentage.
- Users can buy subscriptions and arbitrary top-ups.
- Real provider cost is tracked internally in micro-rubles and is never trusted to the frontend.
- Subscription quota and top-up quota are separate usage buckets.
- The backend must prevent provider spending before an AI request if the user has insufficient allowance.

## Initial product scope
MVP capabilities, in order:
1. Authentication and user account.
2. Plans, subscriptions, arbitrary top-up balance, payment webhooks.
3. Usage engine with reservation -> provider call -> settlement -> append-only ledger.
4. Text chat with streaming and model selection.
5. Auto model routing.
6. Image generation.
7. Video generation via asynchronous jobs.
8. Agents/workflows via workers.
9. Admin finance/usage dashboard and provider reconciliation.

Do not implement later phases before the foundation for earlier phases is correct and tested.

## Stack
- Monorepo: pnpm workspaces + Turborepo.
- Frontend: Next.js 16 App Router, React 19, TypeScript, MobX, SCSS Modules.
- Backend: Node.js 24 LTS, TypeScript, NestJS with Fastify adapter.
- Worker: Node.js 24 LTS, TypeScript, BullMQ.
- Database: PostgreSQL + Prisma.
- Cache/queues: Redis.
- Object storage: S3-compatible.
- AI: provider abstraction, ProxyAPI adapter first.
- API contracts/validation: Zod shared between web and backend where appropriate.
- Observability: structured Pino logs; Sentry-ready; OpenTelemetry later.
- Deployment for MVP: Docker Compose on a VPS; no Kubernetes initially.

## Repository layout
Use this target layout unless an existing repository has a stronger established convention:

```text
apps/
  web/        # Next.js frontend
  api/        # NestJS/Fastify backend
  worker/     # BullMQ workers
packages/
  contracts/  # shared request/response schemas and DTO-safe types
  database/   # Prisma schema/client/migrations
  ai/         # provider interfaces, routing and price/capability metadata
  billing/    # pure billing/usage domain helpers when reusable
  config/     # typed env/config
  shared/     # framework-independent utilities only
docs/
.cursor/rules/
```

## Non-negotiable invariants
1. Never expose ProxyAPI keys or payment secrets to the browser.
2. PostgreSQL is the source of truth for money, quota, subscriptions and payment state.
3. Redis is never the source of truth for balances.
4. Never use floating point for money or provider cost. Use `BIGINT` micro-rubles.
5. Never store the displayed percentage as authoritative state. Calculate it from usage buckets.
6. Every financial/usage mutation must be idempotent and auditable.
7. AI calls that can consume quota must use reservation before provider execution and settlement afterward.
8. Payment success is accepted only from a verified provider webhook, never from browser redirect state.
9. Long-running image/video/agent jobs run in workers, not in long-lived request handlers.
10. Provider integrations must be replaceable adapters; product/domain code must not depend directly on ProxyAPI SDK shapes.
11. No premature microservices. Start as a modular monolith plus worker process.
12. No Kubernetes, Kafka, event sourcing framework, CQRS framework, or other heavy infrastructure unless a measured need appears.

## How Cursor should work in this repository
- Before changing architecture, read `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.
- Implement the current phase only; do not opportunistically build future phases.
- Prefer small coherent commits/changes over broad rewrites.
- Add or update tests for domain rules, especially billing, usage reservation, settlement, webhook idempotency, and provider errors.
- When a decision changes an important invariant or data model, update the relevant document in `docs/`.
- Never silently weaken type safety or financial safety to make a feature easier to implement.
