import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient, type Prisma } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  registerUnverifiedUser,
  registerVerifiedUser,
} from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("client installations API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL =
      process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ??
      "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

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

  it("binds registration to the authenticated user and is idempotent", async () => {
    const user = await registerVerifiedUser(app, "install-owner");
    const id = randomUUID();
    const first = await register(
      app,
      user.cookies,
      installationPayload(id),
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id,
      kind: "WEB",
      appVersion: "web-test",
      protocolVersion: 1,
      capabilities: ["realtime.v1", "sync.v1"],
      revokedAt: null,
      preferences: { pushEnabled: false },
    });
    expect("userId" in first.json()).toBe(false);

    const second = await register(
      app,
      user.cookies,
      installationPayload(id),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    const prisma = app.get(PrismaService).client;
    expect(
      await prisma.clientInstallation.count({
        where: { id, userId: user.id },
      }),
    ).toBe(1);
    expect(
      await prisma.clientInstallationPreference.count({
        where: { installationId: id },
      }),
    ).toBe(1);
    expect(
      await prisma.userCryptoDevice.count({
        where: { userId: user.id },
      }),
    ).toBe(0);
  });

  it("canonicalizes equivalent UUID spellings to one durable installation", async () => {
    const user = await registerVerifiedUser(app, "install-canonical-id");
    const id = randomUUID();
    const uppercaseId = id.toUpperCase();

    const first = await register(
      app,
      user.cookies,
      installationPayload(uppercaseId),
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().id).toBe(id);

    const second = await register(
      app,
      user.cookies,
      installationPayload(id),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(id);

    const prisma = app.get(PrismaService).client;
    expect(
      await prisma.clientInstallation.count({
        where: { id, userId: user.id },
      }),
    ).toBe(1);
  });

  it("refreshes lastSeenAt only after the refresh window while still accepting metadata changes", async () => {
    const user = await registerVerifiedUser(app, "install-seen");
    const id = randomUUID();
    const first = await register(
      app,
      user.cookies,
      installationPayload(id),
    );
    expect(first.statusCode).toBe(200);
    const firstSeen = first.json().lastSeenAt as string;

    const metadataUpdate = await register(app, user.cookies, {
      ...installationPayload(id),
      appVersion: "web-test-2",
    });
    expect(metadataUpdate.statusCode).toBe(200);
    expect(metadataUpdate.json().appVersion).toBe("web-test-2");
    expect(metadataUpdate.json().lastSeenAt).toBe(firstSeen);

    const prisma = app.get(PrismaService).client;
    await prisma.clientInstallation.update({
      where: { id },
      data: {
        lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const refreshed = await register(app, user.cookies, {
      ...installationPayload(id),
      appVersion: "web-test-2",
    });
    expect(refreshed.statusCode).toBe(200);
    expect(
      Date.parse(refreshed.json().lastSeenAt as string),
    ).toBeGreaterThan(Date.parse(firstSeen));
  });

  it("fails closed for foreign installation ids and never rebinds ownership", async () => {
    const owner = await registerVerifiedUser(app, "install-idor-owner");
    const stranger = await registerVerifiedUser(
      app,
      "install-idor-stranger",
    );
    const id = randomUUID();

    expect(
      (
        await register(
          app,
          owner.cookies,
          installationPayload(id),
        )
      ).statusCode,
    ).toBe(200);

    const foreignRegister = await register(
      app,
      stranger.cookies,
      installationPayload(id),
    );
    expect(foreignRegister.statusCode).toBe(404);
    expect(errorCode(foreignRegister)).toBe("not_found");

    const foreignRevoke = await app.inject({
      method: "POST",
      url: `/v1/client-installations/${id}/revoke`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: {},
    });
    expect(foreignRevoke.statusCode).toBe(404);

    const foreignPreferences = await app.inject({
      method: "PATCH",
      url: `/v1/client-installations/${id}/preferences`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: { pushEnabled: false },
    });
    expect(foreignPreferences.statusCode).toBe(404);

    const prisma = app.get(PrismaService).client;
    expect(
      (
        await prisma.clientInstallation.findUniqueOrThrow({
          where: { id },
        })
      ).userId,
    ).toBe(owner.id);
  });

  it("revokes idempotently and refuses silent re-registration of the revoked id", async () => {
    const user = await registerVerifiedUser(app, "install-revoke");
    const id = randomUUID();
    await register(app, user.cookies, installationPayload(id));

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/client-installations/${id}/revoke`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {},
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revokedAt).not.toBeNull();

    const repeated = await app.inject({
      method: "POST",
      url: `/v1/client-installations/${id}/revoke`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().revokedAt).toBe(
      revoked.json().revokedAt,
    );

    const resurrect = await register(
      app,
      user.cookies,
      installationPayload(id),
    );
    expect(resurrect.statusCode).toBe(409);
    expect(errorCode(resurrect)).toBe("installation_revoked");

    const preference = await app.inject({
      method: "PATCH",
      url: `/v1/client-installations/${id}/preferences`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { pushEnabled: false },
    });
    expect(preference.statusCode).toBe(409);
    expect(errorCode(preference)).toBe("installation_revoked");
  });

  it("fails closed when registration metadata refresh races revocation", async () => {
    const user = await registerVerifiedUser(
      app,
      "install-register-revoke-race",
    );
    const id = randomUUID();
    expect(
      (
        await register(
          app,
          user.cookies,
          installationPayload(id),
        )
      ).statusCode,
    ).toBe(200);

    const prisma = app.get(PrismaService).client;
    type UpdateTarget = {
      update(
        args: Prisma.ClientInstallationUpdateArgs,
      ): Promise<
        Prisma.ClientInstallationGetPayload<{
          include: { preference: true };
        }>
      >;
    };
    const updateTarget =
      prisma.clientInstallation as unknown as UpdateTarget;
    const originalUpdate =
      updateTarget.update.bind(updateTarget);
    const updateSpy = vi
      .spyOn(updateTarget, "update")
      .mockImplementationOnce(async (args) => {
        await prisma.$executeRaw`
          UPDATE "client_installation"
          SET "revokedAt" = CURRENT_TIMESTAMP
          WHERE "id" = CAST(${id} AS UUID)
        `;
        return originalUpdate(args);
      });

    try {
      const raced = await register(app, user.cookies, {
        ...installationPayload(id),
        appVersion: "web-raced",
      });
      expect(raced.statusCode).toBe(409);
      expect(errorCode(raced)).toBe("installation_revoked");
    } finally {
      updateSpy.mockRestore();
    }

    const persisted =
      await prisma.clientInstallation.findUniqueOrThrow({
        where: { id },
      });
    expect(persisted.revokedAt).not.toBeNull();
    expect(persisted.appVersion).toBe("web-test");
  });

  it("serializes preference mutation behind revocation of the same installation", async () => {
    const user = await registerVerifiedUser(
      app,
      "install-preference-revoke-race",
    );
    const id = randomUUID();
    expect(
      (
        await register(
          app,
          user.cookies,
          installationPayload(id),
        )
      ).statusCode,
    ).toBe(200);

    const blocker = createPrismaClient(testDatabaseUrl);
    let releaseLock!: () => void;
    const releaseLockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const holdLock = blocker.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "client_installation"
        WHERE "id" = CAST(${id} AS UUID)
        FOR UPDATE
      `;
      signalLocked();
      await releaseLockPromise;
    });

    try {
      await locked;

      const revokePromise = app.inject({
        method: "POST",
        url: `/v1/client-installations/${id}/revoke`,
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {},
      });
      await sleep(25);

      let preferenceSettled = false;
      const preferencePromise = app
        .inject({
          method: "PATCH",
          url: `/v1/client-installations/${id}/preferences`,
          headers: jsonHeaders(),
          cookies: user.cookies,
          payload: { pushEnabled: true },
        })
        .then((response) => {
          preferenceSettled = true;
          return response;
        });

      await sleep(25);
      expect(preferenceSettled).toBe(false);

      releaseLock();
      const [revoked, preference] = await Promise.all([
        revokePromise,
        preferencePromise,
      ]);
      expect(revoked.statusCode).toBe(200);
      expect(preference.statusCode).toBe(409);
      expect(errorCode(preference)).toBe("installation_revoked");

      const persisted =
        await app
          .get(PrismaService)
          .client.clientInstallationPreference.findUniqueOrThrow({
            where: { installationId: id },
          });
      expect(persisted.pushEnabled).toBe(false);
    } finally {
      releaseLock();
      await holdLock;
      await blocker.$disconnect();
    }
  });

  it("requires a verified authenticated session and rejects authority or malformed metadata", async () => {
    const id = randomUUID();
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/client-installations/register",
      headers: jsonHeaders(),
      payload: installationPayload(id),
    });
    expect(anonymous.statusCode).toBe(401);

    const unverified = await registerUnverifiedUser(
      app,
      "install-unverified",
    );
    const blocked = await register(
      app,
      unverified.cookies,
      installationPayload(id),
    );
    expect(blocked.statusCode).toBe(403);
    expect(errorCode(blocked)).toBe("email_not_verified");

    const user = await registerVerifiedUser(app, "install-invalid");
    for (const payload of [
      {
        ...installationPayload(randomUUID()),
        userId: "other-user",
      },
      {
        ...installationPayload(randomUUID()),
        kind: "SERVER",
      },
      {
        ...installationPayload(randomUUID()),
        protocolVersion: 0,
      },
      {
        ...installationPayload(randomUUID()),
        capabilities: ["sync.v1", "sync.v1"],
      },
      {
        ...installationPayload(randomUUID()),
        capabilities: ["ADMIN ACCESS"],
      },
      {
        ...installationPayload(randomUUID()),
        appVersion: "web\u0000test",
      },
    ]) {
      const response = await register(app, user.cookies, payload);
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe("validation_error");
    }
  });

  it("rate limits installation mutations per authenticated user", async () => {
    const previous =
      process.env.CLIENT_INSTALLATIONS_MUTATION_LIMIT_PER_MINUTE;
    process.env.CLIENT_INSTALLATIONS_MUTATION_LIMIT_PER_MINUTE = "2";
    const config = loadApiConfig(process.env);
    if (previous === undefined) {
      delete process.env.CLIENT_INSTALLATIONS_MUTATION_LIMIT_PER_MINUTE;
    } else {
      process.env.CLIENT_INSTALLATIONS_MUTATION_LIMIT_PER_MINUTE =
        previous;
    }

    const isolated = await createVimlaApiApp(config, {
      quiet: true,
    });
    await isolated.init();
    await isolated.getHttpAdapter().getInstance().ready();
    try {
      const user = await registerVerifiedUser(
        isolated,
        "install-rate-limit",
      );
      const first = await register(
        isolated,
        user.cookies,
        installationPayload(randomUUID()),
      );
      const second = await register(
        isolated,
        user.cookies,
        installationPayload(randomUUID()),
      );
      const blocked = await register(
        isolated,
        user.cookies,
        installationPayload(randomUUID()),
      );
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(blocked.statusCode).toBe(429);
      expect(errorCode(blocked)).toBe("rate_limited");
    } finally {
      await isolated.close();
    }
  });

  it("enforces installation metadata constraints in PostgreSQL", async () => {
    const user = await registerVerifiedUser(app, "install-db-check");
    const prisma = app.get(PrismaService).client;
    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "SERVER",
          appVersion: "bad",
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "bad",
          protocolVersion: 0,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: "not-a-uuid",
          userId: user.id,
          kind: "WEB",
          appVersion: "bad",
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: "00000000-0000-0000-0000-000000000000",
          userId: user.id,
          kind: "WEB",
          appVersion: "bad",
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "x".repeat(65),
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "😀".repeat(64),
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).resolves.toBeDefined();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "😀".repeat(65),
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "web\u0000test",
          protocolVersion: 1,
          capabilities: [],
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.clientInstallation.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          kind: "WEB",
          appVersion: "bad",
          protocolVersion: 1,
          capabilities: Array.from(
            { length: 33 },
            (_, index) => `capability.${index}`,
          ),
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "client_installation" (
          "id",
          "userId",
          "kind",
          "appVersion",
          "protocolVersion",
          "capabilities"
        )
        VALUES (
          ${randomUUID()},
          ${user.id},
          'WEB',
          'bad',
          1,
          ARRAY[['sync.v1'], ['realtime.v1']]::TEXT[]
        )
      `,
    ).rejects.toThrow();

    for (const capabilities of [
      [""],
      ["ADMIN ACCESS"],
      ["x".repeat(65)],
      ["sync.v1", "sync.v1"],
    ]) {
      await expect(
        prisma.clientInstallation.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            kind: "WEB",
            appVersion: "bad",
            protocolVersion: 1,
            capabilities,
          },
        }),
      ).rejects.toThrow();
    }
  });

  it("updates installation-scoped preferences without changing account preferences", async () => {
    const user = await registerVerifiedUser(app, "install-pref");
    const id = randomUUID();
    await register(app, user.cookies, installationPayload(id));

    const prisma = app.get(PrismaService).client;
    const accountPreferenceBefore =
      await prisma.userPreference.findUnique({
        where: { userId: user.id },
      });

    const changed = await app.inject({
      method: "PATCH",
      url: `/v1/client-installations/${id}/preferences`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { pushEnabled: false },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().preferences).toEqual({
      pushEnabled: false,
    });

    const accountPreferenceAfter =
      await prisma.userPreference.findUnique({
        where: { userId: user.id },
      });
    expect(accountPreferenceAfter).toEqual(accountPreferenceBefore);
  });
});

function installationPayload(id: string): Record<string, unknown> {
  return {
    id,
    kind: "WEB",
    appVersion: "web-test",
    protocolVersion: 1,
    capabilities: ["sync.v1", "realtime.v1"],
  };
}

async function register(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/v1/client-installations/register",
    headers: jsonHeaders(),
    cookies,
    payload,
  });
}

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}

function errorCode(response: { json: () => unknown }): string {
  const body = response.json() as {
    error?: { code?: string };
  };
  return body.error?.code ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
