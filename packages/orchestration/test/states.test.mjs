import assert from "node:assert/strict";
import test from "node:test";
import {
  INVOCATION_STATUSES,
  PLAN_STATUSES,
  isTerminalInvocationStatus,
  isTerminalPlanStatus,
} from "../dist/index.js";

test("keeps the execution plan state vocabulary stable", () => {
  assert.deepEqual(PLAN_STATUSES, [
    "PLANNING",
    "PLANNED",
    "RUNNING",
    "PARTIAL",
    "COMPLETED",
    "FAILED",
    "CANCELED",
  ]);
  assert.equal(isTerminalPlanStatus("PLANNING"), false);
  assert.equal(isTerminalPlanStatus("RUNNING"), false);
  assert.equal(isTerminalPlanStatus("PARTIAL"), true);
  assert.equal(isTerminalPlanStatus("COMPLETED"), true);
  assert.equal(isTerminalPlanStatus("FAILED"), true);
  assert.equal(isTerminalPlanStatus("CANCELED"), true);
});

test("keeps invocation readiness, approval and terminal states distinct", () => {
  assert.deepEqual(INVOCATION_STATUSES, [
    "PENDING",
    "READY",
    "RUNNING",
    "WAITING_APPROVAL",
    "COMPLETED",
    "FAILED",
    "SKIPPED",
    "CANCELED",
  ]);
  assert.equal(isTerminalInvocationStatus("PENDING"), false);
  assert.equal(isTerminalInvocationStatus("READY"), false);
  assert.equal(isTerminalInvocationStatus("RUNNING"), false);
  assert.equal(isTerminalInvocationStatus("WAITING_APPROVAL"), false);
  assert.equal(isTerminalInvocationStatus("COMPLETED"), true);
  assert.equal(isTerminalInvocationStatus("FAILED"), true);
  assert.equal(isTerminalInvocationStatus("SKIPPED"), true);
  assert.equal(isTerminalInvocationStatus("CANCELED"), true);
});
