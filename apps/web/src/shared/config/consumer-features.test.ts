import { describe, expect, it } from "vitest";
import { CONSUMER_FEATURES } from "./consumer-features";

describe("consumer feature gates", () => {
  it("enables notification settings after Phase 6.5 and keeps future product surfaces off", () => {
    expect(CONSUMER_FEATURES.notificationsSettings).toBe(true);
    expect(CONSUMER_FEATURES.projects).toBe(false);
    expect(CONSUMER_FEATURES.vimlaOperator).toBe(false);
    expect(CONSUMER_FEATURES.directChats).toBe(false);
    expect(CONSUMER_FEATURES.autoRouter).toBe(false);
  });
});
