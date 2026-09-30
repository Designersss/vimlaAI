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

## 5A. RT-01 concrete transport

RT-01 implements the foreground WebSocket endpoint at `/v1/realtime`.

Browser upgrade requirements:

- exact configured Web Origin;
- real Better Auth session;
- verified account with active handle;
- active `ClientInstallation` owned by the authenticated user;
- supported protocol version supplied explicitly by the client.

The Web installation advertises `realtime.v1` in its non-authoritative capability metadata, but capability metadata never grants transport or domain authorization.

The client cannot submit subscription topics. The server derives the user fan-out channel from authenticated identity and domain authorization before publication.

The initial strict frame set is:

- `HELLO` — connection/install identity and heartbeat interval;
- `HEARTBEAT` — server liveness challenge;
- `PONG` — the only accepted client application frame in RT-01;
- `EVENT` — strict versioned server event envelope.

`DIRECT_MESSAGE_CREATED` is the first durable hint and contains only stable Direct Chat/message identifiers. It carries no ciphertext or plaintext message body. The event is an acceleration hint; the authoritative message remains in PostgreSQL.

Connection count, coarse pre-auth handshake frequency by actual network peer, authenticated per-user handshake frequency, incoming frame bytes, client-frame rate, heartbeat interval and heartbeat timeout are bounded server-side. The configured client-frame budget is validated to remain above the server-driven heartbeat cadence. Session and installation activity are revalidated during the heartbeat lifecycle so revocation closes a live connection. Permanent protocol/authorization/abuse close codes are terminal on Web to avoid reconnect storms.

Redis Pub/Sub fans events between API instances on server-derived per-user channels. Publication failure is logged as transport failure and does not roll back an already committed domain mutation.

Web includes a bounded exponential-reconnect transport and answers application heartbeats. Direct Chat temporarily consumes both the common WebSocket hint and its existing SSE signal only during the #94→#97 migration window; duplicate message identifiers are suppressed before refresh. #97 must remove SSE/EventSource after durable Sync proves correctness.

## 6. Sync cursor

Cursor is opaque to clients.

Do not expose a globally meaningful database sequence that reveals unrelated system activity.

Sync responses are bounded/paginated and contain only currently authorized changes.

Membership/access loss must prevent subsequent sensitive deltas even if an older cursor once had access.

## 7. Channels and scale

Large Channels must not create one persistent per-subscriber event row per post.

Channel/feed domains may maintain efficient channel/feed cursors while client SyncEngine presents coherent state.

Do not choose one global event table design merely for conceptual uniformity if it makes public channels non-scalable.

## 8. Direct Chat realtime replacement

Current Direct Chat SSE/EventSource is an obsolete pre-production transport. #97 must replace it with the common WebSocket + durable Sync architecture and remove the SSE/EventSource path before completion.

The replacement must preserve these correctness/security invariants:

- H01 ratchet concurrency/fencing;
- pending-send response-loss recovery;
- message-id dedupe;
- ciphertext-only server state;
- device refresh/revocation semantics;
- @Vimla intent recovery.

After replacement behavior is proven by tests, SSE/EventSource and its dedicated support code are deleted in the same issue. No merged fallback/dual transport remains solely for development-history compatibility.

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
