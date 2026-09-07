# Vimla

Unified consumer/prosumer AI workspace. This repository is a pnpm + Turborepo monorepo.

Phase 3 adds financially metered streaming text chat through Vimla's AI Gateway and a ProxyAPI adapter. Images, video, agents and real acquiring are still out of scope.

## Requirements

- Node.js 24 LTS
- pnpm 10.17.0 (`corepack enable` then `corepack prepare pnpm@10.17.0 --activate`)
- Docker Desktop (PostgreSQL and Redis)

## Install

```bash
pnpm install
```

## Environment setup

```bash
cp .env.example .env
```

If `.env` already exists from an earlier phase, copy the new `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TEST_DATABASE_URL` values from `.env.example`. Do not commit real secrets.

`.env.example` contains names and safe local values only. Never put real provider or payment secrets in git or `NEXT_PUBLIC_*` variables.

All runtime configuration is validated in `@vimla/config`. Application code should not read `process.env` directly, except the Next.js public env file that must use static `process.env.NEXT_PUBLIC_*` access so Next can inline it.

## Docker

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Stop:

```bash
docker compose down
```

## PostgreSQL

Local URL from `.env.example`:

```text
postgresql://vimla:vimla@localhost:5432/vimla
```

Generate the Prisma client:

```bash
pnpm db:generate
```

Apply migrations:

```bash
pnpm db:migrate:dev
```

Deploy already-created migrations (CI and test databases):

```bash
pnpm db:migrate:deploy
```

Idempotent plan and AI model seed:

```bash
pnpm db:seed
```

Prisma Studio:

```bash
pnpm db:studio
```

PostgreSQL is the source of truth for payments, subscriptions, usage and provider-cost accounting.

## Redis

Local URL from `.env.example`:

```text
redis://localhost:6379
```

Redis is for queues, cache and coordination. It is never the source of truth for money or usage.

## Development

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
```

This starts:

- web: [http://localhost:3000](http://localhost:3000) (`/sign-in`, `/sign-up`, `/app`)
- api: [http://localhost:3001](http://localhost:3001) (`GET /health`, `GET /v1/me`, `GET /v1/plans`, `GET /v1/usage`, `GET /v1/subscription`, `GET /v1/ai/models`, `/v1/conversations`, `/api/auth/*`)
- worker: BullMQ / Redis connection process

Local/test only: `POST /dev/mock-purchases/subscription` and `POST /dev/mock-purchases/topup` (authenticated, server-side prices). These routes are not registered in staging/production.

To chat against real ProxyAPI locally, set `PROXYAPI_API_KEY` in `.env` (never `NEXT_PUBLIC_*`). Leave it empty to use the mock AI provider. Staging/production require a key when `AI_TEXT_ENABLED=true`.

Optional live smoke (not CI, max 1–2 tiny requests):

```bash
VIMLA_PROXYAPI_LIVE=1 pnpm test:proxyapi
```

Email verification and password-reset emails are not sent in Phase 1. Sign-up works locally without SMTP.

## Tests

```bash
pnpm test
```

Default tests are unit/smoke tests. They do not require Docker, do not call ProxyAPI, and do not spend provider money.

Integration tests need PostgreSQL and Redis, use the `vimla_test` database, apply migrations, and use `MockAiProvider` only:

```bash
docker compose up -d
pnpm test:integration
```

## Lint

```bash
pnpm lint
```

## Typecheck

```bash
pnpm typecheck
```

## Build

```bash
pnpm build
```

## Workspace layout

```text
apps/web        Next.js 16 App Router
apps/api        NestJS + Fastify modular monolith
apps/worker     BullMQ worker process
packages/contracts
packages/database
packages/config
packages/auth
packages/ai
packages/billing
packages/shared
```

## Money

Authoritative amounts use integer microRUB (`bigint` / PostgreSQL `BIGINT`):

```text
1 RUB = 1_000_000 microRUB
```

JSON serialization must use an explicit decimal string / money DTO. JavaScript `number` is not allowed as authoritative money storage.
