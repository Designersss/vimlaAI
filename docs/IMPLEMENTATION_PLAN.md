# Vimla — Implementation Plan

Status: **canonical sequencing summary**.  
Implementation details live in GitHub #78 and its child issues.  
Architecture: `docs/MESSENGER_PLATFORM_ARCHITECTURE.md`.  
Issue map: `docs/GITHUB_ROADMAP.md`.

## 1. Completed foundation

The repository already contains production-oriented foundations that are reused, not rebuilt:

- pnpm/Turborepo modular monorepo;
- Next.js Web, NestJS/Fastify API, BullMQ worker, separate Admin;
- Better Auth identity/sessions + email verification/recovery;
- billing/usage reservations/ledger and T-Bank integration;
- AI gateway/provider abstraction and persistent AI Threads;
- personal Workspace;
- durable Notifications;
- Projects/member/entitlement foundation;
- secure @Vimla Operator;
- semantic workflow/orchestration runtime;
- ContextSnapshot/ContextBundle, Memory, semantic retrieval;
- 1:1 Direct Chats and X3DH/Double Ratchet E2EE foundation;
- shared @vimla/ui and responsive Web shell.

Do not recreate these domains under new messenger names.

## 2. Current gate

Finish current E2EE-H02 work (#76 / PR #77), including the #78 product correction: preserve the internal authoritative crypto wipe primitive but do not ship a normal user-facing “Clear local Direct Chat data” maintenance control.

Parallel E2EE hardening remains tracked by #54/#74/#75/#130–#134.

## 3. Architecture foundation

Epic #79:
- #90 repository/documentation/rules pivot;
- #91 semantic NavigationTarget;
- #92 platform-neutral client API/core;
- #93 ClientInstallation + setting scopes.

No new large messenger surface should be built on top of known Web-only domain-contract leaks.

## 4. Realtime + durable sync

Epic #80:
- #94 common authenticated WebSocket protocol;
- #95 transactional event outbox;
- #96 durable cursor sync;
- #97 Web SyncEngine and safe Direct Chat SSE migration.

Realtime is fast path. Sync/PostgreSQL are correctness.

## 5. Communication core

Epic #81:
- CommunicationSurface / SurfaceAuthority;
- Unified Inbox;
- PublicProfile + handle discovery;
- Direct Messaging maturity;
- push-ready notifications;
- trust/safety;
- attachments/media.

## 6. Channels

Epic #82:
- Channel domain/global handles;
- feed/subscriptions;
- semantic ChannelPost index;
- Ask Channel;
- discovery/moderation.

Channels are the preferred early public wedge because they provide value before a user's friends migrate.

## 7. Groups

Epic #83:
- Group domain;
- reviewed Group E2EE ADR;
- encrypted implementation only after ADR approval;
- permission-aware @Vimla.

Never invent group cryptography by casually extending pairwise Double Ratchet.

## 8. Shared Work / Projects

Epic #84:
- migrate PERSONAL-only Workspace to explicit PROJECT scope;
- Project Rooms;
- unified project context graph.

## 9. Universal AI / Search

Epic #85:
- surface-aware InvocationContext;
- typed messenger actions;
- existing DAG/orchestration as invisible infrastructure;
- global permission-aware search.

## 10. Web Functional Complete

Epic #86 / #122.

Before the owner's design pass, accepted Web product functionality/security must be complete and architecture must be free of known native-blocking Web assumptions.

## 11. Owner manual Web redesign

Epic #87.

The owner manually finalizes layout/components/presentation. Business/security behavior remains stable unless separately changed.

Then #123 Design Freeze:
- normalize semantic tokens;
- remove duplicate visual code;
- extract reusable Web/Desktop DOM product components from Next route wrappers;
- validate responsive/accessibility behavior.

## 12. Desktop

Epic #88:
- #124 Tauri/React shell (expected direction, reviewed at implementation time);
- #125 secure storage/local DB/content-addressed media cache;
- #126 Desktop parity.

Same backend and business logic. No Desktop backend.

## 13. Mobile

Epic #89:
- #127 React Native/Expo shell (expected direction, reviewed at implementation time);
- #128 foreground WebSocket + APNs/FCM + resume sync;
- #129 native secure storage/local DB/cache/E2EE + parity.

Same backend and business logic. No Mobile backend.

## 14. Later expansion

Creator monetization, business surfaces, calls, bots/mini-apps and extra media/AI capability are intentionally later. Implement them only after core communication usage justifies them.

Old “Images → Video → Agents” sequencing is no longer the product roadmap.

## 15. Universal gates

Every implementation issue must preserve:
- server-authoritative identity/permissions/billing;
- PostgreSQL durable truth;
- Redis/BullMQ as transport/coordination;
- authorization before semantic retrieval/disclosure;
- E2EE plaintext/private keys not centralized for AI convenience;
- idempotency/concurrency/crash recovery;
- strict API contracts and bounded hostile input;
- full relevant tests and exact-head CI;
- no automatic production enablement or merge.
