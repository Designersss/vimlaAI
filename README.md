# Vimla

Unified consumer/prosumer AI workspace. This repository is a pnpm + Turborepo monorepo.

Phase 4 adds T-Bank Internet Acquiring (hosted payment page only). Phase 4.5 adds an internal finance/tariff foundation (**TOPUP never expires**; no public finance API). Phase 5 adds a separate Admin control plane on `http://localhost:3002` (`/admin/v1/*`). Phase 5.5 adds the shared `@vimla/ui` design system used by Web and Admin. Images, video, agents and projects remain out of scope.

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

- web: [http://localhost:3000](http://localhost:3000) (`/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/settings/security`, `/settings/billing`, `/settings/appearance`, `/payment/result`, `/app`). Local/test-only `/dev/ui` design catalog is gated on `APP_ENV=local|test`.
- admin: [http://localhost:3002](http://localhost:3002) (privileged control plane; not part of `apps/web`)
- api: [http://localhost:3001](http://localhost:3001) (`GET /health`, `GET /v1/me`, `PATCH /v1/me/preferences`, `GET /v1/plans`, `GET /v1/usage`, `GET /v1/subscription`, `POST /v1/payments/subscriptions`, `POST /v1/payments/topups`, `GET /v1/payments`, `POST /webhooks/tbank/payments`, `GET /v1/ai/models`, `/v1/conversations`, `/api/auth/*`, `/admin/v1/*`)
- worker: BullMQ / Redis process, including pending-payment reconciliation

Local/test default `PAYMENT_PROVIDER=mock` uses a Vimla mock hosted page. `/dev/mock-purchases/*` still exists for chat E2E shortcuts. Staging/production require `PAYMENT_PROVIDER=tbank` and never register mock purchase routes. `pnpm test:tbank` is a reminder only — default CI never calls T-Bank.

Local/test notification inbox (never in staging/production):

```bash
GET /dev/notifications/latest
GET /dev/notifications/latest?channel=email&to=you@example.com
```

An empty inbox returns `404` with `error.code=notification_not_found` (the route exists). After signup, the same URL without query params returns the latest memory OTP.

Sign-up creates an unverified user and emails a 6-digit OTP (memory inbox in local/test). Confirm at `/verify-email` before chat send or mock purchases. Existing unverified Phase 1 accounts can sign in and complete the same OTP screen. Do not auto-verify old rows.

To chat against real ProxyAPI locally, set `PROXYAPI_API_KEY` in `.env` (never `NEXT_PUBLIC_*`). Leave it empty to use the mock AI provider. Staging/production require a key when `AI_TEXT_ENABLED=true`.

Optional live smoke (not CI, max 1–2 tiny requests):

```bash
VIMLA_PROXYAPI_LIVE=1 pnpm test:proxyapi
```

Email verification and password-reset emails use the memory inbox in local/test (`GET /dev/notifications/latest`). Staging/production require SMTP + HTTP SMS (`EMAIL_PROVIDER=smtp`, `SMS_PROVIDER=http`) or the API will refuse to start. Do not send auth mail from a free mailbox. Configure SPF, DKIM and DMARC on the Vimla sender domain in DNS (not in this repo).

## Tests

```bash
pnpm test
```

Default tests are unit/smoke tests. They do not require Docker, do not call ProxyAPI, and do not spend provider money.

Integration tests need PostgreSQL and Redis, use the `vimla_test` database, apply migrations, and use `MockAiProvider` only:

```bash
docker compose up -d
pnpm test:integration
pnpm test:e2e
```

`pnpm test:e2e` starts the consumer API on `http://localhost:3101` and web on `http://localhost:3100`, then Admin API on `http://localhost:3201` and `apps/admin` on `http://localhost:3202`, against `vimla_test`, memory notifications, MockAiProvider and mock purchases. It does not send real email, SMS, ProxyAPI or payment traffic, and it does not reuse a local `pnpm dev` server.

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
apps/admin      Privileged Admin control plane (port 3002)
apps/api        NestJS + Fastify modular monolith
apps/worker     BullMQ worker process
packages/contracts
packages/database
packages/config
packages/auth
packages/admin
packages/ai
packages/billing
packages/notifications
packages/shared
packages/ui
```

Owner bootstrap (existing verified user, no password, operator CLI on the server):

```bash
pnpm admin:bootstrap --user-id <uuid>
pnpm admin:disable --user-id <uuid>
pnpm admin:revoke-sessions --user-id <uuid>
```

MFA/passkey enrollment (Admin app, after identity login):

1. Sign in at `http://localhost:3002/sign-in` with the bootstrapped user's password.
2. Open `/enroll`, enter the password, scan the TOTP URI in an authenticator app, save backup codes (shown once), verify the TOTP code.
3. Add at least one passkey (`/enroll`). Staging/production require a passkey (`ADMIN_REQUIRE_PASSKEY=true`).
4. Open `/elevate`, enter TOTP or a backup code to create the privileged `AdminSession`.
5. SMS and email OTP are not sufficient Admin factors. Lost MFA: remaining backup codes, another passkey, or server CLI disable/revoke (audited). There is no email magic-link Admin recovery.

## Money

Authoritative amounts use integer microRUB (`bigint` / PostgreSQL `BIGINT`):

```text
1 RUB = 1_000_000 microRUB
```

JSON serialization must use an explicit decimal string / money DTO. JavaScript `number` is not allowed as authoritative money storage.
