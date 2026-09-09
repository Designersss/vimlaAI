# Vimla Design System

Authoritative implementation: `packages/ui` (`@vimla/ui`).

Visual references live in `docs/design/references/`. They define appearance and composition, not production data.

## Principles

Vimla should feel clean, minimal, calm, and modern. Reuse shared primitives before composing page layouts. Feature SCSS is for layout only.

## Reference hierarchy

1. Security and product/domain correctness
2. Backend/API/contracts and persisted state
3. This document and `@vimla/ui`
4. `docs/design/references/00-master-design-system.png`
5. Screen-specific reference images
6. Responsive rules in `.cursor/rules/13-responsive-ui.mdc`

## Tokens

Semantic CSS variables are defined in `packages/ui/src/styles/tokens.scss`.

Raw palette (token file only):

| Token role | Light | Dark |
| --- | --- | --- |
| Accent | `#6366F1` | `#818CF8` |
| Text | `#0F172A` | `#F8FAFC` |
| Surface | `#FFFFFF` | `#111827` |
| Background | `#F8FAFC` | `#0B0F19` |
| Success / Warning / Danger | `#10B981` / `#F59E0B` / `#EF4444` | lightened equivalents |

Components consume `--vimla-*` variables, never raw hex.

### Spacing

4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 (`--vimla-space-1` … `--vimla-space-9`)

### Radii

8 / 10 / 12 / 14 / round (`sm` `md` `lg` `xl` `round`)

### Typography

System UI / Segoe UI. Page title ~32/40 bold, section ~20/28 semibold, body 16/24, secondary 14/20, caption 12–13.

### Motion

fast 140ms, normal 200ms, slow 280ms. `prefers-reduced-motion` disables non-essential animation.

### Breakpoints

xs 0, sm 480, md 768, lg 1024, xl 1280, 2xl 1536. Mixins: `packages/ui/src/styles/breakpoints.scss`.

## Themes

`light` / `dark` / `system` via cookie `vimla_appearance`. `ThemeScript` prevents a flash. Admin uses `data-density="compact"`.

## Canonical navigation

Consumer: Chat, Settings (Security, Billing, Appearance). No production Projects/Library items until those domains exist.

Admin: finance, tariffs, AI, users, security, economics — driven by real `/admin` routes.

## Components

Primitives and patterns are exported from `@vimla/ui`. Product chat pieces (`ChatComposer`, `AiModeSelector`, …) live in the same package and receive real data from the apps.

AUTO is presentational/disabled in production until Auto Router exists. PRO shows the real model catalog. AUTO never reveals a hidden routed model.

## Real data

Production UI must not copy screenshot names, prices, usage, messages, or finance metrics. Empty/loading/error states use `EmptyState` / `Skeleton` / `ErrorState`.

Future Project primitives may appear only in `/dev/ui` with explicit DEMO fixtures.

## `/dev/ui`

Local/test catalog at `/dev/ui`. Gated on `APP_ENV=local|test`. Absent in staging/production (`notFound()`).

## Responsive strategy

Fluid grid/flex first. Mobile chat uses a drawer. Composer and auth submit stay reachable. Tables scroll inside a contained region. Safe-area insets and `dvh` are used on shells.

## Playwright matrix

Primary desktop Chromium keeps the full E2E suite.

Focused smoke: 320×568, 390×844, 768×1024, 1280×800.

Cross-browser: WebKit iPhone-style and Firefox run `responsive-cross-browser` only.

Selective pixel snapshots (`toHaveScreenshot`) cover `/dev/ui`, auth shells, chat empty, settings, and the admin shell. They run locally; CI skips them because Chromium font rendering differs between macOS and Ubuntu. Behavioral overflow/reachability tests remain the gate.

## Accessibility

Visible `focus-visible`, labels, dialog focus trap, Escape, 44px touch targets on coarse pointers, no hover-only critical actions.

## i18n

Generic `@vimla/ui` components do not hardcode product copy. Apps pass labels through next-intl (RU/EN).
