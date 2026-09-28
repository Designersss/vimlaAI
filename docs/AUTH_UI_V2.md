# Vimla Auth UI v2

> **Status note:** this is a Web auth-UI reference, not the final cross-platform presentation contract. The owner will manually redesign Web after #122; native auth shells come later and reuse the same backend identity model rather than this DOM layout.


Reference `08-auth-layout-concept.png` is a composition reference only. Restyle it with Vimla v2 foundation.

## Existing flows to visually cover

- Sign in — email/password.
- Sign up.
- Email OTP verification.
- Forgot password / reset initiation.
- New/reset password.
- Loading, disabled, validation/error, resend and success states as required by existing routes.

Do not invent OAuth/social providers or auth methods not backed by current implementation.

## Desktop
Use the liked split composition:
- primary form area;
- secondary contextual/value panel;
- clear brand at top;
- form remains the focus.

The right/secondary panel contains timeless product value copy only; no fake metrics or fabricated customer counts.

## Tablet
Compact split when space genuinely supports it; otherwise stacked composition.

## Mobile
Single-column auth flow. Secondary marketing panel collapses into a small intro/helper area or disappears. Form must not be pushed below the fold unnecessarily.

## Theme
Dark is primary and must feel native to Vimla. Light preserves exact geometry.

## Accessibility/security UX
- correct autocomplete attributes;
- visible focus;
- password reveal;
- OTP group semantics;
- validation tied to fields;
- no secrets in UI/logs;
- keyboard flow;
- touch targets;
- no browser-native validation popups when app uses stable localized error handling.
