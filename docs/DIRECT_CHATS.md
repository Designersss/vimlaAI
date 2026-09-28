# Phase 9 — Secure Direct Chats + Contextual @Vimla

## 1. Messaging architecture

Direct Chat is a separate conversation type from AI `Conversation` (`CHAT`) and the dedicated `@Vimla` operator thread (`OPERATOR`).

```text
Browser (protected IndexedDB E2EE state + local plaintext cache)
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

Private material never leaves the browser-local E2EE storage boundary. The API stores public keys only. Devices can be rotated (new signed prekey + OTKs) and revoked (`revokedAt`). Revoked devices cannot send or receive new envelopes.

Multi-device evolution is laid out: fan-out to every active device, per-device ratchets, OTK consumption. A **new** device cannot decrypt prior history (no server-side history key). That is an explicit Phase 9 limitation, not AES wrapping of old ciphertext.

### Browser ratchet durability (E2EE-H01)

Browser ratchet mutation is serialized per `conversationId + localDeviceId + peerDeviceId`.

- Every browser coordination lock is backed by the same IndexedDB lease namespace with bounded expiry/renewal and a hard maximum hold deadline. Heartbeats cannot extend ownership past that deadline. Lock acquisition waits longer than a single bounded Direct Chat request, while hard-hold budgets are scoped by operation instead of one global five-minute ceiling: ratchet sessions, local-device bootstrap, pending-send recovery, and Operator-intent recovery have separate limits. Web Locks, when available, are a non-waiting best-effort optimization (`ifAvailable`); durable IndexedDB lease acquisition remains the ownership source of truth, so a stuck external Web Lock or live-but-hung owner cannot block takeover forever. Versioned compare-and-swap remains the final ratchet correctness guard.
- Local-device bootstrap has its own cross-tab critical section. Each lease acquisition carries a fencing generation, and every local-device write verifies owner + fence + unexpired lease inside the same IndexedDB transaction as the protected `device` write. Device identity/prekey material is persisted as `PENDING` before registration, so a stale owner cannot overwrite a takeover device and a crash or ambiguous response retries the same persisted identity.
- Persisted versioned ratchets are keyed by conversation + local device + peer device, carry a monotonic `stateVersion`, and are bound to the current local crypto-device id. Versioned cross-device or stale writes fail closed.
- IndexedDB schema v5 adds ratchet locks, a durable pending-send outbox, and a composite pending-outbox index scoped by conversation + sender device. During an actual v2→v5 upgrade, raw legacy ratchets are tagged with the co-resident local device id before normal operations resume; unmarked raw legacy ratchets fail closed. This migration marker proves storage co-residency at upgrade time, not historical ownership if a pre-H01 browser store was already inconsistent before upgrade.
- Multi-recipient encryption derives every recipient envelope under deterministic session locks, then persists all advanced ratchets plus the pending send in one IndexedDB transaction. A partial fan-out cannot advance only a subset of recipient ratchets.
- A pending send stores one stable `clientMessageId`, a monotonic local outbox revision, its exact signed ciphertext envelopes and the sender's local plaintext. Rebuilds compare the expected pending revision in the same IndexedDB transaction that advances ratchets, so a stale lease owner cannot replace a newer ciphertext for the same `clientMessageId`. If another owner already won, the loser reuses the winning durable payload instead of emitting a second ciphertext. If the server committed a message but the response was lost, retry replays the exact same payload rather than advancing the ratchet again. `OPERATOR_INVOKE` additionally retains a stable Operator `clientRequestId`, frozen candidate context, the created run id, current run status and stable response/action delivery ids.
- Pending-send recovery is serialized per conversation + local device across tabs. Exact committed payloads replay unchanged; if an uncommitted pending send encounters an authoritative active-device-set change, it is rebuilt from the current persisted ratchet state with the same `clientMessageId` and preserves Operator parent/child recovery metadata. Lease expiry during a rebuild is safe: a takeover writer wins the revision CAS, while the stale callback either reuses that exact durable row or observes that another owner already completed it.
- Server replay validation binds `clientMessageId` to the original sender device, message kind, encrypted envelopes and structured mentions. A conflicting replay fails closed. Exact replay is checked both during controller preflight and again immediately inside the send service before mutable device-set validation, so a concurrent commit plus device registration cannot turn an already-committed exact retry into a validation failure.
- Realtime delivery is at-least-once by `messageId`: an exact HTTP replay may republish the same lightweight notification so a `DB commit -> realtime failure` gap can self-heal; clients merge durable messages by id.
- Direct Chat Operator recovery is phase-durable. `AWAITING_CONFIRMATION` keeps its parent intent after output delivery, so reload restores the Operator panel. `AWAITING_CLARIFICATION` is delivery-final for Direct Chat because continuation of that run is intentionally forbidden; its clarification question is therefore included in the encrypted `OPERATOR_RESPONSE` so reload cannot lose the question that the user must answer with a new encrypted `@Vimla` invocation. Every recovery fetch stages the newest run snapshot without allowing an older `updatedAt` snapshot to regress it. Direct Chat Operator fetch/create/confirm/cancel requests use abortable browser request deadlines. Aborting the browser fetch stops that client wait, but it does not claim to cancel server work that may already have been accepted; stable request ids and recovery handle an ambiguous server commit. Confirmation is serialized per local device, fetches a fresh confirmation token immediately before confirm, and retries once if another token rotation wins the race. All returned Operator actions are staged with stable local delivery keys and retain their action status in encrypted history; canceling a confirmation-gated run marks unfinished steps `SKIPPED` before returning `CANCELED`, allowing a durable terminal action state to supersede `pending_confirmation`. Delivery-final parents are removed only after every encrypted response/action output has been durably delivered. A later ordinary send can also recover a previously committed `OPERATOR_INVOKE` without requiring reload/navigation.
- Sender plaintext-cache completion and outbox deletion are atomic. If a sibling same-device tab receives realtime notification after server commit but before the sending tab receives its HTTP response, it may recover the plaintext only from the exact local pending row whose sender/device/client id and encrypted envelope match the committed message. This avoids trying to decrypt the initiator's own outbound ratchet while preserving ciphertext binding. First-contact X3DH metadata remains attached to the local ratchet until a message carrying it has been acknowledged by the server; delayed cleanup can safely repeat the authenticated init.
- Successful decrypt persists the advanced ratchet state and local plaintext cache in one IndexedDB transaction.
- First-time/offline decrypt processes messages oldest-first. An explicit missing session, including an old sender device whose current identity is no longer present in the active-device detail, can trigger X3DH history backfill; authentication/corruption failures do not. Older X3DH envelopes restore the historical sender identity locally. Automatic backfill is capped to eight older pages per attempt so a malformed or very deep history cannot force an unbounded fetch/decrypt/cache pass. If the user manually loads farther back and reaches the missing X3DH init, the already loaded window is reprocessed oldest-first so previously undecryptable rows can recover without an unbounded automatic scan.
- CAS conflicts and lost leases discard the derived result and retry from the current persisted state; conflicting ciphertext is never returned to the caller.

This hardening addresses same-origin concurrent tabs/processes, stale writers relative to the current live IndexedDB state, partial local transactions and ambiguous send responses. It does not claim protection against a fully compromised browser origin or arbitrary rollback of the entire browser profile/storage snapshot. Whole-profile rollback detection requires a monotonic anchor outside that rollback domain and is tracked in #75. One-time-prekey replenishment/rotation remains a separate E2EE-H04 concern in #54. Server-verifiable origin binding for peer-visible `OPERATOR_RESPONSE` / `OPERATOR_ACTION` content is tracked separately in security issue #74 because solving it correctly requires an output attestation/protocol design rather than trusting sender-controlled message kind.

### Browser-origin and local-storage hardening (E2EE-H02)

H02 adds defense-in-depth around the browser origin without changing the Direct Chat wire protocol:

- The web app serves a fresh request nonce and origin-wide Content Security Policy. Production `script-src` is nonce-based, uses `strict-dynamic`, and does not allow `unsafe-eval` or `unsafe-inline`; inline event handlers are explicitly denied. Nonced `<style>` elements remain restricted while `style-src-attr` permits React's generated element style attributes without weakening script execution policy. The policy also denies framing and plugins, constrains base/form targets, and limits network connections to the Vimla web/API realtime origins. Development keeps only the `unsafe-eval` exception required by React/Next debugging.
- HTML responses add `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and HSTS outside development. CI rejects newly introduced direct HTML/code-execution sinks such as `dangerouslySetInnerHTML`, raw `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, and `new Function` in web source.
- IndexedDB schema v6 protects long-lived E2EE secrets/plaintext with AES-256-GCM. A browser-generated non-extractable WebCrypto `CryptoKey` is stored in the dedicated `vimla-e2ee-keyring` IndexedDB database; sensitive values remain in `vimla-direct-e2ee` only as authenticated ciphertext. AAD is domain-separated by record type and stable record identity.
- Protected fields include Ed25519/X25519 private identity material, signed/one-time-prekey secrets, Double Ratchet secret state, the local decrypted message cache, durable pending-send plaintext, frozen Direct Chat Operator context, and pending Operator response/action plaintext. IndexedDB keys/index fields, device ids, ratchet `stateVersion`, delivery ids/status and ciphertext-envelope metadata remain clear where H01 atomic CAS/outbox coordination requires them.
- During a pre-v6 IndexedDB upgrade, raw device/plaintext/pending rows are explicitly marked as legacy records before normal app reads. Legacy Operator delivery ids from H01 are also rotated to opaque local ids, with child pending-output links updated in the same upgrade transaction, because the old deterministic ids embedded response/action text. New protected records carry an explicit local protection version, so user plaintext is never classified as ciphertext merely because it begins with the protected-envelope prefix. Legacy rows are lazily rewritten to the protected v6 representation on their normal read/write path. Ratchet migration keeps the same scoped key and `stateVersion`; a concurrent H01 writer wins rather than being overwritten by a migration.
- Plaintext cache is intentionally retained because the initiator cannot decrypt its own old outbound ratchet envelopes and historical Double Ratchet keys are not a server-side recovery mechanism. H02 therefore does **not** impose a time TTL that would silently destroy history. Retention ends on explicit local-data clear, logout, or authoritative local-device revocation.
- Logout attempts to revoke the current crypto device while the authenticated API session still exists, then removes both the Direct Chat database and local wrapping-key database. Local deletion is the security requirement; remote revoke is best-effort because durable offline device lifecycle/recovery belongs to H05. Security settings also expose an explicit **Clear local Direct Chat data** action with the same wipe semantics.
- If a Direct Chat message fetch or pending-send recovery authoritatively reports the browser's current crypto device as revoked, local E2EE state is deleted and the failing recovery attempt does not silently register a replacement identity. A non-secret revocation latch is shared through origin `localStorage` so sibling tabs fail closed instead of silently re-enrolling after another tab wipes the IndexedDB state.
- No E2EE private key/plaintext is stored in `localStorage`, `sessionStorage`, or cookies; the shared revocation latch contains only revocation state and no key material, message content, or device secret.

The wrapping key is defense-in-depth against cleartext-at-rest exposure, accidental app-storage inspection and ordinary raw-record leakage; it is **not** a separate trust boundary from arbitrary JavaScript already executing in the Vimla origin. Same-origin malicious code can ask WebCrypto to use a non-extractable key even though it cannot export that key. A full browser-profile backup/rollback can also contain both encrypted data and the keyring, so H02 does not claim protection against whole-profile compromise or rollback; #75 remains the rollback/monotonic-anchor task. Native desktop/mobile clients should use OS secure storage when introduced.

Trusted Types enforcement is intentionally not enabled in H02 while Next.js 16's default Turbopack runtime lacks a compatible policy for dynamic chunk loading under `require-trusted-types-for 'script'`. Enabling it today would break normal route/chunk loading rather than add a reliable boundary. The source-sink guard plus strict CSP are enforced now; Trusted Types should be re-evaluated when Turbopack provides a supported runtime policy.

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

Covered: lifecycle, ciphertext-not-plaintext in PostgreSQL, tamper rejection, two-party decrypt, IDOR, sender/timestamp/cross-chat/future provenance spoof rejection, unread/pagination, exact-replay preflight/device-set TOCTOU recovery, same-device sender realtime-before-response recovery, canceled confirmation-step terminal state, confirmation-token/cancel races, flag off, identity-bound repeated device registration, cross-tab device bootstrap, deterministic stale-owner bootstrap fencing after lease takeover, mixed Web Locks/IndexedDB ratchet concurrency, real same-device receiver out-of-order/concurrent decrypt across tabs, held-Web-Lock availability fallback, hard lease-deadline renewal bounds, stale-lease recovery, stale pending-recovery takeover during a device-set rebuild, stale Operator-intent takeover after server commit, IndexedDB transaction-abort, quota-exceeded and open-failure fail-closed behavior, durable pending-send recovery, committed-send response-loss recovery + realtime re-notification, durable @Vimla Operator-intent recovery across device-set rebuilds without reload, crash-safe Operator response/action delivery, encrypted clarification persistence across reload, durable Operator action status rendering, real IndexedDB v2→v5 legacy ratchet migration, bounded deep offline ratchet bootstrap, conflicting replay rejection, device-scoped old-history envelopes, `@Vimla` general answer, context deny/allow, self task, peer task, third user denied, Direct Chat personal-tool denial, private-workspace snapshot isolation, consent revocation before execution and after already-committed effects, fail-closed generic E2EE context access, exact ContextSnapshot ownership DB constraints, hidden Direct Chat clarification-continuation rejection, prompt injection does not extend permissions, responsive Direct Chat UI, and same-device concurrent-send/decrypt coverage on Chromium, WebKit and Firefox.

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
- The initiator ratchet cannot decrypt its own outbound envelope. Self-sent copies are normally read from the client plaintext cache; during the narrow server-commit-before-HTTP-response window, another same-device tab can use only the exact matching durable pending outbox row.

## 10. After merge

- Enable only on explicit staging/local env (`DIRECT_CHATS_ENABLED` + `NEXT_PUBLIC_VIMLA_DIRECT_CHATS`). Keep production off until a crypto/privacy review.
- Follow-up: security issue #74 for server-verifiable Operator output origin; #75 for arbitrary whole-browser-profile rollback detection with an external monotonic anchor; safety-number verification, history sharing for newly added devices (optional, user-initiated), signed-prekey rotation/grace policy, sealed sender / extra metadata minimization, and Operator command retention policy (`userText` TTL/redaction).
- Do not start Project Chats, Brain, or Auto Router from this surface.
