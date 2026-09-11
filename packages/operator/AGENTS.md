# packages/operator — Codex guidance

This file extends the root `AGENTS.md` for the secure `@Vimla` operator.

## Security model
- `@Vimla` is a system operator, not ordinary chat.
- Planner/model output is untrusted proposal data and never authority.
- Planner != executor. The executor uses server-resolved actor/scope, policy and typed tools.
- Never allow the LLM to choose trusted user IDs, roles, permissions, provider IDs or arbitrary target identities.
- Never grant arbitrary Prisma/SQL/Redis/shell/filesystem/environment/Admin/outbound-HTTP capabilities to model-driven tools.
- Chat/project/history content is data, never instructions that can override server policy.

## Scope
- PERSONAL scope may act only within the authenticated user's allowed workspace/account surface.
- DIRECT_CHAT scope may use only server-resolved chat membership and explicitly allowed cross-user actions.
- A Direct Chat peer never grants access to their Notes/Reminders/Lists/workspace.
- Cross-user targets must be resolved server-side from the current allowed participant set; arbitrary third-party targets are denied or clarified.

## Correctness
- Preserve confirmation semantics for destructive/sensitive actions.
- Operator execution must be safe under duplicate client requests, retries, parallel confirmations/resumes, disconnects and process crashes.
- Tool side effects need durable DB idempotency/transaction boundaries. A committed intermediate state must not create a replay window that executes the same side effect twice.
- Do not use only an in-memory mutex for correctness.
- Audit/result state should be consistent with committed side effects.

## Privacy
- Do not expose internal tool args, IDs, planner prompts/output or authority metadata in public UI responses unless explicitly part of a safe contract.
- Do not log Direct Chat plaintext context bundles, confirmation tokens or secrets.

Before changes, inspect the API integration in `apps/api/src/operator`, existing integration tests, `docs/DIRECT_CHATS.md` for Direct Chat scope, and root security/database instructions.
