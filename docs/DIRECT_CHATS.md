# Phase 9 — Secure Direct Chats + Contextual @Vimla

## 1. Messaging architecture

Direct Chat is a separate conversation type from AI `Conversation` (`CHAT`) and the dedicated `@Vimla` operator thread (`OPERATOR`).

```text
Browser (IndexedDB private keys + local plaintext cache)
  -> POST/GET /v1/direct-chats*
  -> DirectChatsFacade -> @vimla/direct-chats
  -> PostgreSQL: ciphertext envelopes, public device material, membership, unread cursors
```

- Unique 1:1 pair: `pairKey = sort(userIdA, userIdB).join(":")`. Creating the same pair returns the existing row.
- Peer lookup is exact verified email. Missing/self → `not_found`.
- Server stores metadata only: sender ids, device ids, kind, timestamps, `lastMessageAt`, read cursors, consent flags.
- Message kinds: `HUMAN`, `OPERATOR_INVOKE`, `OPERATOR_RESPONSE`, `OPERATOR_ACTION`.
- Fan-out: one AEAD envelope per active member device (including the sender’s other/current devices). Incomplete fan-out is rejected.
- Unread is `lastReadMessageCreatedAt` vs later peer messages. Pagination is `createdAt|id` base64url cursors.

`@Vimla` is not a second runtime. Direct Chat invocations reuse Phase 7 `OperatorRun` with `invocationScope=DIRECT_CHAT`. Planner metering still attaches to the user’s OPERATOR `Conversation` so usage reservation stays unchanged. Direct Chat runs do **not** write plaintext `Message` rows into AI/operator threads.

## 2. E2EE architecture and threat model

Protocol: X3DH session setup + Double Ratchet, authenticated with Ed25519 over header+ciphertext+AD.

Audited primitives (`@noble/curves`, `@noble/ciphers`, `@noble/hashes`):

- X25519 DH
- Ed25519 signatures (identity + signed prekey + per-envelope sender binding)
- HKDF-SHA256
- ChaCha20-Poly1305 (IETF) with associated data

Associated data binds `conversationId`, sender user/device, recipient device, and kind. Replay uniqueness is `(senderDeviceId, recipientDeviceId, dhPublicB64, messageNumber)`.

In scope:

- Honest server cannot read Direct Chat plaintext (no private keys, no AES-at-rest of messages).
- Ciphertext tampering and sender-signature spoofing fail closed.
- Unrelated users cannot IDOR a chat (404) and cannot fetch another user’s prekeys without a shared chat.
- Feature flag fail-closed (`DIRECT_CHATS_ENABLED` default false).

Out of scope / residual:

- A compromised client or revoked device that already received envelopes can still decrypt those historical envelopes.
- The operator **command** (`OperatorRun.userText`) is plaintext on the server for execution. Chat history is not. See §4 and §9.
- Server operators can observe metadata (who talks to whom, sizes, timestamps, device public keys).

## 3. Key / device model

Each browser device generates:

- Ed25519 identity (sign)
- X25519 identity (DH)
- signed prekey + signature
- one-time prekeys

Private material never leaves IndexedDB. The API stores public keys only. Devices can be rotated (new signed prekey + OTKs) and revoked (`revokedAt`). Revoked devices cannot send or receive new envelopes.

Multi-device evolution is laid out: fan-out to every active device, per-device ratchets, OTK consumption. A **new** device cannot decrypt prior history (no server-side history key). That is an explicit Phase 9 limitation, not AES wrapping of old ciphertext.

### Browser ratchet durability (E2EE-H01)

Browser ratchet mutation is serialized per `conversationId + localDeviceId + peerDeviceId`.

- Every browser coordination lock is backed by the same IndexedDB lease namespace with bounded expiry/renewal and a hard maximum hold deadline. Heartbeats cannot extend ownership past that deadline. Lock acquisition waits longer than a single bounded Direct Chat network request, avoiding false lock loss while a valid owner is still inside its request budget. Web Locks, when available, are a non-waiting best-effort optimization (`ifAvailable`); durable IndexedDB lease acquisition remains the ownership source of truth, so a stuck external Web Lock or live-but-hung owner cannot block takeover forever. Versioned compare-and-swap remains the final ratchet correctness guard.
- Local-device bootstrap has its own cross-tab critical section. Each lease acquisition carries a fencing generation, and every local-device write verifies owner + fence + unexpired lease inside the same IndexedDB transaction as the protected `device` write. Device identity/prekey material is persisted as `PENDING` before registration, so a stale owner cannot overwrite a takeover device and a crash or ambiguous response retries the same persisted identity.
- Persisted versioned ratchets are keyed by conversation + local device + peer device, carry a monotonic `stateVersion`, and are bound to the current local crypto-device id. Versioned cross-device or stale writes fail closed.
- IndexedDB schema v4 adds ratchet locks and a durable pending-send outbox. During an actual v2→v4 upgrade, raw legacy ratchets are tagged with the co-resident local device id before normal operations resume; unmarked raw legacy ratchets fail closed. This migration marker proves storage co-residency at upgrade time, not historical ownership if a pre-H01 browser store was already inconsistent before upgrade.
- Multi-recipient encryption derives every recipient envelope under deterministic session locks, then persists all advanced ratchets plus the pending send in one IndexedDB transaction. A partial fan-out cannot advance only a subset of recipient ratchets.
- A pending send stores one stable `clientMessageId`, its exact signed ciphertext envelopes and the sender's local plaintext. If the server committed a message but the response was lost, retry replays the exact same payload rather than advancing the ratchet again. `OPERATOR_INVOKE` additionally retains a stable Operator `clientRequestId`, frozen candidate context, the created run id, and stable response/action delivery ids. The parent intent is deleted only after every planned encrypted Operator output has been durably delivered; child output completion updates the parent delivery state atomically with child-outbox deletion.
- Pending-send recovery is serialized per conversation + local device across tabs. Exact committed payloads replay unchanged; if an uncommitted pending send encounters an authoritative active-device-set change, it is rebuilt from the current persisted ratchet state with the same `clientMessageId` and preserves Operator parent/child recovery metadata.
- Server replay validation binds `clientMessageId` to the original sender device, message kind, encrypted envelopes and structured mentions. A conflicting replay fails closed.
- Realtime delivery is at-least-once by `messageId`: an exact HTTP replay may republish the same lightweight notification so a `DB commit -> realtime failure` gap can self-heal; clients merge durable messages by id.
- Sender plaintext-cache completion and outbox deletion are atomic. First-contact X3DH metadata remains attached to the local ratchet until a message carrying it has been acknowledged by the server; delayed cleanup can safely repeat the authenticated init.
- Successful decrypt persists the advanced ratchet state and local plaintext cache in one IndexedDB transaction.
- First-time/offline decrypt processes messages oldest-first. An explicit missing session, including an old sender device whose current identity is no longer present in the active-device detail, can trigger X3DH history backfill; authentication/corruption failures do not. Older X3DH envelopes restore the historical sender identity locally. Backfill is capped to eight older pages per attempt so a malformed or very deep history cannot force an unbounded fetch/decrypt/cache pass.
- CAS conflicts and lost leases discard the derived result and retry from the current persisted state; conflicting ciphertext is never returned to the caller.

This hardening addresses same-origin concurrent tabs/processes, partial local transactions and ambiguous send responses. It does not claim protection against a fully compromised browser origin or arbitrary rollback of the entire browser profile/storage snapshot. One-time-prekey replenishment/rotation remains a separate E2EE-H04 concern in #54.

## 4. @Vimla context handoff

When the user mentions `@Vimla` in a Direct Chat:

1. The client decrypts only the messages it already has locally.
2. It may attach a bounded `contextBundle` (max 16 messages, 4k chars each, 32k aggregate characters). Every disclosed history entry references the concrete encrypted `DirectMessage.id` already stored by the server.
3. The server binds each claim to authoritative Direct Chat metadata (conversation, sender, kind and timestamp), rejects spoofed/cross-chat/future claims, then re-filters using membership + both consent flags. Peer history requires **both** `shareOwnHistoryWithVimla` (peer) and `includePeerHistoryWhenInvoking` (actor).
4. Allowed plaintext is frozen only into the immutable execution-owned `ContextSnapshot` for that `OperatorRun`, with `E2EE_CLIENT_DISCLOSURE` provenance. It is not written into Direct Chat message storage, the semantic index, general Memory, or logs. Replay/replanning re-checks current membership and consent before reusing the frozen disclosure.
5. The server cannot cryptographically prove that client-disclosed plaintext equals ciphertext without possessing decryption material, so disclosed text remains untrusted data and never grants authority. Server-authoritative message metadata prevents a caller from spoofing which participant/message/time the disclosure is attributed to.
6. Direct Chat planning uses an empty personal-workspace snapshot: private Tasks/Reminders/Notes/Lists are not placed in the same planner prompt as peer-controlled chat context.
7. Direct Chat tool capability is intentionally minimal: only `tasks.create` is accepted, with assignees resolved against current chat membership. The same allowlist is re-applied to persisted steps during recovery, so an older/stale plan cannot regain personal tools. Action authority is derived from a planner pass over the trusted current `USER_REQUEST` without E2EE history; contextual E2EE history may refine answer-only output but cannot introduce or alter side-effect commands.
8. Before planning/replanning and before recovery/confirmation, the frozen disclosure is re-validated against current consent. Immediately before every tool side effect, the execution transaction locks the current Direct Chat privacy rows and re-checks the consent required by the frozen history, closing the revoke/execute TOCTOU window.
9. If required consent is revoked, the run fails closed with `direct_chat_context_revoked`, pending/confirmed steps are failed, and confirmation material is cleared.
10. Without consent, `@Vimla` remains callable and receives the command text only.

UI distinguishes E2EE human messages, `@Vimla` invoke, context-shared vs denied, AI response, and operator action cards.

Prompt injection in chat content cannot set `userId`, expand membership, read the actor's private workspace snapshot, or invoke personal Notes/Lists/Reminders tools from a Direct Chat. Tools still run as the authenticated actor (or a membership-resolved assignee for `tasks.create` only).

## 5. Cross-user task assignment

`tasks.create` may include `assigneeHint` (display name only). The server resolves it with `resolveDirectChatAssignee` against **current Direct Chat members**.

- empty / me → actor
- unique peer name/email local-part / 4–5 char stem → that member; `WorkspaceTask.assignedByUserId` + source `DIRECT_CHAT`
- ambiguous → clarification
- anyone else → deny

HTTP task create still has no owner/assignee fields. LLM-supplied `userId` is rejected by Zod.

## 6. Migration / API / config

Additive migration `20260911180000_add_direct_chats_e2ee`.

Config (default off):

- `DIRECT_CHATS_ENABLED=false`
- `DIRECT_CHATS_MUTATION_LIMIT_PER_MINUTE=60`
- `DIRECT_CHATS_MAX_CIPHERTEXT_BYTES=65536`
- `NEXT_PUBLIC_VIMLA_DIRECT_CHATS=false`

API (cookie + OriginGuard + SensitiveArea + mutation rate limit):

- `POST/GET /v1/direct-chats/devices`, rotate, revoke
- `GET /v1/direct-chats/users/:userId/prekeys` (self or shared-chat peer)
- `POST/GET /v1/direct-chats`, `GET :id`, `PATCH :id/privacy`, `POST :id/read`
- `GET/POST /v1/direct-chats/:id/messages`

Disabled → `direct_chats_disabled` (503).

## 7. Security tests

Covered: lifecycle, ciphertext-not-plaintext in PostgreSQL, tamper rejection, two-party decrypt, IDOR, sender/timestamp/cross-chat/future provenance spoof rejection, unread/pagination, flag off, cross-tab device bootstrap, deterministic stale-owner bootstrap fencing after lease takeover, mixed Web Locks/IndexedDB ratchet concurrency, held-Web-Lock availability fallback, hard lease-deadline renewal bounds, stale-lease recovery, IndexedDB write-abort fail-closed behavior, durable pending-send recovery, committed-send response-loss recovery + realtime re-notification, durable @Vimla Operator-intent recovery across device-set rebuilds, crash-safe Operator response/action delivery, real IndexedDB v2→v4 legacy ratchet migration, bounded deep offline ratchet bootstrap, conflicting replay rejection, device-scoped old-history envelopes, `@Vimla` general answer, context deny/allow, self task, peer task, third user denied, Direct Chat personal-tool denial, private-workspace snapshot isolation, peer/actor consent revocation during recovery, fail-closed generic E2EE context access, exact ContextSnapshot ownership DB constraints, hidden Direct Chat clarification-continuation rejection, prompt injection does not extend permissions, responsive Direct Chat UI.

## 8. Quality gates

Lint, typecheck, unit, integration, e2e, and build for the touched packages/apps. Do not auto-merge.

## 9. Known cryptographic limitations

- New device cannot decrypt old Direct Chat history.
- Revoked/compromised device may decrypt envelopes it already obtained.
- Operator command plaintext lives on `OperatorRun.userText` for the planner/executor (not in Direct Chat storage, not in ordinary logs).
- Normal Direct Chat history remains ciphertext-only on the server. A user-approved invocation may persist only its bounded disclosed plaintext subset in that execution's immutable `ContextSnapshot` so retries/crash recovery do not require a plaintext chat archive.
- Ordinary Direct Chat still does not feed automatic Memory extraction. PR-17 implements the durable half of Mode B at `POST /v1/memory/e2ee-promotions`: the user explicitly submits one approved fact plus the Direct Chat/message provenance, which is stored as `E2EE_USER_DISCLOSURE`. The rest of the conversation remains ciphertext-only and is not ingested into Memory.
- No sealed-sender / metadata-hiding transport. No post-compromise recovery beyond Double Ratchet forward secrecy for later messages.
- No QR/safety-number identity verification UX in this phase (TOFU on first prekey bundle).
- Self-sent copies are kept in the client plaintext cache; the initiator ratchet cannot decrypt its own envelope.

## 10. After merge

- Enable only on explicit staging/local env (`DIRECT_CHATS_ENABLED` + `NEXT_PUBLIC_VIMLA_DIRECT_CHATS`). Keep production off until a crypto/privacy review.
- Follow-up: safety-number verification, history sharing for newly added devices (optional, user-initiated), signed-prekey rotation/grace policy, sealed sender / extra metadata minimization, and Operator command retention policy (`userText` TTL/redaction).
- Do not start Project Chats, Brain, or Auto Router from this surface.
