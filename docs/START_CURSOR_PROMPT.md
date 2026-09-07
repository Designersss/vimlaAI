# First Cursor prompt — Vimla

Copy the prompt below into Cursor Agent after placing this starter pack at the repository root.

---

You are starting implementation of a brand-new product called **Vimla**.

Before writing code, read and treat as project context/source of truth:

1. `AGENTS.md`
2. every relevant file in `.cursor/rules/*.mdc`
3. `docs/PROJECT.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DOMAIN_MODEL.md`
6. `docs/DECISIONS.md`
7. `docs/IMPLEMENTATION_PLAN.md`

First inspect the repository. If it is not empty, preserve useful existing user code and migrate intentionally; do not blindly delete files.

## Product context
Vimla is a unified consumer/prosumer AI workspace. It will eventually provide multi-model chat, manual model selection and Auto routing, image/video generation, projects/files, agents, subscriptions and arbitrary top-ups. Users see simple subscription usage as 0–100%, while the backend performs exact provider-cost accounting.

The first AI gateway is ProxyAPI, funded by the user's Russian LLC. ProxyAPI must remain behind Vimla's own `AiProvider` abstraction so it can be replaced or supplemented later.

## Current task
Implement **only Phase 0 — Repository foundation** from `docs/IMPLEMENTATION_PLAN.md`.

Do not implement Phase 1+ features. In particular, do not implement real auth, real payments, ProxyAPI calls, chat, images, video, agents or the full billing engine.

## Required stack
Frontend:
- Next.js 16 App Router
- React 19
- TypeScript strict
- MobX foundation
- SCSS Modules

Backend:
- Node.js 24 LTS
- TypeScript strict
- NestJS
- Fastify adapter

Worker/infrastructure:
- BullMQ
- Redis
- PostgreSQL
- Prisma
- pnpm workspaces
- Turborepo
- Docker Compose

Create this monorepo structure:

```text
apps/
  web/
  api/
  worker/
packages/
  contracts/
  database/
  config/
  ai/
  billing/
  shared/
```

## Phase 0 deliverables
1. Initialize pnpm workspace and Turborepo.
2. Create `apps/web` with Next.js 16/React 19/strict TS and baseline SCSS Modules/MobX setup.
3. Create `apps/api` with NestJS + Fastify and `GET /health`.
4. Create `apps/worker` with BullMQ/Redis connectivity foundation.
5. Create all listed packages with clear package boundaries and build/typecheck setup.
6. Add PostgreSQL + Prisma foundation in `packages/database`.
7. Add Redis configuration/foundation.
8. Add Docker Compose for local PostgreSQL and Redis.
9. Implement centralized validated environment configuration; do not scatter raw `process.env` reads throughout the codebase.
10. Add `.env.example` with no real secrets.
11. Make the web app able to call the API health endpoint through a configurable API base URL.
12. Add structured logging (Pino or suitable NestJS/Fastify integration) and request/correlation ID foundation.
13. Add root scripts: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
14. Add minimal test infrastructure and useful smoke tests.
15. Add `.gitignore`.
16. Add root `README.md` with exact local setup/run/test/build commands.
17. Add basic CI: install -> lint -> typecheck -> test -> build.

## Non-negotiable constraints
- Do not create microservices.
- Do not add Kubernetes, Kafka, RabbitMQ, CQRS framework or event-sourcing framework.
- Do not install ProxyAPI/OpenAI/Anthropic/Google AI integrations yet.
- Do not install a real payment provider SDK yet.
- PostgreSQL will be the source of truth for payments/subscriptions/usage/provider-cost accounting.
- Redis is only for queues/cache/rate limits/temporary coordination, never authoritative money/usage.
- Never use `any`.
- Avoid unsafe type assertions; validate external data.
- No provider secret may ever reach browser code.
- Follow the scoped Cursor rules in `.cursor/rules`.

The future critical financial flow is:

```text
Payment
 -> Usage Bucket
 -> Reservation
 -> AI Gateway
 -> Provider
 -> Actual Provider Cost
 -> Settlement
 -> Usage Ledger
```

Do **not** implement that full flow now, but do not make architectural choices that prevent it.

## Completion protocol
Before reporting Phase 0 complete, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Fix errors introduced by the implementation.

Then report:
- apps/packages created;
- final repository tree;
- Docker services;
- environment variables;
- exact local commands;
- lint/typecheck/test/build results;
- technical debt/open questions;
- files changed;
- only the Phase 0 checkboxes actually completed in `docs/IMPLEMENTATION_PLAN.md`.

Stop after Phase 0. Do not start Phase 1 without a separate instruction.
