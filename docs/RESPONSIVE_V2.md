# Vimla Responsive v2

Required representative checks: 320×568, 375×667, 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080.

## Desktop
One labeled global sidebar + main page. No second persistent navigation layer.

## Tablet
Real reflow, not scaled desktop. Global nav may narrow. Supplementary columns move below. Controls wrap intentionally.

## Mobile
No desktop sidebar. Bottom nav has exactly Messages / My Work / Projects / Vimla. List -> detail drill-down. Profile/settings via avatar/menu.

Use `dvh`, safe-area insets, keyboard-aware composer, `min-width:0`, text wrapping/truncation, >=44px coarse-pointer targets. No hover-only critical operation. No accidental document horizontal overflow.

## Layout engineering
Use normal flow, Flexbox, Grid, gap, minmax, clamp, max-width and intrinsic sizing.

Do not achieve reference similarity by arbitrary `position:absolute`, top/left offsets, translations or magic margins. Absolute/fixed/sticky are only for semantic overlays/popovers/badges/sticky UI/bottom navigation.
