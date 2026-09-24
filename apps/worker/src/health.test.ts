import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { closeHttpServer, listenWorkerHealth } from "./health.js";

describe("worker health listener", () => {
  it("serves liveness on /health, readiness on /ready, and 404 otherwise", async () => {
    const server = await listenWorkerHealth(0);
    const base = serverBase(server);
    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });

      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: "ok" });

      const missing = await fetch(`${base}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await closeHttpServer(server);
    }
  });

  it("fails readiness closed when the local inference dependency is unavailable", async () => {
    const server = await listenWorkerHealth(
      0,
      "127.0.0.1",
      async () => false,
    );
    const base = serverBase(server);
    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);

      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "not_ready" });
    } finally {
      await closeHttpServer(server);
    }
  });

  it("fails readiness closed when the readiness probe throws", async () => {
    const server = await listenWorkerHealth(
      0,
      "127.0.0.1",
      async () => {
        throw new Error("local provider unavailable");
      },
    );
    const base = serverBase(server);
    try {
      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "not_ready" });
    } finally {
      await closeHttpServer(server);
    }
  });
});

function serverBase(server: Server): string {
  const address = server.address();
  expect(address).not.toBeNull();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}
