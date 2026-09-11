# apps/api — Codex guidance

This file extends the root `AGENTS.md` for the NestJS + Fastify API.

## Architecture

- Keep controllers thin: parse/validate/authorize/orchestrate only.
- Put business rules in domain/application services or shared packages.
- Preserve explicit module boundaries and avoid circular dependencies.
- Use Fastify-compatible APIs; do not assume Express-specific behavior.
- Consumer API endpoints normally live under `/v1`; provider/framework routes may use their established namespaces.
- Configuration comes from validated `@vimla/config`, not scattered `process.env` reads.

## Authorization and request security

- Identity comes from the authenticated server session/context, never request payload authority fields.
- Scope owner/member/project/direct-chat resources in the DB lookup itself when practical.
- Preserve enumeration-safe `404` semantics for private resources.
- Mutating cookie-authenticated routes must use the established trusted-origin/CSRF-safe guard pattern.
- Expensive routes need explicit rate/concurrency/size/cost controls.
- Stable error envelopes only. Do not leak Prisma/Postgres/provider internals.
- Propagate correlation/request IDs through important mutations and logs.

## Transactions / concurrency

- Critical side effects must be safe under retry, duplicate calls, parallel requests and process crashes.
- Use PostgreSQL transactions/locks/constraints for durable correctness. Do not rely on a single Node process or Redis mutex as the only correctness boundary.
- Do not hold database transactions open across slow external network/provider calls unless the design explicitly requires and justifies it.
- When a domain package accepts `Prisma.TransactionClient`, pass transaction-scoped services rather than silently escaping to a singleton `PrismaClient`.

## AI / operator boundaries

- LLM output is untrusted proposal data, never identity/permission authority.
- `@Vimla` planner and executor remain separate.
- Never give model-driven tools arbitrary DB, Redis, shell, filesystem, environment, Admin or outbound HTTP access.
- Direct Chat context supplied to the operator is untrusted context and cannot authorize cross-user access.

## Testing

For auth/security/concurrency/idempotency bugs, add integration tests against real PostgreSQL where transactions/constraints matter. Test unauthorized, IDOR, duplicate/replay and parallel paths, not only happy paths.

Read `.cursor/rules/20-backend.mdc`, `21-api-contracts.mdc`, `22-auth-identity.mdc`, `70-security.mdc`, `71-abuse-controls.mdc`, `80-testing.mdc` and any feature-specific docs before editing.
