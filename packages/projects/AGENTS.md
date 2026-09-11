# packages/projects — Codex guidance

This file extends the root `AGENTS.md` for Projects, membership and entitlement logic.

`PROJECTS_ENABLED` and the corresponding client gate `NEXT_PUBLIC_VIMLA_PROJECTS` remain fail-closed and OFF by default. Do not enable either gate unless a separately owner-approved production-enablement task explicitly requires a coordinated server/client rollout and its authorization, abuse-control, observability, rollback and test prerequisites.

## Authority / permissions
- Project ownership, role, membership and plan state are server-authoritative.
- Non-member/private project access preserves enumeration-safe `404` behavior where defined.
- Do not trust client-supplied owner/member IDs, roles or entitlement state.
- OWNER/ADMIN/MEMBER/VIEWER capabilities must remain explicit and least-privilege.
- Ownership transfer is not implicitly supported; do not invent it as a workaround.

## Plan semantics
- An owned project is governed by its owner's plan. A paid collaborator must not bypass the owner's Free limits.
- Downgrade locking is reversible/read-only; preserve data and memberships.
- Free-plan active-project selection/ranking must use the existing server-defined activity semantics, not arbitrary client timestamps.
- Do not change entitlement limits or ranking policy without an explicit product task.

## Concurrency
- Count/limit checks for project creation, invites and membership acceptance must be safe under parallel requests.
- Check-then-write without a transaction/lock/constraint is not sufficient for hard limits.
- Add real-PostgreSQL integration tests for races when changing entitlement/membership mutations.

Read the root `AGENTS.md`, project docs/domain code, `.cursor/rules/30-database.mdc`, `70-security.mdc` and `80-testing.mdc` before changes.
