# Codex Instructions — Shared UI

Scope: `packages/ui/**`.

Before editing, read:
- `.cursor/rules/12-design-system.mdc`
- `.cursor/rules/13-responsive-ui.mdc`
- `.cursor/rules/15-visual-fidelity-v2.mdc`
- `.cursor/rules/16-component-reuse-v2.mdc`
- `.cursor/rules/18-layout-engineering-v2.mdc`
- `.cursor/rules/19-motion-system-v2.mdc`
- `.cursor/rules/20-responsive-theme-accessibility-v2.mdc`

Rules:
- `@vimla/ui` is shared by consumer and admin surfaces; changes can have broad blast radius.
- Preserve DOM props/ref/accessibility passthrough on primitives unless there is a strong reason not to.
- Prefer composable primitives/tokens over one-off feature-specific behavior in the shared package.
- Do not hard-code product copy in primitives.
- Components must support keyboard/focus semantics, reduced motion and responsive containers.
- Avoid fixed dimensions that break small screens or wide layouts without documented intent.
- Do not introduce accidental horizontal overflow.
- Shared visual changes should include/adjust focused tests or representative Playwright coverage when behavior/accessibility changes.
