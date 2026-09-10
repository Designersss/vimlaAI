# Vimla Design Reference Policy v2

## Authority order

1. Approved v2 references for visual language/geometry.
2. v2 design text specs for composition/behavior.
3. Repository contracts/i18n/domain docs for exact feature semantics and copy.
4. Backend/security policy is authoritative.

## Never hardcode generated screenshot content

No demo names, counts, prices, dates, participants, plans, project states or messages in production solely because a PNG contains them.

Missing future features must not receive fake production routes or mock arrays. Presentational previews belong in `/dev/ui` or test fixtures. Feature-gated shell/navigation is acceptable only if it cannot perform fake actions or expose dead production routes.

## Reuse-first

Search `@vimla/ui` first. Extend canonical shared components before page-local alternatives.

## No coordinate tracing

A visual match produced by brittle X/Y positioning is a failed implementation. Reconstruct the layout system.

## Brand asset

Generated variations of the Vimla mark are not authoritative. Use one real repository brand asset consistently.
