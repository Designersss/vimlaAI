import { describe, expect, it } from "vitest";
import { AI_GATEWAY_BOUNDARY } from "./provider.js";

describe("AI gateway foundation", () => {
  it("keeps the provider boundary explicit", () => {
    expect(AI_GATEWAY_BOUNDARY).toContain("AiProvider");
  });
});
