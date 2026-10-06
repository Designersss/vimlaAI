#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  DEFAULT_WEB_E2E_SECONDS,
  WEB_E2E_MEASURED_SECONDS,
  WEB_E2E_SUITES,
} from "./ci-web-e2e-suites.mjs";

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

function partitionSuite(suite) {
  const bins = Array.from({ length: suite.shards }, (_, index) => ({
    index,
    seconds: 0,
    files: [],
  }));

  const weighted = suite.files
    .map((file) => ({
      file,
      seconds: WEB_E2E_MEASURED_SECONDS.get(file) ?? DEFAULT_WEB_E2E_SECONDS,
    }))
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));

  for (const item of weighted) {
    bins.sort((a, b) => a.seconds - b.seconds || a.index - b.index);
    const target = bins[0];
    target.files.push(item.file);
    target.seconds += item.seconds;
  }

  return bins.sort((a, b) => a.index - b.index);
}

function expectedLanes() {
  return WEB_E2E_SUITES.flatMap((suite) =>
    partitionSuite(suite).map((lane) => ({
      suite,
      lane,
      reportName: `report-${suite.id}-${lane.index + 1}.zip`,
    })),
  );
}

function validateContract() {
  const errors = [];
  const discovered = discoverSpecs(e2eDir).sort();

  if (discovered.length === 0) {
    errors.push("No Web Playwright spec files were discovered.");
  }

  const suiteIds = new Set();
  const assignments = new Map();

  for (const suite of WEB_E2E_SUITES) {
    if (!suite.id || suiteIds.has(suite.id)) {
      errors.push(`Suite id must be non-empty and unique: ${suite.id || "<empty>"}`);
    }
    suiteIds.add(suite.id);

    if (!Number.isInteger(suite.shards) || suite.shards < 1) {
      errors.push(`Suite ${suite.id} has invalid shard count ${suite.shards}.`);
    }
    if (!Array.isArray(suite.files) || suite.files.length === 0) {
      errors.push(`Suite ${suite.id} has no spec files.`);
      continue;
    }
    if (suite.shards > suite.files.length) {
      errors.push(
        `Suite ${suite.id} has ${suite.shards} shards for only ${suite.files.length} files.`,
      );
    }

    const localFiles = new Set();
    for (const file of suite.files) {
      if (localFiles.has(file)) {
        errors.push(`Suite ${suite.id} lists ${file} more than once.`);
      }
      localFiles.add(file);
      const owners = assignments.get(file) ?? [];
      owners.push(suite.id);
      assignments.set(file, owners);
    }
  }

  const discoveredSet = new Set(discovered);
  const assignedSet = new Set(assignments.keys());

  for (const file of discovered) {
    const owners = assignments.get(file) ?? [];
    if (owners.length === 0) {
      errors.push(`Unassigned Web E2E spec: ${file}`);
    } else if (owners.length > 1) {
      errors.push(`Web E2E spec ${file} belongs to multiple suites: ${owners.join(", ")}`);
    }
  }

  for (const file of assignedSet) {
    if (!discoveredSet.has(file)) {
      errors.push(`Suite manifest references missing Web E2E spec: ${file}`);
    }
  }

  for (const suite of WEB_E2E_SUITES) {
    const bins = partitionSuite(suite);
    if (bins.some((lane) => lane.files.length === 0)) {
      errors.push(`Suite ${suite.id} produced an empty shard.`);
    }
  }

  if (errors.length > 0) {
    console.error("Web E2E suite contract failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Web E2E suite contract valid: ${discovered.length} specs, ${WEB_E2E_SUITES.length} suites, ${expectedLanes().length} CI lanes.`,
  );
  for (const suite of WEB_E2E_SUITES) {
    const bins = partitionSuite(suite);
    const totalSeconds = bins.reduce((sum, lane) => sum + lane.seconds, 0);
    console.log(
      `  - ${suite.id}: ${suite.files.length} files, ${suite.shards} shard(s), estimated ${totalSeconds.toFixed(1)}s total`,
    );
    for (const lane of bins) {
      console.log(
        `      lane ${lane.index + 1}/${suite.shards}: ${lane.files.length} files, estimated ${lane.seconds.toFixed(1)}s`,
      );
    }
  }
}

function verifyReports(directory) {
  validateContract();
  const expected = expectedLanes().map((lane) => lane.reportName).sort();
  const actual = readdirSync(directory)
    .filter((name) => name.endsWith(".zip"))
    .sort();

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));

  if (
    actual.length !== expected.length ||
    missing.length > 0 ||
    unexpected.length > 0
  ) {
    console.error("Web E2E blob report contract failed.");
    console.error(`Expected: ${expected.join(", ")}`);
    console.error(`Actual:   ${actual.join(", ")}`);
    if (missing.length > 0) {
      console.error(`Missing:  ${missing.join(", ")}`);
    }
    if (unexpected.length > 0) {
      console.error(`Unexpected: ${unexpected.join(", ")}`);
    }
    process.exit(1);
  }

  console.log(`Verified ${actual.length} semantic Web E2E blob reports.`);
}

const args = process.argv.slice(2);

if (args[0] === "--validate") {
  validateContract();
  process.exit(0);
}

if (args[0] === "--verify-reports") {
  const directory = args[1];
  if (!directory) {
    console.error(
      "Usage: node scripts/ci-web-e2e-suite.mjs --verify-reports <directory>",
    );
    process.exit(2);
  }
  verifyReports(resolve(repoRoot, directory));
  process.exit(0);
}

validateContract();

const [suiteId, shardRaw] = args;
const suite = WEB_E2E_SUITES.find((candidate) => candidate.id === suiteId);
const shardIndex = Number(shardRaw);

if (!suite || !Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > suite.shards) {
  console.error("Usage: node scripts/ci-web-e2e-suite.mjs <suite-id> <shard-index>");
  console.error(
    `Valid suites: ${WEB_E2E_SUITES.map((candidate) => `${candidate.id} (1-${candidate.shards})`).join(", ")}`,
  );
  process.exit(2);
}

const selected = partitionSuite(suite)[shardIndex - 1];

console.log(
  `Web E2E / ${suite.label} / lane ${shardIndex}/${suite.shards}: ${selected.files.length} files, estimated ${selected.seconds.toFixed(1)}s`,
);
for (const file of [...selected.files].sort()) {
  const seconds = WEB_E2E_MEASURED_SECONDS.get(file) ?? DEFAULT_WEB_E2E_SECONDS;
  console.log(`  - ${file} (${seconds.toFixed(1)}s seed)`);
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
  console.error("Failed to start Web Playwright suite:", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Web Playwright suite terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
