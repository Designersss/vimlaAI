# Codex Instructions — Projects

Scope: `packages/projects/**`.

Before editing, read:
- `docs/CODEX_CONTEXT.md`
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/30-database.mdc`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

Rules:
- Project authority, membership and role checks are server-side.
- Roles are `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`; do not invent ownership-transfer behavior unless explicitly tasked.
- Project limits/locking are derived from owner/member plan entitlements; downgrade should not silently delete project data.
- A paid participant must not unlock a Free owner's project by becoming de-facto billing authority.
- Non-members should preserve IDOR-resistant `404` behavior where designed.
- Entitlement/membership checks that precede writes are concurrency-sensitive; use durable transactions/locking/constraints rather than process-local assumptions.
- Preserve ranking/activity semantics used for Free-plan project availability unless product policy explicitly changes them.
- Invite tokens are credentials: hash/store/transport them conservatively and avoid leaking them into logs/referrers where possible.
- Add integration tests for role matrix, IDOR, concurrent limits/invite acceptance and downgrade/restore behavior when touched.
