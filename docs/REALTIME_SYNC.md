# Vimla Realtime and Durable Sync

Status: **canonical realtime/sync architecture**  
Roadmap: GitHub #80, #94–#97.

## 1. Product objective

When the same account has Web, Desktop and Mobile open, durable changes should appear on all connected clients with low latency.

The system must also remain correct when:

- WebSocket frame is lost;
- Redis is restarted;
- client is offline;
- browser/tab/app process crashes;
- mobile OS suspends background work;
- API/gateway process dies after DB commit;
- event is delivered more than once.

## 2. Two separate guarantees

### Fast path — realtime

Persistent WebSocket for foreground connected clients.

Used for low-latency notification of:

- new/updated messages;
- membership changes;
- task/project changes;
- notification state;
- device/security state;
- typing/presence (ephemeral).

### Correctness path — durable sync

PostgreSQL-backed cursor/delta recovery.

A client must be able to discard all realtime history and still converge from its last durable cursor.

## 3. Durable mutation publication

For durable changes that clients must observe:

```text
BEGIN
  write authoritative domain state
  write durable event/outbox intent
COMMIT

dispatcher/reconciler
  ↓
Redis fan-out
  ↓
WebSocket gateways
  ↓
active installations
```

Crash after DB commit cannot permanently lose notification of the change.

At-least-once publication is acceptable; clients apply idempotently.

## 4. Redis

Redis is allowed for:

- realtime Pub/Sub/fan-out;
- ephemeral presence/typing;
- locks/coordination;
- rate limiting;
- BullMQ transport.

Redis is never durable message/sync truth.

## 5. Realtime protocol

Use versioned strict envelopes.

Durable events identify stable server state/change references.

Ephemeral events are explicitly marked and are not placed into infinite durable history.

Clients cannot subscribe to arbitrary user-defined server topics; server derives eligible event delivery from authenticated user/installation and current authorization.

## 6. Sync cursor

Cursor is opaque to clients.

Do not expose a globally meaningful database sequence that reveals unrelated system activity.

Sync responses are bounded/paginated and contain only currently authorized changes.

Membership/access loss must prevent subsequent sensitive deltas even if an older cursor once had access.

## 7. Channels and scale

Large Channels must not create one persistent per-subscriber event row per post.

Channel/feed domains may maintain efficient channel/feed cursors while client SyncEngine presents coherent state.

Do not choose one global event table design merely for conceptual uniformity if it makes public channels non-scalable.

## 8. Direct Chat migration

Current Direct Chat SSE/EventSource remains valid until #97 proves equivalent common sync/realtime behavior.

Migration must preserve:

- H01 ratchet concurrency/fencing;
- pending-send response-loss recovery;
- message-id dedupe;
- ciphertext-only server state;
- device refresh/revocation semantics;
- @Vimla intent recovery.

SSE code is removed only after replacement parity is tested.

## 9. Mobile

Foreground: WebSocket.

Background/terminated: APNs/FCM may notify/wake where OS permits.

Push is not guaranteed and not authoritative.

On resume/open, durable sync repairs state.

## 10. No manual resync UX

SyncEngine is self-healing.

Normal UI may show reconnecting/loading state, but product settings do not expose a “Resync local data” maintenance button.

## 11. Observability

Measure without sensitive content:

- connection counts;
- reconnect rates;
- publish lag;
- outbox backlog;
- sync page latency;
- duplicate/replay rate;
- cursor age;
- authorization failures;
- Redis/gateway errors.

Never log E2EE plaintext/private keys or full sensitive event payloads.
