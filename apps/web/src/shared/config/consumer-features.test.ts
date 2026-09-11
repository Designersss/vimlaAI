import { describe, expect, it } from "vitest";
import { CONSUMER_FEATURES } from "./consumer-features";

describe("consumer feature gates", () => {
  it("keeps unreleased surfaces off until they are explicitly enabled", () => {
    expect(CONSUMER_FEATURES.notificationsSettings).toBe(true);
    expect(CONSUMER_FEATURES.projects).toBe(false);
    expect(CONSUMER_FEATURES.vimlaOperator).toBe(false);
    expect(CONSUMER_FEATURES.directChats).toBe(false);
    expect(CONSUMER_FEATURES.autoRouter).toBe(false);
  });
});
