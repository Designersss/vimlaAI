# Vimla Cursor Starter Pack v2

This folder is not the application implementation. It is the persistent project context/rules pack for Cursor before the first code-generation pass.

## Install into a new repository
Copy the **contents** of this folder into the root of the Vimla repository so the final paths are exactly:

```text
<repo>/AGENTS.md
<repo>/.cursor/rules/00-project-core.mdc
<repo>/.cursor/rules/10-frontend.mdc
...
<repo>/docs/PROJECT.md
<repo>/docs/START_CURSOR_PROMPT.md
```

Do not copy it as a nested `vimla-cursor-starter-v2/` folder inside the repo.

## What Cursor should detect
Cursor Project Rules are actual `.mdc` files in `.cursor/rules/` with `description`, `globs` and/or `alwaysApply` frontmatter.

Global always-applied rules:
- `00-project-core.mdc`
- `95-git-workflow.mdc`

Scoped rules automatically apply to frontend/backend/database/billing/AI/worker/security/testing/infra files as relevant.

## First message
Open `docs/START_CURSOR_PROMPT.md`, copy the prompt section into Cursor Agent and run it in the repository root.

## Important
The user's old frontend `.mdc` contained Pixi.js/editor/constraint-layout rules from another project. Vimla keeps the user's intended frontend stack and strictness, but intentionally removes those unrelated editor rules.
