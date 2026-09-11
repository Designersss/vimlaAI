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

## Task specification expectations

A substantial Codex task should state:

- problem/root cause;
- requested outcome;
- scope and likely files/domains;
- security/financial/product invariants that must not change;
- concurrency/retry/crash semantics where relevant;
- migrations allowed/required;
- regression tests/acceptance criteria;
- explicit out-of-scope items;
- required quality gates;
- whether the PR must remain draft and must not be merged.

For high-risk work (billing, auth, Admin, `@Vimla`, Direct Chat/E2EE, permissions), prefer smaller independently reviewable tasks/PRs instead of one broad phase-sized rewrite.

## Implementation protocol

When Codex receives an approved task:

1. Read root `AGENTS.md` and all nearer `AGENTS.md` files that govern changed paths.
2. Read applicable `.cursor/rules/*.mdc` and relevant docs referenced by those files.
3. Inspect existing implementation/tests before editing.
4. Preserve established public behavior unless the task explicitly changes it.
5. Solve the root cause, not just the failing test.
6. Keep changes inside requested scope; avoid unrelated refactors.
7. Add regression tests that reproduce the real bug/race/security boundary.
8. Run the required quality gates supported by the environment.
9. Review the diff for authority leaks, secret leakage, unsafe migrations, race/crash behavior and accidental scope expansion.
10. Report changed files, migrations, commands actually run, failures/unavailable checks and remaining risks.
11. Do not merge automatically.

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
