# Vimla Design Reference Map

This directory contains the approved visual references for Vimla.

The references are NOT independent design systems and are NOT literal sources of production data.

The implementation must derive one coherent UI system from them.

## Priority when references disagree

Use this order:

1. Security, product/domain correctness, permissions, billing rules, and already implemented behavior.
2. Current backend/API/contracts and real persisted data.
3. `docs/DESIGN_SYSTEM.md` and `@vimla/ui` once established.
4. `00-master-design-system.png` for the canonical visual language.
5. Screen-specific references for layout, information hierarchy, density, and composition.
6. `.cursor/rules/13-responsive-ui.mdc` for responsive adaptation.

Never create a second visual language because one screenshot differs slightly.

## Canonical visual reference

### `00-master-design-system.png`

Primary source for:
- color direction;
- typography hierarchy;
- buttons and fields;
- border radii;
- spacing rhythm;
- badges;
- modals;
- toasts;
- chat visual style;
- canonical sidebar/navigation treatment;
- AUTO/PRO controls.

If another reference has a different sidebar treatment, keep the canonical navigation language from the master reference unless the product specification explicitly requires a change.

## Screen-specific references

### `01-projects-desktop.png`
Future Projects list composition.

Until Projects domain exists:
- do not create fake production Projects rows;
- do not fabricate participants, plans, activity, or locked states;
- it may be used to design reusable visual components and `/dev/ui` examples only.

### `02-project-workspace-desktop.png`
Future collaborative project workspace/chat composition.

Do not fabricate:
- participants;
- files;
- decisions;
- actions;
- Project Brain output;
- activity.

### `03-project-context-desktop.png`
Future Project Context / Brain composition.

Do not expose a fake context screen in production before the Project Brain backend/domain exists.

### `04-auth-flows-desktop.png`
Composition reference for currently implemented:
- Sign in;
- Sign up;
- email verification;
- password recovery/reset.

Use real existing auth state, validation, rate-limit behavior, and localized errors.

### `05-settings-billing-desktop.png`
Composition reference for Settings/Billing.

Important:
- do not copy fake prices, limits, usage values, card information, payment methods, billing history, plan names, or dates from the image;
- all visible business/user values must come from existing APIs/contracts;
- if a section does not exist in the real product yet, do not fabricate it.

### `06-chat-mobile.png`
Mobile composition reference for existing chat.

Use real:
- conversation data;
- selected mode/model;
- usage;
- streaming state;
- user identity.

Do not copy the fake message content or usage figures into production.

### `07-projects-mobile.png`
Future mobile Projects composition.

Reference only until Projects domain is implemented.

### `08-project-workspace-mobile.png`
Future mobile Project workspace composition.

Reference only until Projects domain is implemented.

## Production data rule

Screenshots are never data fixtures for production UI.

Do not hardcode from screenshots:
- user names;
- avatars;
- emails;
- project names;
- participants;
- messages;
- plan prices;
- AI usage;
- storage usage;
- billing history;
- card details;
- dates;
- statuses;
- payment methods;
- model names if they are meant to come from the model catalog;
- counts;
- Project Brain facts;
- decisions;
- actions;
- files.

Production UI must render from:
- backend APIs;
- contracts;
- persisted database state;
- authenticated session;
- configuration/policy endpoints;
- real feature flags.

Static values are acceptable only for:
- design tokens;
- localization keys/text;
- route definitions;
- supported enum labels/icons;
- genuine product constants explicitly defined as code configuration.

## Missing-feature rule

If a visual reference shows a feature that is not implemented:

1. do not fabricate production data;
2. do not create a fake working flow;
3. do not introduce a hardcoded local array pretending to be backend data;
4. either:
   - leave the production feature out for now, or
   - implement the required backend/domain/contracts/persistence first as a separately scoped product task;
5. presentational prototypes may exist only in local/test-only `/dev/ui` or dedicated test fixtures.

## Navigation consistency

There must be one canonical navigation model.

Navigation items must be driven by:
- real routes;
- permissions;
- feature availability.

Do not show a clickable production menu item for a route that does not exist.

The visual treatment of navigation should come from the master design system, not independently from every screenshot.
