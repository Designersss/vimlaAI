# Vimla Engineering Workflow

Status: **mandatory repository engineering workflow**  
Product/platform source of truth: GitHub #78 and `docs/MESSENGER_PLATFORM_ARCHITECTURE.md`.

This process applies to every Vimla implementation, fix, CI repair, refactor, audit, architecture change, or technical investigation, regardless of which interface is used to perform the work.

## 1. Inspect reality first

Before conclusions or edits:

- inspect current `main`;
- inspect the exact PR/branch HEAD if one exists;
- read the atomic Issue plus parent EPIC/master context;
- inspect all affected code, contracts, Prisma schema/migrations, API/services, client code, tests and relevant docs;
- inspect neighboring implementations and dependencies;
- treat memory/old Issue text/previous audits as context, not proof;
- if Issue and code disagree, report the mismatch and follow actual code + current approved architecture.

## 2. Architectural baseline

Vimla is a **messenger-first communication platform with native AI**.

Ordinary communication must stand on its own. AI Threads, `@Vimla`, Projects/Work and automation extend communication.

One authoritative backend serves Web and future Desktop/Mobile.

Development order:

```text
backend + complete Web logic
→ Web Functional/Security Complete
→ owner manual Web redesign
→ Design Freeze
→ Desktop
→ Mobile
```

Do not start Desktop/Mobile early, but do not introduce Web-only backend/domain assumptions that would require later rewrites.

## 2A. Greenfield correctness over legacy compatibility

Vimla is still pre-production. There is currently no production user-data or released-client compatibility boundary to preserve by default.

- Do not keep an incorrect earlier implementation merely because a previous issue introduced it.
- Prefer the clean target architecture when old code/contracts/schema conflict with the current approved design.
- Remove obsolete fields, compatibility branches, duplicate DTOs and temporary abstractions instead of carrying them forward.
- It is acceptable to rewrite development-only schema/API behavior and update tests/migrations when that produces the correct architecture.
- Preserve compatibility only when there is a concrete deployed boundary: production data, released clients, external integrations, or another explicitly approved dependency.
- Do not use "backward compatibility" as a reason to retain technical debt in a greenfield subsystem.

## 3. Multi-client boundary

- no separate Web/Desktop/Mobile business backends;
- no ordinary `/v1/web/*`, `/v1/mobile/*`, `/v1/desktop/*` product forks;
- backend/domain contracts express semantic intent, not UI route strings;
- client/platform metadata never grants authority;
- reuse contracts/API/client-core/sync/context/E2EE protocol logic where concrete reuse exists;
- platform APIs stay behind focused adapters;
- avoid speculative abstraction without a real current/future use case.

## 4. Realtime and sync

Target architecture:

- PostgreSQL = durable source of truth;
- transactional outbox = durable publication intent;
- Redis = fan-out/coordination;
- WebSocket = foreground realtime fast path;
- durable cursor-based sync = recovery/correctness;
- Web Push/APNs/FCM = wake/notification only.

Loss of realtime/push/Redis must never imply loss of durable state.

## 5. Context and AI privacy

Required flow:

```text
actor
→ surface
→ audience
→ current authorization
→ eligible sources
→ retrieval
→ ranking/budget
→ model/executor
```

Actor access does not imply permission to disclose to the current audience.

Retrieved/user/model content is data, never authorization.

## 6. E2EE

Do not weaken E2EE for AI convenience.

Encrypted-surface plaintext/private keys remain client-side except for explicit bounded disclosures required by the approved AI flow.

Direct Chat security invariants remain fail-closed.

Encrypted Groups require a separately reviewed group protocol design.

## 7. Root-cause implementation

Before editing:

1. identify the actual root cause;
2. identify affected correctness/security invariants;
3. inspect dependent and neighboring flows;
4. consider schema/data transition; require backward compatibility only for a real deployed/external boundary;
5. consider retries/idempotency/concurrency/crash recovery;
6. keep the architecture suitable for future Desktop/Mobile without preserving unreleased legacy client formats;
7. implement the smallest coherent production-grade scope.

Do not make CI green by weakening assertions, increasing timeouts, disabling checks, or bypassing security if production behavior is wrong.

If the failure is genuinely a test race/setup bug, prove that and fix the test without changing product semantics.

## 8. Technical-debt guard

Do not introduce:

- duplicate business logic;
- dead compatibility branches;
- production mocks/test shortcuts;
- TODO/FIXME in place of required behavior;
- temporary hard-coded authority;
- Web-only business logic;
- client-side authorization;
- unused abstractions;
- giant components/services when a clear existing boundary can be extracted;
- unnecessary dependencies;
- separate implementations of one domain rule per client.

Reuse existing domain services and packages where correct.

## 9. Database and schema-transition discipline

For persistence changes:

- inspect current Prisma schema and migration history;
- because Vimla is pre-production, historical development migrations are not sacred compatibility artifacts: they may be rewritten/squashed/replaced when the clean architecture requires it, provided repository test/dev databases are reset consistently;
- do not create additive legacy columns/backfills solely to preserve development data or an obsolete schema shape;
- prefer a clean final schema over a chain of compatibility migrations when no real deployed database must survive;
- once a migration has crossed a real shared/deployed boundary (production, protected staging with retained data, external release dependency), treat it as immutable and use forward migrations with explicit recovery/rollback planning;
- use DB constraints/indexes when they materially protect invariants;
- backfills are required only when real data must survive, and must then be idempotent/recoverable;
- consider concurrent deploy/version skew only when such a deployed boundary actually exists.

## 10. Security review

For every material change consider:

- authentication;
- authorization/IDOR;
- privilege escalation;
- CSRF/origin/session semantics;
- hostile input validation;
- size/rate/concurrency limits;
- replay/races;
- SSRF/XSS/injection;
- secrets/log redaction;
- E2EE boundaries;
- abuse;
- revoke/downgrade;
- fail-closed behavior.

Never make a stronger security claim than the implementation guarantees.

## 11. Tests

Add/preserve tests appropriate to the invariant:

- unit;
- PostgreSQL integration;
- contract/API;
- negative authorization;
- concurrency/replay/idempotency;
- migration;
- Browser E2E;
- realtime/reconnect/offline where applicable.

Tests should prove behavior/invariants rather than unnecessary implementation detail.

## 12. CI exact-head rule

After every code change verify CI on the **exact current HEAD**.

Required repository checks currently include:

- lint;
- typecheck;
- unit tests;
- integration tests;
- build;
- Browser E2E.

A green run for an older commit is not evidence for a newer one.

For red CI, inspect the complete failure, identify the first real cause, fix it, then validate a new exact HEAD.

## 13. Final audit after green CI

Green CI is necessary, not sufficient.

Before merge, audit the exact diff and affected neighboring code for:

- requirement completeness;
- architecture;
- auth/authz/IDOR;
- security/privacy;
- races/concurrency;
- retries/idempotency/crash recovery;
- migrations/constraints;
- contracts and compatibility only where a real deployed/external boundary exists;
- multi-client/platform leaks;
- duplicate/dead code;
- mocks/test-only leaks;
- logging;
- feature gates;
- unresolved review threads;
- stale docs/comments;
- correctness of earlier fixes themselves.

## 14. GitHub workflow

Repository planning structure:

```text
#78 Master
→ EPIC
→ atomic implementation Issue
→ PR
```

Implement from the atomic Issue. Master/EPIC provide context/dependencies, not permission to implement unrelated descendants.

If an Issue is stale/already implemented, verify code first and clean up tracking rather than duplicating behavior.

Never remove an unresolved security requirement merely to simplify backlog.

## 15. Merge rule

Do not merge before:

- exact-head CI is green;
- final audit has no unresolved blocker;
- review threads are resolved;
- PR is mergeable against current `main`.

When an authorized request says to merge if everything is correct, perform the audit first and merge only when all gates pass.

## 16. Analysis-only requests

If the request is analysis/question only:

- inspect current code first when the answer depends on project state;
- do not make code changes unless requested;
- clearly separate current behavior from proposed future behavior;
- explain findings in normal human language and map architecture changes to the correct roadmap stage.

## 17. Product simplicity

Internal complexity belongs inside Vimla.

Normal users should not administer internal mechanisms such as sync cursors, ratchets or local DB recovery.

For example, Desktop/Mobile storage UX may expose **Clear cache** for reproducible media, but not normal-user `Resync`, `Reset ratchet`, `Reset E2EE`, or `Clear local Direct Chat data` controls.
