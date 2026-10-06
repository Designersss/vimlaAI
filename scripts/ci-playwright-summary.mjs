#!/usr/bin/env node
// Summarizes the actual Playwright JSON reporter, including flaky retries.
// A missing/malformed report is a CI diagnostics failure, not a silent success.
import { appendFileSync, readFileSync } from "node:fs";

const [reportFile, label = "Browser E2E"] = process.argv.slice(2);
if (!reportFile) {
  console.error("Usage: node scripts/ci-playwright-summary.mjs <report.json> [label]");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportFile, "utf8"));
} catch (error) {
  console.error(`Cannot read Playwright report at ${reportFile}:`, error);
  process.exit(1);
}

const tests = [];
function visit(suite, parents = []) {
  const path = [...parents, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      tests.push({
        name: [...path, spec.title].join(" › "),
        file: spec.file || suite.file || "unknown",
        line: spec.line,
        project: test.projectName || "default",
        status: test.status,
        attempts: (test.results ?? []).length,
        errors: (test.results ?? []).flatMap((result) => result.errors ?? []),
      });
    }
  }
  for (const child of suite.suites ?? []) visit(child, path);
}
for (const suite of report.suites ?? []) visit(suite);

const failed = tests.filter((test) => test.status === "unexpected" || test.status === "interrupted");
const flaky = tests.filter((test) => test.status === "flaky");
const stats = report.stats ?? {};
const counts = [
  ["Passed", stats.expected ?? tests.filter((test) => test.status === "expected").length],
  ["Failed", stats.unexpected ?? failed.length],
  ["Flaky", stats.flaky ?? flaky.length],
  ["Skipped", stats.skipped ?? tests.filter((test) => test.status === "skipped").length],
];
const safe = (value) => String(value).replace(/[\r\n|]/g, " ").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 220);
const lines = [
  `### ${safe(label)} — Playwright report`,
  "",
  `Duration: ${((stats.duration ?? 0) / 1000).toFixed(1)}s. Cases: ${tests.length} (including browser projects).`,
  "",
  "| Result | Count |",
  "| --- | ---: |",
  ...counts.map(([name, count]) => `| ${name} | ${count} |`),
  "",
];

function details(heading, cases) {
  if (!cases.length) return;
  lines.push(`#### ${heading}`, "", "| Project | Test (source) | Attempts | Error |", "| --- | --- | ---: | --- |");
  for (const test of cases.slice(0, 20)) {
    const error = test.errors
      .map((item) => item.message || item.value || "")
      .filter(Boolean)
      .at(-1) ?? "";
    const firstLine = String(error).split("\n").find((line) => line.trim()) ?? "";
    lines.push(`| ${safe(test.project)} | ${safe(test.name)} (\`${safe(test.file)}:${test.line ?? "?"}\`) | ${test.attempts} | ${safe(firstLine)} |`);
  }
  if (cases.length > 20) lines.push("", `And ${cases.length - 20} more; see the HTML report artifact.`);
  lines.push("");
}
details("Failures", failed);
details("Flaky tests (passed only after retry)", flaky);
lines.push("Full HTML report, trace.zip, screenshots and JSON are attached to this workflow run as an artifact.", "");

const markdown = lines.join("\n") + "\n";
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
