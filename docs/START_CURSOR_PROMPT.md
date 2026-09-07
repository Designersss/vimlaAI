# Prompt to paste into Cursor Agent for the first implementation pass

You are starting implementation of a new project named ONE.

First, do not write feature code immediately. Read and treat as project source of truth:
- `AGENTS.md`
- every relevant file under `.cursor/rules/`
- `docs/PROJECT.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`

The repository is new. Implement **Phase 0 — Repository foundation** from `docs/IMPLEMENTATION_PLAN.md` and then implement only the minimum skeleton needed to begin Phase 1. Do not implement payments, ProxyAPI calls, images, video, Auto Router or agents yet.

Requirements for this pass:
1. Create a pnpm + Turborepo monorepo.
2. Create:
   - `apps/web`: Next.js 16 + React 19 + TypeScript strict + MobX + SCSS Modules.
   - `apps/api`: Node.js 24 LTS + NestJS + Fastify + TypeScript strict.
   - `apps/worker`: Node.js 24 LTS worker foundation with BullMQ.
3. Create packages:
   - `packages/contracts`
   - `packages/database`
   - `packages/config`
   - `packages/ai`
   - `packages/billing`
   - `packages/shared`
4. Add PostgreSQL + Prisma and Redis development infrastructure through Docker Compose.
5. Add typed environment validation. No scattered direct `process.env` access.
6. Add API `/health` and worker connectivity health/logging.
7. Let web read the configured API base URL and display/develop against the health endpoint without embedding backend secrets.
8. Add root scripts for dev/build/lint/typecheck/test.
9. Add initial test infrastructure and one smoke/unit test per app/package where it is useful to prove setup.
10. Add `.env.example`, `.gitignore`, and a concise root `README.md` with exact local startup commands.
11. Do not add Kubernetes, Kafka, microservices, payment SDKs or AI SDKs in this pass.
12. Do not weaken rules to make setup easier.

Before editing, inspect the repository and preserve any existing valid files. If an existing file conflicts with the ONE architecture, explain the conflict in your working notes and migrate it rather than silently deleting useful content.

After implementation:
- run install/lint/typecheck/tests/build;
- fix all errors introduced by this pass;
- report exactly what was created;
- list any environment prerequisites still required;
- update `docs/IMPLEMENTATION_PLAN.md` by marking completed Phase 0 tasks without changing future product scope.

The most important constraint: build a clean foundation for the financial/usage architecture described in the docs; do not rush ahead into visible AI features.
