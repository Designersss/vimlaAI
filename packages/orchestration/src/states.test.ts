import { describe, expect, it } from "vitest";
import {
  INVOCATION_STATUSES,
  PLAN_STATUSES,
  isTerminalInvocationStatus,
  isTerminalPlanStatus,
} from "./states.js";

describe("orchestration states", () => {
  it("keeps the execution plan state vocabulary stable", () => {
    expect(PLAN_STATUSES).toEqual([
      "PLANNING",
      "PLANNED",
      "RUNNING",
      "PARTIAL",
      "COMPLETED",
      "FAILED",
      "CANCELED",
    ]);
    expect(isTerminalPlanStatus("PLANNING")).toBe(false);
    expect(isTerminalPlanStatus("RUNNING")).toBe(false);
    expect(isTerminalPlanStatus("PARTIAL")).toBe(true);
    expect(isTerminalPlanStatus("COMPLETED")).toBe(true);
    expect(isTerminalPlanStatus("FAILED")).toBe(true);
    expect(isTerminalPlanStatus("CANCELED")).toBe(true);
  });

  it("keeps invocation readiness, approval and terminal states distinct", () => {
    expect(INVOCATION_STATUSES).toEqual([
      "PENDING",
      "READY",
      "RUNNING",
      "WAITING_APPROVAL",
      "COMPLETED",
      "FAILED",
      "SKIPPED",
      "CANCELED",
    ]);
    expect(isTerminalInvocationStatus("PENDING")).toBe(false);
    expect(isTerminalInvocationStatus("READY")).toBe(false);
    expect(isTerminalInvocationStatus("RUNNING")).toBe(false);
    expect(isTerminalInvocationStatus("WAITING_APPROVAL")).toBe(false);
    expect(isTerminalInvocationStatus("COMPLETED")).toBe(true);
    expect(isTerminalInvocationStatus("FAILED")).toBe(true);
    expect(isTerminalInvocationStatus("SKIPPED")).toBe(true);
    expect(isTerminalInvocationStatus("CANCELED")).toBe(true);
  });
});
