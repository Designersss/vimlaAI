# PR-15 pre-merge security review

Reviewed on 2026-09-23 against PR #67, following owner authorization to audit and merge only without blocking findings. This is a code/dependency review and automated regression validation, not a penetration test or an independent cryptographic assessment.

## Findings and remediation

The production dependency audit initially reported 17 advisories (4 high, 12 moderate, 1 low), all present in the PR-14 lockfile dependency versions. Nodemailer 6.10.1 was replaced with 9.1.1. Fastify was updated to 5.12.1, including the Nest adapter's transitive copy through a narrowly bounded pnpm override. Updating only the direct Fastify dependency did not protect the adapter, so both resolved copies were checked.

The email adapter still constructs an explicit allowlist of message fields; its transport now also disables file and URL content access. New tests use the real Nodemailer MIME composer, verify compatibility with that adapter and confirm that message-level raw file/URL content cannot bypass disabled access. They do not send real email. Full authentication, notification, API and browser regression suites remain required after these dependency changes.

A separate correctness finding affected distributed leases: concurrency admission and completion used the process clock while PostgreSQL issued leases. A worker with a slow clock could commit an expired lease. Both comparisons now use database time. A negative integration test reproduces the expired-lease commit on the old implementation and passes after the fix; coverage also checks admission with an ahead-of-database process clock and subsequent expired-job recovery.

The local browser gate also exposed a pre-existing task-checkbox race: overlapping optimistic mutations and list refreshes could restore stale state. Task mutations now share a UI in-flight guard until the authoritative refresh completes; older list responses are ignored and failure releases controls. This is a UI ordering guard, not server authorization. A controlled-latency browser regression fails on the old UI, exercises failure recovery and preserves all existing assertions.

## Remaining dependency advisories: documented, not suppressed

`pnpm audit --prod` still reports three advisories. No audit allowlist was introduced and the audit's nonzero exit status is retained.

| Dependency | Advisory | Reachability assessment |
| --- | --- | --- |
| deepmerge-ts 7.1.5, high | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | Transitive through Prisma's configuration loader. The merge consumes trusted local configuration, not request bodies. Exploitation requires cyclic JavaScript object graphs; plain JSON does not create those. No public runtime path to this merge was found. A future supported Prisma/toolchain update should remove it; forcing a major transitive override was avoided. |
| Vitest 3.2.7, moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | Optional Better Auth peer used by its explicit test-utils entry point and repository tests. No application import of that test-utils entry point or exposed Vitest API server was found. Tests run in run mode. |
| @vitest/mocker 3.2.7, moderate | Same advisory | Same test-only path. A coordinated Vitest major upgrade is separate toolchain maintenance. |

These are not a claim of zero dependency risk. The non-blocking disposition relies on trusted Prisma configuration and no exposed test server; re-evaluate if deployment or imports change.

## Production mocks and trust boundaries

The new embedding provider is a real HTTP adapter and has no mock fallback. Synthetic vectors and injected transports are confined to tests. Existing worker MockAiProvider wiring is inside the local/test orchestration preview gate. Production/staging configuration rejects mock AI/planner/payment and in-memory email adapters. No production feature gate was enabled by this PR.

Actor/query authority comes from persisted server plans. SQL values are parameterized. Current source ACL is applied before distance/top-k and during hydration; normal snapshot/bundle audience and target verification remains in force. E2EE plaintext is excluded. Embedding output is numerical retrieval evidence, never executable tool authority. Secrets/provider bodies are not included in semantic error logs.

## Concurrency, lifecycle and architecture

Reviewed durable PostgreSQL jobs, source triggers, leases, revision/generation fencing, retries, deletion, revocation, admission and bounded provider I/O. Existing semantic integration tests exercise stale completion, concurrent delivery, recovery, model changes and negative scope cases on real pgvector. New source fingerprints and best-chunk-per-source ranking preserve deduplication and recent raw history. Domain dependencies remain inward and acyclic; the existing derived-provider contract cannot inject authoritative semantic scores.

No blocking PR-specific data-isolation, production-mock or SQL-injection finding remained after review. This does not prove absence of all bugs. Exact scoped search has a 1.5-second deadline, but large-corpus performance and migration duration still require deployment rehearsal. Provider endpoint security, pinned weights, backup/erasure policy and coordinated model rollout remain deployment prerequisites documented in SEMANTIC_RETRIEVAL.md.

## Validation interpretation

The final merge decision must use the latest commit's complete local `CI=true pnpm codex:validate` and independent GitHub CI, including browser E2E. Earlier green checks do not cover dependency remediation.

Five ordinary local screenshot failures were previously reproduced on clean PR-14; the existing CI policy excludes six OS-specific pixel tests. No snapshots, assertions, feature gates or skip rules were changed. CI success is not a claim that these baseline screenshot differences were fixed.
