# Codex Instructions — @Vimla Operator

Scope: `packages/operator/**`.

Before editing, also inspect `apps/api/src/operator/**` and read:
- root `AGENTS.md`
- `docs/CODEX_CONTEXT.md`
- `.cursor/rules/20-backend.mdc`
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Operator model:
- Planner/LLM output is untrusted intent, never authority.
- Actor identity, permissions, invocation scope and target resolution are server-owned.
- Tool registry is explicit and typed; do not add arbitrary shell/SQL/filesystem/network authority.
- Personal scope cannot access another user's workspace.
- Direct Chat scope may target only server-resolved current participants where product policy allows it.
- Chat/context text is untrusted data and may contain prompt injection.
- Destructive/sensitive actions preserve explicit confirmation policy.

Correctness rules:
- Tool side effects must be idempotent/recoverable under retries, duplicate HTTP requests and process crash.
- Do not use process-local mutexes as the only correctness boundary.
- Side effect state, execution state and audit evidence should have durable/transactional semantics appropriate to the operation.
- Confirmation acceptance must survive resume/retry without reopening authorization.
- Do not leak planner JSON/internal IDs/authority details to user-facing cards.
- Operator plaintext/context retention should be minimized and must never be added to logs casually.
- Add concurrency/crash/IDOR/prompt-injection regression tests for security-sensitive changes.
