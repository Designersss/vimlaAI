import { describe, expect, it } from "vitest";
import {
  DIRECT_HISTORY_CATCHUP_MAX_PAGES,
  assertDirectHistoryCatchupBudget,
  assertDirectHistoryGapComplete,
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


const conversationId = "11111111-1111-4111-8111-111111111111";
function history(id: string, sequence: string, chat = conversationId) {
  return { id, conversationId: chat, sequence };
}
function reconciliation(
  fetchedMessages: ReturnType<typeof history>[],
  knownMessages = [history("known", "5")],
  requiredMessageIds: string[] = [],
  advertisedHeadSequence = "8",
) {
  return {
    conversationId, advertisedHeadSequence,
    fetchedMessages, knownMessages, requiredMessageIds,
  };
}

describe("Direct E2EE gap reconciliation before ratchet decryption", () => {
  it("accepts only a head-to-known contiguous interval", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(assertDirectHistoryGapComplete(reconciliation(rows))).toBe(5n);
    expect(assertDirectHistoryGapComplete(reconciliation(
      [history("known", "5")], [history("known", "5")], [], "5",
    ))).toBe(5n);
  });

  it("rejects an early-ended page that never reaches a known anchor", () => {
    expect(() => assertDirectHistoryGapComplete(reconciliation([
      history("new-8", "8"), history("new-7", "7"),
    ]))).toThrow("Unanchored");
  });

  it("rejects skipped causal sequences and same-sequence equivocation", () => {
    const missing = [history("new-8", "8"), history("new-6", "6"), history("known", "5")];
    expect(() => assertDirectHistoryGapComplete(reconciliation(missing))).toThrow("interval");
    expect(() => assertDirectHistoryGapComplete(reconciliation([
      history("new-8", "8"), history("evil-8", "8"),
      history("new-7", "7"), history("new-6", "6"), history("known", "5"),
    ]))).toThrow("Conflicting");
  });

  it("rejects a missing hinted event even if the next known row was reached", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      rows, [history("known", "5")], ["missing"],
    ))).toThrow("Missing required");
  });

  it("requires an anchor older than a delayed target, not merely any known row", () => {
    const rows = [history("new-8", "8"), history("known-7", "7"),
      history("target-6", "6"), history("other-5", "5")];
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      rows, [history("known-7", "7")], ["target-6"],
    ))).toThrow("Unanchored");
    expect(assertDirectHistoryGapComplete(reconciliation(
      [...rows, history("known-4", "4")],
      [history("known-7", "7"), history("known-4", "4")],
      ["target-6"],
    ))).toBe(4n);
  });

  it("rejects stale head, foreign conversations and invalid bigint sequence", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      rows, [history("known", "9")],
    ))).toThrow();
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      rows, [history("known", "5")], [], "9",
    ))).toThrow("head");
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      [history("new-8", "8", "foreign"), ...rows.slice(1)],
    ))).toThrow("Cross-conversation");
    expect(() => assertDirectHistoryGapComplete(reconciliation(
      [history("new-8", "9223372036854775808"), ...rows.slice(1)],
    ))).toThrow("sequence");
  });
});
