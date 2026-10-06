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
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("trust safety API", () => {
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
      process.env.REDIS_URL ??
      "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ??
      "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3001";
    process.env.DIRECT_CHATS_ENABLED = "true";

    const prisma =
      createPrismaClient(testDatabaseUrl);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, {
      quiet: true,
    });
    await app.init();
    await app
      .getHttpAdapter()
      .getInstance()
      .ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("enforces block bidirectionally across discovery and Direct Chat while preserving history", async () => {
    const alice = await registerVerifiedUser(
      app,
      "trust-block-alice",
    );
    const bob = await registerVerifiedUser(
      app,
      "trust-block-bob",
    );

    const created = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { peerHandle: bob.handle },
    });
    expect(created.statusCode).toBe(201);
    const direct = created.json() as {
      id: string;
      surfaceId: string;
    };

    const block = await app.inject({
      method: "POST",
      url: "/v1/trust/blocks",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { handle: bob.handle },
    });
    expect(block.statusCode).toBe(200);
    expect(block.json()).toEqual({
      handle: bob.handle,
      blockedByMe: true,
    });

    const blockedList = await app.inject({
      method: "GET",
      url: "/v1/trust/blocks",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(blockedList.statusCode).toBe(200);
    expect(blockedList.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: bob.id,
          handle: bob.handle,
        }),
      ]),
    );
    expect(blockedList.body).not.toContain(bob.email);

    for (const [viewer, target] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const search = await app.inject({
        method: "GET",
        url: `/v1/people?q=${encodeURIComponent(
          `@${target.handle}`,
        )}&limit=10`,
        headers: { origin },
        cookies: viewer.cookies,
      });
      expect(search.statusCode).toBe(200);
      expect(
        search.json().items.some(
          (item: { userId: string }) =>
            item.userId === target.id,
        ),
      ).toBe(false);

      const start = await app.inject({
        method: "POST",
        url: "/v1/direct-chats",
        headers: jsonHeaders(),
        cookies: viewer.cookies,
        payload: {
          peerHandle: target.handle,
        },
      });
      expect(start.statusCode).toBe(404);
    }

    const directSearch = await app.inject({
      method: "GET",
      url: `/v1/inbox?kind=DIRECT&q=${encodeURIComponent(
        bob.handle,
      )}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(directSearch.statusCode).toBe(200);
    expect(
      directSearch
        .json()
        .items.some(
          (item: { domainId: string }) =>
            item.domainId === direct.id,
        ),
    ).toBe(false);

    const mentionSuggestions = await app.inject({
      method: "GET",
      url: `/v1/mentions?q=${encodeURIComponent(
        bob.handle,
      )}&directConversationId=${direct.id}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(mentionSuggestions.statusCode).toBe(200);
    expect(
      mentionSuggestions
        .json()
        .people.some(
          (item: { handle: string }) =>
            item.handle === bob.handle,
        ),
    ).toBe(false);

    const history = await app.inject({
      method: "GET",
      url: `/v1/direct-chats/${direct.id}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(history.statusCode).toBe(200);

    const prekeys = await app.inject({
      method: "GET",
      url: `/v1/direct-chats/users/${bob.id}/prekeys`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(prekeys.statusCode).toBe(404);

    const unblock = await app.inject({
      method: "DELETE",
      url: `/v1/trust/blocks/${bob.handle}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(unblock.statusCode).toBe(200);
    expect(unblock.json()).toEqual({
      handle: bob.handle,
      blockedByMe: false,
    });

    const restored = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { peerHandle: bob.handle },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().id).toBe(direct.id);
  });

  it("keeps unblock actor-owned and paginates blocked users", async () => {
    const actor = await registerVerifiedUser(
      app,
      "trust-block-list-actor",
    );
    const targets = await Promise.all(
      ["a", "b", "c"].map((suffix) =>
        registerVerifiedUser(
          app,
          `trust-block-list-${suffix}`,
        ),
      ),
    );
    const stranger = await registerVerifiedUser(
      app,
      "trust-block-list-stranger",
    );

    for (const target of targets) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/trust/blocks",
        headers: jsonHeaders(),
        cookies: actor.cookies,
        payload: { handle: target.handle },
      });
      expect(response.statusCode).toBe(200);
    }

    const first = await app.inject({
      method: "GET",
      url: "/v1/trust/blocks?limit=2",
      headers: { origin },
      cookies: actor.cookies,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v1/trust/blocks?limit=2&cursor=${first.json().nextCursor}`,
      headers: { origin },
      cookies: actor.cookies,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().nextCursor).toBeNull();

    const notMine = await app.inject({
      method: "DELETE",
      url: `/v1/trust/blocks/${stranger.handle}`,
      headers: { origin },
      cookies: actor.cookies,
    });
    expect(notMine.statusCode).toBe(404);
  });

  it("persists mute only for authorized communication-surface members", async () => {
    const alice = await registerVerifiedUser(
      app,
      "trust-mute-alice",
    );
    const bob = await registerVerifiedUser(
      app,
      "trust-mute-bob",
    );
    const outsider = await registerVerifiedUser(
      app,
      "trust-mute-outsider",
    );

    const created = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { peerHandle: bob.handle },
    });
    expect(created.statusCode).toBe(201);
    const surfaceId = created.json().surfaceId as string;

    const muted = await app.inject({
      method: "PATCH",
      url: `/v1/trust/surfaces/${surfaceId}/preference`,
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: { muted: true },
    });
    expect(muted.statusCode).toBe(200);
    expect(muted.json()).toMatchObject({
      surfaceId,
      muted: true,
    });

    const mine = await app.inject({
      method: "GET",
      url: `/v1/trust/surfaces/${surfaceId}/preference`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().muted).toBe(true);

    const peer = await app.inject({
      method: "GET",
      url: `/v1/trust/surfaces/${surfaceId}/preference`,
      headers: { origin },
      cookies: bob.cookies,
    });
    expect(peer.statusCode).toBe(200);
    expect(peer.json().muted).toBe(false);

    const denied = await app.inject({
      method: "GET",
      url: `/v1/trust/surfaces/${surfaceId}/preference`,
      headers: { origin },
      cookies: outsider.cookies,
    });
    expect(denied.statusCode).toBe(404);
  });

  it("accepts only explicit actor-authorized E2EE evidence with server-verified provenance", async () => {
    const alice = await registerVerifiedUser(
      app,
      "trust-report-alice",
    );
    const bob = await registerVerifiedUser(
      app,
      "trust-report-bob",
    );
    const outsider = await registerVerifiedUser(
      app,
      "trust-report-outsider",
    );
    const db = app.get(PrismaService).client;

    const direct =
      await db.directConversation.create({
        data: {
          pairKey: `trust-report-${randomUUID()}`,
          members: {
            create: [
              { userId: alice.id },
              { userId: bob.id },
            ],
          },
        },
      });
    const senderDevice =
      await db.userCryptoDevice.create({
        data: {
          userId: bob.id,
          identityEd25519Public:
            "trust-report-ed25519",
          identityX25519Public:
            "trust-report-x25519",
          signedPrekeyId: 1,
          signedPrekeyPublic:
            "trust-report-signed",
          signedPrekeySignature:
            "trust-report-signature",
        },
      });
    const message = await db.directMessage.create({
      data: {
        conversationId: direct.id,
        senderUserId: bob.id,
        senderDeviceId: senderDevice.id,
        clientMessageId: randomUUID(),
        kind: "HUMAN",
      },
    });

    const foreign =
      await db.directConversation.create({
        data: {
          pairKey: `trust-report-foreign-${randomUUID()}`,
          members: {
            create: [
              { userId: bob.id },
              { userId: outsider.id },
            ],
          },
        },
      });
    const foreignMessage =
      await db.directMessage.create({
        data: {
          conversationId: foreign.id,
          senderUserId: bob.id,
          senderDeviceId: senderDevice.id,
          clientMessageId: randomUUID(),
          kind: "HUMAN",
        },
      });

    const forged = await app.inject({
      method: "POST",
      url: "/v1/trust/reports",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: {
        reporterUserId: outsider.id,
        targetHandle: bob.handle,
        reason: "HARASSMENT",
      },
    });
    expect(forged.statusCode).toBe(400);

    const foreignEvidence = await app.inject({
      method: "POST",
      url: "/v1/trust/reports",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: {
        targetHandle: bob.handle,
        reason: "HARASSMENT",
        evidence: {
          kind: "DIRECT_MESSAGE",
          conversationId: foreign.id,
          messageId: foreignMessage.id,
          disclosedText: "Not Alice's conversation",
        },
      },
    });
    expect(foreignEvidence.statusCode).toBe(400);

    const disclosedText =
      "  Explicitly selected decrypted message\n";
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/trust/reports",
      headers: jsonHeaders(),
      cookies: alice.cookies,
      payload: {
        targetHandle: bob.handle,
        reason: "THREATS",
        details: "Context supplied by the reporter",
        evidence: {
          kind: "DIRECT_MESSAGE",
          conversationId: direct.id,
          messageId: message.id,
          disclosedText,
        },
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.body).not.toContain(disclosedText);
    const reportId = accepted.json().id as string;

    const stored =
      await db.abuseReport.findUniqueOrThrow({
        where: { id: reportId },
      });
    expect(stored).toMatchObject({
      reporterUserId: alice.id,
      targetUserId: bob.id,
      evidenceKind: "DIRECT_MESSAGE",
      directConversationId: direct.id,
      directMessageId: message.id,
      evidenceSenderUserId: bob.id,
      evidenceSenderDeviceId: senderDevice.id,
      evidenceMessageKind: "HUMAN",
      evidenceText: disclosedText,
    });
    expect(
      stored.evidenceMessageCreatedAt?.toISOString(),
    ).toBe(message.createdAt.toISOString());
  });

  it("rate-limits report abuse independently from ordinary safety reads", async () => {
    const reporter = await registerVerifiedUser(
      app,
      "trust-rate-reporter",
    );
    const target = await registerVerifiedUser(
      app,
      "trust-rate-target",
    );

    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/trust/reports",
        headers: jsonHeaders(),
        cookies: reporter.cookies,
        payload: {
          targetHandle: target.handle,
          reason: "SPAM",
          details: `Occurrence ${index}`,
        },
      });
      expect(response.statusCode).toBe(201);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/trust/reports",
      headers: jsonHeaders(),
      cookies: reporter.cookies,
      payload: {
        targetHandle: target.handle,
        reason: "SPAM",
      },
    });
    expect(limited.statusCode).toBe(429);

    const readsStillWork = await app.inject({
      method: "GET",
      url: "/v1/trust/blocks",
      headers: { origin },
      cookies: reporter.cookies,
    });
    expect(readsStillWork.statusCode).toBe(200);
  });
});

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}
