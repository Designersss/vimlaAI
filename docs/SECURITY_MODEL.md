# Vimla Security Model

## Assumption
Vimla is a public Internet service and will receive malicious traffic. Security and financial safety are first-class product requirements.

## Assets
High-value assets include:
- user credentials/sessions;
- personal data and conversations/files;
- payment/subscription/usage state;
- ProxyAPI/payment/email/SMS credentials;
- corporate provider balance;
- admin privileges and configuration;
- financial/audit history.

## Trust boundaries
1. Browser/mobile client -> Vimla API.
2. Vimla API -> PostgreSQL/Redis/object storage.
3. Vimla -> AI/payment/email/SMS providers.
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
Strict runtime schemas for external payloads; reject unknown sensitive fields on mutating security/financial/admin/AI operations.

### Financial safety
Postgres transactions/locks/constraints, idempotency, append-only ledger, reservation before provider calls, independent cost/concurrency caps and anomaly/reconciliation states.

### Abuse/DoS
IP/account/action rate limits, concurrency limits, request/file/context bounds, provider-spend caps and emergency switches.

### Secrets
Environment-specific least-privilege keys, no browser exposure, log redaction, rotation-ready configuration.

### Admin
Separate control plane, strong MFA/passkey, infrastructure access restriction where practical, explicit RBAC/permissions, step-up re-authentication and append-only audit trail.

### Infrastructure
Private DB/Redis, WAF/DDoS layer, TLS/security headers, least-privilege containers, secure management access, backups and restore tests.

## Incident principles
- Fail closed when financial/security outcome is ambiguous and failing closed avoids new spend/access.
- Never discard evidence needed for reconciliation/audit.
- Keep correlation IDs/provider request IDs/financial state sufficient to investigate incidents.
- Emergency disable expensive AI/provider actions independently from login/read-only product access.
