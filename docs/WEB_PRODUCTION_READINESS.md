# Vimla Web Production Readiness

This document is the release gate for the completed Vimla Web Design System 2026 migration.

## Completed visual migration scope

- Design System 2026 foundation and shared UI primitives
- AppShell and global navigation
- Chats
- Projects
- Settings
- Work
- Authentication
- Public landing

## Release checks

Before treating Web as production-ready, CI must remain green for:

- typecheck, lint and repository validation
- browser E2E
- representative mobile, tablet, laptop and desktop viewports
- short-landscape coverage where page-local behavior requires it
- no accidental document-level horizontal overflow
- route-driven master/detail behavior on Chats, Projects, Settings, Notes and Lists
- intentional single-pane behavior on Tasks and Reminders
- public auth and landing routes
- authenticated primary routes
- keyboard-accessible shared controls and visible focus treatment
- reduced-motion compatibility
- deliberate light/dark semantic token usage

## Architecture boundaries

Production-readiness polish must not move domain authority into presentation code. Existing backend, auth, billing, usage, project entitlement and workspace semantics remain authoritative.

The Web release gate must also preserve:

- URL selection authority for route-driven detail views
- owner-plan project entitlement rules and PLAN_LOCKED behavior
- Better Auth session, verification and password-reset semantics
- billing and usage overspend protections
- current API contracts and data-fetching authority

## Responsive contract

Web remains one shared responsive implementation. It must support:

- small mobile
- common mobile
- tablet
- laptop
- desktop
- wide desktop
- short landscape
- touch and keyboard input
- safe-area insets
- reduced motion
- no accidental horizontal overflow

Persistent master/detail layouts use the existing shared breakpoint contract; page-local code must not create a second competing breakpoint model.

## Native clients

Desktop and Mobile are a separate future phase. Completing this release gate does not require Web-specific architecture rewrites for native clients. Shared backend contracts, schemas, validation and design tokens may be reused later without changing current Web behavior.
