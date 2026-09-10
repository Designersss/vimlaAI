# Vimla Visual System v2

## Character

Vimla is a serious mass-market product, not a developer dashboard and not a playful AI toy. It should be understandable to teenagers, adults and older users.

Visual inspiration is the clarity/density of Telegram and the discipline of iOS/macOS, without literal copying.

## Theme

Dark is the primary reference. Light is a theme-equivalent, never a second design.

- neutral graphite / blue-black surfaces;
- system-like blue for interactive actions;
- Vimla blue-violet reserved for identity and `◆ Vimla`;
- no general purple glow/gradient surfaces;
- subtle borders instead of excessive shadows;
- high text contrast.

Implementation must use semantic `--vimla-*` tokens; raw hex belongs only in token definitions.

## Typography

System/SF Pro/Inter-like typography. Compact and serious.

- Page: ~28/34 bold
- Section: ~20/26 semibold
- Component title: ~16/22 semibold
- Body: 15–16 / 21–24 regular
- Secondary: 14/20
- Caption: 12–13/17

Do not use oversized marketing headings on productivity screens and do not shrink ordinary UI text to fit.

## Geometry

- base spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64;
- controls: ~36–40px desktop, >=44px touch target;
- radii: restrained 8/10/12/14–16;
- pills only when semantically appropriate.

## Icons

One monochrome system-like line icon family. Consistent stroke and size. No cartoon/multi-color navigation icons. Brand mark is allowed for Vimla identity.
