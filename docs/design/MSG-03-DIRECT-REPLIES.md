# MSG-03 — Authenticated E2EE Direct replies (second slice)

Scope: [#102](https://github.com/Designersss/vimlaAI/issues/102). This is
an isolated reviewed reply implementation, not full message mutation
or completion of the epic.

## Protocol and adversary model

A reply to a **HUMAN** message includes `{clientMessageId, senderUserId, senderDeviceId}`
inside the same authenticated, per-device end-to-end encrypted HUMAN
plaintext as the reply body. Every newly composed HUMAN payload is versioned
(`version: 2`), with optional `replyTo` and a uniformly random, 256-bit
`bindingKey` *inside the encrypted plaintext*. The clientMessageId is
a full 256-bit HMAC-SHA256 of the canonical text and reply reference,
keyed by that secret. The full opaque commitment is stored in the
nullable message-level `contentCommitmentB64` API/database field and signed
in AD5 for every recipient. A UUID-v4-shaped 122-bit prefix remains the
existing `clientMessageId` idempotency key, **not** the sole security binding. The sender generates ONE payload
and ONE derived ID for the entire device fan-out. Literal user-typed JSON
remains text rather than control metadata.
No untyped/v1 HUMAN format is accepted: Vimla is preproduction, with no
released-client compatibility boundary. Missing keys, invalid versions or
invalid content-to-ID bindings fail closed as undecryptable. The Direct
API/storage schema adds a nullable 32-byte (Base64) opaque
`contentCommitmentB64` field on `DirectMessage` (not per-device envelopes).
HUMAN requires the commitment, all OPERATOR_* kinds require null. API validates
that the UUID prefix matches the full commitment and verifies each sender
signature over AD5, which covers BOTH identifiers. The server sees ciphertext,
opaque HMAC, sender, epoch and existing routing metadata; neither the quoted
text, binding secret nor reply reference IDs appear in server-readable fields.

The sender of a reply can author an arbitrary reference. A valid E2EE sender
signature authenticates that sender's claim but **does not attest the source
message**. The recipient must resolve the reference against a locally
authenticated decrypted HUMAN message with exact authenticated client message ID, Direct chat ID, original sender ID
and sender device before displaying a quote attributed to that sender.
On missing history, missing device envelope, tampered references or a forged
OPERATOR_* source kind, show a neutral unavailable-source label **without
echoing attacker-authored quoted text**. When history is loaded and a valid
source becomes available, the quote can resolve locally. Never use a
sender-supplied plaintext snapshot as the displayed source quote.

The portable HUMAN wire codec and quote-provenance verifier live in
`@vimla/client-core`, so future Desktop/Mobile clients share exactly the
same authenticated-envelope interpretation and source validation. Web owns
only its platform-specific composition and rendering UI.

The composing UI only offers replies to decrypted HUMAN messages in the
current chat. It revalidates that original source before send; an invalid
source cannot silently turn into an ordinary send. Mixing a pending reply
with an @Vimla invocation is rejected to preserve the separate consent
and #74 origin-attestation boundaries. References are covered by existing
signed ciphertext, trust epochs, idempotency, device revocation and pending
outbox recovery without extra plaintext storage.

## Testing and limitations

Unit tests cover structured payload round-trip, malformed/forged references,
operator-kind spoofing and exact local source verification. Browser tests
exercise two-user replies, reload, and history pagination where the original
is not initially available.

This slice intentionally excludes cross-device missing-history recovery,
edits, deletes, reactions, forwarding and verified Operator origin. The
preproduction protocol may be refined before those separate security reviews.

The consent-gated @Vimla local-history projection decodes HUMAN payloads
before assembling AI context. It must never include serialized encrypted
reply-reference metadata as if it were ordinary user text.

## Cached E2EE provenance

A decrypted IndexedDB plaintext must remain bound to the exact message ID,
conversation, sender user, sender device, interaction epoch, kind and creation time against which it was
originally ratchet-decrypted or finalized from a verified outgoing send.
A server-side relabelled record is never treated as an authenticated local
source, even when the locally cached bytes decrypt as a HUMAN reply.
Both the immediate cache hit and the ratchet-locked second read enforce this
boundary. This prevents cross-chat/author relabelling from producing a
misattributed quote without performing unverifiable duplicate decryption.

Old plaintext caches without a signed-associated-data device/epoch provenance
are not eligible for quoted source attribution. A missing provenance field
must never be interpreted as a wildcard.

## Durable composer ownership

The sending lock is synchronous, before any mention-network await. A pre-persistence failure preserves the typed text and reply context. After outbound ratchets and the encrypted pending send commit atomically to IndexedDB, the composer relinquishes the original draft: only idempotent pending-send recovery owns any uncertain HTTP outcome. Text edited while sending is not cleared. @Vimla uses the same queue-ownership boundary.

### E2EE authenticated identity

Direct AD v5 binds the full `contentCommitmentB64` and `clientMessageId` alongside the existing sender user/device, conversation, recipient device, kind, epoch and routing context. This prevents a server from swapping signed ciphertext between distinct message identities. A reply points to the signed client message ID, not to the server-generated record ID. Server-generated IDs are used only for message pagination/report navigation and must not be cryptographic quote identities. The binding applies to HUMAN and OPERATOR envelope kinds alike; the existing Operator-origin verification gate #74 remains separate. Multi-recipient envelopes of one send use the *same* signed client message ID.

Sender-user and sender-device are included alongside signed client ID in the Web quote index. The server uniqueness constraint is per-conversation/per-author; a malicious sender with the same chosen UUID must not shadow another author's original in local reply resolution. Malformed HUMAN content is omitted from consent-gated @Vimla context, never copied as raw serialized control metadata.


## Protection against malicious sender equivocation across devices

Authentic sender signatures alone cannot guarantee that two recipient devices
received the **same** original HUMAN text for the same signed clientMessageId:
a malicious sender controls its own encryption keys and could sign different
plaintexts for each device. HUMAN wire v2 closes this gap by requiring each
recipient to recompute the **same content-bound ID after E2EE decryption**,
before a body or reply reference can be displayed as a verified HUMAN message.

- The unguessable, 256-bit `bindingKey` stays inside the ciphertext. A
  server-visible SHA256 (even one with a public random salt) would enable
  offline dictionary guessing of short messages; this keyed design does not.
- **A UUID alone does not provide 128-bit collision resistance:** its
  122-bit prefix has about 2^61 birthday security against a malicious sender
  able to preselect two messages/secrets. The independent, signed 256-bit
  commitment retains ~2^128 generic collision security, while the derived
  UUID remains the established idempotency/lookup key. The server verifies
  their relationship and retains one commitment per authoritative message.
  A receiver checks the entire 256-bit HMAC, not just the 122-bit prefix.
- The canonical commitment covers the **full original text and reply
  identity**. Every device sees and checks the same client ID, although
  recipient ciphertext, ratchet state and nonce legitimately differ.
- All read paths (new ratchet decrypt, protected cache, unified inbox,
  consent-gated AI context and local pending finalization) validate the FULL
  signed 256-bit commitment and derived UUID. The outbound multi-device
  encryption boundary rejects a mismatch before persisting ratchets or ciphertext.
- The server does not learn either the binding secret or plaintext. It
  verifies every signature over AD5 and insists on a single authoritative
  message-level commitment, while recipients verify the same 256-bit HMAC
  after decrypting HUMAN plaintext.
- Invalid, absent or mismatched binding data renders as unavailable, not
  spoofed peer content. Malicious senders can still intentionally author
  *ordinary* false text, omit a message to a recipient, or deny service; this
  property only prevents treating **inconsistent original HUMAN contents**
  under one committed ID as a single verifiable quote.

Regression coverage includes two correctly sender-signed, independently
encrypted recipient envelopes with the **same** clientMessageId but
**different plaintexts**: cryptographic signature checks succeed for each;
only the content matching the signed ID is accepted. Happy-path independent
recipient devices, tampering, cache provenance and pending recovery are also
covered.

## Composer revision ownership

The text input remains editable while the previous message waits for
network/outbox completion. The send transaction captures an exact monotonically
incrementing draft revision and reply-selection revision before the first
await. Only if BOTH draft and reply-selection revisions remain unchanged may
the staged outbox release composer text AND the selected reply together.
Changing either field prevents the prior send from clearing either field. An edit, even if it eventually restores identical text,
is not accidentally reclassified as the original staged draft. This
prevents silently dropping the quote on a newer reply composed during an
in-flight send.

### Protocol migration

Preproduction test/development Direct content predating AD5 and HUMAN v2 with the full signed commitment is intentionally not a released-client compatibility contract. Reset development ciphertext/ratchet histories as appropriate; do not silently accept legacy 122-bit-only HUMAN content in recipient clients. Migration `20261008213000_add_direct_human_content_commitment` introduces an optional PostgreSQL field to accommodate OPERATOR_* while HUMAN sends are strictly validated by the authoritative API.
