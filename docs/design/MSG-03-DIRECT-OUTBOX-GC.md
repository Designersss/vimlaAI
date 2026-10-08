# MSG-03 — Direct outbox trust-cancellation reconciliation (first slice)

Issue: [#102](https://github.com/Designersss/vimlaAI/issues/102). This is an
incremental implementation slice, not completion of the mature messaging epic.

## Invariants / adversary review

An ambiguous HTTP send may have committed before a response was lost. Never
delete its local ciphertext or plaintext merely because a block was observed,
realtime was dropped, the message is absent from the most recent page, or a
timeout has elapsed. Likewise, do not replay trust-cancelled sends across an
unblock. In #104, blocking/unblocking advances the server-authoritative
Direct interaction epoch; send commits and block changes serialize through
the same trust-pair transaction lock.

The non-mutating actor-owned lookup reads exactly one `clientMessageId` from
the authoritative Direct message store. It requires authenticated Direct
membership and ownership of the active sending device; no peer's message may
be queried by clientMessageId. The response is only a normal ciphertext
message view or an explicit absence. The server does not gain plaintext or
private E2EE material. A sender-device conflict is **not** absence.

GC occurs only when ALL the following hold:
1. The row was explicitly trust-cancelled and aged past a short grace period.
2. The current authoritative interaction epoch has advanced beyond the
   pending row's epoch. Stale uncommitted sends cannot subsequently commit.
3. A read-only authoritative lookup either reports absence, or reports the
   exact original committed message with matching local ciphertext identity.
4. Local IndexedDB deletion verifies the same cancellation marker and revision
   atomically; an Operator parent with staged dependent outputs is retained
   until those outputs are reconciled.

Ambiguous, tampered, offline, unauthorized or unavailable responses retain
the local row for later retry. Persisted rows without an explicit supported
local protection version are invalid; tests inject a valid v0 legacy record
to exercise its migration and subsequent reconciliation, never a fake
unversioned plaintext row.  Reconciliation is capped per recovery
invocation, performed under existing pending-send recovery serialization,
and never exposes a crypto-maintenance button to the user. The mounted
Direct Chat retries this recovery when the browser reports connectivity
restored or the tab becomes visible again; duplicate events are coalesced; pending-free conversations do not
perform a needless recovery network round-trip. Existing IndexedDB
leases prevent competing outbox mutations.

## Limitations and remaining #102 work

This slice does not implement edits, deletes, replies, reactions, forwards,
read receipts in the message bubble, typing, pins/archives, attachments or
new cross-device message history. Those require separate reviewed slices;
E2EE-mutable semantics require a separate explicit protocol/adversary review.
#74 operator-output origin attestation remains a feature gate; do not trust
a forged `OPERATOR_*` kind as proof of Vimla authorship.
