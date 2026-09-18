import { describe, expect, it } from "vitest";
import { estimateInputTokens, estimateProviderRequestInputTokens, selectContextMessages, utf8ByteLength } from "./estimate.js";

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


describe("estimateProviderRequestInputTokens", () => {
  it("includes tool definitions and tool-call metadata in the funded input bound", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "github.readFile",
            arguments: { path: "README.md" },
          },
        ],
      },
      {
        role: "tool" as const,
        toolCallId: "call-1",
        toolName: "github.readFile",
        content: JSON.stringify({ content: "repository result" }),
      },
    ];
    const withoutTools = estimateProviderRequestInputTokens(messages);
    const withTools = estimateProviderRequestInputTokens(messages, [
      {
        name: "github.readFile",
        description: "x".repeat(2_000),
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);

    expect(withTools).toBeGreaterThan(withoutTools + 2_000);
    expect(withoutTools).toBeGreaterThan(
      estimateInputTokens(messages.map((message) => ({ content: message.content }))),
    );
  });
});
