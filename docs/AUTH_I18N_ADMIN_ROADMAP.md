# Vimla — Identity, Localization & Admin Roadmap Addendum

This document adds mandatory requirements to the implementation roadmap. It does not require interrupting an in-progress phase unless that phase would make these requirements impossible.

## Phase 3.5 — Identity + Auth UX + Localization Hardening
Completed after text-chat Phase 3 and before public payments/production.

Delivered:
- email OTP verification and resend/cooldown/attempt limits;
- block AI generation and billing mutations until `emailVerified=true`;
- password reset email link and reset-complete session revocation;
- phone login via SMS OTP behind `@vimla/notifications` (no phone-first signup);
- account linking only after authenticated verified-email + SMS OTP proof;
- change phone via SMS OTP from settings; change email via Better Auth OTP (current address, then new address);
- session management / revoke other sessions / IDOR-safe revoke;
- auth/account enumeration protection on signup and forgot-password;
- localized RU/EN auth, chat, usage, validation and API error codes via next-intl;
- no native-browser-only validation UX;
- localized auth/security email/SMS templates;
- `UserPreference.locale` persistence with cookie and Accept-Language fallback;
- tests for auth abuse, replay, expiry, resend, localization and errors;
- Playwright browser E2E against memory notifications and mock AI/payments.

Provider selection for email/SMS remains a separate explicit infrastructure/commercial decision. SMTP and HTTP SMS adapters exist; no vendor SDK is wired. Staging/production fail startup unless those adapters are configured. Live smoke tests are deferred until a vendor is chosen.

## Sender domain (production email)
Operators must configure SPF, DKIM and DMARC for the Vimla sending domain before production mail. `EMAIL_FROM` is a first-party address (not a free mailbox). Vimla does not write DNS records.

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
