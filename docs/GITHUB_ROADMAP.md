# Vimla GitHub Roadmap / Issue Hierarchy

Status: **canonical repository work hierarchy**  
Master epic: #78.

GitHub issue descriptions remain the implementation-level source of truth for each task. This file provides the stable map so repository docs/rules do not depend on an obsolete phase list.

Engineering execution/audit/CI/merge rules are defined in `docs/ENGINEERING_WORKFLOW.md`.

## Current gate

- E2EE-H02: #76 / PR #77 — merged into main at `15667f37b3749f8d266e25ab02e01f25e6fa4dea`.
- Master roadmap: #78.
- ARCH-00 guidance implementation: #90 / PR #135.
- Next implementation after ARCH-00: #91 semantic NavigationTarget.

## Architecture

- #79 EPIC ARCH
  - #90 ARCH-00 guidance pivot
  - #91 ARCH-01 semantic NavigationTarget
  - #92 ARCH-02 shared client API/core
  - #93 ARCH-03 ClientInstallation/preferences

## Realtime / Sync

- #80 EPIC REALTIME
  - #94 RT-01 WebSocket protocol/gateway
  - #95 RT-02 transactional outbox
  - #96 SYNC-01 durable cursor sync
  - #97 SYNC-02 Web SyncEngine + SSE/EventSource removal

## Messaging Core

- #81 EPIC MESSAGING
  - #98 CommunicationSurface
  - #99 SurfaceAuthority
  - #100 Unified Inbox
  - #101 PublicProfile/@handle discovery
  - #102 Direct Messaging maturity
  - #103 push-ready notification destinations
  - #104 block/report/mute
  - #105 attachments/media

## Channels

- #82 EPIC CHANNELS
  - #106 Channel domain
  - #107 Channel Web/feed
  - #108 semantic indexing
  - #109 Ask Channel
  - #110 discovery/moderation

## Groups

- #83 EPIC GROUPS
  - #111 Group domain
  - #112 reviewed Group E2EE ADR
  - #113 encrypted Group messaging
  - #114 @Vimla in Groups

## Shared Work / Projects

- #84 EPIC WORK
  - #115 PROJECT Workspace scope
  - #116 Project Rooms
  - #117 Project context graph

## AI / Search

- #85 EPIC AI
  - #118 universal InvocationContext
  - #119 messenger actions
  - #120 invisible orchestration
  - #121 global permission-aware search

## Web → Design → Desktop → Mobile

- #86 EPIC WEB
  - #122 Web Functional/Security Complete
- #87 EPIC DESIGN
  - owner manual Web redesign
  - #123 Design Freeze
- #88 EPIC DESKTOP
  - #124 Desktop shell
  - #125 Desktop storage/cache
  - #126 Desktop parity
- #89 EPIC MOBILE
  - #127 Mobile shell
  - #128 realtime/push/background sync
  - #129 native storage/cache/E2EE/parity

## Parallel E2EE security

- #54 security epic
  - #76 / PR #77 H02
  - #130 H03 identity verification/safety numbers
  - #131 H04 prekey lifecycle
  - #132 H05 device/recovery lifecycle
  - #133 H06 transparency/rollback anchor
  - #134 H07 final audit gate
  - #74 @Vimla peer-visible output attestation
  - #75 whole-profile rollback detection

## Sequencing rule

Do not jump directly to Channels/Groups because an issue exists.

Follow dependencies in issue bodies.

In particular, platform-neutral contracts and realtime/sync foundations precede new communication surfaces.

No issue automatically production-enables a feature.
