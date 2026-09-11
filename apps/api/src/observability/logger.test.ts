import { describe, expect, it } from "vitest";
import { shouldSkipPinoAutoLogging } from "./logger.js";

describe("shouldSkipPinoAutoLogging", () => {
  it("skips hijacked conversation SSE so pino-http cannot buffer the stream", () => {
    expect(shouldSkipPinoAutoLogging("/v1/conversations/abc/messages")).toBe(true);
    expect(shouldSkipPinoAutoLogging("/v1/direct-chats/abc/messages")).toBe(true);
    expect(shouldSkipPinoAutoLogging("/v1/operator/runs")).toBe(true);
    expect(shouldSkipPinoAutoLogging("/v1/conversations")).toBe(false);
    expect(shouldSkipPinoAutoLogging("/health")).toBe(false);
  });
});
