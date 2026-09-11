# Codex workflow for Vimla

This document defines how Codex should be used on Vimla. It complements `AGENTS.md`; it does not replace repository architecture/security rules.

## Roles

- **Architecture / audit / task design**: performed before implementation. Root cause, invariants, scope, acceptance tests and risks should be written into the GitHub issue/PR/task specification.
- **Codex**: implementation executor. It edits code, adds migrations/tests when required, runs quality gates and reports results.
- **Human owner**: approves whether a prepared task is actually delegated to Codex and decides whether a finished PR may be merged.

Codex should not independently expand the roadmap or start future phases.

## Approval gate

A prepared task is not permission to start work by itself.

Before a new Codex implementation task is launched, the human owner should explicitly approve that delegation. Once approved, the task specification in GitHub is the implementation contract.

Follow-up Codex work after review/CI findings should use the same approval gate rather than creating an uncontrolled autonomous fix loop.

## Mandatory minimum task specification

Before editing for any substantial implementation task, Codex must confirm that the owner-approved specification states, at minimum:

- scope/problem and requested outcome;
- intended architecture/approach;
- preserved security, financial, product and domain invariants;
- acceptance criteria and required tests;
- explicit out-of-scope items.

It should additionally state, where relevant:

- likely files/domains;
- concurrency/retry/crash semantics where relevant;
- migrations allowed/required;
- required quality gates;
- whether the PR must remain draft and must not be merged.

If any mandatory field is missing, materially ambiguous or contradictory, Codex must not infer product or architecture decisions. Stop before editing and request clarification. Likewise, stop if the specification conflicts with protected repository invariants; owner approval does not silently waive them.

For high-risk work (billing, auth, Admin, `@Vimla`, Direct Chat/E2EE, permissions), prefer smaller independently reviewable tasks/PRs instead of one broad phase-sized rewrite.

## Implementation protocol

When Codex receives an approved task:

1. Read root `AGENTS.md` and all nearer `AGENTS.md` files that govern changed paths.
2. For cross-cutting app/worker integration, also read every domain-relevant sibling guide (for example `packages/projects/AGENTS.md`, `packages/operator/AGENTS.md`, `packages/notifications/AGENTS.md`, `packages/direct-chats/AGENTS.md`, `packages/e2ee/AGENTS.md` or `packages/workspace/AGENTS.md`). Ancestry-only discovery is insufficient.
3. Read applicable `.cursor/rules/*.mdc` and relevant docs referenced by those files.
4. Inspect existing implementation/tests before editing.
5. Preserve established public behavior unless the task explicitly changes it.
6. Solve the root cause, not just the failing test.
7. Keep changes inside requested scope; avoid unrelated refactors.
8. Add regression tests that reproduce the real bug/race/security boundary.
9. Run the required quality gates supported by the environment.
10. Review the diff for authority leaks, secret leakage, unsafe migrations, race/crash behavior and accidental scope expansion.
11. Report changed files, migrations, commands actually run, failures/unavailable checks and remaining risks.
12. Do not merge automatically.

## Review loop

A green CI run is necessary but not sufficient for security/correctness-sensitive work.

After Codex implementation, a separate review should inspect the actual diff and tests. If additional fixes are needed, prepare a focused follow-up task and obtain owner approval before delegating it to Codex.

Examples of unacceptable shortcuts even if tests pass:

- replacing a database concurrency invariant with an in-memory mutex;
- weakening a permission/CSRF/MFA check;
- changing historical applied migrations;
- using floating point for authoritative money;
- trusting client-provided authority fields;
- moving durable business state from PostgreSQL to Redis;
- logging secrets/private E2EE plaintext;
- enabling an intentionally disabled security-sensitive feature without explicit approval;
- updating snapshots/tests to hide a regression instead of fixing the implementation.

## Merge policy

Codex does not merge Vimla PRs by default. A PR should be left for human decision after implementation, CI and independent review.
