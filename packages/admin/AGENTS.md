# Codex Instructions — Admin Domain

Scope: `packages/admin/**`.

Before editing, read:
- `.cursor/rules/75-admin-control-plane.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/72-observability-incidents.mdc`
- `docs/ADMIN_SECURITY.md`
- `docs/FINANCE_ADMIN.md` when finance/tariff behavior is involved.

Rules:
- Admin is a separate privileged control plane with explicit principal/role/permission checks.
- Ordinary consumer session possession is not admin authority.
- Preserve strong-auth/elevation/session-expiry/revocation semantics.
- Privileged mutations must create durable audit evidence with secrets/redaction handled correctly.
- Never expose raw secrets, recovery codes, TOTP material or sensitive internal state beyond the designed secure flow.
- Permission checks are server-side and deny by default.
- Administrative finance operations must preserve billing/ledger invariants and require explicit audit/reason metadata where designed.
- Security incidents/events must not silently fail open.
- Add tests for permission denial, stale/revoked sessions, strong-auth boundaries and audit creation when touched.
