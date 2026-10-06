import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { seedVimlaAiModels } from "@vimla/ai";
import { seedVimlaPlans } from "@vimla/billing";
import { loadApiConfig } from "@vimla/config/server";
import { Prisma, createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  PEOPLE_ACCESS_POLICY,
  type PeopleAccessPolicy,
} from "./people-access-policy.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("people public identity API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.DIRECT_CHATS_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    await seedVimlaAiModels(prisma);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("reads and searches public identity without leaking account email", async () => {
    const viewer = await registerVerifiedUser(app, "people-viewer");
    const target = await registerVerifiedUser(app, "people-target");

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/people/me",
      headers: jsonHeaders(),
      cookies: target.cookies,
      payload: {
        displayName: "Никита 🚀",
        bio: "Публичное описание",
        status: "В сети",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      userId: target.id,
      handle: target.handle,
      displayName: "Никита 🚀",
      bio: "Публичное описание",
      status: "В сети",
    });
    expect(updated.body).not.toContain(target.email);

    const exact = await app.inject({
      method: "GET",
      url: `/v1/people/${target.handle.toUpperCase()}`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(exact.statusCode).toBe(200);
    expect(exact.json()).toMatchObject({
      userId: target.id,
      handle: target.handle,
      displayName: "Никита 🚀",
    });
    expect(exact.body).not.toContain(target.email);

    const byHandle = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent(`@${target.handle}`)}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(byHandle.statusCode).toBe(200);
    expect(byHandle.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: target.id,
          handle: target.handle,
        }),
      ]),
    );
    expect(byHandle.body).not.toContain(target.email);

    const byDisplayName = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("Никита")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(byDisplayName.statusCode).toBe(200);
    expect(byDisplayName.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: target.id,
          displayName: "Никита 🚀",
        }),
      ]),
    );

    const shortPrefix = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("Ни")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(shortPrefix.statusCode).toBe(200);
    expect(shortPrefix.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: target.id }),
      ]),
    );

    const indexedContains = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("кит")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(indexedContains.statusCode).toBe(200);
    expect(indexedContains.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: target.id }),
      ]),
    );

    const wildcardLiteral = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("%")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(wildcardLiteral.statusCode).toBe(200);
    expect(wildcardLiteral.json().items).toEqual([]);

    const emptyHandleSearch = await app.inject({
      method: "GET",
      url: "/v1/people?q=%40",
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(emptyHandleSearch.statusCode).toBe(400);

    const overLimit = await app.inject({
      method: "GET",
      url: "/v1/people?q=nikita&limit=31",
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(overLimit.statusCode).toBe(400);

    const reservedSystemIdentity = await app.inject({
      method: "GET",
      url: "/v1/people/vimla",
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(reservedSystemIdentity.statusCode).toBe(404);
  });

  it("keeps profile provisioning idempotent and enforces handle ownership in PostgreSQL", async () => {
    const target = await registerVerifiedUser(
      app,
      "people-invariant-target",
      "N".repeat(120),
    );
    const other = await registerVerifiedUser(app, "people-invariant-other");
    const prisma = app.get(PrismaService).client;

    const profileBefore = await prisma.publicProfile.findUnique({
      where: { userId: target.id },
      select: { handleId: true, displayName: true, updatedAt: true },
    });
    expect(profileBefore).not.toBeNull();
    expect(profileBefore?.displayName).toBe(target.handle);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const steadyState = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: target.cookies,
    });
    expect(steadyState.statusCode).toBe(200);

    const profileAfter = await prisma.publicProfile.findUnique({
      where: { userId: target.id },
      select: { handleId: true, displayName: true, updatedAt: true },
    });
    expect(profileAfter?.updatedAt.getTime()).toBe(
      profileBefore?.updatedAt.getTime(),
    );

    const otherHandle = await prisma.handle.findUnique({
      where: { userId: other.id },
      select: { id: true },
    });
    if (!profileBefore || !otherHandle) {
      throw new Error("Expected public identity fixtures");
    }

    // Remove the other user's profile so the attempted reassignment is not
    // rejected by the unique handleId index before PostgreSQL checks ownership.
    await prisma.publicProfile.delete({
      where: { userId: other.id },
    });

    await expect(
      prisma.publicProfile.update({
        where: { userId: target.id },
        data: { handleId: otherHandle.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    const intact = await prisma.publicProfile.findUnique({
      where: { userId: target.id },
      select: { handleId: true },
    });
    expect(intact?.handleId).toBe(profileBefore.handleId);

    await prisma.handle.delete({
      where: { id: otherHandle.id },
    });
    await expect(
      prisma.handle.update({
        where: { id: profileBefore.handleId },
        data: { userId: other.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    const ownershipStillIntact =
      await prisma.publicProfile.findUnique({
        where: { userId: target.id },
        select: { handleId: true },
      });
    expect(ownershipStillIntact?.handleId).toBe(
      profileBefore.handleId,
    );

    const searchIndexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'handle_normalized_pattern_idx',
          'handle_normalized_trgm_idx',
          'public_profile_displayName_lower_pattern_idx',
          'public_profile_displayName_trgm_idx'
        )
    `;
    expect(new Set(searchIndexes.map((row) => row.indexname))).toEqual(
      new Set([
        "handle_normalized_pattern_idx",
        "handle_normalized_trgm_idx",
        "public_profile_displayName_lower_pattern_idx",
        "public_profile_displayName_trgm_idx",
      ]),
    );
  });

  it("allows only owner mutation and respects the TRUST-01 policy seam", async () => {
    const viewer = await registerVerifiedUser(app, "people-policy-viewer");
    const target = await registerVerifiedUser(app, "people-policy-target");

    const foreignUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/people/${target.handle}`,
      headers: jsonHeaders(),
      cookies: viewer.cookies,
      payload: { displayName: "Hijacked" },
    });
    expect(foreignUpdate.statusCode).toBe(404);

    const policy = app.get<PeopleAccessPolicy>(
      PEOPLE_ACCESS_POLICY,
    );
    const discoverExact = vi
      .spyOn(policy, "canDiscover")
      .mockResolvedValue(false);
    const discoverSearch = vi
      .spyOn(policy, "discoveryAllowedSql")
      .mockReturnValue(Prisma.sql`FALSE`);
    const startDirect = vi
      .spyOn(policy, "canStartDirectChat")
      .mockImplementation(async (_actorUserId, targetUserId) =>
        targetUserId !== target.id,
      );

    try {
      const hiddenExact = await app.inject({
        method: "GET",
        url: `/v1/people/${target.handle}`,
        headers: { origin },
        cookies: viewer.cookies,
      });
      expect(hiddenExact.statusCode).toBe(404);

      const hiddenSearch = await app.inject({
        method: "GET",
        url: `/v1/people?q=${target.handle}`,
        headers: { origin },
        cookies: viewer.cookies,
      });
      expect(hiddenSearch.statusCode).toBe(200);
      expect(hiddenSearch.json().items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: target.id }),
        ]),
      );
      expect(discoverExact).toHaveBeenCalledWith(
        viewer.id,
        target.id,
      );
      expect(discoverSearch).toHaveBeenCalledWith(
        viewer.id,
        expect.anything(),
      );

      const deniedDirect = await app.inject({
        method: "POST",
        url: "/v1/direct-chats",
        headers: jsonHeaders(),
        cookies: viewer.cookies,
        payload: { peerHandle: target.handle },
      });
      expect(deniedDirect.statusCode).toBe(404);
    } finally {
      discoverExact.mockRestore();
      discoverSearch.mockRestore();
      startDirect.mockRestore();
    }
  });

  it("creates Direct Chat from handle identity and rejects legacy email addressing", async () => {
    const alice = await registerVerifiedUser(app, "people-direct-alice");
    const nikita = await registerVerifiedUser(app, "people-direct-nikita");

    const created = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { peerHandle: nikita.handle },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      surfaceKind: "DIRECT",
      peer: {
        userId: nikita.id,
        handle: nikita.handle,
      },
    });
    expect(created.body).not.toContain(nikita.email);
    expect(created.body).not.toContain(alice.email);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: nikita.cookies,
      payload: { peerHandle: alice.handle },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(created.json().id);

    const legacyEmail = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { peerEmail: nikita.email },
    });
    expect(legacyEmail.statusCode).toBe(400);
  });

  it("rate-limits GET and HEAD discovery together to reduce enumeration", async () => {
    const viewer = await registerVerifiedUser(app, "people-rate-viewer");
    const target = await registerVerifiedUser(app, "people-rate-target");

    for (let index = 0; index < 59; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/people/${target.handle}`,
        headers: { origin },
        cookies: viewer.cookies,
      });
      expect(response.statusCode).toBe(200);
    }

    const head = await app.inject({
      method: "HEAD",
      url: `/v1/people/${target.handle}`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(head.statusCode).toBe(200);

    const limited = await app.inject({
      method: "GET",
      url: `/v1/people/${target.handle}`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(limited.statusCode).toBe(429);
  });
});

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}
