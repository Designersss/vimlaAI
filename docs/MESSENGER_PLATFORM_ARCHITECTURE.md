# Vimla Messenger-First Platform Architecture

Status: **canonical product/platform architecture**  
Roadmap source of truth: GitHub #78  
Issue structure: see `docs/GITHUB_ROADMAP.md`.

## 1. Product definition

Vimla is a **full messenger with AI as a native system capability**.

Normal communication must stand on its own:

- 1:1 Direct Chats;
- Groups;
- Channels;
- Projects/Project Rooms;
- AI Threads;
- media/files;
- notifications;
- search.

AI extends communication instead of replacing it.

> **Always available, never intrusive.**

`@Vimla` may be invoked from supported surfaces, but AI must not inject itself into human conversation without explicit invocation or an explicitly configured automation.

## 2. One system, multiple clients

Vimla has one authoritative backend/domain system serving:

```text
Web  ───────┐
Desktop ────┼── Vimla API / Realtime / Sync ── PostgreSQL
Mobile ─────┘                 │
                              ├── Redis/BullMQ (transport/coordination)
                              └── workers/providers/object storage
```

There is no separate Web/Mobile/Desktop business backend.

Product APIs are domain-oriented. Do not create `/v1/web/*`, `/v1/mobile/*` or `/v1/desktop/*` forks for ordinary product behavior.

## 3. Delivery order

```text
backend + Web functionality
        ↓
Web Functional/Security Complete
        ↓
owner manual Web redesign
        ↓
Design Freeze / UI consolidation
        ↓
Desktop
        ↓
Mobile
```

Desktop/Mobile are intentionally not implemented before Web is complete and the owner has approved the final Web presentation.

However, backend/API/client boundaries created now must not require redesign when native clients arrive.

## 4. Authority

The server is authoritative for:

- authenticated actor;
- ownership/membership/roles;
- entitlements/billing;
- message/surface metadata;
- public identities/handles;
- durable business state.

Client-supplied platform, user id, role, permission, model/provider id or local state never grants authority.

## 5. Communication surfaces

A high-level `CommunicationSurface` provides stable identity/routing/context for product surfaces such as:

- AI_THREAD;
- DIRECT;
- GROUP;
- CHANNEL;
- PROJECT / PROJECT_ROOM.

Surface is **not** a universal ACL table.

Each domain retains its own authority:

- Direct Chat membership/E2EE policy;
- Group membership/roles;
- Channel roles/subscription/visibility;
- Project capabilities;
- personal ownership.

### 5.1 Current MSG-01 identity model

The first implemented surface kinds are `AI_THREAD` and `DIRECT`.

- `CommunicationSurface.id` is an independent UUID routing identity; it is not a replacement for the domain object's id.
- exactly one current domain binding is stored per surface (`Conversation(kind='CHAT')` or `DirectConversation`);
- dedicated `Conversation(kind='OPERATOR')` rows are not AI Threads and intentionally have no CommunicationSurface in MSG-01;
- PostgreSQL constraints/triggers prevent one surface from binding both domains, prevent `AI_THREAD` from binding a non-`CHAT` Conversation, and unique constraints prevent two surfaces from binding the same domain object;
- Conversation kind plus the surface identity, kind and domain binding are immutable after creation, so a thread cannot change domains underneath a stable routing identity;
- supported domain-row creation transactionally causes creation of its surface in PostgreSQL, including direct domain/test writes that do not pass through one specific HTTP service;
- AI Thread APIs expose `surfaceId/surfaceKind` only after owner-scoped conversation authorization;
- Direct Chat APIs expose `surfaceId/surfaceKind` only after the existing membership/E2EE authority succeeds.

Surface rows contain no ownership, role, membership or E2EE authority. The authority-adapter registry prepared in MSG-01 first resolves the surface kind through a server-authoritative identity resolver and only then dispatches to a domain adapter; CTX-02 owns the domain-specific audience/read/write/capability decisions.

## 6. Context / audience rule

The central privacy invariant is:

> **Actor access to information does not imply permission to disclose that information to the current audience.**

Required pipeline:

```text
actor
→ current surface
→ audience
→ allowed source scopes
→ current authorization
→ eligible context
→ lexical/semantic retrieval
→ ranking/budget
→ model/executor
```

Authorization must occur before semantic top-k/ranking.

Retrieved/user/model content is data, never authorization.

## 7. E2EE

Direct Chats and future encrypted Groups keep plaintext/private keys client-side.

The server must not receive decryption keys or build a persistent plaintext archive merely to enable AI.

For encrypted surfaces:

```text
local decrypt
→ bounded eligible context selection
→ consent/policy
→ server revalidation of authoritative metadata
→ @Vimla/model
```

Disclosed plaintext remains untrusted context and cannot grant actions/permissions.

Group encryption requires a separately reviewed protocol design; do not extrapolate pairwise Double Ratchet into a custom group protocol.

## 8. Realtime and sync

Realtime is the **fast path**. Durable sync is the **correctness/recovery path**.

Target foreground transport is WebSocket.

Durable product state remains PostgreSQL authority. Durable mutations that require client visibility use transactionally coupled event/outbox intent.

Redis may fan out realtime events but is never durable message/sync truth.

A client that misses every realtime event must still recover from its last durable sync cursor.

See `docs/REALTIME_SYNC.md`.

## 9. Client architecture

Reusable layers should contain:

- contracts;
- API clients;
- client/domain state;
- SyncEngine;
- context/E2EE protocol logic;
- design tokens/i18n where appropriate.

Platform adapters own:

- Web browser APIs;
- Desktop/Tauri APIs;
- Mobile/Expo/native APIs;
- secure storage;
- filesystem/cache;
- push;
- deep links;
- app lifecycle.

See `docs/CLIENT_ARCHITECTURE.md`.

## 10. Navigation

Backend/domain outputs use semantic `NavigationTarget`, not Next routes.

Example semantics:

```text
TASK(id)
REMINDER(id)
NOTE(id)
PROFILE(handle/user)
CHAT(surfaceId)
CHANNEL(channelId)
PROJECT(projectId)
SETTINGS_NOTIFICATIONS
```

Each client maps a target to its platform navigation.

## 11. Local cache

Web initially relies on normal browser/CDN HTTP caching.

Desktop/Mobile use content-addressed media cache:

- filesystem blobs;
- local metadata index;
- stable attachment/content hash key;
- variants (thumbnail/preview/original);
- bounded size + eviction policy.

Normal user UX exposes only **Clear cache**.

Clear cache removes only reproducible cache. It never deletes E2EE identity/ratchets, sync authority, account data, Memory or settings.

Internal security lifecycle may wipe crypto state when required; that is not a cache feature.

## 12. UI/design

Business/client logic must be separable from layout/presentation.

The owner will manually redesign Web after functional completion. That pass must not require rewriting messaging/sync/crypto/domain behavior.

After owner approval, Design Freeze normalizes tokens/components for Desktop reuse.

Web/Desktop may share DOM product components. Mobile shares contracts/client logic/design language/tokens where practical but uses native presentation when appropriate.

## 13. Repository invariants

1. Messaging is primary.
2. AI/Work/Projects extend communication.
3. One backend serves every client.
4. Client platform is never authority.
5. Backend/domain does not know UI routes/layout.
6. PostgreSQL is durable truth.
7. Realtime is fast path; sync is recovery/correctness.
8. Authorization precedes context retrieval.
9. E2EE is not weakened for AI convenience.
10. Model/planner output is never authority.
11. Web first does not mean Web-only architecture.
12. Desktop/Mobile begin only after Web Complete + owner design freeze.
13. Clear cache never clears security/sync authority.
14. Avoid speculative abstraction; every shared layer needs a concrete purpose.
