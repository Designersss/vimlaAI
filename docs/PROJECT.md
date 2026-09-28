# Vimla — Product Description

Status: **current product definition**.  
Master roadmap: GitHub #78.  
Canonical architecture: `docs/MESSENGER_PLATFORM_ARCHITECTURE.md`.

## Vision

Vimla is a full consumer messenger with AI designed as a native system layer rather than a separate destination bolted onto messaging.

A user can communicate normally and ignore AI. When they need help, `@Vimla` can understand the current permitted context, answer questions and perform typed actions.

> **Always available, never intrusive.**

## Core communication product

Target product includes:
- 1:1 chats;
- Groups;
- Channels;
- AI Threads;
- Projects/Project Rooms;
- media/files;
- notifications;
- global permission-aware search.

Projects/Tasks/Notes/Reminders remain useful structured domains, but they extend communication rather than define the primary navigation/product identity.

## AI

`@Vimla` is the included/system assistant and action layer.

External models (AI_MODEL/AI_AUTO) remain separately governed by the existing safe billing/provider architecture.

The existing semantic planner/orchestration DAG remains internal infrastructure. Users should not need to understand Invocation/Artifact/Dependency concepts.

## Context

Vimla may retrieve all information the actor is currently permitted to use, but no model receives “everything”.

For each invocation:

```text
actor
→ surface
→ audience
→ current authorization
→ eligible context
→ retrieval/ranking/budget
→ model
```

Access is not disclosure permission.

Private-chat knowledge must never leak into an audience that is not allowed to receive it.

## Channels

Channel history is a knowledge surface.

A user may ask:
- what the author said about a topic;
- how an opinion changed over time;
- find an old recommendation/post.

Answers must link/provide provenance to original posts.

## E2EE

Direct Chats are ciphertext-only on the server with client-held keys.

Encrypted Groups require a separately reviewed group protocol.

AI on encrypted surfaces uses bounded client disclosure; Vimla does not gain permanent plaintext history or decryption keys.

## Multi-client

One backend serves Web, Desktop and Mobile.

Development order:
1. backend + complete Web logic;
2. Web functional/security gate;
3. owner manual Web design;
4. Design Freeze;
5. Desktop;
6. Mobile.

Future native clients reuse contracts/client logic/sync/context/E2EE protocol logic and shared design language. They do not receive independent business backends.

## Realtime

Foreground connected clients use common realtime (target WebSocket).

Realtime delivery is not durable truth. PostgreSQL-backed sync restores missed state after reconnect/offline/background suspension.

## Local cache

Desktop/Mobile have content-addressed media cache with one user-facing **Clear cache** action.

Clear cache removes reproducible media/cache only. It never clears E2EE identity/ratchets, sync authority, messages, Memory or settings.

Web initially uses browser/CDN cache.

## Existing foundation

Current repository already implements significant production-oriented infrastructure:
- identity/auth/sessions;
- billing/payments/usage safety;
- AI gateway;
- Admin;
- Workspace;
- notifications;
- Projects foundation;
- Operator/orchestration;
- context/memory/semantic retrieval;
- Direct Chat/E2EE foundation;
- shared UI;
- CI/E2E.

The messenger roadmap evolves these systems rather than starting over.

## Commercial direction

Long-term monetization may combine:
- free core messenger;
- Vimla Premium;
- frontier AI allowance/credits;
- creator/paid channel economics;
- promoted channel/discovery inventory;
- business/team capabilities;
- platform/mini-app/digital-goods economics.

Specific pricing is owned by versioned billing/tariff policy, not this document.

## Security/product principles

- public hostile traffic is assumed;
- client input is not authority;
- PostgreSQL is durable truth;
- money uses existing integer microRUB accounting;
- expensive provider calls remain funded/reserved before spend;
- sensitive data/logging is minimized;
- security-sensitive features stay fail-closed until explicit rollout;
- no feature or model output may bypass current ACL/capability policy.

## Roadmap

See `docs/GITHUB_ROADMAP.md` and GitHub #78. Old phase lists are historical and do not override this product definition.
