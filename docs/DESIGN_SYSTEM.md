# Vimla Design System

Authoritative implementation: `packages/ui` (`@vimla/ui`).

Visual references for Phase 6.1 live in `docs/design/references-v2/` and the v2 text specs (`docs/REFERENCE_INDEX_V2.md`, `docs/VISUAL_SYSTEM_V2.md`, `docs/COMPONENT_SPEC_V2.md`, `docs/PAGE_PATTERNS_V2.md`, `docs/NAVIGATION_IA_V2.md`, `docs/RESPONSIVE_V2.md`, `docs/MOTION_V2.md`, `docs/AUTH_UI_V2.md`, `docs/REFERENCE_POLICY_V2.md`).

Historical v1 images remain in `docs/design/references/` and must not override v2.

## Principles

Vimla is a serious mass-market product. Reuse shared primitives before composing page layouts. Feature SCSS is for layout only.

## Reference hierarchy

1. Security and product/domain correctness
2. Backend/API/contracts and persisted state
3. This document and `@vimla/ui`
4. Foundation PNGs (theme/tokens)
5. Component PNGs
6. Page-pattern PNGs
7. Text specs / i18n
8. Responsive rules

`08-auth-layout-concept.png` is composition-only. Its old palette is not canonical.

## Tokens

Semantic CSS variables are defined in `packages/ui/src/styles/tokens.scss`.

Raw palette (token file only):

| Token role | Light | Dark |
| --- | --- | --- |
| Background | `#FAFBFD` | `#0B1220` |
| Surface | `#FFFFFF` / `#F3F6FA` | `#111827` / `#1A2332` |
| Interactive accent (system blue) | `#007AFF` | `#3B82F6` |
| Identity / ◆ Vimla | `#6366F1` | `#6366F1` |
| Text | `#0F172A` | `#F1F5F9` |
| Success / Warning / Danger | `#22C55E` / `#F59E0B` / `#EF4444` | same family |

`--vimla-accent` is system blue. `--vimla-brand` is identity only. Components consume `--vimla-*`, never raw hex.

### Spacing

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64

### Radii

4 / 8 / 10 / 12 / 16 / round (`xs` `sm` `md` `lg` `xl` `round`)

### Typography

System/SF Pro/Inter-like. Page 28/34 bold, section 20/26 semibold, body 16/24, secondary 14/20, caption 12/17.

### Motion

fast ~130ms, normal ~180ms, overlays ~240ms. `prefers-reduced-motion` disables non-essential animation.

### Breakpoints

xs 0, sm 480, md 768, lg 1024, xl 1280, 2xl 1536. Mixins: `packages/ui/src/styles/breakpoints.scss`.

Desktop: one global sidebar + main. Tablet (≥768): narrower sidebar, true reflow. Mobile (<768): bottom navigation, no desktop sidebar.

## Themes

`light` / `dark` / `system` via cookie `vimla_appearance`. `ThemeScript` prevents a flash. Dark is the primary reference. Admin uses `data-density="compact"` on the same foundation.

## Canonical navigation

Exactly one global layer: Messages, My Work, Settings. Projects and ◆ Vimla stay feature-gated (`CONSUMER_FEATURES`) until their domain phases. No conversation history, folders, or work lists in the global sidebar.

List/detail are separate routes (`/app` collection, `/app/[id]` conversation).

My Work local tabs: Today / Tasks / Reminders / Lists / Notes.

Settings local nav: Account / Security / Billing / Appearance. Notifications stay gated.

## Components

Primitives and patterns are exported from `@vimla/ui`. Composer model selection lives only in the AI composer. Auto is truthfully gated until Auto Router exists. PRO opens `ModelPickerDialog` against the real catalog. Concrete models never appear in the root menu.

`◆ @Vimla` is a structured mention control. Phase 7 executes operator actions through `/v1/operator/runs`; the dedicated `/vimla` composer has no model selector.

## Real data

Production UI must not copy screenshot names, prices, usage, messages, or finance metrics. Empty/loading/error states use `EmptyState` / `Skeleton` / `ErrorState`.

Future Direct Chat / Projects / operator patterns may appear only in `/dev/ui` with explicit DEMO fixtures.

## `/dev/ui`

Local/test catalog at `/dev/ui`. Gated on `APP_ENV=local|test`. Absent in staging/production (`notFound()`).

## Responsive strategy

Fluid grid/flex first. Do not imitate references with arbitrary absolute offsets. Mobile uses bottom navigation and collection → detail drill-down. Composer is keyboard/safe-area aware. Tables scroll inside a contained region.

## Playwright matrix

Primary desktop Chromium keeps the full E2E suite.

Focused smoke: 320×568, 390×844, 768×1024, 1280×800.

Cross-browser: WebKit iPhone-style and Firefox run `responsive-cross-browser` only.

Selective pixel snapshots (`toHaveScreenshot`) cover `/dev/ui`, auth shells, messages collection, settings, and the admin shell. They run locally; CI skips them because Chromium font rendering differs between macOS and Ubuntu. Behavioral overflow/reachability tests remain the gate.

## Accessibility

Visible `focus-visible`, labels, dialog focus trap, Escape, 44px touch targets on coarse pointers, no hover-only critical actions.

## i18n

Generic `@vimla/ui` components do not hardcode product copy. Apps pass labels through next-intl (RU/EN).
