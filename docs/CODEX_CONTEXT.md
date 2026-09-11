# Codex Context for Vimla

This document gives coding agents a compact map of the product and repository. It is descriptive context, not permission to expand scope.

## Product model
Vimla is an AI-native universal workspace. The long-term product combines:
- ordinary AI chat and model selection;
- personal workspace objects (`Task`, `Reminder`, `List`, `Note`);
- projects and collaboration;
- notifications;
- `@Vimla`, a system operator that acts through typed backend tools;
- 1:1 Direct Chats with E2EE;
- future routing/brains/agents/media capabilities.

Rule of thumb: generation/answering is ordinary AI; actions inside Vimla go through controlled backend capabilities, not arbitrary LLM authority.

## Repository topology
```text
apps/
  web/       consumer Next.js 16 / React 19 UI
  admin/     separate privileged Next.js control plane
  api/       NestJS + Fastify modular monolith
  worker/    BullMQ worker process

packages/
  contracts/      shared runtime contracts / Zod schemas / error codes
  database/       Prisma schema/client/migrations
  config/         validated configuration
  auth/           Better Auth integration
  ai/             provider abstractions, catalog, pricing/cost logic
  billing/        subscriptions/payments/usage/reservations/ledger
  notifications/  inbox/email/reminder delivery platform
  workspace/      personal Task/Reminder/List/Note domain
  operator/       typed @Vimla planner/tool runtime primitives
  projects/       project/member/entitlement domain
  direct-chats/   direct-chat server domain and consent/filtering
  e2ee/           client-side E2EE primitives/state helpers
  admin/          privileged admin-domain utilities
  ui/             shared design system
  shared/         genuinely shared utilities
```

## Runtime architecture
- PostgreSQL is the durable source of truth.
- Redis is used for queues/cache/rate-limit coordination, not money.
- API owns identity/authorization/business orchestration.
- Worker handles durable asynchronous delivery/reconciliation work.
- Consumer Web and Admin are separate surfaces; Admin is a security control plane, not a hidden consumer route.

## Implemented foundation through Phase 9
Current `main` contains the foundation through Phase 9, including:
- repository/monorepo foundation;
- Better Auth email/password sessions and verified-email flows;
- bigint billing/usage reservations and append-only ledger;
- text AI gateway with provider abstraction and ProxyAPI adapter;
- T-Bank acquiring integration and payment reconciliation foundation;
- finance/tariff economics foundation;
- shared UI system and responsive requirements;
- Personal Workspace;
- durable reminder/notification platform;
- Phase 7 `@Vimla` Personal Workspace operator;
- Phase 8 Projects/collaboration and plan-derived locking;
- Phase 9 1:1 Direct Chats with X3DH + Double Ratchet implementation and scoped `@Vimla` context handoff.

Do not infer that an implemented feature is approved for public rollout. Several capabilities remain feature-gated and/or require hardening.

## Product/operator model
`@Vimla` is not an unconstrained AI agent. Planner output is untrusted intent. The server owns identity, scope, authorization and tool execution.

The same operator runtime can be invoked from different surfaces, but invocation scope limits capabilities:
- Personal Workspace: actor's own workspace.
- Direct Chat: current participants/current chat context only, with consent for decrypted context handoff.
- Project-scoped operator behavior may be added later; do not invent it unless tasked.

LLM output must never become permission authority. User/chat/project content is untrusted data and can contain prompt injection.

## Projects model
- Project authority is derived server-side.
- Roles: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- No ownership transfer workaround to bypass plan limits.
- Project availability/locking is derived from owner/member entitlements; data is not deleted on downgrade.
- Non-members should generally receive owner-safe `404` behavior where designed.
- Plan-limit changes and membership changes are concurrency-sensitive.

## Direct Chat / E2EE model
Direct Chats are 1:1 and separate from ordinary AI conversations.
- Server stores ciphertext and public device/prekey material, not human message plaintext.
- Client decrypts locally.
- `@Vimla` receives only explicitly selected/consented, bounded, ephemeral plaintext context.
- Cross-user task assignment may target only current chat participants resolved server-side.
- Chat history/context is never authorization authority.

Feature flags for Direct Chats stay fail-closed by default. Public enablement requires crypto/privacy hardening and review; green functional tests are not an external cryptographic audit.

## Billing and AI cost model
Money is integer microRUB. Provider-consuming work follows reservation-first semantics. Provider actual cost and user-settled usage are separate facts.

Do not conflate:
- customer payment;
- subscription price;
- user allowance;
- provider actual COGS;
- user-settled usage;
- provider corporate balance.

Ambiguous provider outcomes require reconciliation/hold behavior, not free release or blind retry.

## Notifications
Reminder flow is durable:
`PostgreSQL Reminder -> NotificationDelivery -> reconciliation -> BullMQ -> worker -> IN_APP/EMAIL`.

Redis loss must be recoverable from PostgreSQL intent. Workers re-read current DB state before delivery so cancel/reschedule can invalidate stale jobs.

## Admin model
Admin is a separate origin/control plane with explicit principal/permissions and elevated authentication. Consumer session possession alone is not sufficient authority. Admin changes require auditability. Never weaken strong-auth requirements for convenience or test success.

## Frontend product requirements
Consumer/admin UI must be responsive and accessible across small mobile, common mobile, tablet, laptop, desktop and wide displays. Support touch + keyboard, safe-area insets, reduced motion and no accidental horizontal overflow.

Use shared UI primitives/tokens where available. User-facing strings are localized RU/EN. Server/financial state is authoritative; do not fabricate balances, entitlements or provider state in UI.

## Current development posture
The project is in a hardening stage before continuing large new phases. Correctness/security findings should be fixed in focused PRs with regression tests rather than hidden inside new feature work.

High-priority review areas include concurrency/idempotency, crash recovery, AI reconciliation, billing/payment races, admin strong auth, web security headers/XSS surface, and E2EE lifecycle hardening.

## Feature rollout safety
Do not change rollout flags unless explicitly tasked. In particular, staged capabilities must remain off in staging/production until their own readiness criteria are satisfied.

## Local / CI commands
Root scripts:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Node requirement: `>=24`.
Package manager: `pnpm@10.17.0`.
Integration/E2E expect isolated test PostgreSQL/Redis and must never target production/staging data.

## When uncertain
Prefer a small, reversible, testable change. Do not create new distributed infrastructure, new authority paths, new crypto protocols or new billing semantics merely to simplify implementation. Report uncertainty instead of guessing.