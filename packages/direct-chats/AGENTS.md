# Codex Instructions — Direct Chats

Scope: `packages/direct-chats/**`.

Before editing, read:
- `docs/DIRECT_CHATS.md`
- `docs/CODEX_CONTEXT.md`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/21-api-contracts.mdc`
- `.cursor/rules/80-testing.mdc`
- `packages/e2ee/AGENTS.md` when crypto/session behavior is involved.

Rules:
- Direct Chats are 1:1 and distinct from ordinary AI conversations.
- Server-side code must not start storing human message plaintext as normal chat state.
- Membership/participant identity is server-authoritative; arbitrary user IDs from LLM/client do not grant targeting authority.
- Non-member access must preserve the existing owner-safe/IDOR-resistant behavior.
- `@Vimla` context handoff uses explicitly consented, bounded, client-decrypted context only.
- Context text is untrusted and never permission authority.
- Peer workspace Notes/Reminders/Lists are not exposed by Direct Chat membership.
- Preserve attribution for cross-user task assignment.
- Device/prekey/message endpoints must enforce ownership, replay/tamper validation, payload bounds and rate limits.
- Keep feature flags fail-closed by default.
- Do not make public cryptographic guarantees stronger than the implementation proves.
- Add integration tests for IDOR, spoofing, consent/context isolation, participant targeting and replay/tamper-related server invariants when touched.
