import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("memory API", () => {
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
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3001";
    process.env.MEMORY_ENABLED = "true";
    process.env.PROJECTS_ENABLED = "true";
    process.env.DIRECT_CHATS_ENABLED = "true";

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

  it("fails closed when durable Memory is disabled", async () => {
    const previous = process.env.MEMORY_ENABLED;
    process.env.MEMORY_ENABLED = "false";
    const config = loadApiConfig(process.env);
    expect(config.memoryEnabled).toBe(false);
    process.env.MEMORY_ENABLED = previous ?? "true";

    const isolated = await createVimlaApiApp(config, {
      quiet: true,
    });
    await isolated.init();
    await isolated.getHttpAdapter().getInstance().ready();
    try {
      const user = await registerVerifiedUser(
        isolated,
        "memory-disabled",
      );
      const response = await isolated.inject({
        method: "POST",
        url: "/v1/memory",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {
          type: "USER_FACT",
          slotKey: "disabled",
          content: "must not persist",
        },
      });
      expect(response.statusCode).toBe(503);
      expect(errorCode(response)).toBe("memory_disabled");
    } finally {
      await isolated.close();
    }
  });

  it("supports inspect/correct/delete while preventing authority injection and IDOR", async () => {
    const owner = await registerVerifiedUser(
      app,
      "memory-owner",
    );
    const stranger = await registerVerifiedUser(
      app,
      "memory-stranger",
    );

    const injected = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        type: "USER_PREFERENCE",
        slotKey: "answer style",
        content: "Concise",
        userId: stranger.id,
        scopeKind: "PROJECT",
      },
    });
    expect(injected.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        type: "USER_PREFERENCE",
        slotKey: "answer style",
        content: "Prefers concise answers",
      },
    });
    expect(created.statusCode).toBe(201);
    const first = created.json() as {
      id: string;
      content: string;
      origin: string;
    };
    expect(first.origin).toBe("USER_EXPLICIT");

    const stolen = await app.inject({
      method: "GET",
      url: `/v1/memory/${first.id}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.statusCode).toBe(404);

    const corrected = await app.inject({
      method: "PATCH",
      url: `/v1/memory/${first.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        content: "Prefers concise technical answers",
      },
    });
    expect(corrected.statusCode).toBe(200);
    const current = corrected.json() as {
      id: string;
      content: string;
      origin: string;
      userCorrectedAt: string | null;
    };
    expect(current.id).not.toBe(first.id);
    expect(current.origin).toBe("USER_CORRECTION");
    expect(current.userCorrectedAt).not.toBeNull();

    const db = app.get(PrismaService).client;
    expect(
      (
        await db.memoryItem.findUnique({
          where: { id: first.id },
        })
      )?.state,
    ).toBe("SUPERSEDED");

    const listed = await app.inject({
      method: "GET",
      url: "/v1/memory?limit=10",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(listed.statusCode).toBe(200);
    const items = (
      listed.json() as {
        items: Array<{ id: string }>;
      }
    ).items;
    expect(items.map((item) => item.id)).toContain(current.id);
    expect(items.map((item) => item.id)).not.toContain(first.id);

    const secret = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        type: "USER_FACT",
        slotKey: "credential",
        content:
          "api_key=sk-super-sensitive-credential-value-123456789",
      },
    });
    expect(secret.statusCode).toBe(400);
    expect(errorCode(secret)).toBe(
      "memory_sensitive_content",
    );

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/memory/${current.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/v1/memory/${current.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(gone.statusCode).toBe(404);
    expect(
      (
        await db.memoryItem.findUnique({
          where: { id: current.id },
        })
      )?.state,
    ).toBe("INVALIDATED");
  });

  it("creates Project Memory only through an explicit authorized project write", async () => {
    const owner = await registerVerifiedUser(
      app,
      "memory-project-owner",
    );
    const db = app.get(PrismaService).client;
    const project = await db.project.create({
      data: {
        ownerUserId: owner.id,
        name: "Memory Project",
        members: {
          create: {
            userId: owner.id,
            role: "OWNER",
          },
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/memory/projects/${project.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        type: "PROJECT_DECISION",
        slotKey: "launch window",
        content: "Launch window is October",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      scopeKind: "PROJECT",
      projectId: project.id,
      type: "PROJECT_DECISION",
      slotKey: "launch window",
      content: "Launch window is October",
      origin: "USER_EXPLICIT",
    });
  });

  it("creates Project Memory only through an explicit authorized project write", async () => {
    const owner = await registerVerifiedUser(
      app,
      "memory-project-owner",
    );
    const outsider = await registerVerifiedUser(
      app,
      "memory-project-outsider",
    );
    const db = app.get(PrismaService).client;
    const project = await db.project.create({
      data: {
        ownerUserId: owner.id,
        name: "Memory Project",
        members: {
          create: {
            userId: owner.id,
            role: "OWNER",
          },
        },
      },
    });

    const created = await app.inject({
      method: "POST",
      url: `/v1/memory/projects/${project.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        type: "PROJECT_DECISION",
        slotKey: "launch region",
        content: "Launch in Europe",
      },
    });
    expect(created.statusCode).toBe(201);
    const memory = created.json() as {
      id: string;
      scopeKind: string;
      projectId: string | null;
      origin: string;
    };
    expect(memory).toMatchObject({
      scopeKind: "PROJECT",
      projectId: project.id,
      origin: "USER_EXPLICIT",
    });

    const persisted = await db.memoryItem.findUniqueOrThrow({
      where: { id: memory.id },
      include: { sourceRefs: true },
    });
    expect(persisted.projectId).toBe(project.id);
    expect(persisted.sourceRefs).toHaveLength(1);
    expect(persisted.sourceRefs[0]).toMatchObject({
      provenance: "USER_EXPLICIT",
      sourceType: "USER_EXPLICIT",
      sourceScopeKind: "PERSONAL",
      sourceScopeId: owner.id,
    });

    const denied = await app.inject({
      method: "POST",
      url: `/v1/memory/projects/${project.id}`,
      headers: jsonHeaders(),
      cookies: outsider.cookies,
      payload: {
        type: "PROJECT_FACT",
        slotKey: "stolen project fact",
        content: "Must not persist",
      },
    });
    expect(denied.statusCode).toBe(404);
    expect(errorCode(denied)).toBe("not_found");
    expect(
      await db.memoryItem.count({
        where: {
          ownerUserId: outsider.id,
          projectId: project.id,
        },
      }),
    ).toBe(0);
  });

  it("promotes exactly one explicit E2EE fact with disclosure provenance and no hidden authority", async () => {
    const actor = await registerVerifiedUser(
      app,
      "memory-e2ee-actor",
    );
    const peer = await registerVerifiedUser(
      app,
      "memory-e2ee-peer",
    );
    const outsider = await registerVerifiedUser(
      app,
      "memory-e2ee-outsider",
    );
    const db = app.get(PrismaService).client;
    const device = await db.userCryptoDevice.create({
      data: {
        userId: actor.id,
        identityEd25519Public: "ed25519-memory-test",
        identityX25519Public: "x25519-memory-test",
        signedPrekeyId: 1,
        signedPrekeyPublic: "signed-prekey-memory-test",
        signedPrekeySignature: "signature-memory-test",
      },
    });
    const conversation = await db.directConversation.create({
      data: {
        pairKey: [actor.id, peer.id].sort().join(":"),
        members: {
          create: [
            { userId: actor.id },
            { userId: peer.id },
          ],
        },
      },
    });
    const source = await db.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderUserId: actor.id,
        senderDeviceId: device.id,
        clientMessageId: randomUUID(),
        kind: "HUMAN",
      },
    });

    const promoted = await app.inject({
      method: "POST",
      url: "/v1/memory/e2ee-promotions",
      headers: jsonHeaders(),
      cookies: actor.cookies,
      payload: {
        directConversationId: conversation.id,
        sourceMessageId: source.id,
        type: "USER_PREFERENCE",
        slotKey: "coffee",
        content: "Prefers black coffee",
      },
    });
    expect(promoted.statusCode).toBe(201);
    const memory = promoted.json() as {
      id: string;
      origin: string;
      content: string;
    };
    expect(memory.origin).toBe("E2EE_USER_DISCLOSURE");
    expect(memory.content).toBe("Prefers black coffee");

    const persisted = await db.memoryItem.findUniqueOrThrow({
      where: { id: memory.id },
      include: { sourceRefs: true },
    });
    expect(persisted.sourceRefs).toHaveLength(1);
    expect(persisted.sourceRefs[0]).toMatchObject({
      provenance: "E2EE_USER_DISCLOSURE",
      sourceType: "E2EE_USER_DISCLOSURE",
      sourceId: source.id,
      sourceScopeKind: "DIRECT_CHAT",
      sourceScopeId: conversation.id,
    });

    const forged = await app.inject({
      method: "POST",
      url: "/v1/memory/e2ee-promotions",
      headers: jsonHeaders(),
      cookies: outsider.cookies,
      payload: {
        directConversationId: conversation.id,
        sourceMessageId: source.id,
        type: "USER_FACT",
        slotKey: "forged",
        content: "Must not be remembered",
      },
    });
    expect(forged.statusCode).toBe(404);

    expect(
      await db.memoryItem.count({
        where: {
          ownerUserId: outsider.id,
          origin: "E2EE_USER_DISCLOSURE",
        },
      }),
    ).toBe(0);
  });

  it("rate-limits memory mutations per user", async () => {
    const config = loadApiConfig({
      ...process.env,
      MEMORY_ENABLED: "true",
      MEMORY_MUTATION_LIMIT_PER_MINUTE: "1",
      MEMORY_MAX_ACTIVE_PERSONAL_ITEMS: "1000",
    });
    const isolated = await createVimlaApiApp(config, {
      quiet: true,
    });
    await isolated.init();
    await isolated.getHttpAdapter().getInstance().ready();
    try {
      const user = await registerVerifiedUser(
        isolated,
        "memory-rate-limit",
      );
      const first = await isolated.inject({
        method: "POST",
        url: "/v1/memory",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {
          type: "USER_FACT",
          slotKey: "rate-one",
          content: "First memory mutation",
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await isolated.inject({
        method: "POST",
        url: "/v1/memory",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {
          type: "USER_FACT",
          slotKey: "rate-two",
          content: "Second memory mutation",
        },
      });
      expect(second.statusCode).toBe(429);
      expect(errorCode(second)).toBe("rate_limited");
    } finally {
      await isolated.close();
    }
  });

  it("enforces the configured active personal memory storage cap", async () => {
    const config = loadApiConfig({
      ...process.env,
      MEMORY_ENABLED: "true",
      MEMORY_MUTATION_LIMIT_PER_MINUTE: "100",
      MEMORY_MAX_ACTIVE_PERSONAL_ITEMS: "1",
    });
    const isolated = await createVimlaApiApp(config, {
      quiet: true,
    });
    await isolated.init();
    await isolated.getHttpAdapter().getInstance().ready();
    try {
      const user = await registerVerifiedUser(
        isolated,
        "memory-storage-cap",
      );
      const first = await isolated.inject({
        method: "POST",
        url: "/v1/memory",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {
          type: "USER_FACT",
          slotKey: "cap-one",
          content: "First retained fact",
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await isolated.inject({
        method: "POST",
        url: "/v1/memory",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: {
          type: "USER_GOAL",
          slotKey: "cap-two",
          content: "Second retained fact",
        },
      });
      expect(second.statusCode).toBe(409);
      expect(errorCode(second)).toBe("conflict");
    } finally {
      await isolated.close();
    }
  });

});

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}

function errorCode(response: {
  json: () => unknown;
}): string {
  const body = response.json() as {
    error?: { code?: string };
  };
  return body.error?.code ?? "";
}
