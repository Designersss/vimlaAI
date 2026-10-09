# MSG-03 — E2EE Direct message reactions (proposed third slice)

Status: **Draft; signed Direct reaction events, Web picker/chips, portable verification and multi-device E2E exist. Bounded historical reconstruction, storage lifecycle and final security review are NOT complete.**
Parent: [#102](https://github.com/Designersss/vimlaAI/issues/102);
epic: [#81](https://github.com/Designersss/vimlaAI/issues/81);
master: [#78](https://github.com/Designersss/vimlaAI/issues/78).
Baseline: `main@4593ce26cbea7e58e8d755687344e5e390cd9a9d`
after merged replies PR #152.

## Goal and scope

Allow either Direct participant to add or remove an emoji reaction to an
**authenticated HUMAN** message, and have that result converge across
tabs/devices, history pagination, offline recovery and duplicate realtime.

A reaction is a durable **message interaction**, not a new ordinary human
chat bubble. It must not produce a misleading unread count, AI context,
notification text, human-message report body, or fresh inbox preview.

Non-goals for this slice: editing/deleting existing messages, forwards, media,
cross-device E2EE history-key recovery, and trusted @Vimla output origin.
Security issues #54, #74 and #75 remain open and must not be bypassed.

## Observed baseline

- HUMAN v2 uses a fresh 256-bit encrypted `bindingKey`, a full 256-bit
  `contentCommitmentB64` authenticated in Direct AD5, and a derived
  UUIDv4-shaped `clientMessageId` for idempotency.
- A source quotation is locally attested only after matching the exact
  decrypted original's conversation, kind, author, sender device, UUID
  **and full commitment**.
- `DirectMessage` currently stores all kinds in a per-conversation ordered
  log, with one encrypted envelope per active device and authoritative
  trust/interaction epoch.
- `DirectConversationMember` read cursors and the common inbox use
  authoritative Direct message sequences/activity. Adding a control event
  to this log **without revisiting those projections is incorrect**.
- Ratchets and pending outbox rows must be committed atomically; an ambiguous
  HTTP response is reconciled under the same stable idempotency key.
- WebSocket is a fast path; PostgreSQL-backed durable sync is recovery truth.

## Threats and trust boundaries

1. The Direct API/DB, realtime delivery or a peer may be malicious. They can
   drop, replay, reorder or misroute untrusted metadata; they cannot be
   treated as cryptographic witnesses of decrypted original text.
2. A legitimate peer can sign reaction events containing arbitrary source
   claims. Its valid sender signature authenticates **only that claim**.
   Receiver MUST check against an original locally ratchet-authenticated
   HUMAN message, including the full 256-bit source commitment. OPERATOR_*
   ciphertext or missing originals may never become verified source content.
3. The two recipient devices may receive **different correctly signed**
   ciphertexts for one client ID. As for HUMAN v2, recipients need a full
   signed content commitment and content-bound, per-event secret, not merely
   a UUID prefix.
4. A participant may use multiple devices or two tabs to race add/remove.
   Client wall-clock time is not a valid conflict resolver.
5. Block/unblock, device revocation and a rotated interaction epoch must
   apply to reaction sends exactly as to other Direct sends. Pending sends
   must never replay under a fresh ID after ambiguous server commit.
6. UI labels may only be attributed to an authenticated reactor and
   original. Server-side reaction metadata is **not** authorization,
   plaintext or an attestation of original content.
7. Plaintext emoji and target/source reference must never flow into
   @Vimla context without a separately reviewed consent rule; this
   slice sends **no reactions** as AI context.

## Proposed authenticated wire

Introduce a distinct Direct E2EE envelope kind, e.g. `REACTION`, instead
of overloading `HUMAN` with an invisible JSON command. The encrypted,
versioned reaction event contains:

- `type: "reaction"`, `version: 1`;
- `action: "add" | "remove"`;
- one validated, bounded Unicode emoji grapheme (policy to be fixed
  explicitly in the codec/tests, not inferred from any arbitrary string);
- `target`: original HUMAN
  `{clientMessageId, contentCommitmentB64, senderUserId, senderDeviceId}`;
- a fresh per-event 256-bit binding secret **only in ciphertext**.

A versioned, domain-separated commitment covers the canonical complete
reaction event (action, emoji and full target identity). One committed
reaction event has the **same** full commitment, derived client UUID, and
E2EE plaintext for every recipient device. Sender signatures authenticate
that commitment and the event kind in associated data; receivers verify
the full commitment *after decrypt*. Separate reaction domain separation
prevents interpreting a reaction commitment as a HUMAN text commitment.

Re-use reviewed SHA-256 HMAC primitives and the atomic, durable E2EE
fan-out/outbox machinery. Do **not** add a second custom ratchet,
plaintext server parser, or a shortcut based on an unkeyed hash of a
guessable emoji. Greenfield protocol changes require a specific adversary
review and negative tests before production implementation.

## Proposed server and product semantics

- Server authenticates the sender and active device, verifies current
  Direct membership/trust epoch and *every* per-device signed envelope,
  and enforces strict bounded size, rate and replay constraints. The
  server cannot conclude that an encrypted reaction target is valid.
- The reaction event is durable and sync-visible. The projected reaction
  state comes from locally authenticated/decrypted events, **not** a
  client-controlled HTTP "current reaction count" or a plaintext table.
- A reaction does **not** count as a new HUMAN message, advance the visible
  chat preview, create a new user-visible bubble, or by itself increment
  unread. If kept in `DirectMessage`, audit its write transaction,
  sequence/read cursor, inbox ordering triggers, activity and all client
  projection paths, including operator history and abuse reports.
- User-facing state: per original message and per reactor/emoji, the most
  recent *authenticated* add/remove operation determines membership.
  The authoritative **conversation sequence**, not timestamps or
  client-supplied counters, resolves concurrent events from one user's
  separate devices. The receiver must handle duplicate and out-of-order
  realtime/sync notifications deterministically.
- A missing original source fails closed (no displayed attributed
  reaction). When an authenticated original becomes available through
  paging, locally held events may be reprojected; a forged source can
  never be accepted merely because its IDs look plausible.
- Server-visible event kind and sender remain metadata; emoji/action and
  the full E2EE source claim remain encrypted. A server-visible indexing
  hint for bounded historical lookup must receive an explicit metadata
  privacy decision and itself be authenticated in AD (see gate below).

## Implemented authenticated protocol, portable projection and Web integration (Draft)

- `@vimla/e2ee` has two independently domain-separated HMAC-SHA256
  helpers: one for each event's full content identity and one for an
  opaque stable original-message lookup tag.
- The opaque index tag is computed as
  `HMAC(originalHumanBindingKey, "VimlaReactionTargetIndexV1\\0" || canonical[conversationId, clientMessageId, contentCommitmentB64, senderUserId, senderDeviceId])`.
  The 256-bit source binding key is recoverable **only after** locally
  authenticating and decrypting the original HUMAN v2 wire; it is
  neither transmitted in API metadata nor persisted by the server.
- A fresh per-reaction 256-bit key derives the full signed event
  commitment from canonical [action, emoji, target], in a distinct domain.
  The derived UUIDv4-shaped id is for idempotency, **not** content equality.
- The pure codec currently accepts a deliberately bounded, seven-emoji
  product set. There is no generic Unicode parser that silently accepts
  multiple graphemes, controls or arbitrary oversized input.
- Local verification checks full event commitment, exact source
  provenance and index-tag consistency. The reducer accepts verified
  event records and orders add/remove by authoritative server sequence,
  with conflicting duplicate IDs/sequence failing closed. The reducer's
  replay identity is `(reactorUserId, eventClientMessageId)`, whereas the
  conversation sequence must be globally unique across all senders.
- The final provenance gate now requires the target lookup tag in the
  **sender-signed associated metadata**; a caller-supplied unsigned tag
  is no longer sufficient. For REACTION, the server and Web route this
  tag through the existing signed AD5 routing-context field, without
  changing AD for older HUMAN or OPERATOR kinds.
- Unit tests include malformed inputs, target forgery, full-commitment
  tamper beyond the UUID prefix, multi-device sender equivocation and
  out-of-order/duplicate projection.

**Implemented, but still Draft and not ready for release:** The Direct API
now accepts signed `REACTION` envelope kinds and stores the opaque
`reactionTargetTagB64` plus the authoritative sequence in the existing
append-only `direct_message` log. PostgreSQL constraints and a compound
index protect the opaque tag; the existing Direct message list preserves
ratchet chronology. SQL triggers preserve ordinary inbox sorting and
read count semantics. Web decrypts these envelopes in the ordinary
ratchet stream but deliberately does not render them as HUMAN text or
include them in AI context. The Web picker/chips and verified emoji state
now use a platform-neutral `@vimla/client-core` projector with IndexedDB
provided by a Web adapter. Cross-browser E2E covers two users, two enrolled
recipient devices, add/remove, reload and independent actor emoji state.
**Historical tag lookup, bounded cold-start reconstruction and safe
retention/compaction remain unimplemented.** Sender-signature verification
remains a prerequisite of any user-visible event projection.

## Release-blocking security and lifecycle design gates

### Historical reaction lookup and metadata leakage

An encrypted server cannot index reactions by arbitrary encrypted
`target` for an old message. Scanning an unbounded whole-chat event
history when paginating is not acceptable at million-user scale.

**Chosen for this Draft implementation: A (opaque tag).** The API stores
an AD5-authenticated 256-bit HMAC-derived tag, not a plaintext message
reference. The service can correlate reaction events sharing a target tag
and observe sender/timing metadata, but cannot invert the tag to ordinary
HUMAN text or discover a target by comparing unkeyed hashes. This
correlation leakage is explicitly accepted as a proposed metadata tradeoff
and remains subject to independent privacy/adversary audit before merge.
No server-side materialized reaction counts or author claims are trusted.
The compound index exists, but a safe historical lookup endpoint still
needs ratchet-aware design and a bounded reconstruction proof.

Evaluate and approve ONE bounded lookup design:

- **A.** An AD-authenticated opaque lookup tag derived, with a separate
  reviewed domain, from the original's encrypted per-message binding
  material. Its derivation/access must be proven consistent across all
  enrolled devices without leaking text or granting false source authority.
  The API sees an opaque correlation tag, not the original plaintext
  or a readable source reference.
- **B.** A server-readable reference to an original message row, also
  bound into sender AD, with a straightforward same-conversation index.
  This leaks the reaction-to-original relation to the service even though
  the emoji/action remain encrypted; decide whether this is acceptable
  under Vimla's Direct privacy model.

Do **not** implement both forever or silently choose B because it is
simpler. Document the selected metadata disclosure in the threat model.

### Bounded history and compaction

If events are append-only, repeated toggles may grow the encrypted log.
Before release, specify storage/retention caps and **safe** compaction
that cannot erase the latest effective add/remove, invalidate ratchet
recovery, or resurrect a removed reaction during cold-start replay.
The server cannot safely compact on emoji/action it cannot decrypt.
Do not invent a lossy TTL or drop old ratchet envelopes without a proof
of state recovery. Abuse rate limits alone do not prove bounded storage.

### Verified SQL/event-stream interaction (October 8–9)

The existing `direct_message_assign_sequence` BEFORE INSERT trigger assigns
an authoritative sequence **and advances `direct_conversation.lastMessageAt`**.
The `direct_message_touch_communication_surface_activity` AFTER INSERT trigger
also touches `communication_surface.lastActivityAt`. Both must exclude
REACTION from product activity while continuing to allocate a unique causal
sequence, otherwise reactions reorder the inbox and fabricate recent chat
activity. The Direct unread count query currently counts **all** peer
`direct_message` rows; it and `markRead` must distinguish visible chat
messages from control events. The common Direct message history cannot
simply filter reaction envelopes out: that can break Double Ratchet
message-number progression and offline/reconnect decryption.

A target-index query alone is **not proof that the recipient can decrypt
an arbitrary old reaction envelope**: recipient ratchet state may need
preceding envelopes, especially on a new device. The server design must
supply a bounded, recoverable chronological decryption path or a separately
reviewed cryptographic reaction-state mechanism before claiming complete
historical reactions. A materialized server reaction-count table derived
from untrusted client plaintext is forbidden.

The Direct detail API also returns its PostgreSQL `lastMessageSequence`
high-water mark. Before showing emoji state or allowing a toggle, the
portable client-core projector requires a contiguous sequence interval
from that mark to the original HUMAN. The client refuses to infer a
reaction count from a partial Web page, missed realtime event, or stale
encryption cache. Missing sequence ranges suppress the derived state
until the authoritative interval is replayed; this does not substitute
for a bounded cold-start recovery policy.

Post-green audit: realtime gap reconciliation now has an explicit
16-page cap; a stale or maliciously distant event hint aborts BEFORE
decrypting an incomplete page interval. This avoids an unbounded
whole-conversation backfill, but cannot guarantee recovery of events
older than the cap. A future bounded checkpoint/reconstruction protocol
must provide a supported recovery path. The portable projector and the Web decrypted-row merge now both
reject conflicting metadata for the same server message ID, rather
than relying on last-wins deduplication; exact replays remain valid.
A Web conflict poisons the affected local row and suppresses reaction
aggregates until the conversation is safely reconstructed. The initial
decrypted page and every later X3DH/pagination page now preserve every
server-provided replica **until** that shared conflict-aware merge runs;
a preliminary map keyed by server message ID would incorrectly erase
same-page equivocation. A portable **pre-ratchet page preflight** now
rejects conflicting immutable metadata for the same server message ID
**before** any decrypt attempt, protected-cache lookup, or ratchet commit.
The entire corrupt page becomes an integrity-conflicted fail-closed result,
not a source of partial decrypted state. Realtime gap reconciliation and
manual older-page pagination also compare incoming wire replicas with their
previously observed message IDs **before** any known-ID filtering or
ratchet decryption. Repeated paginated responses are checked against one
another. A conflicting page is quarantined instead of partially replayed.
Identical wire replays remain valid. Duplicate-message and preflight
regression tests cover these boundaries.
Replica equality is a conflict detector, not a replacement for E2EE
signature or commitment verification.
Protected plaintext cache reads are batched to at most eight concurrent
operations and an I/O failure still rejects the entire projection.

History pagination is now ordered and cursor-scoped by the authoritative
conversation `sequence`, not `createdAt`/UUID: timestamp-order divergence
under concurrent insert transactions can violate Double Ratchet replay
order at page boundaries. Integration tests deliberately reorder stored
message timestamps and require exact sequence-driven retrieval.

At present, keep the append-only encrypted event log authoritative. A
compaction policy requires a separate proof that ratchet-dependent records,
offline clients and remove tombstones survive. The proposed opaque
index only bounds **lookup cost**; it does not solve safe compaction or
E2EE decryption dependencies.

## Required test matrix

- Two users; multiple enrolled devices; independent browsers/tabs;
  same-user concurrent add/remove, last-authoritative-sequence wins.
- Add, remove and add again; exact replay; duplicate realtime; out-of-order
  sync; offline queued send; lost HTTP response and idempotent recovery.
- History pagination where source or older event is initially missing,
  plus cold-start reconstruction with bounded history retrieval.
- Forged target user/device/client ID/full commitment; absent source;
  operator-kind spoof; invalid emoji; malformed/future wire; tampered AD.
- Malicious sender generates valid signed per-device ciphertext with
  conflicting action/emoji/target under the same claimed event ID.
- Sender blocked mid-send; revoked device; stale trust epoch; incomplete
  device fan-out; no cross-chat reaction leakage or IDOR.
- Read/unread, inbox ordering/preview, sync cursor, @Vimla consent/context,
  report evidence, E2EE local cache migration and accessibility/i18n.
- API, portable protocol reducer, service/db integration, Web E2E and
  exact-head CI, then independent adversarial audit.

## Exit conditions

This Draft is **not a merge candidate**. Authenticated event storage,
user-visible reaction controls and verified projection now exist, but
indexed historical retrieval still lacks a secure, bounded ratchet
reconstruction policy and compaction proof. Do not merge until that policy,
full tests, Web UX and independent adversarial/security review are complete.
#102 remains open after this slice; #54/#74/#75 remain independent.
