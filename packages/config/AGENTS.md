# Codex Instructions — Config

Scope: `packages/config/**`.

Rules:
- Environment/configuration is untrusted input and must be validated centrally.
- Do not scatter new direct `process.env` reads through application code when validated config can own the setting.
- Secrets must never be exposed through `NEXT_PUBLIC_*`, logs, defaults committed to production paths or error responses.
- Staging/production must fail closed when a required real provider/security setting is missing; do not silently fall back to mocks.
- Feature flags for staged capabilities remain default-off unless product rollout explicitly changes them.
- Keep local/test defaults clearly non-production and safe.
- Config changes require updates to `.env.example` and tests/docs when relevant, without inserting real credentials.
