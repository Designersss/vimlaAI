# Codex Instructions — Consumer Web

Scope: `apps/web/**`.

Before editing, read the applicable shared UI policies:
- `.cursor/rules/10-frontend.mdc`
- `.cursor/rules/11-i18n-ux.mdc`
- `.cursor/rules/12-design-system.mdc`
- `.cursor/rules/13-responsive-ui.mdc`
- `.cursor/rules/14-real-data-ui.mdc`
- `.cursor/rules/15-visual-fidelity-v2.mdc`
- `.cursor/rules/16-component-reuse-v2.mdc`
- `.cursor/rules/17-navigation-architecture-v2.mdc`
- `.cursor/rules/18-layout-engineering-v2.mdc`
- `.cursor/rules/19-motion-system-v2.mdc`
- `.cursor/rules/20-responsive-theme-accessibility-v2.mdc`
- `.cursor/rules/21-messaging-composer-v2.mdc`
- `.cursor/rules/22-auth-ui-v2.mdc`
- `.cursor/rules/23-real-data-feature-gates-v2.mdc`
- `.cursor/rules/24-brand-asset-v2.mdc`

Rules:
- Next.js App Router + React functional components + strict TypeScript.
- Prefer Server Components unless browser state/interactivity requires Client Components.
- MobX is client/UI state only, never authoritative auth/financial/billing state.
- Do not call AI/payment providers directly from the browser.
- Do not expose secrets, provider IDs/prices, privileged roles or internal limits in client bundles.
- AI/user content is untrusted. Do not introduce unsafe raw HTML rendering.
- UI must use real backend state and explicit loading/empty/error/retry states; do not fake balances, usage, entitlements or success.
- All end-user text must follow RU/EN localization conventions.
- Reuse `@vimla/ui` primitives and existing tokens before adding bespoke components/styles.
- Responsive behavior is mandatory across small mobile, common mobile, tablet, laptop, desktop and wide screens; support touch, keyboard, safe-area insets and reduced motion.
- No accidental horizontal overflow.
- Preserve feature gates. A hidden/disabled staged feature must not become enabled because a component exists.
- When UI changes behavior, add/update Playwright coverage at representative viewports where practical.
