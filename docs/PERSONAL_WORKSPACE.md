# Personal Workspace (Phase 6)

Personal Workspace is the non-AI **My Work / Мои дела** domain: Today, Tasks, Reminders, Lists/Checklists, and Notes.

```text
UI → authenticated API → @vimla/workspace services → PostgreSQL
```

Controllers stay thin. The browser never supplies `userId`, owner, `scopeType`, or source conversation/message IDs. Phase 7 `@Vimla` must call the same domain services with a server-side `ActorContext` and optional `TrustedSourceContext`.

## Objects

Internal concept: `WorkspaceObject` with kinds `TASK | REMINDER | LIST | NOTE`.

- Checklist is a List `type` (`PLAIN` | `CHECKLIST`), not a separate kind.
- Phase 6 scope is **`PERSONAL` only**. There is no `projectId` column.
- Phase 8 PROJECT migration should add `scopeType = PROJECT` plus a real project foreign key, backfill personal rows as PERSONAL, and keep owner checks in the same services. Do not add a dangling nullable `projectId` beforehand.

## Timezone

`UserPreference.timezone` stores an IANA zone after explicit user confirmation (Settings or first reminder). The browser `Intl` zone is a suggestion only and is never written on page load. Today and reminder local-day bounds use that stored zone (DST-aware). Numeric offsets such as `UTC+3` are rejected.

## Scheduling vs delivery

Phase 6 persists reminder **schedule data** (`PENDING` / `CANCELED`). UI copy describes in-app delivery after Phase 6.5; email is opt-in in Settings. Recurring reminders, Web Push, and SMS remain out of scope. See `docs/NOTIFICATIONS.md`.

## Security

- Auth is the session user. Mutations require verified email (`SensitiveArea`) and trusted `Origin`.
- Workspace mutations are rate-limited (`WORKSPACE_MUTATION_LIMIT_PER_MINUTE`, default 60). Redis failure fails closed outside local/test.
- Other users’ objects return **404**, not 403.
- Soft delete (`deletedAt`) hides rows from get/list/update. Archive is reversible. There is no purge/retention job in this phase.
- Logs record object id, kind, actor, operation — never title/body/content.

## Notes

Notes use an explicit **Save** button and dirty state (decision A). Markdown is stored as text and rendered as plain `pre-wrap` text. HTML is not executed.

## Task ordering

Default `GET /v1/workspace/tasks` order is server-authoritative and deterministic:

1. Active (`TODO`, `IN_PROGRESS`) before finished (`DONE`, `CANCELED`).
2. Active: dated tasks before undated; earlier `dueAt` first; then `updatedAt` descending, `createdAt` ascending, `id` ascending.
3. Finished: `updatedAt` descending, `createdAt` descending, `id` descending.

Status filters use the matching group's order. Pagination cursors are keyset tokens for this sort and are not interchangeable with a different `status` filter.

## Limits

Centralized in `WORKSPACE_LIMITS` (`@vimla/contracts`): title 1–200; task/reminder description 4000; list description 2000; list item 500; 200 items/list; note content 50_000; page default 20 / max 50.

## Out of scope

`@Vimla`, VIMLA_OPERATOR, Command Segments, Tool Registry, ActionPolicyEngine, ActionInvocation, recurring reminders, Web Push, SMS, Projects, Project/Personal Brain, Files/RAG, Images, Video, Agents, Auto Router.

Do not seed demo personal workspace rows in `pnpm db:seed`.
