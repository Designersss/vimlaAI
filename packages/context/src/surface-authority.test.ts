import { describe, expect, it, vi } from "vitest";
import {
  SurfaceAuthorityRegistry,
  SurfaceAuthorityUnavailableError,
  SurfaceIdentityUnavailableError,
  isReadScopeEligible,
  writeScopeRequirement,
  type ResolvedSurfaceAuthority,
  type SurfaceAuthorityAdapter,
  type SurfaceIdentityResolver,
} from "./surface-authority.js";

const authority: ResolvedSurfaceAuthority = {
  surfaceId: "11111111-1111-4111-8111-111111111111",
  kind: "DIRECT",
  domainId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "user-a",
  canRead: true,
  canContribute: true,
  audienceUserIds: ["user-a", "user-b"],
  eligibleReadScopes: [
    {
      kind: "DIRECT_CHAT",
      directConversationId:
        "22222222-2222-4222-8222-222222222222",
    },
    {
      kind: "PROJECT",
      projectId: "ANY_AUTHORIZED",
    },
  ],
  eligibleWriteScopes: [
    {
      kind: "DIRECT_CHAT",
      directConversationId:
        "22222222-2222-4222-8222-222222222222",
      explicitActionRequired: false,
    },
  ],
  disclosurePolicy: {
    serverPlaintextAvailable: false,
    clientDisclosureRequired: true,
    peerContentRequiresConsent: true,
  },
  capabilities: [
    "CONTEXT_READ",
    "CONTEXT_CONTRIBUTE",
    "AI_INVOKE",
    "ACTION_INVOKE",
  ],
};

describe("SurfaceAuthorityRegistry", () => {
  it("selects an adapter only after server-authoritative identity resolution", async () => {
    const identities: SurfaceIdentityResolver = {
      resolve: vi.fn(async () => ({
        surfaceId: authority.surfaceId,
        kind: "DIRECT",
      })),
    };
    const resolve = vi.fn(async () => authority);
    const adapter: SurfaceAuthorityAdapter = {
      kind: "DIRECT",
      resolve,
    };
    const registry = new SurfaceAuthorityRegistry(
      identities,
      [adapter],
    );

    await expect(
      registry.resolve({
        actorUserId: "user-a",
        surfaceId: authority.surfaceId,
      }),
    ).resolves.toEqual(authority);
    expect(identities.resolve).toHaveBeenCalledWith(
      authority.surfaceId,
    );
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("fails closed for unknown identity or unregistered kind", async () => {
    const missing = new SurfaceAuthorityRegistry(
      { resolve: async () => null },
      [],
    );
    await expect(
      missing.resolve({
        actorUserId: "user-a",
        surfaceId: authority.surfaceId,
      }),
    ).rejects.toBeInstanceOf(
      SurfaceIdentityUnavailableError,
    );

    const noAdapter = new SurfaceAuthorityRegistry(
      {
        resolve: async () => ({
          surfaceId: authority.surfaceId,
          kind: "AI_THREAD",
        }),
      },
      [],
    );
    await expect(
      noAdapter.resolve({
        actorUserId: "user-a",
        surfaceId: authority.surfaceId,
      }),
    ).rejects.toBeInstanceOf(
      SurfaceAuthorityUnavailableError,
    );
  });

  it("rejects duplicate adapters", () => {
    const first: SurfaceAuthorityAdapter = {
      kind: "DIRECT",
      resolve: async () => authority,
    };
    const second: SurfaceAuthorityAdapter = {
      kind: "DIRECT",
      resolve: async () => authority,
    };
    expect(
      () =>
        new SurfaceAuthorityRegistry(
          { resolve: async () => null },
          [first, second],
        ),
    ).toThrow(
      "Duplicate surface authority adapter for DIRECT",
    );
  });

  it("evaluates eligible read/write scopes from the domain adapter result", () => {
    expect(
      isReadScopeEligible(authority, {
        kind: "DIRECT_CHAT",
        directConversationId: authority.domainId,
      }),
    ).toBe(true);
    expect(
      isReadScopeEligible(authority, {
        kind: "PERSONAL",
        ownerUserId: "user-a",
      }),
    ).toBe(false);
    expect(
      writeScopeRequirement(authority, {
        kind: "DIRECT_CHAT",
        directConversationId: authority.domainId,
      }),
    ).toEqual({
      eligible: true,
      explicitActionRequired: false,
    });
  });
});
