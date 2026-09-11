# Codex Instructions — Auth

Scope: `packages/auth/**`.

Before editing, read:
- `.cursor/rules/22-auth-identity.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/71-abuse-controls.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- Better Auth remains the identity/session foundation; do not create a parallel hand-rolled auth stack.
- User/session identity is established server-side from trusted auth state, never client-supplied user IDs/roles.
- Preserve verified-email, password-reset, session-revocation and sensitive-area policy.
- Avoid account enumeration in registration/recovery flows.
- OTP/reset/session tokens are secrets: do not log or place them in unsafe URLs beyond the designed reset flow.
- Cookie/session changes require CSRF/origin, SameSite, secure-cookie and session-fixation review.
- Admin privilege is separate from ordinary consumer authentication.
- Strong-auth/passkey/TOTP behavior must not be weakened to make tests convenient.
- Security-sensitive auth changes require abuse/replay/expiry/IDOR/session regression tests.
