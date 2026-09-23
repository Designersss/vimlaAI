# PR-15 pre-merge security review

Reviewed on 2026-09-23 against PR #67, following owner authorization to audit and merge only without blocking findings. This is a code/dependency review and automated regression validation, not a penetration test or an independent cryptographic assessment.

## Findings and remediation

The initial production dependency audit found advisories already present in the PR-14 dependency graph. The first PR-15 remediation moved Nodemailer from 6.10.1 to 9.1.1 and Fastify from 5.11.3 to 5.12.1, but a final pre-merge advisory re-check on 2026-09-23 found newer published security fixes that made those intermediate pins obsolete.

Fastify is therefore pinned to 5.12.5, including the Nest platform adapter's transitive copy through the bounded pnpm override. This includes the 5.12.2 validation/authentication fixes and the later 5.12.5 HTTP/2 trailer DoS fix. Nodemailer is moved to 10.0.10, the supported TypeScript line containing the current linear-time address/MIME/SMTP parser fixes. Nodemailer 10 ships its own declarations, so the obsolete `@types/nodemailer` package is removed.

The email adapter still constructs an explicit allowlist of message fields and the SMTP transport still disables file and URL content access. Existing real Nodemailer contract tests must remain green after the major upgrade; they verify MIME compatibility and that raw file/URL access cannot bypass the transport boundary.

A separate correctness finding affected distributed leases: concurrency admission and completion used the process clock while PostgreSQL issued leases. A worker with a slow clock could commit an expired lease. Both comparisons now use database time. A negative integration test reproduces the expired-lease commit on the old implementation and passes after the fix; coverage also checks admission with an ahead-of-database process clock and subsequent expired-job recovery.

The local browser gate also exposed a pre-existing task-checkbox race: overlapping optimistic mutations and list refreshes could restore stale state. Task mutations now share a UI in-flight guard until the authoritative refresh completes; older list responses are ignored and failure releases controls. This is a UI ordering guard, not server authorization. A controlled-latency browser regression fails on the old UI, exercises failure recovery and preserves all existing assertions.

## Remaining dependency advisories: documented, not suppressed

No advisory allowlist or package-audit suppression is introduced. The previously reachability-reviewed remaining advisories are:

| Dependency | Advisory | Reachability assessment |
| --- | --- | --- |
| deepmerge-ts 7.1.5, high | GHSA-ggr8-5vv4-36mx | Transitive through Prisma's configuration loader. The merge consumes trusted local configuration, not request bodies. Exploitation requires cyclic JavaScript object graphs; plain JSON does not create those. No public runtime path to this merge was found. A future supported Prisma/toolchain update should remove it; forcing a major transitive override was avoided. |
| Vitest 3.2.7, moderate | GHSA-82fw-gwwq-j7x9 | Optional Better Auth peer used by its explicit test-utils entry point and repository tests. No application import of that test-utils entry point or exposed Vitest API server was found. Tests run in run mode. |
| @vitest/mocker 3.2.7, moderate | GHSA-82fw-gwwq-j7x9 | Same test-only path. A coordinated Vitest major upgrade is separate toolchain maintenance. |

These entries are not a claim of zero dependency risk. Final merge still requires a fresh exact-head dependency/advisory check plus complete CI. Re-evaluate the disposition if deployment, Prisma configuration, Better Auth imports, or test-server exposure changes.

## Production mocks and trust boundaries

The new embedding provider is a real HTTP adapter and has no mock fallback. Synthetic vectors and injected transports are confined to tests. Existing worker MockAiProvider wiring is inside the local/test orchestration preview gate. Production/staging configuration rejects mock AI/planner/payment and in-memory email adapters. No production feature gate was enabled by this PR.

Actor/query authority comes from persisted server plans. SQL values are parameterized. Current source ACL is applied before distance/top-k and during hydration; normal snapshot/bundle audience and target verification remains in force. E2EE plaintext is excluded. Embedding output is numerical retrieval evidence, never executable tool authority. Secrets/provider bodies are not included in semantic error logs.

## Concurrency, lifecycle and architecture

Reviewed durable PostgreSQL jobs, source triggers, leases, revision/generation fencing, retries, deletion, revocation, admission and bounded provider I/O. Existing semantic integration tests exercise stale completion, concurrent delivery, recovery, model changes and negative scope cases on real pgvector. New source fingerprints and best-chunk-per-source ranking preserve deduplication and recent raw history. Domain dependencies remain inward and acyclic; the existing derived-provider contract cannot inject authoritative semantic scores.

No blocking PR-specific data-isolation, production-mock or SQL-injection finding remained in the semantic implementation. This does not prove absence of all bugs. Exact scoped search has a 1.5-second deadline, but large-corpus performance and migration duration still require deployment rehearsal. Provider endpoint security, pinned weights, backup/erasure policy and coordinated model rollout remain deployment prerequisites documented in SEMANTIC_RETRIEVAL.md.

## Validation interpretation

The merge decision must use the latest commit's complete GitHub CI, including lint, typecheck, unit, PostgreSQL/pgvector integration, build and browser E2E, plus a fresh dependency/advisory check after the Fastify/Nodemailer remediation. Earlier green checks do not cover this final dependency commit.

Five ordinary local screenshot failures were previously reproduced on clean PR-14; the existing CI policy excludes six OS-specific pixel tests. No snapshots, assertions, feature gates or skip rules were changed. CI success is not a claim that these baseline screenshot differences were fixed.
