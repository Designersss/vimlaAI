import { describe, expect, it, vi } from "vitest";
import type { ClientTransport } from "./transport.js";
import { createInstallationsClient } from "./installations.js";

const view = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "WEB" as const,
  appVersion: "1.0.0",
  protocolVersion: 1,
  capabilities: ["realtime.v1"],
  createdAt: "2026-09-29T12:00:00.000Z",
  lastSeenAt: "2026-09-29T12:00:00.000Z",
  revokedAt: null,
  preferences: { pushEnabled: true },
};

describe("installations client", () => {
  it("registers through the shared transport with strict metadata", async () => {
    const request = vi.fn<ClientTransport["request"]>(
      async (_path, input) => input.parse(view),
    );
    const client = createInstallationsClient({ request });
    await expect(
      client.register({
        id: view.id,
        kind: "WEB",
        appVersion: "1.0.0",
        protocolVersion: 1,
        capabilities: ["realtime.v1"],
      }),
    ).resolves.toEqual(view);
    expect(request).toHaveBeenCalledWith(
      "/v1/client-installations/register",
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
      }),
    );
  });

  it("encodes installation ids in lifecycle paths", async () => {
    const request = vi.fn<ClientTransport["request"]>(
      async (_path, input) => input.parse(view),
    );
    const client = createInstallationsClient({ request });
    await client.revoke(view.id);
    await client.updatePreferences(view.id, {
      pushEnabled: false,
    });
    expect(request.mock.calls[0]?.[0]).toBe(
      `/v1/client-installations/${encodeURIComponent(view.id)}/revoke`,
    );
    expect(request.mock.calls[1]?.[0]).toBe(
      `/v1/client-installations/${encodeURIComponent(view.id)}/preferences`,
    );
  });
});
