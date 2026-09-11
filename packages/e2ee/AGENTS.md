# packages/e2ee — Codex guidance

This file extends the root `AGENTS.md` for Direct Chat cryptography.

## Crypto safety
- This package is security-critical. Do not invent new cryptographic primitives or casually redesign the protocol.
- Preserve reviewed primitives, signature coverage, associated-data binding, key separation/domain separation, replay handling and ratchet state semantics.
- Private keys, chain keys and decrypted plaintext must never be logged or persisted in server-side ordinary message storage.
- Do not make private key material exportable or broadly accessible without an explicit security design.

## Known hardening posture
Direct Chat/E2EE code may exist while production enablement remains intentionally off pending security/cryptography hardening. Do not interpret feature presence as approval to enable it.

Any change touching X3DH/ratchet/envelope/device/prekey behavior must explicitly consider:
- first-contact identity verification / TOFU implications;
- one-time-prekey atomic consumption and lifecycle;
- crash/network failure around ratchet advancement;
- skipped-key/global memory bounds;
- replay/tamper handling;
- device revoke/rotation/multi-device evolution;
- canonical parsing of signed/authenticated header metadata;
- forward secrecy and key deletion expectations.

## Tests
Add or preserve tests for successful interop plus tamper rejection, signature spoofing, unrelated identity decryption failure, replay/out-of-order behavior and state recovery relevant to the change.

Do not weaken a crypto test to accommodate implementation changes. If a task would change protocol compatibility or security claims, stop and surface that explicitly.

Read `docs/DIRECT_CHATS.md`, `packages/direct-chats/AGENTS.md`, and root security guidance before changes.
