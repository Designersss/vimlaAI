import { describe, expect, it } from "vitest";
import { AiError } from "./errors.js";
import { normalizeProviderUsage, readOpenAiUsage } from "./usage.js";

describe("normalizeProviderUsage", () => {
  it("rejects cacheRead greater than input", () => {
    expect(() =>
      normalizeProviderUsage({
        inputTokens: 10n,
        outputTokens: 1n,
        cacheReadTokens: 11n,
      }),
    ).toThrow(AiError);
  });
});

describe("readOpenAiUsage", () => {
  it("reads a terminal usage chunk with empty choices", () => {
    const usage = readOpenAiUsage({
      choices: [],
      usage: {
        prompt_tokens: 18,
        completion_tokens: 214,
        total_tokens: 232,
      },
    });
    expect(usage?.inputTokens).toBe(18n);
    expect(usage?.outputTokens).toBe(214n);
  });
});
