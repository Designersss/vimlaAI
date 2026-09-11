# Codex Instructions — Admin Web

Scope: `apps/admin/**`.

Before editing, read:
- `.cursor/rules/10-frontend.mdc`
- `.cursor/rules/11-i18n-ux.mdc`
- `.cursor/rules/12-design-system.mdc`
- `.cursor/rules/13-responsive-ui.mdc`
- `.cursor/rules/20-responsive-theme-accessibility-v2.mdc`
- `.cursor/rules/75-admin-control-plane.mdc`
- `docs/ADMIN_SECURITY.md`
- `docs/FINANCE_ADMIN.md` when finance/tariff UI is involved.

Admin is a privileged security control plane, not a hidden consumer page.

Rules:
- Never treat route obscurity as authorization.
- Preserve explicit admin-principal, permission and strong-auth boundaries.
- Do not downgrade passkey/TOTP/session requirements merely to unblock UI/tests.
- Do not expose raw TOTP secrets, backup codes, tokens or sensitive audit material beyond the explicitly designed enrollment/recovery flow.
- Mutations must map to audited backend actions with stable error codes.
- Never fabricate financial/admin state client-side.
- Keep consumer and admin origins/clients conceptually separate.
- Use shared design primitives where appropriate, but security UX clarity wins over visual cleverness.
- RU/EN localization, keyboard access, focus states and responsive behavior remain mandatory.
- Add E2E coverage for security-sensitive navigation/auth/error states when changed.
