import { describe, expect, it } from "vitest";
import { estimateInputTokens, selectContextMessages, utf8ByteLength } from "./estimate.js";

describe("estimateInputTokens", () => {
  it("is at least the UTF-8 byte length, not characters/4", () => {
    const content = "Привет";
    const estimate = estimateInputTokens([{ content }]);
    expect(estimate).toBeGreaterThanOrEqual(utf8ByteLength(content));
    expect(estimate).toBeGreaterThan(content.length / 4);
  });
});

describe("selectContextMessages", () => {
  it("keeps the newest messages within the byte budget", () => {
    const selected = selectContextMessages(
      [
        { content: "old" },
        { content: "mid" },
        { content: "new" },
      ],
      40,
    );
    expect(selected.at(-1)?.content).toBe("new");
  });
});
