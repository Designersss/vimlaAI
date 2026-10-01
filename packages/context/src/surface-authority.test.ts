import { describe, expect, it, vi } from "vitest";
import {
  SurfaceAuthorityRegistry,
  SurfaceAuthorityUnavailableError,
  type SurfaceAuthorityAdapter,
} from "./surface-authority.js";

describe("SurfaceAuthorityRegistry", () => {
  it("routes a surface to the matching domain-owned adapter", async () => {
    const resolve = vi.fn(async () => ({
      canRead: true,
    }));
    const adapter: SurfaceAuthorityAdapter<{
      canRead: boolean;
    }> = {
      kind: "DIRECT",
      resolve,
    };
    const registry = new SurfaceAuthorityRegistry([
      adapter,
    ]);

    await expect(
      registry.resolve("DIRECT", {
        actorUserId: "user-a",
        surfaceId:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({ canRead: true });
    expect(resolve).toHaveBeenCalledWith({
      actorUserId: "user-a",
      surfaceId:
        "11111111-1111-4111-8111-111111111111",
    });
  });

  it("fails closed when no authority adapter is registered", async () => {
    const registry =
      new SurfaceAuthorityRegistry<unknown>([]);

    await expect(
      registry.resolve("AI_THREAD", {
        actorUserId: "user-a",
        surfaceId:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(
      SurfaceAuthorityUnavailableError,
    );
  });

  it("rejects duplicate adapters for one surface kind", () => {
    const first: SurfaceAuthorityAdapter<unknown> = {
      kind: "DIRECT",
      resolve: async () => ({}),
    };
    const second: SurfaceAuthorityAdapter<unknown> = {
      kind: "DIRECT",
      resolve: async () => ({}),
    };

    expect(
      () =>
        new SurfaceAuthorityRegistry([
          first,
          second,
        ]),
    ).toThrow(
      "Duplicate surface authority adapter for DIRECT",
    );
  });
});
