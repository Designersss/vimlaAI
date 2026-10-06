# CI pipeline

Issue: [#147](https://github.com/Designersss/vimlaAI/issues/147). Workflow: `.github/workflows/ci.yml`.

## Principles

The **same complete coverage** runs for every pull request and every `main` push; we do not skip checks based on changed paths. All jobs check out the event's exact SHA (for PRs GitHub's synthetic merge ref), use frozen pnpm dependency resolution, and operate on fresh runners. `CI required` aggregates all results, treating failed, skipped, or cancelled constituent jobs as red. Do not require the old `lint-typecheck-test-build` check in branch-protection rules after migration; require **CI required** instead. Branch protection was not enabled at task creation and must be configured by a repository administrator as a separate governance decision.

```text
          ┌─ quality / lint ────────────────┐
          ├─ quality / typecheck ───────────┤
PR/main ──┼─ quality / build (full) ────────┤
          ├─ unit tests ────────────────────┤
          ├─ integration tests (PG + Redis) ├──> CI required
          ├─ web-browser-e2e (1/2) ─────────┤
          ├─ web-browser-e2e (2/2) ─────────┤
          └─ admin-browser-e2e ─────────────┘
```

No test runner needs another check to pass. This is deliberate: a TypeScript error must not hide unrelated browser failures, and E2E is no longer stalled behind lint and unit tests. GitHub's matrix strategy uses `fail-fast: false`. Playwright Web shards use the same configuration and all configured browser projects; `--shard=1/2` and `--shard=2/2` together cover each selected test once. Each shard owns its own runner, PostgreSQL and Redis containers and migrated/seeded test database: sharing these between shards would cause flaky, non-reproducible state races. Admin E2E also has isolated services. The Web suite intentionally retains `workers: 1` per shard to avoid changing in-process test isolation.

## Setup, build and cache boundaries

The local composite action `.github/actions/setup-workspace/action.yml` pins pnpm 10.17.0 and reads Node 24 from `.node-version`. `actions/setup-node` caches the **pnpm content-addressed store** keyed by `pnpm-lock.yaml`; it does not cache `node_modules`, generated Prisma client, mutable test databases, Playwright browser directories or Next build outputs. Dependency integrity is checked on every job by `pnpm install --frozen-lockfile`.

The independent `quality / build` job runs the **full** `pnpm build`. Browser runs start the API/Worker through `tsx` and the Next applications through `next dev`. They need compiled `@vimla/*` workspace libraries but do not need production builds of the apps. Thus Web E2E invokes Turborepo with `@vimla/web^...`, `@vimla/api^...` and `@vimla/worker^...` filters (the transitive dependencies, excluding the app packages); Admin E2E uses `@vimla/admin-web^...` and `@vimla/api^...`. This preserves package build prerequisites while avoiding duplicate full app compilation. Re-check these filters if the E2E startup commands or workspace dependency declarations change.

Official maintained Node24-capable GitHub Actions releases are used: checkout v7, setup-node v7, upload-artifact v6 and pnpm/action-setup v6. Keep them updated and review third-party changes. The workflow uses `permissions: contents: read` and `persist-credentials: false`; it never uses `pull_request_target`, write tokens, production URLs or secrets. The hardcoded credentials are for runner-local disposable containers only. Untrusted PR code does execute in CI, as is inherent to tests; therefore do **not** add secrets or privileged permissions to these jobs. CI cache is dependency-store-only, not generated code or tests.

## Failure diagnostics

Every E2E shard produces GitHub annotations, console logs, and a JSON + HTML Playwright report. The JSON parser `scripts/ci-playwright-summary.mjs` produces a Step Summary with counts, duration, failures, flaky retries, project and source location. `actions/upload-artifact` uploads the browser's `test-results` (screenshots, error contexts, retry traces, JSON) and `playwright-report` (HTML) even if Playwright exits non-zero; artifacts have a 7-day retention. Artifacts use unique shard/attempt names and cannot overwrite one another.

To debug: open the failed named job, inspect the first failing preparation step or its annotated test, then download that shard's artifact from the workflow run. Unzip and open `playwright-report/index.html`; inspect `test-results/**/trace.zip` via `pnpm exec playwright show-trace path/to/trace.zip`. Green-on-retry tests are explicitly marked **flaky**, not silently hidden. For an E2E failure, first establish whether the bug is application logic, test setup or infrastructure; never just increase timeouts or disable assertions to turn CI green.

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
pnpm --filter @vimla/web test:e2e --shard=1/2
pnpm --filter @vimla/web test:e2e --shard=2/2
pnpm --filter @vimla/admin-web test:e2e
```

The Web shard commands above are **illustrative sequential local execution**. In CI they run on different hosts with separate databases, so do not execute shards simultaneously against one local database without explicit isolation. `pnpm codex:validate` remains a sequential developer command; this task changes only CI scheduling, not its coverage.

## Metrics, limitations and rollout

Baseline: [CI #2080](https://github.com/Designersss/vimlaAI/actions/runs/37395219264) completed in 17m53s on 2026-10-06 (5m40s quality, followed by 12m07s Web E2E). One bad run is not a statistical baseline; compare several green runs, same class of commit, on the exact PR HEAD after rollout. Measure run created/completed timestamps, per-job setup and execution durations, queueing, cache hit rates, flaky attempts and total runner-minutes. Record before/after median (not just best run), and watch for increased resource use from concurrent jobs. No speedup is claimed until measured.

Known tradeoffs: extra isolated runners use more aggregate compute in exchange for lower critical-path latency; Playwright browser installation and DB setup repeat per shard. Over-sharding incurs setup overhead and risks imbalanced work. The Web suite is split only into two shards initially; adjust only with measured results. Dependency caches are shared safely by lockfile but not all packages/build outputs are cross-job cached. The required gate's job name is stable across matrix shape changes.
