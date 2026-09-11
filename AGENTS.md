# Vimla — Codex Repository Instructions

## Mission
Vimla is a public AI-native SaaS/workspace for real users, real money and hostile Internet traffic. It combines multi-model AI, personal workspace objects, projects/collaboration, notifications, a privileged Admin control plane, the `@Vimla` system operator, and E2EE 1:1 Direct Chats.

Treat security, financial correctness, privacy, abuse resistance, recovery and auditability as product requirements, not later polish.

## How Codex should work in this repository
1. Read this file before non-trivial work.
2. Read `docs/CODEX_CONTEXT.md` for the current architecture/domain map.
3. Read every applicable nested `AGENTS.md` for files you will touch.
4. Read the relevant `.cursor/rules/*.mdc` files referenced by those instructions. Cursor rules remain shared engineering policy; Codex `AGENTS.md` files translate their scope into Codex-native directory instructions.
5. Inspect the existing implementation and tests before proposing a rewrite.
6. Implement only the explicit task/PR/issue scope. Do not silently expand the roadmap.
7. Add regression tests for correctness/security bugs.
8. Run the narrowest relevant tests first, then the repository quality gates that the environment supports.
9. Review your own diff before finishing and report unresolved risks honestly.

Task-specific instructions in the active prompt/PR/issue may narrow scope, but must not weaken the invariants below unless the task explicitly changes product policy.

## Non-negotiable global invariants
- TypeScript strict. Do not introduce `any` in application/domain code.
- Validate untrusted HTTP, webhook, provider, queue and environment data at boundaries.
- Browser/client is never authoritative for identity, ownership, roles, permissions, prices, provider IDs, model IDs, costs, grants or limits.
- Authentication is not authorization. Scope protected resources with server-established actor/permission context.
- Secrets stay server-side and out of logs, URLs, client bundles, fixtures and commits.
- PostgreSQL is authoritative for persistent, financial and audit-grade state.
- Redis is cache/queue/rate-limit coordination only; never financial truth.
- Financial values use integer microRUB (`1 RUB = 1_000_000 microRUB`) with PostgreSQL `BIGINT` / TypeScript `bigint`; never JS floating point as authoritative money.
- Controllers/routes remain thin. Domain/business behavior belongs in services/packages.
- External integrations sit behind replaceable adapters.
- Use UTC internally; localize only at presentation boundaries.
- Expensive/security-sensitive operations require explicit authz, validation, size/rate/concurrency/cost limits, idempotency and recovery semantics.
- Never weaken or skip security/financial tests just to make CI green.
- Never edit already-applied migrations. Add a new additive migration.
- Never use `prisma db push` as a substitute for versioned production migrations.
- Never run live ProxyAPI, T-Bank, SMTP or other billable/production actions from normal tests/CI unless a task explicitly authorizes a dedicated safe smoke environment.

## Financial invariants
Every provider-consuming request follows:
`estimate -> reserve in PostgreSQL -> provider call -> settle/release -> append ledger/audit evidence`.

Never call a provider before a successful usage reservation. Never blindly release ambiguous provider outcomes as free usage. Duplicate retries/events must not grant or charge twice. Ledger history is append-only; corrections use compensating records.

Customer payments, retail price, user allowance, provider COGS, user-settled usage and corporate provider balance are separate concepts.

## Security invariants
Assume public input and authenticated users can be malicious.
- Prevent IDOR with actor-scoped lookups/authorization.
- Cookie-authenticated mutations need trusted-origin/CSRF-safe handling.
- Bound message/context/file/body sizes.
- AI/user content is untrusted output.
- Parameterize SQL; do not interpolate untrusted input into raw queries.
- Fail closed for security/cost gates when ambiguity could create access or spend.
- Security-sensitive fixes require regression tests.

## Current high-risk domains
Treat these as requiring especially conservative changes:
- `packages/billing` and payment paths
- `packages/database/prisma` migrations and financial constraints
- `packages/ai` and provider settlement/reconciliation
- `apps/admin` / `packages/admin`
- `packages/operator`
- `packages/direct-chats` and `packages/e2ee`
- auth/session/recovery code

## Feature flags and staged functionality
Operator, Projects and Direct Chats use explicit feature gates. Keep existing default-OFF/fail-closed behavior unless the task explicitly changes rollout policy. Do not enable a staged feature in production/staging merely because tests pass.

Direct Chat E2EE is security-sensitive. Do not make stronger cryptographic/privacy claims than the implementation proves. Do not invent cryptography; use reviewed primitives/protocol behavior and preserve ciphertext-only server semantics.

## Git / PR safety
- Work on the assigned branch/PR only.
- Do not push directly to `main`.
- Do not merge a PR unless the user/task explicitly authorizes merge.
- Do not rewrite shared history or force-push unless explicitly required.
- Keep changes focused; separate unrelated hardening/refactors.
- Do not modify branch protection, repository settings, secrets or deployment infrastructure unless explicitly tasked.
- Preserve existing feature flags and deployment safety boundaries.

## Quality gates
Repository-level gates are:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```
Run what the environment supports. Integration/E2E require the configured PostgreSQL/Redis test environment. Never fake success: if a gate cannot run, say why.

For a scoped package/app change, run the closest package tests first before the full gates.

## Security review checklist for every new/changed feature
Before completion answer internally:
1. Who can call it?
2. How is actor identity established server-side?
3. How is ownership/permission enforced?
4. Which inputs are validated and bounded?
5. What rate/concurrency/cost limits apply?
6. Is it idempotent under retries/duplicates?
7. What happens on partial failure, disconnect or process crash?
8. What is logged and what must be redacted?
9. Can the client influence prices/roles/provider IDs/limits?
10. Which tests prove these invariants?

## Sources of truth
Use these in this order for repository work:
1. explicit task / active PR or issue specification
2. this `AGENTS.md` plus any deeper `AGENTS.md`
3. relevant `.cursor/rules/*.mdc`
4. `docs/CODEX_CONTEXT.md`
5. `docs/PROJECT.md`
6. `docs/ARCHITECTURE.md`
7. `docs/DOMAIN_MODEL.md`
8. `docs/IMPLEMENTATION_PLAN.md`

If sources conflict on security/billing/privacy, stop expanding scope and choose the safer interpretation while reporting the conflict.