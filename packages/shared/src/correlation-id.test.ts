import { describe, expect, it } from "vitest";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  createCorrelationId,
  readCorrelationId,
} from "./correlation-id.js";

describe("createCorrelationId", () => {
  it("returns a UUID-shaped string", () => {
    const id = createCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("readCorrelationId", () => {
  it("prefers x-request-id over x-correlation-id", () => {
    expect(
      readCorrelationId({
        [REQUEST_ID_HEADER]: "req-1",
        [CORRELATION_ID_HEADER]: "corr-1",
      }),
    ).toBe("req-1");
  });

  it("falls back to x-correlation-id", () => {
    expect(
      readCorrelationId({
        [CORRELATION_ID_HEADER]: "corr-1",
      }),
    ).toBe("corr-1");
  });

  it("ignores blank header values", () => {
    expect(
      readCorrelationId({
        [REQUEST_ID_HEADER]: "   ",
      }),
    ).toBeUndefined();
  });
});
