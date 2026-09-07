# ONE Cursor Starter Pack

Copy the contents of this folder into the root of the new ONE repository.

Recommended files:
- `AGENTS.md` — always-on project context.
- `.cursor/rules/*.mdc` — scoped Cursor Project Rules.
- `docs/PROJECT.md` — product description.
- `docs/ARCHITECTURE.md` — architecture/invariants/data model.
- `docs/IMPLEMENTATION_PLAN.md` — ordered roadmap.
- `docs/START_CURSOR_PROMPT.md` — first prompt to paste into Cursor Agent.

Important about the previously supplied frontend rule:
It contained Pixi.js/editor/constraint-layout rules from a different editor-style application. Those editor-specific rules are intentionally not carried into ONE. The reusable choices were retained: Next.js 16, React 19, TypeScript strict, MobX, SCSS Modules, feature grouping, and strong type safety.
