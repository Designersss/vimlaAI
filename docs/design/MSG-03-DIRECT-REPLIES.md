# MSG-03 — Authenticated E2EE Direct replies (second slice)

Scope: [#102](https://github.com/Designersss/vimlaAI/issues/102). This is
an isolated reviewed reply implementation, not full message mutation
or completion of the epic.

## Protocol and adversary model

A reply to a **HUMAN** message includes `{messageId, senderUserId}`
inside the same authenticated, per-device end-to-end encrypted HUMAN
plaintext as the reply body. Every newly composed HUMAN payload is versioned
(`version: 1`), with optional `replyTo`; this preserves literal user-typed
JSON instead of mistaking it for control metadata. Untyped previous Direct
plaintext is still rendered as ordinary user text. The Direct
API/storage schema and ciphertext-associated-data signature are unchanged:
the server sees only ciphertext, sender, epoch and preexisting routing
metadata; neither quoted text nor reference IDs appear in server-readable
fields.

The sender of a reply can author an arbitrary reference. A valid E2EE sender
signature authenticates that sender's claim but **does not attest the source
message**. The recipient must resolve the reference against a locally
authenticated decrypted HUMAN message with exact message ID, Direct chat ID
and original sender ID before displaying a quote attributed to that sender.
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
conversation, sender user, kind and creation time against which it was
originally ratchet-decrypted or finalized from a verified outgoing send.
A server-side relabelled record is never treated as an authenticated local
source, even when the locally cached bytes decrypt as a HUMAN reply.
Both the immediate cache hit and the ratchet-locked second read enforce this
boundary. This prevents cross-chat/author relabelling from producing a
misattributed quote without performing unverifiable duplicate decryption.
