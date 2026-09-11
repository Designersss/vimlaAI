# Codex Instructions — Workspace

Scope: `packages/workspace/**`.

Before editing, read:
- `docs/CODEX_CONTEXT.md`
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/30-database.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- Personal workspace objects (`Task`, `Reminder`, `List`, `Note`) are actor-scoped server-side.
- Domain services should remain usable with the repository's DB client abstraction, including transaction-scoped clients where supported.
- Do not duplicate workspace business logic in controllers/operator code; reuse domain services.
- Soft-delete/archive/status semantics are distinct; do not conflate them or permanently delete data without explicit product policy.
- Reminder scheduling/timezone validation is server-enforced, not only UI-enforced.
- Preserve assignment attribution and source metadata for cross-user/direct-chat task assignment.
- User-facing timestamps are UTC internally and localized at presentation.
- Add tests for ownership/IDOR, state transitions, timezone boundaries and transaction/idempotency behavior relevant to changes.
