import { describe, expect, it } from "vitest";
import {
  DEEP_HISTORY_BOOTSTRAP_MAX_PAGES,
  shouldContinueDeepHistoryBootstrap,
} from "./history-bootstrap";

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
