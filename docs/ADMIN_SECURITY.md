# Admin security

Phase 5 adds a separate privileged control plane. A hidden URL is not a security mechanism.

## Topology

```text
Internet
  → Cloudflare (production)
  → optional Cloudflare Access on the admin hostname
  → apps/admin (admin.<domain>, local http://localhost:3002)
  → API /admin/v1/*
  → AdminPrincipal + AdminSession + MFA + permissions
```

Cloudflare Access is defense-in-depth. It does not replace application auth.

Consumer web (`apps/web`, `:3000`) and Admin (`apps/admin`, `:3002`) are separate frontend security boundaries. Privileged UI is not mounted under `/apps/web/app/admin`.

## Identity

Privileged access requires:

1. Better Auth identity with verified email;
2. `AdminPrincipal` status `ACTIVE` (not an email allow-list);
3. strong Admin authentication: TOTP (required) and, in staging/production, at least one enrolled passkey;
4. a short-lived server-side `AdminSession` cookie (`vimla_admin_session`).

Ordinary user session cookies never become Admin sessions. Email OTP or phone OTP alone cannot elevate.

Bootstrap (idempotent, no password, existing verified user only):

```bash
pnpm admin:bootstrap --user-id <uuid>
pnpm admin:disable --user-id <uuid>
pnpm admin:revoke-sessions --user-id <uuid>
```

Production bootstrap is a manual operator action on the server.

## MFA

Better Auth `twoFactor` (TOTP + encrypted backup codes) and `@better-auth/passkey` are used. Vimla never stores passkey private material. WebAuthn `rpID` / origin are explicit config (`ADMIN_WEBAUTHN_RP_ID`, `ADMIN_WEBAUTHN_ORIGIN`). SMS is not an Admin MFA factor. Email OTP is not a sufficient privileged factor.

Enrollment:

1. Operator bootstraps OWNER with `pnpm admin:bootstrap --user-id <uuid>` (verified user only).
2. Owner signs in on the Admin origin and opens `/enroll`.
3. Enable TOTP with the account password, store backup codes (shown once), verify a TOTP code before it is considered enabled (`skipVerificationOnEnable: false`).
4. Register at least one passkey. Staging/production refuse elevate without a passkey.
5. `/elevate` creates the hashed `AdminSession` after TOTP or backup-code step-up.

## Sessions and CSRF

Admin sessions: hashed token, absolute TTL, idle timeout, `lastStrongAuthAt`, server revocation, logout revoke, password change revoke. Production cookies: HttpOnly, Secure, SameSite=Lax.

Mutations require exact `ADMIN_ORIGIN`. CORS is an explicit origin list (`WEB_ORIGIN` + `ADMIN_ORIGIN`), never `*`. Browser-supplied user/admin IDs are ignored.

Sensitive actions (publish/retire plans and policies, kill switch, permission changes) require recent step-up (`ADMIN_STEP_UP_SECONDS`, default 900).

## Permissions

Default deny: every `/admin/v1` handler must declare `@RequireAdminPermission(...)`. OWNER receives all permissions (`finance.read/manage`, `tariffs.read/manage`, `users.read`, `ai.read/manage`, `security.audit.read`, `admin.manage`). Controllers must not branch on `role === OWNER`.

## Audit

`AdminAuditLog` is append-only (PostgreSQL trigger rejects UPDATE/DELETE). Secrets (passwords, TOTP, backup codes, WebAuthn private material, T-Bank password, ProxyAPI keys, cookies, Authorization) are redacted.

## Recovery

Preferred: remaining backup codes or another passkey. There is no “forgot MFA → email magic link → full admin”. Emergency recovery is operator CLI (`admin:disable`, `admin:revoke-sessions`) with server access and an audit row.

## Rate limits

Admin elevate is limited by IP, account and global Redis counters. Failures are audited. Accidental lockout is avoided by moderate windows; disable/revoke remains available from the server.

## E2E ports

User Playwright: web `3100` / API `3101`. Admin Playwright: admin `3202` / API `3201`.
