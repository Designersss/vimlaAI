import { describe, expect, it } from "vitest";
import {
  DIRECT_HISTORY_CATCHUP_MAX_PAGES,
  assertDirectHistoryCatchupBudget,
  DEEP_HISTORY_BOOTSTRAP_MAX_PAGES,
  pageUnlocksHistoryBootstrap,
  shouldContinueDeepHistoryBootstrap,
} from "./direct-chat-history-bootstrap.js";

describe("Direct Chat realtime E2EE catch-up safety bounds", () => {
  it("permits exactly the bounded number of history fetches", () => {
    for (let fetched = 0; fetched < DIRECT_HISTORY_CATCHUP_MAX_PAGES; fetched += 1) {
      expect(() => assertDirectHistoryCatchupBudget(fetched)).not.toThrow();
    }
    expect(() => assertDirectHistoryCatchupBudget(DIRECT_HISTORY_CATCHUP_MAX_PAGES))
      .toThrow("Direct E2EE history catch-up exceeds the safe page budget");
  });

  it("rejects corrupted and overflowing counters without attempting more fetches", () => {
    for (const pages of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertDirectHistoryCatchupBudget(pages)).toThrow();
    }
  });
});

describe("Direct Chat deep-history bootstrap bounds", () => {
  it("allows backfill before the page budget is exhausted", () => {
    expect(
      shouldContinueDeepHistoryBootstrap({
        cursor: "cursor",
        missingSenderCount: 1,
        backfillPages:
          DEEP_HISTORY_BOOTSTRAP_MAX_PAGES - 1,
      }),
    ).toBe(true);
  });

  it("stops exactly at the page budget", () => {
    expect(
      shouldContinueDeepHistoryBootstrap({
        cursor: "cursor",
        missingSenderCount: 1,
        backfillPages:
          DEEP_HISTORY_BOOTSTRAP_MAX_PAGES,
      }),
    ).toBe(false);
  });

  it("recognizes a manually loaded X3DH page for a missing sender", () => {
    expect(
      pageUnlocksHistoryBootstrap({
        missingSenderDeviceIds: new Set(["peer-old"]),
        messages: [
          {
            senderDeviceId: "peer-old",
            envelope: { x3dhInit: { version: 1 } },
          },
        ],
      }),
    ).toBe(true);
    expect(
      pageUnlocksHistoryBootstrap({
        missingSenderDeviceIds: new Set(["peer-old"]),
        messages: [
          {
            senderDeviceId: "peer-other",
            envelope: { x3dhInit: { version: 1 } },
          },
          {
            senderDeviceId: "peer-old",
            envelope: { x3dhInit: null },
          },
        ],
      }),
    ).toBe(false);
  });

  it("stops without a cursor or missing sender", () => {
    expect(
      shouldContinueDeepHistoryBootstrap({
        cursor: null,
        missingSenderCount: 1,
        backfillPages: 0,
      }),
    ).toBe(false);
    expect(
      shouldContinueDeepHistoryBootstrap({
        cursor: "cursor",
        missingSenderCount: 0,
        backfillPages: 0,
      }),
    ).toBe(false);
  });
});
