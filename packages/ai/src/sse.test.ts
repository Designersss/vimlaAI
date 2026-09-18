import { describe, expect, it } from "vitest";
import { OpenAiCompatSseParser } from "./sse.js";

const encoder = new TextEncoder();

describe("OpenAiCompatSseParser", () => {
  it("parses a terminal usage chunk with empty choices", () => {
    const parser = new OpenAiCompatSseParser();
    const events = parser.push(
      encoder.encode(
        'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":214,"total_tokens":232}}\n\n',
      ),
    );
    expect(events).toEqual([
      {
        type: "usage",
        usage: {
          inputTokens: 18n,
          outputTokens: 214n,
          reasoningTokens: 0n,
          cacheReadTokens: 0n,
          cacheWriteTokens: 0n,
        },
      },
    ]);
  });

  it("reassembles JSON split across TCP chunks", () => {
    const parser = new OpenAiCompatSseParser();
    const json = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n';
    const bytes = encoder.encode(json);
    const mid = 12;
    expect(parser.push(bytes.slice(0, mid))).toEqual([]);
    const rest = parser.push(bytes.slice(mid));
    expect(rest).toEqual([{ type: "delta", text: "Hi" }]);
  });

  it("parses multiple SSE events in one network chunk", () => {
    const parser = new OpenAiCompatSseParser();
    const events = parser.push(
      encoder.encode(
        'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"B"}}]}\n\n' +
          "data: [DONE]\n\n",
      ),
    );
    expect(events).toEqual([
      { type: "delta", text: "A" },
      { type: "delta", text: "B" },
      { type: "done" },
    ]);
  });

  it("parses streamed tool-call deltas", () => {
    const parser = new OpenAiCompatSseParser();
    const events = parser.push(
      encoder.encode(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"github.readFile","arguments":"{\\\"path\\\":\\\"README.md\\\"}"}}]}}]}\n\n',
      ),
    );
    expect(events).toEqual([
      {
        type: "tool_call_delta",
        index: 0,
        id: "call-1",
        name: "github.readFile",
        argumentsDelta: '{"path":"README.md"}',
      },
    ]);
  });

  it("does not throw on empty choices", () => {
    const parser = new OpenAiCompatSseParser();
    expect(() => parser.push(encoder.encode('data: {"choices":[]}\n\n'))).not.toThrow();
  });

  it("throws on malformed JSON", () => {
    const parser = new OpenAiCompatSseParser();
    expect(() => parser.push(encoder.encode("data: {not json}\n\n"))).toThrow(SyntaxError);
  });
});
