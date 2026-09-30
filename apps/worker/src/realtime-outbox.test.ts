import { describe, expect, it } from "vitest";
import { retryBackoffMs } from "./realtime-outbox.js";

describe("realtime outbox retry policy", () => {
  it("uses capped exponential backoff without a terminal attempt", () => {
    expect(retryBackoffMs(1, 500, 5_000)).toBe(500);
    expect(retryBackoffMs(2, 500, 5_000)).toBe(1_000);
    expect(retryBackoffMs(3, 500, 5_000)).toBe(2_000);
    expect(retryBackoffMs(4, 500, 5_000)).toBe(4_000);
    expect(retryBackoffMs(5, 500, 5_000)).toBe(5_000);
    expect(retryBackoffMs(100, 500, 5_000)).toBe(5_000);
  });
});
