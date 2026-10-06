# CI pipeline

Issue: [#147](https://github.com/Designersss/vimlaAI/issues/147). Workflow: `.github/workflows/ci.yml`.

## Principles

The **same complete coverage** runs for every pull request and every `main` push; we do not skip checks based on changed paths. All jobs check out the event's exact SHA (for PRs GitHub's synthetic merge ref), use frozen pnpm dependency resolution, and operate on fresh runners. `CI required` aggregates all results, treating failed, skipped, or cancelled constituent jobs as red. Do not require the old `lint-typecheck-test-build` check in branch-protection rules after migration; require **CI required** instead. Branch protection was not enabled at task creation and must be configured by a repository administrator as a separate governance decision.

```text
          ┌─ quality / lint ─────────────────┐
          ├─ quality / typecheck ────────────┤
PR/main ──┼─ quality / build (full) ─────────┤
          ├─ unit tests ─────────────────────┤
          ├─ integration tests (PG + Redis) ─┤
          ├─ web-browser-e2e (1/3) ──────────┤
          ├─ web-browser-e2e (2/3) ──────────┤
          ├─ web-browser-e2e (3/3) ──────────┼─> merged Web report ─┐
          └─ admin-browser-e2e ──────────────┘                      ├─> CI required
                                                                   ┘
```

No test runner needs another quality check to pass. This is deliberate: a TypeScript error must not hide unrelated browser failures, and E2E is no longer stalled behind lint and unit tests. GitHub matrix strategies use `fail-fast: false`. Playwright Web shards use the same configuration and all configured browser projects; the three `--shard=N/3` invocations together cover each selected test once. Each shard owns its own runner, PostgreSQL and Redis containers and migrated/seeded test database. Admin E2E also has isolated services. The Web suite intentionally retains `workers: 1` and `fullyParallel: false`; we improve host-level parallelism without changing in-file test isolation semantics.

## Setup, build and cache boundaries

The local composite action `.github/actions/setup-workspace/action.yml` pins pnpm 10.17.0 and reads Node 24 from `.node-version`. `actions/setup-node` caches the pnpm content-addressed store keyed by `pnpm-lock.yaml`; `actions/cache` additionally restores the local `.turbo` task cache. Turborepo archives are scoped by CI lane, runner OS, Node/pnpm/Turbo configuration and exact workflow SHA, with a lane-specific restore prefix for unchanged tasks from earlier commits.

This cache is deliberately **not a test-result cache**. Root `test`, `test:integration` and `test:e2e` are explicitly `cache: false`, so every required test process executes on every PR and `main` run. The cache may reuse deterministic lint/typecheck/build work whose Turborepo input hash is unchanged. `.node-version` is a global dependency and build-time public environment variables remain declared in `turbo.json`. Never cache mutable databases, Playwright browser installs, secrets, or production credentials.

The previous `lint -> ^build` dependency was removed after auditing the root ESLint configuration: it lint-checks source files directly, ignores `dist`/Next/generated output, and has no type-aware parser configuration that requires compiled workspace dependencies. `typecheck` retains `^build` because workspace packages publish compiled declarations/exports and removing that prerequisite would change the typecheck contract.

The independent `quality / build` job still runs the **full** `pnpm build`. Browser runs start API/Worker through `tsx` and Next applications through `next dev`; they build only the transitive workspace libraries needed by those processes. Re-check these filters if E2E startup commands or workspace dependency declarations change.

Official maintained Node24-capable GitHub Actions releases are used: checkout v7, setup-node v7, cache v6, upload-artifact v6, download-artifact v8 and pnpm/action-setup v6. The workflow uses `permissions: contents: read` and `persist-credentials: false`; it never uses `pull_request_target`, write tokens, production URLs or secrets. Untrusted PR code executes in CI, so privileged credentials must never be added to these jobs.

## Failure diagnostics

CI forbids committed `test.only` through Playwright's `forbidOnly`. Web/API/Worker/Admin web-server processes have explicit names and pipe stdout/stderr into the job log in CI, so startup failures are visible without reproducing locally. Shared E2E helpers expose high-value setup actions such as account creation, verification, sign-in, PRO entitlement and Direct Chat device registration as named `test.step` entries without placing user data in step titles.

Each E2E run produces GitHub annotations, JSON, HTML and Playwright blob reports. Traces use `retain-on-failure`, preserving the failing attempt rather than only a retry. Screenshots remain failure-only. Evidence upload runs even when an earlier browser preparation/test step fails; missing files warn instead of hiding the original failure.

Web shards upload independent artifacts, then `web-browser-e2e merged report` downloads all three and requires exactly three blob archives before running `playwright merge-reports --reporter html`. The merged HTML report is uploaded separately and the merge job itself is part of `CI required`, so broken report plumbing cannot silently rot. The JSON parser `scripts/ci-playwright-summary.mjs` still publishes per-shard counts, duration, failures and flaky retries to the Step Summary.

To debug: inspect the first failing preparation step or Playwright annotation, inspect named web-server output, then download the shard artifact or merged Web report. Open `playwright-report/index.html`; inspect a `trace.zip` with `pnpm exec playwright show-trace path/to/trace.zip`. Never increase timeouts or disable assertions merely to turn CI green.

## Local reproduction

Start isolated PostgreSQL/Redis (`docker compose up -d`), configure the `.env` values documented in `.env.example`, then:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm --filter @vimla/database ensure-test-db
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @vimla/billing seed
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @vimla/ai seed
pnpm --filter @vimla/web exec playwright install --with-deps chromium webkit firefox
pnpm --filter @vimla/web test:e2e --shard=1/3
pnpm --filter @vimla/web test:e2e --shard=2/3
pnpm --filter @vimla/web test:e2e --shard=3/3
pnpm --filter @vimla/admin-web test:e2e
```

The Web shard commands above are **illustrative sequential local execution**. In CI they run on different hosts with separate databases, so do not execute shards simultaneously against one local database without explicit isolation. `pnpm codex:validate` remains a sequential developer command; this task changes only CI scheduling, not its coverage.

## Metrics, limitations and rollout

Historical successful workflow median before #147 was **17m53s**. The first complete parallel candidate, [CI #2082](https://github.com/Designersss/vimlaAI/actions/runs/37435705644), completed in **8m11s**, a 54.2% wall-time reduction versus that median while preserving 97 configured Web browser cases. Its two Web shards were imbalanced at 8m00s versus 5m52s, which motivates the measured three-shard experiment without enabling in-file parallelism.

Operational SLOs for this pipeline are: first meaningful quality feedback around **2 minutes or less** under normal runner availability, and complete required CI around **8-10 minutes** for a representative green run. Treat these as engineering targets, not guarantees: GitHub queueing and cold dependency downloads vary. Compare medians across several exact-HEAD runs and record per-job setup/execution duration, cache hit rates, flaky attempts and aggregate runner-minutes.

Known tradeoffs: extra isolated runners consume more aggregate compute in exchange for lower critical-path latency; Playwright browser installation and DB setup repeat per shard. More shards are not automatically better. Keep three shards only if measured wall time/variance improves without unacceptable runner-minute growth. Path-based/affected-only skipping remains intentionally out of scope until Vimla's dependency graph and required-check semantics can prove that skipping cannot hide regressions. Full cross-browser expansion beyond the existing targeted Firefox/WebKit projects should be a separately designed nightly/release suite, not silently substituted for PR coverage.
