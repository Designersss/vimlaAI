import { describe, expect, it } from "vitest";
import {
  DIRECT_HISTORY_CATCHUP_MAX_PAGES,
  assertDirectHistoryCatchupBudget,
  inspectDirectHistoryGap,
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

describe("Direct E2EE history gap classification before ratchet decryption", () => {
  it("recognizes a continuous head-to-known interval, including an exact replay", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(inspectDirectHistoryGap(reconciliation(rows))).toEqual({
      complete: true, anchor: 5n,
    });
    expect(inspectDirectHistoryGap(reconciliation(
      [history("known", "5")], [history("known", "5")], [], "5",
    ))).toEqual({ complete: true, anchor: 5n });
  });

  it("classifies an early-ended history page as partial, not a broken signed HUMAN message", () => {
    expect(inspectDirectHistoryGap(reconciliation([
      history("new-8", "8"), history("new-7", "7"),
    ]))).toEqual({ complete: false });
  });

  it("allows skipped causal sequences but rejects same-sequence equivocation", () => {
    const missing = [history("new-8", "8"), history("new-6", "6"), history("known", "5")];
    expect(inspectDirectHistoryGap(reconciliation(missing))).toEqual({
      complete: false,
    });
    expect(() => inspectDirectHistoryGap(reconciliation([
      history("new-8", "8"), history("evil-8", "8"),
      history("new-7", "7"), history("new-6", "6"), history("known", "5"),
    ]))).toThrow("Conflicting");
  });

  it("treats a missing hinted event as incomplete reaction history without poisoning ratchet", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(inspectDirectHistoryGap(reconciliation(
      rows, [history("known", "5")], ["missing"],
    ))).toEqual({ complete: false });
  });

  it("requires an anchor older than a delayed hint before claiming complete history", () => {
    const rows = [history("new-8", "8"), history("known-7", "7"),
      history("target-6", "6"), history("other-5", "5")];
    expect(inspectDirectHistoryGap(reconciliation(
      rows, [history("known-7", "7")], ["target-6"],
    ))).toEqual({ complete: false });
    expect(inspectDirectHistoryGap(reconciliation(
      [...rows, history("known-4", "4")],
      [history("known-7", "7"), history("known-4", "4")],
      ["target-6"],
    ))).toEqual({ complete: true, anchor: 4n });
  });

  it("does not mistake a delayed older ratchet message for forged event metadata", () => {
    // In the cross-browser E2E, the server omits sequence 7 from one device
    // while sequence 8 is already signed and decryptable via skipped keys.
    // Human message 8 must remain renderable, but reaction counts must not
    // claim to have reconstructed the interval.
    expect(inspectDirectHistoryGap(reconciliation([
      history("new-8", "8"), history("known", "5"),
    ]))).toEqual({ complete: false });
    expect(inspectDirectHistoryGap(reconciliation([
      history("new-8", "8"), history("delayed-7", "7"),
      history("new-6", "6"), history("known", "5"),
    ]))).toEqual({ complete: true, anchor: 5n });
  });

  it("classifies stale head as partial; rejects foreign or conflicting identity and bigint", () => {
    const rows = [history("new-8", "8"), history("new-7", "7"),
      history("new-6", "6"), history("known", "5")];
    expect(() => inspectDirectHistoryGap(reconciliation(
      rows, [history("known", "9")],
    ))).toThrow("Conflicting");
    expect(inspectDirectHistoryGap(reconciliation(
      rows, [history("known", "5")], [], "9",
    ))).toEqual({ complete: false });
    expect(() => inspectDirectHistoryGap(reconciliation(
      [history("new-8", "8", "foreign"), ...rows.slice(1)],
    ))).toThrow("Cross-conversation");
    expect(() => inspectDirectHistoryGap(reconciliation(
      [history("new-8", "9223372036854775808"), ...rows.slice(1)],
    ))).toThrow("sequence");
    expect(() => inspectDirectHistoryGap(reconciliation(
      [history("known", "8"), ...rows.slice(1)],
    ))).toThrow("Conflicting");
  });
});
