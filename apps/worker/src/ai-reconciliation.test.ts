import { describe, expect, it } from "vitest";
import {
  AI_RECONCILIATION_PRE_PROVIDER_STALE_MS,
  AI_RECONCILIATION_PROVIDER_GRACE_MS,
  aiReconciliationCutoffs,
} from "./ai-reconciliation-timing.js";

describe("AI reconciliation cutoffs", () => {
  it("derives provider eligibility from the configured timeout plus grace", () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    const providerTimeoutMs = 600_000;

    const cutoffs = aiReconciliationCutoffs(now, providerTimeoutMs);

    expect(cutoffs.preProvider.getTime()).toBe(
      now.getTime() - AI_RECONCILIATION_PRE_PROVIDER_STALE_MS,
    );
    expect(cutoffs.provider.getTime()).toBe(
      now.getTime() - providerTimeoutMs - AI_RECONCILIATION_PROVIDER_GRACE_MS,
    );
    expect(cutoffs.provider.getTime()).toBeLessThan(
      now.getTime() - providerTimeoutMs,
    );
  });
});
