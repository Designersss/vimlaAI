# Vimla — Identity, Localization & Admin Roadmap Addendum

This document adds mandatory requirements to the implementation roadmap. It does not require interrupting an in-progress phase unless that phase would make these requirements impossible.

## Phase 3.5 — Identity + Auth UX + Localization Hardening
Recommended immediately after text-chat Phase 3 and before public payments/production.

Deliverables:
- email OTP verification and resend/cooldown/attempt limits;
- block sensitive paid/AI use for unverified identity according to policy;
- password reset email link and reset-complete session revocation;
- phone login via SMS OTP behind provider abstraction;
- safe account/identity linking rules;
- change email/phone with verification;
- session management/revoke other sessions;
- auth/account enumeration protection;
- localized RU/EN auth UI and validation;
- no native-browser-only validation UX;
- localized auth/security email/SMS templates;
- central i18n framework and locale persistence;
- tests for auth abuse, replay, expiry, resend, localization and errors.

Provider selection for email/SMS is a separate explicit infrastructure/commercial decision; design adapters first.

## Real payments phase
Before production acquiring:
- verified signed webhook only;
- refund/charge state reconciliation;
- localized payment errors/receipts/notifications where applicable;
- anti-fraud/abuse limits;
- operator reconciliation/admin views.

## Admin/control-plane foundation
Recommended after or alongside real payments/operations tooling, before broad public launch.

Architecture target:
```text
Internet
  -> infrastructure access policy (where practical)
  -> separate admin hostname/app
  -> privileged authentication + strong MFA
  -> explicit permission boundary
  -> admin API/application services
  -> audit log
```

Initial sections:
- Overview analytics;
- users/support;
- plans/subscriptions/payments/usage;
- provider COGS/balance/burn/runway;
- AI model catalog + enable/disable;
- feature flags/circuit breakers;
- errors/incidents/security signals;
- admin audit log.

Admin security requirements:
- no consumer-app link/navigation;
- no security dependence on obscurity/secret URL;
- OWNER role/permission initialized through controlled bootstrap, not public signup;
- mandatory passkey/TOTP/MFA;
- optional Cloudflare Access/Tailscale/IP policy defense-in-depth;
- separate/step-up privileged session for dangerous actions;
- default deny permissions;
- all dangerous actions audited;
- no ability to erase audit history through normal admin UI.

## Production hardening before launch
- CSP/HSTS/security headers;
- WAF/DDoS/bot layer + app-side rate limits;
- DB/Redis private network exposure only;
- production secrets/rotation process;
- backups + restore drill;
- monitoring/Sentry/metrics/alerts;
- dependency scanning/update policy;
- incident/reconciliation playbooks;
- AI global/user/model spend circuit breakers;
- admin/control-plane ingress hardening.
