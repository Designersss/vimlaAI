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

### Target-tag metadata privacy review (October 9; conditional, NOT sign-off)

Security boundary: `reactionTargetTagB64` is the
`HMAC-SHA256` of a canonical `(conversation, original client UUID, full
content commitment, author, author device)` tuple under the original
encrypted HUMAN v2 binding key. That source key has 256 bits of entropy,
is created independently for every HUMAN source and is never a database
field. REACTION envelope AD5 authenticates the tag, kind and full content
commitment; swapping a target tag between valid envelopes fails sender
signature verification. The 256-bit per-event binding key is fresh for
each add/remove, so the event commitment does not act as a deterministic
emoji or action hash.

**What the service CAN observe, even with perfect E2EE:** it can group
all control events with an equal tag inside a conversation; see the actor
ID, device, server sequence and timing of each add/remove event; count
*encrypted events* (NOT effective active emoji reactions); and associate
an authorized query with its account/device and the queried tag. The
first reaction arriving just after a HUMAN, repeated activity and
participant traffic patterns can probabilistically identify a target
despite the cryptographic opacity of the tag. Database readers and
application access logs with request bodies may also observe it. The
`POST` body only avoids accidental URL/proxy-query logging; it is not
anonymity against the API operator. Abuse of tag equality as a behavioral
signal is a genuine privacy cost. Neither event emoji nor add/remove
action is deliberately exposed in plaintext metadata.

**What the service CANNOT derive from the tag alone:** the HUMAN text,
per-event emoji, full source reference or the original binding key by
dictionary attacks on ordinary text; equal HUMAN text encrypted with
fresh keys yields independent tags. The same source key/reference in
different conversation domains yields a different tag. These are
cryptographic properties, not a claim that traffic analysis cannot
identify which original a reaction refers to.

**Boundaries and mitigations checked:** queries are restricted to members
with their own active crypto device, bounded by indexed pagination and
a separate Redis probe quota. The source sequence stays local; the
query carries only the tag, device and cursor in an authenticated POST
body, not a URL. Clients independently check signed AD5 tags after
decryption, full HUMAN provenance and causal completeness before
displaying state. Tests assert stable per-original equality, independent
source/conversation tags, fresh event commitments and AD5 tamper
rejection.

**Decision still required before merge:** accept the equality/sender/timing
leakage under Vimla's user-facing Direct privacy promises and verify
infrastructure, request/trace logging, DB diagnostics, analytics, backup
and retention policies do not introduce additional avoidable disclosures.
Changing the index to a plaintext source ID would increase disclosure;
randomizing the tag per event would destroy efficient same-target
lookup. This review does not prove historical reaction recovery or close
the storage-compaction and independent final audit gates.

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

### Revoke-vs-send and idempotency security hardening (October 9)

An exact cryptographic send replay resolves an ambiguous HTTP acknowledgement,
but it is **not** a reusable authorization token. An audit found that the
Direct `preflightSend` and `sendWithStatus` fast paths resolved committed
idempotency keys *before* verifying that the sender's crypto device was
still active. A user who retained a revoked device's old signed request
could therefore query the replay response despite device revocation,
unlike ordinary history/lookup endpoints.

Both replay paths now require the caller's active sender device, including
the unique-constraint retry path. A new message transaction obtains a
PostgreSQL `FOR UPDATE` lock on the sender's device row *after* the trust
pair lock and checks `revokedAt` while the lock is held. This serializes a
new signed HUMAN or REACTION insert against an in-flight device-revoke
update. After revocation wins the row lock, a new event cannot commit;
when a send obtains it first, the send commits before revocation. Exact
committed replays after a **peer block** remain independently permitted
as before, but replays from a **revoked device** are forbidden. Integration
tests verify committed REACTION replay denial, fresh REACTION denial,
and the existing committed-message lookup denial.

This protects sender-device authority; it does not yet prove recipient
fan-out device-set atomicity for concurrent recipient revocation, nor
recover skipped historical Double Ratchet chains. Those remain subject
to the broader messaging/device lifecycle review.

### Post-green revocation race audit (October 9; concurrency hardening)

A second audit after CI #37966420825 found that an active-device read
followed by an exact idempotency lookup still had a revocation TOCTOU
window: a device could become revoked between the check and the
committed ciphertext response. The fast `preflightSend`, fast send
replay and uniqueness-conflict replay recovery now resolve exact
committed messages only inside a short PostgreSQL transaction holding
a `FOR SHARE` row lock on the original sender device. This provides a
well-defined ordering with the revocation `UPDATE`: either the
authorized lookup linearizes first or it sees `revokedAt` and fails.
Blocked-peer committed replays still do not depend on current recipient
fan-out membership.

New sends also must not rely solely on the recipient-device set sampled
*before* validating AD5 signatures. The write transaction now
re-reads/locks all active participant device rows in ID order with
`FOR SHARE`, verifies the original sender is still active, handles
the committed replay before any mutable fan-out comparison, and requires
the currently active device ID set to match the signed envelope set
before creating a new Direct log row. This prevents a recipient
revocation or already-committed enrolment from silently invalidating
an earlier fan-out snapshot. All participant devices are locked in one
deterministic acquisition order instead of acquiring Alice's sender
device before Bob's receiver device (which would risk deadlock for
simultaneous cross-sends). A dedicated integration race test holds the
trust-pair lock, revokes the recipient, releases the lock and requires
that the queued signed REACTION does **not** commit.

**Remaining concurrency boundary:** PostgreSQL row locks cover the
existing device rows but do not predicate-lock against a brand-new
device being enrolled *after* the transactional device-set query. Fully
atomic enrolment versus message fan-out needs shared per-user
enrolment/write coordination and a separate design review; do not
represent the current check as a proof of inclusion for arbitrary
simultaneous brand-new devices. Bounded historical Double Ratchet
reconstruction and event compaction are likewise still open.

### Complete device-roster serialization and revocation-aware reads (October 9)

A PostgreSQL row lock on *existing* crypto devices cannot serialize a
brand-new device registration: no row exists to lock. Direct send,
registration and revocation now share **transaction-scoped per-user
advisory roster locks**, acquired in lexical user order after the
Direct trust-pair lock and held through the signed envelope insertion.
**Sends acquire shared roster advisory locks, while enrolment/revocation
acquire exclusive roster locks**. This permits overlapping sends for the
same popular participant while preventing concurrent roster mutation.
Registration keeps its independent stable device-ID advisory guard
against simultaneous first inserts. Revocation obtains its owner's
roster lock before re-reading and updating the device row. The signed
fan-out is recomputed against the active device list under the roster
locks; the lock makes a newly inserted device unable to appear after
this snapshot but before the send commits. New sends reject a stale
encrypted recipient set instead of silently omitting a newly enrolled
device. Idempotent *previously committed* message replays still use the
original delivery set, regardless of later enrolment or peer block, but
a revoked original sender device is never authorized to replay.

The same post-revocation authorization gate now protects Direct
message page reads, sparse opaque-tag reaction index reads and
original-sender committed-message lookup: `FOR SHARE` on the caller's
device row is held from active-device check until the corresponding
encrypted DB rows are read. A concurrent revoke either waits for this
authorized read to finish or commits first and the read fails. The
locks do **not** reveal E2EE plaintext, event emoji or source IDs to
the API.

Real-PostgreSQL integration tests exercise both stale pre-signed
REACTION fan-out scenarios: recipient revocation wins, or a new crypto
device enrols while the send waits on the trust-pair lock. Both must
reject the pending send and leave no partial encrypted reaction event.

This closes the previously documented missing-new-device-row
*registration-vs-send* gap for call paths using this roster coordinator.
Prekey rotation and initial OTK consumption do not alter active
membership and are not a fan-out roster mutation. Lock/DB performance, shared-vs-exclusive fairness, unrelated
alternate device-registration paths and the full multi-device/outbox
retry matrix remain part of the independent production readiness audit. None of these measures provides
historical Double Ratchet recovery or a safe reaction compaction proof.

### Bounded indexed ciphertext discovery (implemented; not a history proof)

`POST /v1/direct-chats/:id/reactions` is an actor-scoped **read-only**
projection of the PostgreSQL `(conversationId, reactionTargetTagB64, sequence)`
index. Input requires an authenticated local device ID and the
*opaque HMAC tag derived from a previously verified HUMAN source*.
**Do not transmit the exact original HUMAN source sequence to this
endpoint:** combining the tag with that sequence would reveal which
server-visible HUMAN row is its target, defeating the opaque-tag metadata
privacy model. The client alone retains the authenticated source sequence
and checks response ordering and bounds locally.
The tag, device ID and optional causal cursor travel in a strictly
validated JSON **POST body**, never in a URL query string or browsing
history. Each indexed SQL request fetches no more than **51** rows,
returns at most **50**, and never scans the whole conversation.
A separate Redis-backed per-user POST budget
caps the metadata-probe rate at min(30, configured preflight/minute).
The member-conversation and active actor-device checks run before index
access; outsider, foreign-device and revoked-device queries fail closed.
The response contains only ordinary encrypted `DirectMessageView` rows
and device-scoped envelopes; it does **not** disclose emoji/action,
create server-side counts, or treat an arbitrary supplied tag as source
authority. The endpoint does not rewrite unread/inbox/activity state.
The portable client-side page validator independently rejects wrong
conversation/tag/kind, wrong-device envelopes, out-of-order or duplicate
causal sequences, improperly bounded pages and misleading cursors.
This validates index response **shape and claimed scope only**, not E2EE
decryption, source authority, completeness or reaction state.

**This is a discovery primitive, not a released reaction recovery flow.**
A matching encrypted event may require an older Double Ratchet chain key,
and the device may never have received its envelope. The cursor's
exhaustion proves only index-response completion under the authoritative
server; it is NOT cryptographic proof of message completeness or a
validated aggregate. Never concatenate these sparse matches into the
existing verified projector, skip intermediate encrypted messages, or
display counts based only on the indexed response. Successful decryption
requires a reviewed bounded chronological recovery proof or authenticated
checkpoint design. A malicious server can still withhold index results;
the threat model cannot claim otherwise.

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

Sparse-index pagination follow-up (October 9): the client-core
response validator now requires every nonterminal cursor to be the
canonical URL-safe base64 of `s1:<last returned sequence>`, exactly matching
the API's current versioned pagination codec. This prevents a server-supplied
cursor from silently skipping or rewinding within a single result page;
malformed and oversized sequence strings are rejected before BigInt
parsing. The source HUMAN sequence still never leaves the client.
**This is page-boundary consistency only**: an authorized or compromised
server could still omit matching events, and a sparse index is never a
cryptographic completeness proof or independent ratchet replay. The
metadata and historical reconstruction gates remain open.

Cold-start/bootstrap follow-up after CI #37951445603 (October 9):
the initial recent encrypted page may be opened before discovering that an
older X3DH initial envelope is needed. When fetching any older bootstrap
page, Web now compares its full immutable signed-envelope replica metadata
and conversation sequence ownership against **all previously fetched pages**
before attempting the second chronological Double Ratchet replay. An
equivocating older page quarantines all initially selected visible rows
rather than projecting previously cached plaintext as if history were
unambiguous. Portable regressions cover multi-page signed-ID alteration,
duplicate position under a fresh ID, and harmless exact replay.

This is intentionally a narrow fail-closed improvement; it does **not**
retroactively undo the first authenticated ratchet pass, provide a trusted
history-completeness witness, or implement bounded cold-start checkpoints.
Historical reaction counts remain unavailable when their full signed
head-to-original interval cannot be reconstructed.

Independent post-green sequence-ownership audit (October 9): PostgreSQL has
`@@unique([conversationId, sequence])`, but an untrusted Web history response
could present TWO different server IDs for one conversation/sequence. A
server-ID fingerprint alone cannot detect that equivocation. The portable
pre-ratchet replica checker now also detects duplicate sequence ownership
within a page, against previously observed rows, and across pages before
decrypting an injected envelope. The independent Web merge poisons both
ambiguous owners, and the portable reaction projector refuses all aggregates
from duplicated causal positions. Exact replays of the same server ID
remain idempotent; identical sequence values in different conversations are
not conflicts. Delayed/missing sequence values still do NOT block separately
authenticated HUMAN messages, consistent with skipped-key Double Ratchet
semantics.
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


### Gap classification before ratchet catch-up (October 9)

Cross-browser adversarial E2E uncovered an over-strict first iteration of
the closed-interval preflight: it rejected legitimate **skipped-key** delivery
when an older signed HUMAN envelope was delayed but a newer, valid message
had already committed. This broke normal message delivery in Chromium,
Firefox and WebKit, without strengthening the authenticity of those
messages. The first iteration was corrected before merge.

The final portable pre-ratchet inspector distinguishes **structural
equivocation** (foreign conversations, contradictory server IDs or sequence
ownership, malformed/overflowed PostgreSQL bigint) from **partial but
potentially authentic history** (skipped server sequence, stale detail
high-water, missing older anchor or delayed realtime ID). Structural
conflicts still fail closed *before* Double Ratchet touches persistent
keys. A partial history is *not* cryptographic evidence that a valid
HUMAN envelope must be rejected; the existing sender signature and AD5
authenticated decryption remain required, and Double Ratchet deliberately
supports skipped keys. The 16-page catch-up budget still aborts excessive
history retrieval before decryption.

The inspector can report a complete head-to-known interval only after
observing all consecutive PostgreSQL sequences and, for older hints,
an immutable known anchor below the hinted event. This result only
permits a smaller bounded replay window. It does **not** authorize
historical reaction counts: the independent platform-neutral reaction
projector still requires a continuous authoritative head-to-original
interval, authenticates the original HUMAN source and verifies every
targeted control event. Missing/undecryptable events suppress counts and
toggles, even while independent HUMAN messages remain readable.

This does not supply a new-device history checkpoint, trust a potentially
equivocating server as a cryptographic completeness witness, or prove
safe append-only event compaction. Cold-start reconstruction, retention,
privacy review and the remaining adversarial matrix are still release gates.

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
