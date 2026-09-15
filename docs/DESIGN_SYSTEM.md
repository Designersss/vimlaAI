# Vimla Design System 2026

This document is the canonical visual and interaction contract for Vimla. The authoritative implementation lives in `packages/ui` (`@vimla/ui`).

The September 2026 approved design direction supersedes the Phase 6.1 / UI System v2 visual specification. Existing v2 documents and `docs/design/references-v2/` remain useful migration/history material, but they must not override this document or the semantic foundation in `@vimla/ui`.

Historical v1 references in `docs/design/references/` are archival only.

## Product character

Vimla is an adult, intelligent AI product: calm, precise and visually confident. The design should minimize visual noise while making quality, hierarchy and state obvious.

Core principles:

1. Content first.
2. Dark native, with a deliberately designed light theme rather than an inverted dark theme.
3. Quiet UI: restrained color, radius, borders and motion.
4. Depth without clutter: surfaces and subtle borders before heavy shadows.
5. Familiar navigation patterns without copying another product's identity.
6. Vimla identity: the sphere is the primary brand object when a production-quality source asset is available.
7. Responsive and accessible by default, not as follow-up polish.

## Reference hierarchy

When sources disagree, use this order:

1. Security, privacy, billing and product/domain correctness.
2. Backend/API/contracts, persisted state, feature gates and real capabilities.
3. This document and the semantic `@vimla/ui` foundation.
4. Approved 2026 page/component visual references.
5. Existing route architecture and responsive behavior documented in `docs/CONSUMER_LAYOUT.md`.
6. Historical v2 and v1 material for migration context only.

Visual references never create product capabilities. Do not add dead navigation, settings sections, demo finance data, models, Library/Agents/Tools/Favorites/Archive, or other future concepts solely because a mockup contains them.

## Foundation tokens

Semantic CSS variables are defined in `packages/ui/src/styles/tokens.scss`. Component and feature styles consume semantic `--vimla-*` roles; raw palette values stay in the token file.

### Color

| Semantic role | Light | Dark |
| --- | --- | --- |
| Background primary | `#F7F9FC` | `#070B10` |
| Background secondary | `#FBFCFE` | `#0A1018` |
| Surface 1 | `#FFFFFF` | `#0D141E` |
| Surface 2 | `#F2F6FB` | `#111A26` |
| Surface 3 | `#EAF1F9` | `#172231` |
| Border subtle | `#E5EBF2` | `#1A2735` |
| Border default | `#D7E0EA` | `#253447` |
| Text primary | `#142238` | `#F3F6FA` |
| Text secondary | `#66758A` | `#A6B1C0` |
| Text muted | `#8C99AA` | `#6E7D90` |
| Accent | `#4C91E8` | `#75B7FF` |
| Accent hover | `#397FD5` | `#8DC4FF` |
| Accent soft | `#E8F2FF` | `#16283D` |
| Success | `#239B76` | `#62D5B3` |
| Warning | `#B78021` | `#E9BB6A` |
| Danger | `#DC4650` | `#FF646D` |

`--vimla-bg`, `--vimla-surface`, `--vimla-text`, `--vimla-border` and other legacy semantic names remain compatibility aliases during migration. New work should prefer the more explicit foundation roles where that improves clarity.

Do not reintroduce the old v2 violet as a general product accent. The final sphere artwork may contain its own controlled brand lighting; that does not turn arbitrary component chrome purple.

### Typography

Primary UI face: **Inter Variable** / Inter, with system fallbacks. Code and technical monospace content use **JetBrains Mono** or a system monospace fallback.

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Display | 56 / 60 | 500 |
| H1 | 36 / 44 | 500 |
| H2 | 28 / 36 | 550 |
| H3 | 22 / 28 | 600 |
| H4 | 18 / 24 | 600 |
| Body | 14 / 21 | 400 |
| Body large / messages | 16 / 24 | 400 |
| Small | 13 / 18 | 400/500 |
| Caption | 12 / 16 | 400/500 |
| Overline | 11 / 16 | 500/600 |

Use weights 400, 500 and 600 for normal interface work. Avoid faux-heavy typography as a substitute for hierarchy.

### Spacing

Base unit: 4px.

Canonical scale: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`.

Role guidance:

- controls: 12–16px internal spacing;
- cards/panels: 20–24px;
- sidebar rows: approximately 12px vertical / 16px horizontal;
- desktop page gutters: 24–40px according to available space;
- mobile page gutters: 16–20px.

Do not add arbitrary values such as 17, 23 or 29px without a functional reason.

### Radius

Prefer role tokens over choosing a radius by eye:

- small controls: 8px;
- inputs/buttons: 10px;
- sidebar/navigation rows: 12px;
- cards: 14px;
- messages: 18px;
- modals: 18px;
- promo surfaces: 20px;
- bottom sheets: 24px.

The old generic radius aliases remain available while existing components migrate.

### Material, elevation and glass

Dark depth comes primarily from background/surface steps, borders and local light. Avoid large generic shadows on every card.

Floating surfaces may use the shared floating shadow and, when glass is functionally appropriate, `--vimla-glass-bg` with `--vimla-glass-blur: 24px`.

Glass is for floating UI, modal/drawer/sheet contexts and selective overlays. Do not make the whole application glass.

### Motion

Canonical roles:

- hover: 120ms;
- button/state response: 150ms;
- dropdown/popover: 180ms;
- sidebar/layout transition: 220ms;
- modal: 240ms;
- page transition: 250ms;
- easing: `cubic-bezier(.2,.8,.2,1)`.

Motion must communicate state or spatial continuity. No bounce/spring effects by default. `prefers-reduced-motion` disables non-essential animation.

## Responsive layout

Shared Sass thresholds live in `packages/ui/src/styles/breakpoints.scss`. Existing `sm/md/lg/xl/2xl` names remain stable so this visual migration does not silently rewrite route behavior. Design System 2026 additionally defines context (`1100px`), desktop (`1440px`) and wide (`1728px`) roles for future presentation variants.

Representative QA widths include 360, 390, 430, 768, 1024, 1280, 1440 and 1728px, plus existing repository coverage at 320 and 1920px. Always test short heights, portrait/landscape, touch and keyboard input, safe areas and reduced motion.

Layout rules:

- global desktop navigation target: 240–264px;
- optional compact global rail target: approximately 88px;
- rich context/list pane target: 420–460px where the feature and viewport genuinely support it;
- below a usable context threshold, master/detail becomes sequential or temporary rather than squeezing both panes;
- mobile levels are separate full-screen states with deterministic Back behavior;
- horizontal document overflow is a defect.

Do not change existing URL/source-of-truth architecture merely to match a screenshot. `MasterDetailLayout` stays routing/domain agnostic; richer width variants belong to the shared presentation layer in a later migration step.

## Themes

`light` / `dark` / `system` continue to use the `vimla_appearance` cookie and `ThemeScript` to prevent a theme flash. Dark is the primary brand expression. Light uses cold layered surfaces (`#F7F9FC`, `#FFFFFF`, `#F2F6FB`) rather than color inversion.

Admin remains on the same semantic foundation with `data-density="compact"`; density does not create a second design system.

## Brand

The Vimla sphere is the intended recognizable brand object for logo/app identity, assistant avatar, empty/onboarding states, thinking/loading moments and large marketing/auth visuals.

Do **not** extract a low-resolution sphere from screenshots/PDF references for production. Until a proper source asset (SVG/high-resolution raster/source artwork) is available, the existing Vimla mark remains a temporary fallback. Small navigation/app-icon usage should eventually use a simplified glyph derived from the approved sphere rather than a downscaled photorealistic object.

## Navigation and product IA

The product/domain model remains authoritative during the visual migration.

Current global navigation remains the existing product set and feature gates. Current mobile navigation remains **Messages / My Work / Projects / Vimla**, with Settings/profile through account UI. Do not add mock-only destinations.

Existing consumer architecture remains intact:

- Messages: persistent URL-authoritative master/detail;
- Projects: persistent project collection/detail where real routes exist;
- Settings: persistent local navigation + responsive detail;
- My Work: persistent Work navigation; Notes/Lists master-detail; Tasks/Reminders single-pane.

See `docs/CONSUMER_LAYOUT.md` for route/state authority.

## Component contract

Shared primitives/patterns are exported by `@vimla/ui`. A component owns one state model across themes and breakpoints: default, hover, active/selected, focus-visible, disabled and—where relevant—loading/error/success.

New or migrated components should use role tokens for spacing/radius/motion instead of local values. Feature SCSS may compose layout but must not fork the foundation palette.

Touch targets are at least 44×44px for primary interactive controls on touch/coarse-pointer contexts. Icon-only controls require an accessible name; focus-visible is mandatory; errors cannot rely on color alone.

## Real data and content

Production UI must not copy mock screenshot names, prices, usage, messages or finance metrics. Empty/loading/error states use shared patterns. Tone is calm, confident and human; avoid childish default emoji and vague error copy.

## `/dev/ui` design lab

`/dev/ui` is the local/test design laboratory and remains gated by `APP_ENV=local|test`; it must not ship as a production catalog.

During the Design System 2026 migration it should make foundation behavior visible in both themes before feature pages are restyled: typography, semantic colors/surfaces, buttons, inputs, switches, cards, messages, navigation, overlays, empty/error/loading states and eventual sphere variants.

## Migration sequence

Do not rebuild every page independently. Use this order:

1. Foundation (this contract, tokens, typography, spacing/radius, material, motion, responsive roles).
2. Shared component state/visual migration + `/dev/ui` design lab.
3. Global `AppShell` and navigation treatment.
4. Chat as the first reference product surface (desktop/mobile and dark/light).
5. Projects, Settings and My Work.
6. Auth.
7. Landing/marketing.

Each step should be a focused reviewable PR. Preserve server authority, route semantics, feature gates and existing responsive behavior while the visual layer changes.

## Playwright and accessibility gates

Behavioral responsive tests remain CI gates. Visual snapshots are useful only in a pinned rendering environment; never weaken behavioral assertions because local/macOS and CI/Linux font rasterization differ.

Minimum accessibility contract:

- WCAG AA contrast target (4.5:1 normal text, 3:1 large text/UI where applicable);
- visible keyboard focus;
- logical tab order;
- 44px touch targets where touch interaction applies;
- icon-only accessible names;
- errors/state not communicated by color alone;
- safe-area support and reduced-motion support.

## i18n

Generic `@vimla/ui` components do not hardcode product copy. Apps provide user-facing labels through the existing localization boundary (RU/EN). Long translations must be included in responsive QA.
