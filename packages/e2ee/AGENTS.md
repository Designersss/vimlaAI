# Codex Instructions — E2EE

Scope: `packages/e2ee/**`.

Before editing, read:
- `docs/DIRECT_CHATS.md`
- `packages/direct-chats/AGENTS.md`
- `.cursor/rules/70-security.mdc`
- `.cursor/rules/80-testing.mdc`

This package is cryptography/security critical.

Rules:
- Do not invent new cryptographic constructions or primitives for convenience.
- Preserve the intended X3DH + Double Ratchet structure and reviewed primitive usage.
- Preserve forward-secrecy/session-rotation intent, AEAD integrity, replay handling and device lifecycle semantics.
- Treat server-provided identity/prekey material as untrusted transport input and preserve signature/identity checks.
- Never move long-term private keys or plaintext message history to the server.
- Avoid secret/plaintext logging, debug dumps and test fixtures that contain real secrets.
- Any persisted browser secret/plaintext expansion must be explicitly justified and reviewed.
- State advancement must remain safe under network failure/retry; do not advance durable ratchet state in a way that creates unrecoverable desynchronization without a recovery design.
- Bound skipped-key/replay-related storage and adversarial resource growth.
- One-time prekeys require safe single-consumption semantics.
- New-device/history behavior must fail safely rather than silently weakening E2EE.
- Unit tests must cover tamper rejection, unrelated identity/device isolation, out-of-order/replay semantics and any changed ratchet/KDF/nonce behavior.
- Functional tests are not a substitute for external cryptographic review; do not claim otherwise.
