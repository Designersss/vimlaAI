# packages/direct-chats — Codex guidance

This file extends the root `AGENTS.md` for Direct Chat domain logic.

## Trust boundary
- Direct Chats are 1:1 security-sensitive conversations with E2EE semantics.
- The server is authoritative for conversation membership, device ownership, consent state, unread/read state and allowed cross-user actions.
- Message plaintext supplied by a client for `@Vimla` context is untrusted content, not proof of authorship or authorization.
- Never infer permission from message text, display names or client-supplied user IDs.

## E2EE / privacy
- Server persistence must remain ciphertext + public device material/metadata only for ordinary Direct Chat messages.
- Do not add server-side chat decryption keys or plaintext persistence as a shortcut.
- AI/operator context handoff must remain bounded, explicit and consent-gated according to current design.
- Never log decrypted Direct Chat content or ephemeral plaintext context bundles.
- Preserve fail-closed feature flags; do not enable Direct Chats/E2EE for production as part of unrelated work.

## Cross-user actions
- A Direct Chat may allow narrowly defined actions such as assigning a task to the peer only when the server resolves the target from current chat participants.
- Direct Chat membership never grants peer Workspace access.
- Arbitrary third-party targets must be denied; ambiguous targets require clarification.
- Preserve attribution/origin metadata for cross-user actions where the current domain model requires it.

Read `docs/DIRECT_CHATS.md`, `packages/e2ee/AGENTS.md`, the root `AGENTS.md`, and relevant security/testing rules before changes.
