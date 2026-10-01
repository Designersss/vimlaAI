import { describe, expect, it, vi } from "vitest";
import {
  SurfaceAuthorityRegistry,
  SurfaceAuthorityUnavailableError,
  SurfaceIdentityUnavailableError,
  type SurfaceAuthorityAdapter,
  type SurfaceIdentityResolver,
} from "./surface-authority.js";

describe("SurfaceAuthorityRegistry", () => {
  it("routes using the server-resolved surface kind", async () => {
    const identities: SurfaceIdentityResolver = {
      resolveKind: vi.fn(async () => "DIRECT"),
    };
    const resolve = vi.fn(async () => ({
      canRead: true,
    }));
    const adapter: SurfaceAuthorityAdapter<{
      canRead: boolean;
    }> = {
      kind: "DIRECT",
      resolve,
    };
    const registry = new SurfaceAuthorityRegistry(
      identities,
      [adapter],
    );
    const input = {
      actorUserId: "user-a",
      surfaceId:
        "11111111-1111-4111-8111-111111111111",
    };

    await expect(
      registry.resolve(input),
    ).resolves.toEqual({ canRead: true });
    expect(identities.resolveKind).toHaveBeenCalledWith(
      input.surfaceId,
    );
    expect(resolve).toHaveBeenCalledWith(input);
  });

  it("fails closed when the surface identity cannot be resolved", async () => {
    const identities: SurfaceIdentityResolver = {
      resolveKind: async () => null,
    };
    const registry =
      new SurfaceAuthorityRegistry<unknown>(
        identities,
        [],
      );

    await expect(
      registry.resolve({
        actorUserId: "user-a",
        surfaceId:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(
      SurfaceIdentityUnavailableError,
    );
  });

  it("fails closed when no adapter exists for the authoritative kind", async () => {
    const identities: SurfaceIdentityResolver = {
      resolveKind: async () => "AI_THREAD",
    };
    const registry =
      new SurfaceAuthorityRegistry<unknown>(
        identities,
        [],
      );

    await expect(
      registry.resolve({
        actorUserId: "user-a",
        surfaceId:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(
      SurfaceAuthorityUnavailableError,
    );
  });

  it("rejects duplicate adapters for one surface kind", () => {
    const identities: SurfaceIdentityResolver = {
      resolveKind: async () => "DIRECT",
    };
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
        new SurfaceAuthorityRegistry(
          identities,
          [first, second],
        ),
    ).toThrow(
      "Duplicate surface authority adapter for DIRECT",
    );
  });
});
