<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vimla consumer web guidance

These rules extend the repository root `AGENTS.md` for `apps/web`.

## Architecture
- Next.js 16 App Router, React 19, strict TypeScript.
- Prefer Server Components unless browser interactivity/state requires a Client Component.
- MobX is client/UI domain state only; never authoritative for auth, billing, roles, entitlements or provider cost.
- Reuse `@vimla/ui`, shared tokens and existing components before adding one-off primitives.
- Use SCSS Modules and centralized design tokens instead of scattered magic values.

## Security and data
- Never expose provider/payment/admin secrets or internal permissions in browser bundles.
- Never call ProxyAPI, T-Bank or privileged providers directly from browser code.
- Treat AI/user content as untrusted. Do not use `dangerouslySetInnerHTML` without an explicitly reviewed sanitizer; prefer safe text/Markdown with raw HTML disabled.
- Refetch/revalidate authoritative server state. Do not invent optimistic financial balances or permission state.

## UX, i18n and responsive behavior
- End-user copy follows repository RU/EN i18n conventions; do not hard-code new product strings when translation keys are required.
- Handle loading, empty, partial, retryable error and terminal error states.
- Responsive behavior is mandatory for every changed flow: ~320px small mobile, common mobile, tablet, laptop, desktop and wide desktop; portrait/landscape; touch/mouse/keyboard; short viewport heights; safe-area insets; reduced motion.
- Prevent accidental horizontal page overflow. Test long RU/EN strings, emails, IDs, model/project names, code blocks and monetary values.
- Core actions must not depend on hover. Keep touch targets usable.
- Do not duplicate separate mobile/desktop business implementations; share data/actions and vary composition responsively.
- Critical responsive flows need representative Playwright viewport coverage.

Read `.cursor/rules/10-frontend.mdc` through `24-brand-asset-v2.mdc`, especially `11-i18n-ux.mdc`, `12-design-system.mdc`, `13-responsive-ui.mdc`, `14-real-data-ui.mdc` and `20-responsive-theme-accessibility-v2.mdc`.
