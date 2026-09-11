# Vimla Security Model

## Assumption
Vimla is a public Internet service and will receive malicious traffic. Security and financial safety are first-class product requirements.

## Assets
High-value assets include:
- user credentials/sessions;
- personal data and conversations/files;
- payment/subscription/usage state;
- ProxyAPI/payment/email credentials;
- corporate provider balance;
- admin privileges and configuration;
- financial/audit history.

## Trust boundaries
1. Browser/mobile client -> Vimla API.
2. Vimla API -> PostgreSQL/Redis/object storage.
3. Vimla -> AI/payment/email providers.
4. Worker queue -> worker execution.
5. Consumer surface -> admin/control plane.

Everything crossing a boundary is untrusted until authenticated/validated/authorized.

## Primary threat classes
- credential stuffing, brute force, OTP spam/interception/replay;
- session theft/fixation/replay;
- account enumeration/recovery abuse;
- IDOR/privilege escalation;
- malformed/oversized payloads;
- XSS via user/AI content;
- CSRF against cookie-authenticated mutations;
- SQL/raw-query injection;
- SSRF when URL-fetching/tools exist;
- upload abuse/malware when files exist;
- concurrency/race-condition financial abuse;
- payment/webhook replay;
- AI provider spend abuse and retry storms;
- secret leakage via client/logs/errors/build artifacts;
- dependency/supply-chain compromise;
- admin account/control-plane compromise.

## Security controls
### Authentication
Proven auth framework, secure cookie sessions, verification/recovery, strong privileged MFA, rate limits and enumeration-safe flows.

### Authorization
Default deny. Scope resources by authenticated owner. Explicit permissions for privileged actions.

### Data validation
Validate every external payload, including webhooks, provider responses, env, and queue jobs. Bound sizes. Reject unexpected sensitive fields.

## Admin control plane
Privileged Admin uses a separate origin, hashed AdminSession, TOTP (required) and passkeys (required in staging/production), default-deny permissions, and append-only `AdminAuditLog`. Ordinary sessions and email OTP cannot elevate. Details: `docs/ADMIN_SECURITY.md`.

### Financial safety
Postgres transactions/locks/constraints, idempotency, append-only ledger, reservation before provider calls, independent cost/concurrency caps and anomaly/reconciliation states.

### Payments (Phase 4)
T-Bank notifications are untrusted until Token verification (timing-safe compare). `Success=true` / `Status=CONFIRMED` / Amount / PaymentId are ignored until the signature matches and the values equal the checkout snapshot. Webhook body `OK` is returned only after idempotent processing. Invalid signatures do not mutate Payment or Usage. Owner-scoped payment reads return 404 for foreign IDs. `TBANK_PASSWORD` and Token are redacted and never `NEXT_PUBLIC_*`. Production cannot start with `PAYMENT_PROVIDER=mock`. NotificationURL is server config (HTTPS in staging/production). Payment method is taken from **signed** root fields (e.g. PAN presence) or a trusted GetState `Source`; nested unsigned notification Params are not used. Raw PAN is not stored.

### Finance (Phase 4.5)
`FinanceQueryService` / tariff simulator / PaymentEconomics are internal. There is no public `/v1/finance` and no user-facing margin API. Owner Admin (`apps/admin`, `/admin/v1/*`) is the only privileged reader. Missing acquiring-fee policy must not cancel a paid grant.

### Abuse/DoS
IP/account/action rate limits, concurrency limits, request/file/context bounds, provider-spend caps and emergency switches. Email has additional rolling destination/IP/global send limits so Vimla cannot be used as a bomber.

### Secrets
Environment-specific least-privilege keys, no browser exposure, log redaction, rotation-ready configuration. Notification credentials (`SMTP_PASSWORD`) are server-only and redacted.

### Notifications
OTP and password-reset tokens never appear in logs, URLs (except the single-use reset query on the Vimla origin), analytics or Sentry breadcrumbs. Provider errors are normalized to stable API codes. Production cannot start with memory/logging delivery adapters. `GET /dev/notifications/latest` is registered only for `APP_ENV=local|test` (gated on `APP_ENV`, never `NODE_ENV`) and is absent from staging/production. Rate-limit Redis keys HMAC destination and IP; they never store raw email.

### Admin
Separate control plane, strong MFA/passkey, infrastructure access restriction where practical, explicit RBAC/permissions, step-up re-authentication and append-only audit trail.

### @Vimla operator (Phase 7)
The LLM never receives Prisma, SQL, Redis, shell, filesystem, env, Admin API, or arbitrary HTTP tools. Tool arguments are Zod-strict and reject `userId` / owner / permission fields. Execution uses the authenticated session `ActorContext` and existing workspace/notification services (other users’ objects 404). Destructive tools require a hashed confirmation token. Operator runs are owner-scoped (foreign IDs 404). Planner output is not returned to the browser. `OPERATOR_ENABLED` defaults to false; disabled endpoints return `operator_disabled`. UI entry points stay behind `CONSUMER_FEATURES.vimlaOperator`.

### Projects (Phase 8)
Project membership is server-authoritative. Non-members receive 404 (not 403). Owner plan is the only entitlement subject; a paid member cannot unlock `PLAN_LOCKED`. There is no ownership-transfer API. Invite tokens are HMAC-hashed; accept requires the authenticated email to match. `lastOpenedAt` is not updated by list or prefetch. `PROJECTS_ENABLED` defaults to false; disabled endpoints return `projects_disabled`. UI entry points stay behind `CONSUMER_FEATURES.projects`.

### Infrastructure
Private DB/Redis, WAF/DDoS layer, TLS/security headers, least-privilege containers, secure management access, backups and restore tests.

## Incident principles
- Fail closed when financial/security outcome is ambiguous and failing closed avoids new spend/access.
- Never discard evidence needed for reconciliation/audit.
- Keep correlation IDs/provider request IDs/financial state sufficient to investigate incidents.
- Emergency disable expensive AI/provider actions independently from login/read-only product access.
