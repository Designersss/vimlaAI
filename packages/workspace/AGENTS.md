# packages/workspace — Codex guidance

This file extends the root `AGENTS.md` for Tasks, Reminders, Notes and Lists. Read `docs/PERSONAL_WORKSPACE.md` before changing this package or any Workspace integration in an app, worker or `@Vimla` tool.

## Scope and authority

- Workspace objects are PERSONAL-only until an explicitly approved migration introduces another scope. Personal rows have no `projectId`; do not add a nullable/dangling Project linkage or infer Project-scoped behavior.
- The authenticated server session supplies the actor. Never trust browser- or planner-supplied `userId`, owner, `scopeType`, source conversation/message IDs or other authority fields.
- `@Vimla` writes must call the same `@vimla/workspace` domain services with a server-created `ActorContext` and, where supported, a trusted source context. Do not duplicate CRUD or bypass Workspace validation, authorization, limits, transaction or audit rules.

## Privacy and access

- Preserve enumeration-safe behavior: access to or deletion of another user's object returns `404` where the contract defines it, rather than revealing existence with `403`.
- Soft-deleted objects remain hidden from get/list/update paths. Do not introduce destructive purge behavior without an explicit retention task.
- Keep logs content-free. Structured logs may include object ID, kind, actor and operation, but never title, body, note content, list-item text or other user-authored content.

## Time and scheduling

- Persist only a valid IANA timezone after explicit user confirmation through the supported product flow. A browser-detected timezone is a suggestion only and must not be written automatically on page load.
- Use the confirmed stored timezone for user-local day/reminder semantics and handle DST correctly. Reject invented numeric-offset substitutes such as `UTC+3`.
- Reminder schedule persistence and notification delivery are separate responsibilities; read the Notifications guidance for delivery integrations.

## Correctness

- Keep controllers and tools thin; centralize limits, deterministic ordering/cursors and mutation invariants in the existing contracts/domain services.
- Preserve trusted-origin, verified-email, rate-limit and owner-scope controls. Critical dependency failure must remain fail-closed outside explicit local/test behavior.
- Do not silently add recurring reminders, Project workspace objects, purge/retention, Web Push, SMS or other items listed as out of scope in `docs/PERSONAL_WORKSPACE.md`.
