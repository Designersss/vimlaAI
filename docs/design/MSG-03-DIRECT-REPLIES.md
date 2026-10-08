# MSG-03 — Authenticated E2EE Direct replies (second slice)

Scope: [#102](https://github.com/Designersss/vimlaAI/issues/102). This is
an isolated reviewed reply implementation, not full message mutation
or completion of the epic.

## Protocol and adversary model

A reply to a **HUMAN** message includes `{clientMessageId, senderUserId, senderDeviceId}`
inside the same authenticated, per-device end-to-end encrypted HUMAN
plaintext as the reply body. Every newly composed HUMAN payload is versioned
(`version: 1`), with optional `replyTo`; this preserves literal user-typed
JSON instead of mistaking it for control metadata. No untyped/legacy HUMAN format is accepted: preproduction development
history is not a released-client compatibility boundary. Malformed or future
versions fail closed as undecryptable content. The Direct API/storage schema is unchanged; however, the E2EE associated
data changes to bind the client-generated message identifier:
the server sees only ciphertext, sender, epoch and preexisting routing
metadata; neither quoted text nor reference IDs appear in server-readable
fields.

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

Direct AD v4 binds `clientMessageId` and the existing sender user/device, conversation, recipient device, kind, epoch and routing context. This prevents a server from swapping signed ciphertext between distinct message identities. A reply points to the signed client message ID, not to the server-generated record ID. Server-generated IDs are used only for message pagination/report navigation and must not be cryptographic quote identities. The binding applies to HUMAN and OPERATOR envelope kinds alike; the existing Operator-origin verification gate #74 remains separate. Multi-recipient envelopes of one send use the *same* signed client message ID.

Sender-user and sender-device are included alongside signed client ID in the Web quote index. The server uniqueness constraint is per-conversation/per-author; a malicious sender with the same chosen UUID must not shadow another author's original in local reply resolution. Malformed HUMAN content is omitted from consent-gated @Vimla context, never copied as raw serialized control metadata.
