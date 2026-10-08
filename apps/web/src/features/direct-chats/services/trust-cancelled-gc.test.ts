import { describe, expect, it } from "vitest";
import {
  TRUST_CANCELLED_GC_BATCH_MAX,
  TRUST_CANCELLED_GC_MIN_AGE_MS,
  TRUST_CANCELLED_GC_POLL_INTERVAL_MS,
  selectTrustCancelledGcCandidates,
  type TrustCancelledGcRow,
} from "./trust-cancelled-gc";

const now = Date.parse("2026-10-08T12:00:00.000Z");
function row(i: number, overrides: Partial<TrustCancelledGcRow> = {}): TrustCancelledGcRow {
  return {
    conversationId: "chat",
    senderDeviceId: "device",
    clientMessageId: String(i).padStart(3, "0"),
    createdAt: new Date(now - 60_000 + i).toISOString(),
    trustCancelledAt: new Date(now - 10 * 60_000).toISOString(),
    ...overrides,
  };
}
const select = (rows: TrustCancelledGcRow[], at = now) =>
  selectTrustCancelledGcCandidates(rows, {
    conversationId: "chat",
    senderDeviceId: "device",
    now: at,
  });

describe("trust-cancelled Direct GC candidate scheduling", () => {
  it("excludes foreign scopes, malformed, future and immature timestamps", () => {
    expect(select([
      row(1),
      row(2, { conversationId: "other" }),
      row(3, { senderDeviceId: "other" }),
      row(4, { trustCancelledAt: undefined }),
      row(5, { trustCancelledAt: "bad" }),
      row(6, { trustCancelledAt: new Date(now + 1000).toISOString() }),
      row(7, { trustCancelledAt: new Date(now - 1000).toISOString() }),
    ])).toEqual([row(1)]);
  });

  it("checks staged output children before their Operator parent", () => {
    const parent = row(0, { operatorIntent: { clientRequestId: "req" } });
    expect(select([parent, row(2), row(1)]).map(x => x.clientMessageId))
      .toEqual(["001", "002", "000"]);
  });

  it("rotates over every bounded page even when old entries never resolve", () => {
    const rows = Array.from({ length: 53 }, (_, index) =>
      row(index, index === 0 ? { operatorIntent: { clientRequestId: "req" } } : {}),
    );
    const pages = Math.ceil(rows.length / TRUST_CANCELLED_GC_BATCH_MAX);
    const visited = new Set<string>();
    for (let index = 0; index < pages; index += 1) {
      const batch = select(rows, now + index * TRUST_CANCELLED_GC_POLL_INTERVAL_MS);
      expect(batch.length).toBeLessThanOrEqual(TRUST_CANCELLED_GC_BATCH_MAX);
      for (const candidate of batch) {
        expect(visited.has(candidate.clientMessageId)).toBe(false);
        visited.add(candidate.clientMessageId);
      }
    }
    expect(visited.size).toBe(rows.length);
  });

  it("waits for the complete cancellation grace period", () => {
    const candidate = row(99, {
      trustCancelledAt: new Date(now - TRUST_CANCELLED_GC_MIN_AGE_MS).toISOString(),
    });
    expect(select([candidate], now - 1)).toEqual([]);
    expect(select([candidate])).toEqual([candidate]);
  });
});
