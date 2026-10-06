# CI pipeline

Issue: [#147](https://github.com/Designersss/vimlaAI/issues/147). Workflow: `.github/workflows/ci.yml`.

## Principles

The **same complete coverage** runs for every pull request and every `main` push; we do not skip checks based on changed paths. All jobs check out the event's exact SHA (for PRs GitHub's synthetic merge ref), use frozen pnpm dependency resolution, and operate on fresh runners. `CI required` aggregates all results, treating failed, skipped, or cancelled constituent jobs as red. Do not require the old `lint-typecheck-test-build` check in branch-protection rules after migration; require **CI required** instead. Branch protection was not enabled at task creation and must be configured by a repository administrator as a separate governance decision.

```text
          ┌─ quality / lint ───────────────────────────────┐
          ├─ quality / typecheck ──────────────────────────┤
          ├─ quality / build (full) ───────────────────────┤
PR/main ──┼─ unit tests ───────────────────────────────────┤
          ├─ integration tests (PG + Redis) ───────────────┤
          ├─ web-browser-e2e / suite contract ─────────────┤
          ├─ web-browser-e2e / direct-chats-e2ee (1/2) ───┤
          ├─ web-browser-e2e / direct-chats-e2ee (2/2) ───┤
          ├─ web-browser-e2e / messaging-ai ───────────────┤
          ├─ web-browser-e2e / identity-account ───────────┤
          ├─ web-browser-e2e / work-projects ──────────────┤
          ├─ web-browser-e2e / ui-release ─────────────────┼─> merged Web report ─┐
          └─ admin-browser-e2e ─────────────────────────────┘                      ├─> CI required
                                                                                  ┘
```

No test runner needs another quality check to pass. This is deliberate: a TypeScript error must not hide unrelated browser failures, and E2E is not stalled behind lint or unit tests. GitHub matrix strategies use `fail-fast: false`.

## Semantic Web E2E ownership

Web E2E is organized by product domain instead of anonymous global shards. `scripts/ci-web-e2e-suites.mjs` is the single source of truth for suite ownership, labels, shard counts and measured duration seeds:

- `direct-chats-e2ee` — Direct Chats and E2EE regressions; internally split across two weighted lanes because this domain is materially heavier than the others.
- `messaging-ai` — unified inbox, AI chat, chat design system, master-detail and messaging navigation.
- `identity-account` — registration, reset, sessions, localization/errors, public profiles, billing and auth UI.
- `work-projects` — Work, Projects, workflows, operator and notifications.
- `ui-release` — responsive/cross-browser UI, settings/UI system and production-readiness surfaces.

The fail-closed contract in `scripts/ci-web-e2e-suite.mjs` recursively discovers every `*.spec.ts` under `apps/web/e2e` and requires the manifest to be an exact partition: every discovered spec must belong to **exactly one** semantic suite, no manifest entry may reference a missing file, suite IDs must be unique, and every configured shard must receive at least one file. A newly added spec therefore makes CI red until its domain ownership is explicit; it can never silently fall out of coverage.

Within a multi-shard domain, files are assigned with deterministic longest-processing-time balancing using measured CI duration hints. Unknown-but-assigned files use a conservative 30-second seed until remeasured. This preserves semantic ownership while still balancing heavy domains. The Web suite intentionally retains `workers: 1` and `fullyParallel: false`; host-level partitioning never opts tests into a different in-file isolation model.

Each semantic lane owns its own runner, PostgreSQL and Redis containers and migrated/seeded test database. Admin E2E also has isolated services. All configured Playwright projects are preserved, including the targeted Firefox/WebKit coverage selected by the existing `testMatch` rules. Web lanes install Chromium by default and add WebKit/Firefox only when their selected file set contains a `*-cross-browser.spec.ts` target. This changes setup cost only: if Playwright schedules a project whose engine is not installed, the lane fails rather than silently skipping coverage.

## Setup, build and cache boundaries

The local composite action `.github/actions/setup-workspace/action.yml` pins pnpm 10.17.0 and reads Node 24 from `.node-version`. `actions/setup-node` caches the pnpm content-addressed store keyed by `pnpm-lock.yaml`; `actions/cache` additionally restores the local `.turbo` task cache. Turborepo archives are scoped by CI lane, runner OS, Node/pnpm/Turbo configuration and exact checked-out source SHA, with a lane-specific restore prefix for unchanged tasks from earlier commits.

This cache is deliberately **not a test-result cache**. Root `test`, `test:integration` and `test:e2e` are explicitly `cache: false`, so every required test process executes on every PR and `main` run. The cache may reuse deterministic lint/typecheck/build work whose Turborepo input hash is unchanged. `.node-version` is a global dependency and build-time public environment variables remain declared in `turbo.json`. Never cache mutable databases, Playwright browser installs, secrets, or production credentials.

The previous `lint -> ^build` dependency was removed after auditing the root ESLint configuration: it lint-checks source files directly, ignores `dist`/Next/generated output, and has no type-aware parser configuration that requires compiled workspace dependencies. `typecheck` retains `^build` because workspace packages publish compiled declarations/exports and removing that prerequisite would change the typecheck contract.

The independent `quality / build` job still runs the **full** `pnpm build`. Browser runs start API/Worker through `tsx` and Next applications through `next dev`; they build only the transitive workspace libraries needed by those processes. Re-check these filters if E2E startup commands or workspace dependency declarations change.

The CI authentication key is test-only and derived from the public `github.sha`; no privileged secret is required. Official maintained Node24-capable GitHub Actions releases are used: checkout v7, setup-node v7, cache v6, upload-artifact v6, download-artifact v8 and pnpm/action-setup v6. The workflow uses `permissions: contents: read` and `persist-credentials: false`; it never uses `pull_request_target`, write tokens, production URLs or production credentials. Untrusted PR code executes in CI, so privileged credentials must never be added to these jobs.

## Failure diagnostics

CI forbids committed `test.only` through Playwright's `forbidOnly`. Web/API/Worker/Admin web-server processes have explicit names and pipe stdout/stderr into the job log in CI, so startup failures are visible without reproducing locally. Shared E2E helpers expose high-value setup actions such as account creation, verification, sign-in, PRO entitlement and Direct Chat device registration as named `test.step` entries without placing user data in step titles.

Each E2E lane produces GitHub annotations, JSON, HTML and Playwright blob reports. Traces use `retain-on-failure`, preserving the failing attempt rather than only a retry. Screenshots remain failure-only. Evidence upload runs even when an earlier browser preparation/test step fails; missing files warn instead of hiding the original failure.

Blob names encode semantic suite and lane. The merged-report job downloads only artifacts from the current `github.run_attempt`, copies blob archives into one directory, and asks the same suite contract to verify the **exact expected report set** before merging. This catches workflow/manifest drift as well as missing lanes: changing shard counts or suites without updating the matrix cannot silently produce a partial green report. The merged HTML report is uploaded separately and the merge job itself is part of `CI required`.

The JSON parser `scripts/ci-playwright-summary.mjs` publishes per-lane counts, duration, failures and flaky retries to the Step Summary. A failing job therefore identifies a product domain such as `work-projects` or `direct-chats-e2ee (2/2)`, rather than only an anonymous shard number.

To debug: inspect the first failing preparation step or Playwright annotation, inspect named web-server output, then download the lane artifact or merged Web report. Open `playwright-report/index.html`; inspect a `trace.zip` with `pnpm exec playwright show-trace path/to/trace.zip`. Never increase timeouts or disable assertions merely to turn CI green.

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
node scripts/ci-web-e2e-suite.mjs --validate
node scripts/ci-web-e2e-suite.mjs --browsers messaging-ai 1
pnpm --filter @vimla/web exec playwright install --with-deps chromium webkit firefox

node scripts/ci-web-e2e-suite.mjs --validate
node scripts/ci-web-e2e-suite.mjs direct-chats-e2ee 1
node scripts/ci-web-e2e-suite.mjs direct-chats-e2ee 2
node scripts/ci-web-e2e-suite.mjs messaging-ai 1
node scripts/ci-web-e2e-suite.mjs identity-account 1
node scripts/ci-web-e2e-suite.mjs work-projects 1
node scripts/ci-web-e2e-suite.mjs ui-release 1

pnpm --filter @vimla/admin-web test:e2e
```

The Web commands above use the exact CI partitioner but are **illustrative sequential local execution**. In CI the lanes run on different hosts with separate databases, so do not execute them simultaneously against one local database without explicit isolation. `pnpm codex:validate` remains a sequential developer command; this task changes only CI scheduling, not its coverage.

## Metrics, limitations and rollout

Historical successful workflow median before #147 was **17m53s**. The previous three-way weighted-shard candidate on exact HEAD `dea0aaea…` completed in **7m22s** on CI #2086, with Web Playwright execution at 245.6s / 261.1s / 255.5s and the same 97 configured Web cases.

The semantic topology is based on the same measured file weights. Its estimated Playwright-only lane weights before fresh measurement are approximately:

- `direct-chats-e2ee (1/2)`: 126.3s
- `direct-chats-e2ee (2/2)`: 116.9s
- `messaging-ai`: 133.4s
- `identity-account`: 76.8s
- `work-projects`: 140.1s
- `ui-release`: 123.3s

These estimates are planning data, not performance claims. Validate the semantic topology with exact-HEAD CI and compare full wall time, lane variance, flaky attempts and aggregate runner-minutes against #2086 before changing shard counts again.

Operational SLOs remain: first meaningful quality feedback around **2 minutes or less** under normal runner availability, and complete required CI around **8-10 minutes or less** for a representative green run. Treat these as engineering targets, not guarantees: GitHub queueing and cold dependency downloads vary.

Known tradeoffs: six isolated semantic Web lanes repeat checkout/install/browser/DB setup more often than the previous three global shards, increasing aggregate compute in exchange for lower critical-path test time and much stronger diagnostic ownership. More lanes are not automatically better. Keep this topology only while measured wall time and diagnosability justify the runner-minute cost.

Path-based/affected-only skipping remains intentionally out of scope until Vimla's dependency graph and required-check semantics can prove that skipping cannot hide regressions. Full cross-browser expansion beyond the existing targeted Firefox/WebKit projects should be a separately designed nightly/release suite, not silently substituted for PR coverage.
