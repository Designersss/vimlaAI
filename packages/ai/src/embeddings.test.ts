import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EmbeddingError,
  InternalHttpEmbeddingProvider,
  validateEmbedding,
} from "./embeddings.js";

const config = {
  baseUrl: "http://localhost:8080/v1",
  model: "test-model",
  revision: "weights-v1",
  dimensions: 2,
  timeoutMs: 1000,
};
describe("embedding provider boundary", () => {
  it.each([
    [0, 0],
    [NaN, 1],
    [Infinity, 1],
    [1],
    [1, 2, 3],
    ["1", 2],
    [1e7, 1],
  ])("rejects invalid vector %s", (...vector) => {
    expect(() => validateEmbedding(vector, 2)).toThrow(EmbeddingError);
  });
  it("rejects oversized batches before network access", async () => {
    const transport = vi.fn();
    const provider = new InternalHttpEmbeddingProvider(config, transport);
    await expect(
      provider.embed({ texts: ["a".repeat(8193)], requestId: "request" }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      provider.embed({
        texts: Array(33).fill("a") as string[],
        requestId: "request",
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { model: "other", data: [{ index: 0, embedding: [1, 0] }] },
    { model: "test-model", data: [{ index: 1, embedding: [1, 0] }] },
    { model: "test-model", data: [] },
    { model: "test-model", data: [{ index: 0, embedding: [0, 0] }] },
  ])("validates the complete provider response", async (payload) => {
    const provider = new InternalHttpEmbeddingProvider(
      config,
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))),
    );
    await expect(
      provider.embed({ texts: ["query"], requestId: "request" }),
    ).rejects.toThrow("INVALID_RESPONSE");
  });
  it("does not disclose provider errors or retry requests", async () => {
    const transport = vi
      .fn()
      .mockRejectedValue(new Error("secret-key and private content"));
    const provider = new InternalHttpEmbeddingProvider(config, transport);
    await expect(
      provider.embed({ texts: ["query"], requestId: "request" }),
    ).rejects.toThrow("Embedding service: UNAVAILABLE");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("embedding HTTP contract", () => {
  let server: Server;
  let baseUrl: string;
  const received: { path?: string; body?: unknown; key?: string | string[] } =
    {};
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/redirect/embeddings") {
        response.writeHead(302, { location: "/v1/embeddings" });
        response.end();
        return;
      }
      if (request.url === "/timeout/embeddings") return;
      if (request.url === "/large/embeddings") {
        response.end("x".repeat(2_000_001));
        return;
      }
      const parts: Buffer[] = [];
      request.on("data", (part: Buffer) => parts.push(part));
      request.on("end", () => {
        received.path = request.url;
        received.body = JSON.parse(Buffer.concat(parts).toString()) as unknown;
        received.key = request.headers["idempotency-key"];
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            model: "test-model",
            data: [
              { index: 1, embedding: [0, 1] },
              { index: 0, embedding: [1, 0] },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("sends bounded input and restores provider result order", async () => {
    const provider = new InternalHttpEmbeddingProvider({
      ...config,
      baseUrl: baseUrl + "/v1",
    });
    expect(
      await provider.embed({
        texts: ["first", "second"],
        requestId: "same-request",
      }),
    ).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(received).toEqual({
      path: "/v1/embeddings",
      body: {
        model: "test-model",
        input: ["first", "second"],
        encoding_format: "float",
      },
      key: "same-request",
    });
  });
  it.each(["redirect", "timeout", "large"])(
    "bounds %s responses",
    async (path) => {
      const provider = new InternalHttpEmbeddingProvider({
        ...config,
        baseUrl: baseUrl + "/" + path,
      });
      await expect(
        provider.embed({ texts: ["query"], requestId: "request" }),
      ).rejects.toBeInstanceOf(EmbeddingError);
    },
  );
});
