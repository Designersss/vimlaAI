# Vimla Shared UI Components 2026

This document records the implementation contract for the shared component layer that follows the canonical `docs/DESIGN_SYSTEM.md` foundation.

## Scope

`@vimla/ui` is the shared presentation and interaction layer for Vimla. It must remain independent from product routing, authentication authority, billing authority and domain state.

The current shared component families are:

- Actions: `Button`, `IconButton`.
- Forms: `Input`, `Textarea`, `NativeSelect`, `SearchInput`, `PasswordInput`, `OtpInput`, `FormField`, `Checkbox`, `Radio`, `Switch`.
- Navigation primitives: `Tabs`, `Tab`, `SegmentedControl`, `Segment`.
- Surfaces and feedback: `Card`, `Alert`, `Badge`, `StatusBadge`, `Avatar`, `Progress`, `UsageMeter`, `Skeleton`, `Spinner`, `EmptyState`, `ErrorState`, `Divider`.
- Overlays: `Dialog`, `Drawer`, `Sheet`, `DropdownMenu`, `Popover`, `Tooltip`, `Toast`.

## State contract

Interactive primitives must provide deliberate default, hover, active/pressed, focus-visible, disabled and loading states when applicable. Components consume semantic Design System 2026 roles instead of raw palette values or page-specific styling.

Form fields connect visible description and error content to the rendered control through ARIA relationships. Disabled and read-only states remain visually distinct without relying only on color.

## Responsive and input contract

Shared components must remain usable across small mobile, common mobile, tablet, laptop, desktop, wide desktop and short-landscape viewports. Touch targets use the canonical touch-target role on coarse pointers. Overlays respect safe-area insets and dynamic viewport height. Reduced-motion preferences are inherited from the foundation motion contract.

## Development state lab

`/dev/ui` is the local/test-only visual and interaction state lab for the shared layer. It is not a product destination and must not introduce fake routes, capabilities or domain state.

The state lab covers both light and dark themes and representative states for actions, form controls, navigation primitives, surfaces, feedback and overlays. Product-page redesigns remain separate migration steps.
