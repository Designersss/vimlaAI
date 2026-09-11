# Codex Instructions — API

Scope: `apps/api/**`.

Before editing, read the relevant policies for the touched domain:
- `.cursor/rules/20-backend.mdc`
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/22-auth-identity.mdc`
- `.cursor/rules/23-notifications.mdc`
- `.cursor/rules/40-billing-usage.mdc`
- `.cursor/rules/41-payments.mdc`
- `.cursor/rules/50-ai-gateway.mdc`
- `.cursor/rules/51-proxyapi.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/71-abuse-controls.mdc`
- `.cursor/rules/72-observability-incidents.mdc`
- `.cursor/rules/75-admin-control-plane.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- NestJS controllers stay thin: parse/validate/authenticate/authorize/orchestrate only.
- Business/domain rules belong in services/packages.
- Use Fastify-compatible APIs; do not introduce Express-only assumptions.
- Use validated config, not scattered `process.env` reads.
- Owner/member/admin identity comes from authenticated server context, never request body fields.
- Treat every client ID as an untrusted reference and re-authorize it server-side.
- Mutating cookie-authenticated routes require the existing trusted-origin/CSRF-safe pattern.
- Financial/auth/admin/AI/security DTOs reject unexpected authority-sensitive fields.
- Return stable machine error codes; do not leak provider/Prisma/Postgres/internal stack details.
- Preserve correlation IDs and structured/redacted logs.
- Expensive routes require size/rate/concurrency/cost controls and fail-closed behavior where security/spend coordination is unavailable.
- Concurrency/idempotency fixes must use durable DB/coordination semantics, not only process-local mutexes.
- Do not perform network calls inside long database transactions unless the design explicitly requires and justifies it.
- Add integration tests for authorization, IDOR, concurrency, retries/crash recovery and security regressions relevant to the change.
