# Codex Instructions — Contracts

Scope: `packages/contracts/**`.

Before editing, read:
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/70-security.mdc`

Rules:
- Shared HTTP/queue/provider-facing contracts require runtime validation, not TypeScript types alone.
- Sensitive mutating DTOs should be strict and reject unexpected authority-bearing fields.
- Client contracts must not make `userId`, role, permission, price, provider cost/model ID or internal limits authoritative unless an explicitly reviewed endpoint requires such a field.
- Stable machine error codes belong in contracts; user-facing localization stays in clients.
- Do not serialize native bigint directly; use validated decimal-string/money DTOs at JSON boundaries.
- Contract changes must consider backward compatibility and all consumers.
- Treat every client-supplied ID as an untrusted reference that still needs server-side authorization.
