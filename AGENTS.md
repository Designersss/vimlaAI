# Vimla — Codex project guidance

This is the repository-wide instruction set for Codex and other coding agents. For Codex implementation work, read this file and `docs/CODEX_WORKFLOW.md` before editing. More specific `AGENTS.md` files in subdirectories extend these rules for that area.

## Instruction discovery and precedence

Apply repository guidance in this order, after platform/system instructions: the explicitly owner-approved task specification; the nearest scoped `AGENTS.md`; this root `AGENTS.md`; applicable `.cursor/rules/*.mdc`; then architecture/product documentation. A later item supplies detail where a higher-priority source is silent; it does not override a higher-priority requirement.

- A nearer scoped `AGENTS.md` may specialize guidance for its subtree, but it must never weaken root security, authorization, privacy, financial, migration or fail-closed invariants.
- An approved task may define product scope and intended behavior, but it does not authorize violating protected invariants. Stop and report the conflict instead.
- For a cross-cutting integration file, ancestry-only discovery is insufficient. Read the `AGENTS.md` for the app/worker path **and** every domain package involved (for example Workspace, Projects, Operator, Notifications, Direct Chats/E2EE, Billing or AI), even when that domain guide is a sibling rather than an ancestor of the edited file.
- Treat current code, manifests and docs as evidence, not permission to ignore these instructions. If guidance remains contradictory or materially ambiguous after applying this hierarchy, stop before editing and ask the owner for clarification; do not infer a product, architecture, security or financial decision.

## What Vimla is

Vimla is a public production SaaS: an AI-native workspace combining ordinary AI chat, personal workspace objects, projects/collaboration, notifications, a privileged Admin control plane, and a secure `@Vimla` system operator.

Treat the repository as production software handling real users, money, sensitive data, hostile traffic, and expensive external providers. Correctness, authorization, financial integrity, crash recovery, idempotency and observability are part of feature correctness.

Do not trust stale phase summaries. Before architectural work, inspect the current tree, relevant docs and the nearest `AGENTS.md` files.

## Repository map

Monorepo: pnpm + Turborepo, strict TypeScript.

- `apps/web` — Next.js 16 / React 19 consumer app, MobX, SCSS Modules.
- `apps/admin` — separate privileged Next.js Admin control plane.
- `apps/api` — NestJS + Fastify modular monolith.
- `apps/worker` — BullMQ worker process.
- `packages/contracts` — shared Zod/API contracts.
- `packages/database` — Prisma/PostgreSQL schema, migrations and DB helpers.
- `packages/auth` — authentication infrastructure.
- `packages/admin` — privileged Admin domain/security logic.
- `packages/ai` — AI/provider abstractions, model catalog and pricing.
- `packages/billing` — subscriptions, usage reservations, ledger and payment economics.
- `packages/notifications` — durable notification delivery/reconciliation.
- `packages/workspace` — Tasks, Reminders, Notes and Lists domain services.
- `packages/operator` — `@Vimla` planner/tool policy/runtime domain logic.
- `packages/projects` — projects, membership and entitlement logic.
- `packages/direct-chats` — Direct Chat domain, consent and context rules.
- `packages/e2ee` — Direct Chat cryptographic protocol implementation.
- `packages/ui` — shared design system.
- `packages/config`, `packages/shared` — validated configuration and shared utilities.

## Core architecture invariants

- TypeScript strict. Do not introduce `any` in application/domain code to bypass typing.
- Validate all external inputs and provider responses at boundaries.
- Browser/client input is never authoritative for identity, ownership, roles, permissions, prices, plans, model/provider IDs, costs, limits or billing state.
- PostgreSQL is authoritative for persistent state, financial state, permissions, audit-grade state and durable delivery intent.
- Redis is queue/cache/rate-limit/coordination infrastructure only. Never make Redis the source of truth for money, usage, permissions or durable business state.
- Keep controllers/routes thin. Put business rules in domain/application services or shared packages.
- External providers sit behind replaceable adapters.
- Use UTC internally while preserving explicit user timezone semantics at product boundaries.
- Protected resources must be scoped with authenticated server-side authority. Authentication is not authorization.
- For owner-scoped/private resources, preserve enumeration-safe `404` behavior where the API contract uses it.

## Package dependency and layering policy

Dependencies point inward: applications and framework/provider adapters may depend on domain and shared packages; domain packages must not depend on `apps/*`, Next.js or NestJS application modules. Current manifests and architecture docs support this policy but are not its sole source of truth.

| Layer | Packages / examples | Permitted dependencies and restrictions |
| --- | --- | --- |
| Browser-safe foundations | `@vimla/contracts`, `@vimla/shared`, `@vimla/ui`, and explicitly browser-exported `@vimla/e2ee` entry points | May be imported by browser code only through exports that contain no Node, Prisma, secrets or server configuration. `ui` may depend on browser-safe contracts/shared utilities, not server domains. |
| Server infrastructure | `@vimla/database`, `@vimla/config`, `@vimla/auth` | Server-only unless an explicitly documented browser-safe subpath exists. Prisma client/raw SQL is confined to `@vimla/database` and server-side domain/application code through that package; never bundle it into browser code. |
| Domain/application packages | `@vimla/workspace`, `@vimla/projects`, `@vimla/operator`, `@vimla/billing`, `@vimla/notifications`, `@vimla/ai`, `@vimla/direct-chats`, `@vimla/admin` | May depend on shared contracts/utilities, server infrastructure, and narrowly defined domain interfaces/services. They must not import from `apps/*` or depend on NestJS controllers/modules. Cross-domain dependencies must follow an explicit use case and avoid cycles. |
| Framework/application adapters | `apps/api`, `apps/worker`, Next.js server code in `apps/web`/`apps/admin` | Compose inward-facing packages and translate HTTP, jobs or framework lifecycle concerns. NestJS/Fastify/BullMQ/Next.js dependencies stay here rather than leaking into domain packages. |
| External-provider adapters | concrete AI, payment, email and other provider implementations | Depend on domain-owned interfaces and validated server config. Domain logic must not depend on a concrete provider SDK/adapter, and browser code must never import or call these adapters directly. |

Before adding a package dependency, verify its runtime boundary, exported entry point and cycle impact. If the required direction conflicts with this table, obtain explicit architectural approval rather than introducing reverse coupling.

## Security — always apply

Assume every public input and authenticated user can be malicious.

- Reject client-supplied authority fields such as trusted `userId`, role, permission, internal price, provider ID or entitlement state.
- Bound request bodies, messages, context, pagination, files and expensive operations.
- Cookie-authenticated mutations require the repository's trusted-origin/CSRF-safe pattern.
- Never expose secrets, raw cookies, passwords, OTPs, recovery codes, provider keys, internal SQL, stack traces or internal hosts to the browser or logs.
- AI/user content is untrusted data. Conversation/history/model output never becomes authorization or executable authority.
- Security-sensitive and financial changes require regression tests, including negative and abuse cases.
- Fail closed when a critical authorization/security/cost-control dependency is unavailable.
- Never weaken a security check, permission boundary, test or fail-closed behavior merely to make CI green.

Detailed engineering policy under `.cursor/rules/` remains valid for Codex. Always read applicable rules, especially:

- `00-project-core.mdc`
- `70-security.mdc`
- `71-abuse-controls.mdc`
- `72-observability-incidents.mdc`
- the area-specific rules for the files being changed.

## Database and migrations

- PostgreSQL/Prisma is the persistence authority.
- Never edit already-applied migrations. Create a new additive/versioned migration.
- Never replace production migration history with `db push`.
- Add DB constraints, unique/partial indexes and checks when they materially enforce invariants.
- For critical concurrency, use explicit transactions/locking/isolation and prove behavior with integration tests.
- Parameterize raw SQL. Do not interpolate untrusted values into raw SQL.
- Do not cascade-delete financial/audit history for convenience.
- Append-only ledger/audit records are corrected with compensating records, not destructive edits.

See `.cursor/rules/30-database.mdc`.

## Billing and money — critical

- `1 RUB = 1_000_000 microRUB`.
- Authoritative money uses PostgreSQL `BIGINT` and TypeScript `bigint`, never JS floating point.
- Payment, retail price, user allowance, provider COGS, user-settled usage and corporate provider balance are distinct concepts.
- Provider-consuming actions reserve usage atomically before provider calls, then settle actual usage and safely release unused reservation.
- `spent + reserved <= total` must hold under concurrency.
- Duplicate payment/provider events, reservations and settlement/release paths must be idempotent.
- Ambiguous provider outcomes must not be blindly released as free usage.
- Financial/usage ledger is append-only.

See `.cursor/rules/40-billing-usage.mdc` and `.cursor/rules/41-payments.mdc`.

## `@Vimla` operator

`@Vimla` is a secure system operator, not an ordinary chatbot.

- Planner/model output proposes typed commands; it is never authority.
- Planner != executor. Server policy and typed tools decide what may execute.
- The LLM must never gain arbitrary Prisma/SQL/Redis/shell/filesystem/environment/Admin/HTTP authority.
- Actor identity and invocation scope come from authenticated server state, never planner arguments.
- Direct Chat scope may authorize only what the server resolves for that chat. Peer chat context never grants access to the peer's workspace.
- Preserve explicit confirmation semantics for destructive/sensitive actions.
- Execution must be safe under retry, duplicate requests, concurrent requests, disconnects and process crashes.
- Tool side effects need durable idempotency/transaction boundaries. Do not solve correctness only with an in-memory mutex.

Read `packages/operator/AGENTS.md` when present before changing operator execution.

## Projects and entitlements

- Project permissions and plan limits are server-authoritative.
- The project owner's plan governs owned-project capabilities. A paid collaborator must not unlock a Free owner's project.
- Downgrade locks are reversible/read-only states; never delete project data because a paid plan ended.
- Preserve ownership/membership invariants and protect count/limit checks against concurrency races.

## Direct Chats / E2EE

Direct Chats are a high-risk security boundary.

- Server stores ciphertext/public device material/metadata, not ordinary Direct Chat plaintext.
- Never add server possession of user chat decryption keys as a shortcut.
- Do not invent cryptography. Preserve reviewed primitives, signatures, domain separation and protocol state semantics.
- Chat plaintext/history handed to AI is untrusted context and never authorization.
- `@Vimla` context handoff must stay bounded and consent-gated as designed.
- Never log decrypted chat plaintext, private keys, chain keys or ephemeral AI context bundles.
- Direct Chat/E2EE feature flags stay fail-closed/off unless a task explicitly authorizes production enablement after security/crypto hardening.
- Security claims must match actual guarantees; endpoint compromise, screenshots and participant disclosure are outside E2EE guarantees.

Read `docs/DIRECT_CHATS.md`, `packages/direct-chats/AGENTS.md` and `packages/e2ee/AGENTS.md` before changing this area.

## OFF-by-default feature gates

- Unfinished or security-sensitive capabilities remain fail-closed and OFF by default. Do not enable, relax, bypass or remove their server or client gates as incidental work.
- In particular, preserve `OPERATOR_ENABLED` and `NEXT_PUBLIC_VIMLA_OPERATOR`, `PROJECTS_ENABLED` and `NEXT_PUBLIC_VIMLA_PROJECTS`, and the Direct Chat/E2EE server/client gates as disabled by default.
- Production enablement requires a separately owner-approved task that explicitly covers coordinated server and client rollout, prerequisites, authorization/abuse controls, observability, rollback and tests. Enabling only one side is not a safe rollout.
- Routes, UI visibility, a truthy client value or an available backend implementation must never implicitly enable a capability. Missing, invalid or unavailable gate configuration fails closed.

## Notifications / workers

- PostgreSQL durable delivery intent is the source of truth; BullMQ/Redis is transport/coordination.
- Jobs must be idempotent under retries, duplicate delivery, Redis loss, stale jobs and cancellation/reschedule.
- Re-read authoritative DB state before externally visible delivery where the current design requires it.

## Admin control plane

Admin is a separate privileged security boundary.

- Default deny; every privileged action requires explicit server-side permission.
- Keep privileged session/elevation concepts separate from ordinary consumer access as designed.
- Strong MFA/passkey/TOTP policy must not be weakened.
- Dangerous mutations require strict validation and append-only audit events.
- Never leak user secrets, session tokens, provider credentials, MFA secrets or recovery codes.
- Local/mock admin shortcuts must never become production routes.

Read `apps/admin/AGENTS.md`, `.cursor/rules/75-admin-control-plane.mdc` and `docs/ADMIN_SECURITY.md`.

## Frontend / design system

- Next.js App Router + React functional components + strict TypeScript.
- Prefer Server Components unless browser state/interactivity requires a Client Component.
- MobX is UI/client domain state only, not authoritative auth/billing state.
- Reuse `@vimla/ui`, shared tokens and existing components before inventing local primitives.
- SCSS Modules are the normal component styling mechanism.
- Follow repository i18n conventions; do not hard-code new end-user copy when a translation key belongs in the locale system.
- Never call AI/payment providers directly from browser code.
- Never render untrusted AI/user HTML without an explicitly reviewed sanitizer.
- Handle loading, empty, partial, retryable error and terminal error states.

Responsive behavior is mandatory, not polish. Changed UI must remain usable across small mobile (~320 CSS px), common mobile, tablet, laptop, desktop and wide desktop; portrait/landscape; touch/mouse/keyboard; short viewport heights; safe-area insets; reduced motion; and difficult long RU/EN content. Avoid accidental horizontal overflow and do not hide required functionality on mobile.

Read `.cursor/rules/10-frontend.mdc` through `.cursor/rules/24-brand-asset-v2.mdc`, especially `12-design-system.mdc` and `13-responsive-ui.mdc`.

## Scope and Git workflow

`docs/CODEX_WORKFLOW.md` is mandatory for Codex implementation work. A prepared task/specification is not authorization by itself: the owner must explicitly delegate implementation. Review or CI findings require fresh owner approval before follow-up edits; do not create an autonomous fix loop.

- Implement only the requested task/phase. Do not silently start future roadmap items.
- Do not broad-refactor unrelated areas in a bugfix PR.
- Preserve working behavior unless the task explicitly changes product semantics.
- If task instructions conflict with a security/financial invariant, stop and report the conflict instead of weakening the invariant.
- If an architectural/security/product decision changes, update the relevant docs/ADR.
- Preserve historical migrations; schema changes get new migrations only.
- Do not merge PRs unless explicitly instructed. Default is to prepare commits/PR and report results.
- Do not push directly to `main` for development work.

See `.cursor/rules/95-git-workflow.mdc`.

## Quality gates

Use narrow tests while iterating. Before declaring a substantial change complete, run as much as the environment supports:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Integration/E2E use test PostgreSQL/Redis and mock providers. Normal tests/CI must never use production credentials or spend real AI/payment money.

For security, billing, concurrency, retry or crash bugs, add regression tests reproducing the broken case, including duplicate/replay/concurrent paths where applicable.

Report exactly which commands ran and which could not run. Never claim an unexecuted check passed.

## Codex working protocol

1. Read this file and every closer `AGENTS.md` governing the target path.
2. Read the task/PR specification completely.
3. Inspect current code, tests, relevant docs and applicable `.cursor/rules` before editing.
4. Identify the authority/correctness invariant being changed or fixed.
5. Make the smallest coherent change that solves the requested root cause.
6. Add/adjust regression tests for that root cause.
7. Run quality gates.
8. Review your own diff for authority leaks, concurrency/crash behavior, secret leakage and unrelated changes.
9. Summarize changed files, migrations, checks run, remaining risks and anything not executable.
10. Never auto-merge.
