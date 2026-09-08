import { describe, expect, it } from "vitest";
import { sseResponseHeaders } from "./sse-headers.js";

describe("sseResponseHeaders", () => {
  it("keeps CORS credentials on hijacked SSE responses", () => {
    const headers = sseResponseHeaders("http://localhost:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(headers["Content-Type"]).toContain("text/event-stream");
  });
});
