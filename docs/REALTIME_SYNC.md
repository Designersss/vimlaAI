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

## 5B. RT-02 transactional durable event outbox

RT-02 separates two PostgreSQL concerns:

- `DurableEvent` is the immutable state-change/event ledger that future SYNC-01 may consume;
- `RealtimeOutbox` is operational publication state for getting a durable hint onto the RT-01 foreground transport.

For Direct Chat message creation, the encrypted message rows, mention metadata, conversation timestamp, durable event, recipient set and initial outbox row are committed in the same PostgreSQL transaction. A successful message commit therefore cannot exist without its durable publication intent.

The first durable event remains `DIRECT_MESSAGE_CREATED`. Its stable event id is the Direct Message id and its payload contains only `conversationId` and `messageId`; ciphertext, plaintext, private keys, prompts and envelope bodies are not copied into the event ledger.

The worker claims due `PENDING` rows and expired `PROCESSING` leases with `FOR UPDATE ... SKIP LOCKED`. Claims are bounded by batch size and ordered by internal durable sequence. A per-event lease is renewed immediately before publication so a large sequential batch cannot accidentally let later claimed rows expire while earlier rows are being sent.

Publication semantics are deliberately at-least-once:

- Redis unavailable or publish timeout returns the outbox row to `PENDING` with capped exponential backoff;
- there is no terminal transport-failure state that can permanently hide a committed event;
- a worker crash or lease loss before publication is recovered from the expired lease;
- a crash after Redis publication but before marking `PUBLISHED` may publish the same event again after lease recovery;
- clients therefore deduplicate by stable event id and durable Sync remains the convergence mechanism.

Multiple workers may claim concurrently without a global application lock. `SKIP LOCKED` prevents the same live claim from being owned twice, while expired leases make abandoned work recoverable.

The global `DurableEvent.sequence` is server-internal ordering metadata. It is **not** a public client cursor and must not be exposed directly by SYNC-01. Concurrent workers/gateways can deliver realtime hints out of order even when rows are claimed in sequence; clients must treat WebSocket frames as hints and reconcile authoritative state. In particular, `DIRECT_MESSAGE_CREATED` has no WebSocket delivery-order guarantee: clients deduplicate by event/message id and resolve authoritative message ordering from persisted Direct Chat state / durable Sync.

If an event has no remaining recipients at dispatch time (for example after recipient rows are removed by account lifecycle), the worker completes its publication state without calling Redis. This prevents an undeliverable empty-audience event from becoming an infinite retry backlog.

Published `RealtimeOutbox` rows have bounded operational retention and may be compacted after the configured retention interval. Compaction deletes only publication state. The associated `DurableEvent` remains until SYNC-01 defines and proves a safe durable-event retention horizon.

Direct Chat's old SSE publication remains temporary only for the #94→#97 transition. Global WebSocket publication for durable Direct Chat events now comes from the transactional outbox path rather than the post-commit API controller.

## 6. Sync cursor

SYNC-01 uses a per-user monotonic stream, not the global `DurableEvent.sequence`.

Each `DurableEventRecipient` has a user-local `position`. `UserSyncState.lastPosition` is incremented in the same PostgreSQL transaction that creates the event recipient. Writers acquire per-user counters in stable user-id order, so concurrent transactions affecting the same users serialize without duplicate positions or deadlock-prone lock ordering.

The API is `GET /v1/sync?protocolVersion=1`. A response contains bounded identifier-only deltas, an opaque `nextCursor`, and `hasMore`.

Cursor properties:

- the cursor represents a per-user position, never the raw global event sequence;
- the token is HMAC-bound to the authenticated user, so a cursor copied from another account is invalid;
- clients treat the token as opaque and persist only the last successfully applied cursor;
- malformed/foreign cursors return `sync_cursor_invalid`;
- positions older than `minRetainedPosition` or ahead of the user's current stream head return `sync_cursor_stale`;
- no realtime ACK is required for correctness.

Pagination snapshots the user's `lastPosition` at request start and reads only positions up to that head. Concurrent writes receive larger user-local positions and are recovered by the next request. Reusing the same cursor replays the same logical page safely because event ids are stable and client application is idempotent.

Authorization is rechecked when deltas are read. For Direct Chat `UPSERT_REF` events, current conversation membership is required. Rows that are no longer authorized are skipped while the cursor still advances, preventing an infinite replay loop after membership loss. Identifier-only `TOMBSTONE` events remain deliverable to their explicitly recorded recipient so the client can delete stale local state after access/object removal without receiving protected content.

Version 1 supports:

- `DIRECT_MESSAGE_CREATED / UPSERT_REF` with only `conversationId` and `messageId`;
- `DIRECT_MESSAGE_DELETED / TOMBSTONE` with a distinct event id plus the deleted `messageId`.

Tombstone event identity is intentionally distinct from resource identity so multiple transitions for one resource never collide in `DurableEvent.id`.

`UserSyncState.minRetainedPosition` reserves the future safe-retention boundary. SYNC-01 does not compact `DurableEvent` rows yet; RT-02 outbox compaction remains independent and cannot remove sync history.

### Public Channels and large feeds

The per-user recipient stream is for bounded/private state such as Direct Chats. Large public Channels/feeds must **not** write one `DurableEventRecipient` row per subscriber per post. Those domains will use domain-specific feed cursors/checkpoints and the future client SyncEngine will merge them into one coherent recovery model.


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
