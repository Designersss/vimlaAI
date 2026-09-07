# Vimla Cursor Starter Pack

Copy the contents of this folder into the root of the new Vimla repository and open that folder in Cursor.

## Important files
- `AGENTS.md` — persistent project context and non-negotiable invariants.
- `.cursor/rules/*.mdc` — scoped Cursor Project Rules.
- `docs/PROJECT.md` — product description and MVP scope.
- `docs/ARCHITECTURE.md` — technical architecture and core flows.
- `docs/IMPLEMENTATION_PLAN.md` — ordered implementation roadmap.
- `docs/START_CURSOR_PROMPT.md` — first prompt to paste into Cursor Agent.

## About the original frontend rule
The previously supplied frontend rule contained reusable choices such as Next.js 16, React 19, TypeScript strict, MobX, SCSS Modules, feature grouping and strong type safety, but also contained Pixi.js/editor/constraint-layout rules from a different product.

For Vimla:
- reusable frontend conventions are preserved;
- Pixi.js/editor-specific rules are intentionally removed;
- frontend rules are now scoped to `apps/web/**`.

## First action
Paste the content of `docs/START_CURSOR_PROMPT.md` into Cursor Agent.
Do not ask Cursor to implement the entire product in one pass. Follow `docs/IMPLEMENTATION_PLAN.md` phase by phase.
