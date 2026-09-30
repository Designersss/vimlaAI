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
import {
  SYNC_PROTOCOL_VERSION,
  syncResponseSchema,
} from "@vimla/contracts";
import type { PrismaClient } from "@vimla/database";
import { PrismaDirectChatDurableEventWriter } from "@vimla/direct-chats";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";
import { SyncCursorCodec } from "./sync-cursor.codec.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("durable cursor sync API", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    configureTestEnv();
    app = await createVimlaApiApp(
      loadApiConfig(process.env),
      { quiet: true },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService).client;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("recovers offline events with bounded pagination and deterministic replay", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-offline-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-offline-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );

    const events = [];
    for (let index = 1; index <= 4; index += 1) {
      events.push(
        await seedDirectCreatedEvent(
          prisma,
          owner.id,
          conversationId,
          BigInt(index),
        ),
      );
    }

    const first = await syncRequest(app, owner.cookies, {
      limit: 2,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    const firstBody = syncResponseSchema.parse(first.json());
    expect(firstBody.syncProtocolVersion).toBe(
      SYNC_PROTOCOL_VERSION,
    );
    expect(
      firstBody.deltas.map((delta) => delta.eventId),
    ).toEqual(events.slice(0, 2));
    expect(firstBody.hasMore).toBe(true);

    const second = await syncRequest(app, owner.cookies, {
      cursor: firstBody.nextCursor,
      limit: 2,
    });
    const secondBody = syncResponseSchema.parse(
      second.json(),
    );
    expect(
      secondBody.deltas.map((delta) => delta.eventId),
    ).toEqual(events.slice(2));
    expect(secondBody.hasMore).toBe(false);

    const duplicate = await syncRequest(
      app,
      owner.cookies,
      {
        cursor: firstBody.nextCursor,
        limit: 2,
      },
    );
    expect(syncResponseSchema.parse(duplicate.json())).toEqual(
      secondBody,
    );
  });

  it("binds cursors to the authenticated user and normalizes malformed/stale cursor errors", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-cursor-owner",
    );
    const stranger = await registerVerifiedUser(
      app,
      "sync-cursor-stranger",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-cursor-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );
    await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      1n,
    );

    const page = await syncRequest(app, owner.cookies, {
      limit: 1,
    });
    const body = syncResponseSchema.parse(page.json());

    const foreign = await syncRequest(
      app,
      stranger.cookies,
      {
        cursor: body.nextCursor,
        limit: 1,
      },
    );
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toMatchObject({
      error: { code: "sync_cursor_invalid" },
    });

    const malformed = await syncRequest(
      app,
      owner.cookies,
      {
        cursor: "abc.def",
        limit: 1,
      },
    );
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({
      error: { code: "sync_cursor_invalid" },
    });

    await prisma.userSyncState.update({
      where: { userId: owner.id },
      data: { minRetainedPosition: 1n },
    });
    const zeroCursor = app
      .get(SyncCursorCodec)
      .encode(owner.id, {
        position: 0n,
        snapshotHead: 1n,
      });
    const stale = await syncRequest(app, owner.cookies, {
      cursor: zeroCursor,
      limit: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "sync_cursor_stale" },
    });

    const unsupported = await app.inject({
      method: "GET",
      url: "/v1/sync?protocolVersion=2&limit=1",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({
      error: { code: "sync_protocol_unsupported" },
    });
  });

  it("rechecks membership between pages while still delivering identifier-only tombstones", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-revoke-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-revoke-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );
    const firstEvent = await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      1n,
    );
    await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      2n,
    );

    const first = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          limit: 1,
        })
      ).json(),
    );
    expect(first.deltas[0]?.eventId).toBe(firstEvent);

    await prisma.directConversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId,
          userId: owner.id,
        },
      },
    });

    const revoked = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          cursor: first.nextCursor,
          limit: 10,
        })
      ).json(),
    );
    expect(revoked.deltas).toEqual([]);
    expect(revoked.hasMore).toBe(false);

    const tombstoneEventId = randomUUID();
    const deletedMessageId = randomUUID();
    await seedSyncEvent(prisma, {
      userId: owner.id,
      conversationId,
      position: 3n,
      eventId: tombstoneEventId,
      eventType: "DIRECT_MESSAGE_DELETED",
      changeKind: "TOMBSTONE",
      payload: {
        conversationId,
        messageId: deletedMessageId,
      },
    });

    const tombstone = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          cursor: revoked.nextCursor,
          limit: 10,
        })
      ).json(),
    );
    expect(tombstone.deltas).toEqual([
      {
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        eventId: tombstoneEventId,
        eventType: "DIRECT_MESSAGE_DELETED",
        changeKind: "TOMBSTONE",
        scope: {
          kind: "DIRECT_CHAT",
          id: conversationId,
        },
        occurredAt:
          tombstone.deltas[0]?.occurredAt,
        payload: {
          conversationId,
          messageId: deletedMessageId,
        },
      },
    ]);
  });

  it("keeps an in-progress pagination snapshot stable while concurrent writes append", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-snapshot-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-snapshot-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );

    const firstEvent = await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      1n,
    );
    const secondEvent = await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      2n,
    );
    const thirdEvent = await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      3n,
    );

    const firstPage = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          limit: 1,
        })
      ).json(),
    );
    expect(
      firstPage.deltas.map(
        (delta) => delta.eventId,
      ),
    ).toEqual([firstEvent]);
    expect(firstPage.hasMore).toBe(true);

    const appendedEvent =
      await seedDirectCreatedEvent(
        prisma,
        owner.id,
        conversationId,
        4n,
      );

    const secondPage = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          cursor: firstPage.nextCursor,
          limit: 10,
        })
      ).json(),
    );
    expect(
      secondPage.deltas.map(
        (delta) => delta.eventId,
      ),
    ).toEqual([secondEvent, thirdEvent]);
    expect(secondPage.hasMore).toBe(false);

    const nextSnapshot = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          cursor: secondPage.nextCursor,
          limit: 10,
        })
      ).json(),
    );
    expect(
      nextSnapshot.deltas.map(
        (delta) => delta.eventId,
      ),
    ).toEqual([appendedEvent]);
    expect(nextSnapshot.hasMore).toBe(false);
  });

  it("recovers writes appended after a completed page and survives API process restart", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-restart-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-restart-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );
    await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      1n,
    );

    const initial = syncResponseSchema.parse(
      (
        await syncRequest(app, owner.cookies, {
          limit: 10,
        })
      ).json(),
    );
    expect(initial.hasMore).toBe(false);

    const appended = await seedDirectCreatedEvent(
      prisma,
      owner.id,
      conversationId,
      2n,
    );

    const restarted = await createVimlaApiApp(
      loadApiConfig(process.env),
      { quiet: true },
    );
    await restarted.init();
    await restarted
      .getHttpAdapter()
      .getInstance()
      .ready();
    try {
      const recovered = syncResponseSchema.parse(
        (
          await syncRequest(
            restarted,
            owner.cookies,
            {
              cursor: initial.nextCursor,
              limit: 10,
            },
          )
        ).json(),
      );
      expect(
        recovered.deltas.map(
          (delta) => delta.eventId,
        ),
      ).toEqual([appended]);
      expect(recovered.hasMore).toBe(false);
    } finally {
      await restarted.close();
    }
  });

  it("fails closed on corrupted persisted sync data without advancing client state", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-corrupt-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-corrupt-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );
    const messageId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.userSyncState.create({
        data: {
          userId: owner.id,
          lastPosition: 1n,
          minRetainedPosition: 0n,
        },
      });
      await tx.durableEvent.create({
        data: {
          id: messageId,
          protocolVersion: 1,
          eventType: "DIRECT_MESSAGE_CREATED",
          durability: "DURABLE_HINT",
          changeKind: "UPSERT_REF",
          scopeKind: "DIRECT_CHAT",
          scopeId: conversationId,
          occurredAt: new Date(),
          payload: {
            conversationId,
            messageId,
            plaintext: "must-never-leak",
          },
          recipients: {
            create: {
              userId: owner.id,
              position: 1n,
            },
          },
        },
      });
    });

    const response = await syncRequest(
      app,
      owner.cookies,
      { limit: 10 },
    );
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: "internal_error" },
    });

    const repaired = {
      conversationId,
      messageId,
    };
    await prisma.durableEvent.update({
      where: { id: messageId },
      data: { payload: repaired },
    });
    const afterRepair = syncResponseSchema.parse(
      (
        await syncRequest(
          app,
          owner.cookies,
          { limit: 10 },
        )
      ).json(),
    );
    expect(
      afterRepair.deltas.map(
        (delta) => delta.eventId,
      ),
    ).toEqual([messageId]);
  });

  it("serializes concurrent per-user positions without duplicates or gaps", async () => {
    const owner = await registerVerifiedUser(
      app,
      "sync-order-owner",
    );
    const peer = await registerVerifiedUser(
      app,
      "sync-order-peer",
    );
    const conversationId = await createDirectConversation(
      prisma,
      owner.id,
      peer.id,
    );
    const writer =
      new PrismaDirectChatDurableEventWriter();

    const messageIds = Array.from(
      { length: 20 },
      () => randomUUID(),
    );
    await Promise.all(
      messageIds.map((messageId) =>
        prisma.$transaction((tx) =>
          writer.directMessageCreated(tx, {
            conversationId,
            messageId,
            occurredAt: new Date(),
            recipientUserIds: [
              owner.id,
              peer.id,
            ],
          }),
        ),
      ),
    );

    for (const userId of [owner.id, peer.id]) {
      const rows =
        await prisma.durableEventRecipient.findMany({
          where: {
            userId,
            eventId: { in: messageIds },
          },
          orderBy: { position: "asc" },
          select: { position: true },
        });
      expect(
        rows.map((row) => row.position),
      ).toEqual(
        Array.from(
          { length: 20 },
          (_value, index) => BigInt(index + 1),
        ),
      );
      const state =
        await prisma.userSyncState.findUniqueOrThrow({
          where: { userId },
        });
      expect(state.lastPosition).toBe(20n);
    }
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/sync?protocolVersion=1",
      headers: { origin },
    });
    expect(response.statusCode).toBe(401);
  });
});

async function syncRequest(
  target: NestFastifyApplication,
  cookies: Record<string, string>,
  input: {
    cursor?: string;
    limit?: number;
  },
) {
  const query = new URLSearchParams({
    protocolVersion: "1",
  });
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }
  return target.inject({
    method: "GET",
    url: `/v1/sync?${query.toString()}`,
    headers: { origin },
    cookies,
  });
}

async function createDirectConversation(
  db: PrismaClient,
  firstUserId: string,
  secondUserId: string,
): Promise<string> {
  const conversation = await db.directConversation.create({
    data: {
      pairKey: randomUUID(),
      members: {
        create: [
          { userId: firstUserId },
          { userId: secondUserId },
        ],
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

async function seedDirectCreatedEvent(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  position: bigint,
): Promise<string> {
  const messageId = randomUUID();
  await seedSyncEvent(db, {
    userId,
    conversationId,
    position,
    eventId: messageId,
    eventType: "DIRECT_MESSAGE_CREATED",
    changeKind: "UPSERT_REF",
    payload: {
      conversationId,
      messageId,
    },
  });
  return messageId;
}

async function seedSyncEvent(
  db: PrismaClient,
  input: {
    userId: string;
    conversationId: string;
    position: bigint;
    eventId: string;
    eventType:
      | "DIRECT_MESSAGE_CREATED"
      | "DIRECT_MESSAGE_DELETED";
    changeKind: "UPSERT_REF" | "TOMBSTONE";
    payload: {
      conversationId: string;
      messageId: string;
    };
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.userSyncState.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        lastPosition: input.position,
        minRetainedPosition: 0n,
      },
      update: {
        lastPosition: input.position,
      },
    });
    await tx.durableEvent.create({
      data: {
        id: input.eventId,
        protocolVersion: 1,
        eventType: input.eventType,
        durability: "DURABLE_HINT",
        changeKind: input.changeKind,
        scopeKind: "DIRECT_CHAT",
        scopeId: input.conversationId,
        occurredAt: new Date(),
        payload: input.payload,
        recipients: {
          create: {
            userId: input.userId,
            position: input.position,
          },
        },
      },
    });
  });
}

function configureTestEnv(): void {
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
}
