#!/usr/bin/env bash
set -euo pipefail

required_env=(
  NODE_ENV
  APP_ENV
  API_HOST
  API_PORT
  WEB_ORIGIN
  DATABASE_URL
  REDIS_URL
  NEXT_PUBLIC_API_BASE_URL
  NEXT_PUBLIC_ADMIN_API_BASE_URL
  ADMIN_ORIGIN
  ADMIN_REQUIRE_PASSKEY
  BETTER_AUTH_SECRET
  BETTER_AUTH_URL
  TEST_DATABASE_URL
)

missing=()
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Codex validation environment is incomplete. Missing: %s\n' "${missing[*]}" >&2
  exit 2
fi

printf '\n==> lint\n'
pnpm lint

printf '\n==> typecheck\n'
pnpm typecheck

printf '\n==> unit tests\n'
pnpm test

printf '\n==> integration tests\n'
pnpm test:integration

printf '\n==> build\n'
pnpm build

printf '\n==> browser e2e\n'
pnpm test:e2e

printf '\n==> diff whitespace check\n'
git diff --check

printf '\nCodex validation suite is green.\n'
