<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vimla Admin guidance

These rules extend the repository root `AGENTS.md` for the privileged Admin app.

Admin is a separate security boundary, not merely another consumer page.

## Security
- Default deny. Never infer Admin authorization from route visibility, email address or ordinary consumer session state.
- Preserve explicit server-side permissions and privileged session/elevation semantics.
- Do not weaken MFA/passkey/TOTP or recent-reauth requirements.
- Never expose TOTP secrets, backup codes, session tokens, provider credentials or other sensitive operational data in UI/logging.
- Dangerous actions require strict validation, explicit permission and append-only audit events.
- Do not add local/mock privileged shortcuts to production code paths.

## UI
- Reuse `@vimla/ui` and design-system tokens/components.
- Admin is desktop-first, not desktop-only. Narrow screens must remain usable through stacking, drawers, controlled horizontal table scrolling or route/detail transitions.
- Never hide critical financial/status/action information solely because viewport width is small.
- Preserve keyboard/focus accessibility and reduced-motion behavior.

Read `.cursor/rules/75-admin-control-plane.mdc`, `10-frontend.mdc`, `12-design-system.mdc`, `13-responsive-ui.mdc`, `20-responsive-theme-accessibility-v2.mdc`, plus `docs/ADMIN_SECURITY.md` and `docs/FINANCE_ADMIN.md` before changing privileged flows.
