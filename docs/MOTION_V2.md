# Vimla Motion v2

Motion explains state changes and gives tactile feedback. It is never decoration-first.

- fast: 120–140ms
- standard: 160–200ms
- overlay: 220–280ms

Buttons: subtle background/border transition and pressed scale ~0.985–0.99.
Inputs: focus border/ring transition with no layout shift.
Menus: opacity + 3–4px translation + optional .98 -> 1 scale.
Dialogs: overlay fade + subtle surface scale/translate.
Tabs: smooth active indicator/surface.
Switch/Checkbox: animated state/thumb/check.
Rows: quiet hover; deliberate drag pickup/drop state.
Composer: focus, send press, mention insertion.

`prefers-reduced-motion: reduce` removes non-essential transforms/animation; functionality and state feedback remain.
