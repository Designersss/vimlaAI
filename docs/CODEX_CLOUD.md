# Codex Cloud environment for Vimla

This document defines the Codex Cloud environment required to run Vimla's full validation suite before a task is considered complete.

The goal is parity with `.github/workflows/ci.yml`: Codex should catch lint, type, unit, PostgreSQL/Redis integration, build, and browser E2E failures before GitHub Actions becomes the second independent check.

## Runtime

Use Linux with:

- Node.js 24.x (required by the repository `engines` field and CI);
- pnpm 10.17.0;
- PostgreSQL 16;
- Redis 7;
- Playwright Chromium, WebKit, Firefox and their Linux dependencies.

Do not use production databases, Redis, provider credentials, payment credentials, or real AI/provider traffic for validation.

## Persistent environment variables

Configure these in the Codex Cloud environment settings so they are available during both the setup and agent phases:

```text
NODE_ENV=test
APP_ENV=test
LOG_LEVEL=info
API_HOST=127.0.0.1
API_PORT=3001
WEB_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://vimla:vimla@localhost:5432/vimla
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_ADMIN_API_BASE_URL=http://localhost:3001
ADMIN_ORIGIN=http://localhost:3002
ADMIN_REQUIRE_PASSKEY=false
BETTER_AUTH_SECRET=local-dev-only-change-me-use-32-chars-min
BETTER_AUTH_URL=http://localhost:3001
TEST_DATABASE_URL=postgresql://vimla:vimla@localhost:5432/vimla_test
```

These values intentionally mirror GitHub CI and are test-only values, not production secrets.

## Setup script

The setup phase must ensure PostgreSQL and Redis are running before validation and install JavaScript/browser dependencies.

Prefer the repository's existing service definition when Docker is available:

```bash
set -euo pipefail

corepack enable
corepack prepare pnpm@10.17.0 --activate
pnpm install --frozen-lockfile

docker compose up -d postgres redis

# Fail setup early if dependencies never become healthy.
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U vimla -d vimla >/dev/null 2>&1 \
    && docker compose exec -T redis redis-cli ping | grep -q PONG; then
    break
  fi
  if [ "$i" = 30 ]; then
    docker compose ps
    exit 1
  fi
  sleep 1
done

pnpm --filter @vimla/web exec playwright install --with-deps chromium webkit firefox
pnpm --filter @vimla/admin-web exec playwright install chromium webkit firefox
```

If the Codex environment does not expose Docker, install/start PostgreSQL 16 and Redis 7 natively in the setup script instead, using the same users, databases, ports and URLs shown above. The agent must not work around missing services by skipping integration or E2E tests.

## Maintenance script

Cached Codex environments can resume on a newer commit. Use a maintenance script that refreshes repository dependencies and makes sure services are up:

```bash
set -euo pipefail

corepack enable
corepack prepare pnpm@10.17.0 --activate
pnpm install --frozen-lockfile

docker compose up -d postgres redis
```

If native PostgreSQL/Redis are used instead of Docker, replace the last line with the corresponding idempotent service-start commands.

When `pnpm-lock.yaml`, Playwright versions, the setup script, runtime versions, or environment variables change materially, reset the Codex Cloud environment cache.

## Required validation command

After implementation and before Codex reports completion, run:

```bash
pnpm codex:validate
```

That command is intentionally fail-fast and runs:

1. lint;
2. typecheck;
3. unit tests;
4. PostgreSQL/Redis integration tests;
5. production builds;
6. browser E2E;
7. `git diff --check`.

A task is not complete when this command is red or when a required dependency is unavailable. Fix the root cause and rerun until green. Do not weaken tests, feature gates, authorization, financial controls, security checks, or CI configuration merely to obtain green output.

## GitHub CI remains mandatory

A green Codex Cloud validation is a pre-push/pre-delivery gate, not a replacement for GitHub Actions. GitHub CI remains the independent final environment check after the changes are published.

If GitHub CI fails despite a green Codex run, compare the exact environment and failure first. Fix the root cause and rerun `pnpm codex:validate` before publishing another revision.

## Network access

Setup scripts may use internet access to install dependencies. Agent-phase internet access should stay off unless a task genuinely requires it. Normal Vimla tests must use mock/test providers and must not depend on live AI, email, or payment services.
