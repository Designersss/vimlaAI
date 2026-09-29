import { describe, expect, it, vi } from "vitest";
import {
  ensureWebInstallation,
  installationStorageKey,
  type WebInstallationStorage,
} from "./installation";

function storage(): WebInstallationStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function response(id: string): Response {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      id,
      kind: "WEB",
      appVersion: null,
      protocolVersion: 1,
      capabilities: [],
      createdAt: "2026-09-29T12:00:00.000Z",
      lastSeenAt: "2026-09-29T12:00:00.000Z",
      revokedAt: null,
      preferences: { pushEnabled: true },
    }),
  } as Response;
}

describe("Web installation bootstrap", () => {
  it("reuses one durable installation id for the same account", async () => {
    const local = storage();
    const id = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = vi.fn<typeof fetch>(async () => response(id));

    await ensureWebInstallation("user-a", {
      storage: local,
      randomUuid: () => id,
      fetchImpl,
    });
    await ensureWebInstallation("user-a", {
      storage: local,
      randomUuid: () => {
        throw new Error("must not rotate an existing installation id");
      },
      fetchImpl,
    });

    expect(local.values.get(installationStorageKey("user-a"))).toBe(id);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)) as { id: string },
    );
    expect(bodies.map((body) => body.id)).toEqual([id, id]);
  });

  it("uses account-scoped storage keys instead of rebinding one id across users", async () => {
    const local = storage();
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return response(body.id);
    });
    let cursor = 0;

    await ensureWebInstallation("user-a", {
      storage: local,
      randomUuid: () => ids[cursor++]!,
      fetchImpl,
    });
    await ensureWebInstallation("user-b", {
      storage: local,
      randomUuid: () => ids[cursor++]!,
      fetchImpl,
    });

    expect(local.values.get(installationStorageKey("user-a"))).toBe(ids[0]);
    expect(local.values.get(installationStorageKey("user-b"))).toBe(ids[1]);
  });
});
