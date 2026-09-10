import { describe, expect, it } from "vitest";
import { closeHttpServer, listenWorkerHealth } from "./health.js";

describe("worker health listener", () => {
  it("serves ok on /health and 404 otherwise", async () => {
    const server = await listenWorkerHealth(0);
    const address = server.address();
    expect(address).not.toBeNull();
    if (!address || typeof address === "string") {
      await closeHttpServer(server);
      throw new Error("expected TCP address");
    }
    const base = `http://127.0.0.1:${String(address.port)}`;
    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      const missing = await fetch(`${base}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await closeHttpServer(server);
    }
  });
});
