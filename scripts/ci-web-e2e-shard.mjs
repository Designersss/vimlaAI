#!/usr/bin/env node
// Deterministically balances Web Playwright spec files across CI hosts without
// enabling Playwright's in-file parallel mode. Every discovered *.spec.ts file
// is assigned exactly once. New files are automatically included with a
// conservative default weight until measured data is added below.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const [indexRaw, totalRaw] = process.argv.slice(2);
const shardIndex = Number(indexRaw);
const shardTotal = Number(totalRaw);

if (
  !Number.isInteger(shardIndex) ||
  !Number.isInteger(shardTotal) ||
  shardTotal < 1 ||
  shardIndex < 1 ||
  shardIndex > shardTotal
) {
  console.error("Usage: node scripts/ci-web-e2e-shard.mjs <index> <total>");
  process.exit(2);
}

const repoRoot = resolve(import.meta.dirname, "..");
const e2eDir = resolve(repoRoot, "apps/web/e2e");

function discoverSpecs(directory, prefix = "") {
  const discovered = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      discovered.push(...discoverSpecs(resolve(directory, entry.name), relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      discovered.push(relativePath);
    }
  }
  return discovered;
}

const specs = discoverSpecs(e2eDir).sort();

if (specs.length === 0) {
  console.error("No Web Playwright spec files were discovered.");
  process.exit(1);
}

// Seed weights are seconds of Playwright execution observed on CI #2083.
// They are hints for longest-processing-time balancing, not pass/fail data.
const measuredSeconds = new Map([
  ["direct-chats.spec.ts", 101.5],
  ["direct-chats-cross-browser.spec.ts", 63.9],
  ["e2ee-h02-storage-regression.spec.ts", 53.0],
  ["unified-inbox.spec.ts", 52.8],
  ["work-layout.spec.ts", 36.0],
  ["responsive-cross-browser.spec.ts", 30.8],
  ["master-detail.spec.ts", 28.6],
  ["responsive.spec.ts", 27.1],
  ["notifications.spec.ts", 25.6],
  ["e2ee-h02-security.spec.ts", 24.8],
  ["workspace.spec.ts", 23.4],
  ["projects.spec.ts", 21.9],
  ["web-production-readiness.spec.ts", 19.3],
  ["chat.spec.ts", 18.5],
  ["settings-layout.spec.ts", 15.6],
  ["chat-design-system.spec.ts", 14.5],
  ["billing.spec.ts", 13.2],
  ["public-profile.spec.ts", 13.0],
  ["locale-errors.spec.ts", 12.5],
  ["password-reset.spec.ts", 12.1],
  ["projects-design-system.spec.ts", 12.1],
  ["workflow-ui.spec.ts", 12.0],
  ["auth-design-system.spec.ts", 11.4],
  ["ui-v2.spec.ts", 11.1],
  ["app-shell-navigation.spec.ts", 10.6],
  ["operator.spec.ts", 9.1],
  ["registration.spec.ts", 8.7],
  ["contextual-sidebar-navigation.spec.ts", 8.4],
  ["settings-design-system.spec.ts", 8.1],
  ["ui-state-lab.spec.ts", 6.1],
  ["sessions.spec.ts", 5.9],
  ["landing-design-system.spec.ts", 5.1],
  ["visual.spec.ts", 0.1],
]);

const DEFAULT_SECONDS = 30;
const bins = Array.from({ length: shardTotal }, (_, index) => ({
  index,
  seconds: 0,
  files: [],
}));

const weighted = specs
  .map((file) => ({
    file,
    seconds: measuredSeconds.get(file) ?? DEFAULT_SECONDS,
  }))
  .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));

for (const item of weighted) {
  bins.sort((a, b) => a.seconds - b.seconds || a.index - b.index);
  const target = bins[0];
  target.files.push(item.file);
  target.seconds += item.seconds;
}

bins.sort((a, b) => a.index - b.index);

const selected = bins[shardIndex - 1];
if (!selected || selected.files.length === 0) {
  console.error(`Shard ${shardIndex}/${shardTotal} received no spec files.`);
  process.exit(1);
}

const assigned = new Set(bins.flatMap((bin) => bin.files));
if (assigned.size !== specs.length) {
  console.error("Weighted sharding failed to assign every spec exactly once.");
  process.exit(1);
}

console.log(
  `Web E2E weighted shard ${shardIndex}/${shardTotal}: ${selected.files.length} files, estimated ${selected.seconds.toFixed(1)}s`,
);
for (const file of selected.files.sort()) {
  const weight = measuredSeconds.get(file) ?? DEFAULT_SECONDS;
  console.log(`  - ${file} (${weight.toFixed(1)}s seed)`);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpm,
  [
    "exec",
    "playwright",
    "test",
    ...selected.files.map((file) => `e2e/${file}`),
  ],
  {
    cwd: resolve(repoRoot, "apps/web"),
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error("Failed to start Web Playwright shard:", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Web Playwright shard terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
