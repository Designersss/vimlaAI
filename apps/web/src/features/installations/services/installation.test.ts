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

function errorResponse(code: string, status: number): Response {
  return {
    status,
    ok: false,
    json: async () => ({
      error: { code, message: code },
    }),
  } as Response;
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
      capabilities: ["realtime.v1"],
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
      JSON.parse(String(call[1]?.body)) as {
        id: string;
        capabilities: string[];
      },
    );
    expect(bodies.map((body) => body.id)).toEqual([id, id]);
    expect(
      bodies.map((body) => body.capabilities),
    ).toEqual([
      ["realtime.v1"],
      ["realtime.v1"],
    ]);
  });

  it("normalizes an equivalent stored UUID without rotating identity", async () => {
    const local = storage();
    const key = installationStorageKey("user-a");
    const canonicalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    local.values.set(key, canonicalId.toUpperCase());
    const randomUuid = vi.fn(() =>
      "22222222-2222-4222-8222-222222222222",
    );
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return response(body.id);
    });

    await expect(
      ensureWebInstallation("user-a", {
        storage: local,
        randomUuid,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ id: canonicalId });

    expect(local.values.get(key)).toBe(canonicalId);
    expect(randomUuid).not.toHaveBeenCalled();
    const body = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as { id: string };
    expect(body.id).toBe(canonicalId);
  });

  it("rotates a foreign or otherwise missing stored installation id", async () => {
    const local = storage();
    const key = installationStorageKey("user-a");
    const oldId = "11111111-1111-4111-8111-111111111111";
    const replacementId = "22222222-2222-4222-8222-222222222222";
    local.values.set(key, oldId);

    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return body.id === oldId
        ? errorResponse("not_found", 404)
        : response(body.id);
    });

    await expect(
      ensureWebInstallation("user-a", {
        storage: local,
        randomUuid: () => replacementId,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ id: replacementId });

    expect(local.values.get(key)).toBe(replacementId);
    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)) as { id: string },
    );
    expect(bodies.map((body) => body.id)).toEqual([
      oldId,
      replacementId,
    ]);
  });

  it("does not bypass server revocation by silently rotating identity", async () => {
    const local = storage();
    const key = installationStorageKey("user-a");
    const id = "11111111-1111-4111-8111-111111111111";
    local.values.set(key, id);
    const randomUuid = vi.fn(() =>
      "22222222-2222-4222-8222-222222222222",
    );
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errorResponse("installation_revoked", 409),
    );

    await expect(
      ensureWebInstallation("user-a", {
        storage: local,
        randomUuid,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "installation_revoked",
      status: 409,
    });

    expect(local.values.get(key)).toBe(id);
    expect(randomUuid).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not rotate installation identity on transient server failures", async () => {
    const local = storage();
    const key = installationStorageKey("user-a");
    const id = "11111111-1111-4111-8111-111111111111";
    local.values.set(key, id);
    const randomUuid = vi.fn(() =>
      "22222222-2222-4222-8222-222222222222",
    );
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errorResponse("internal_error", 503),
    );

    await expect(
      ensureWebInstallation("user-a", {
        storage: local,
        randomUuid,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      status: 503,
    });

    expect(local.values.get(key)).toBe(id);
    expect(randomUuid).not.toHaveBeenCalled();
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
