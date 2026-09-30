import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  REALTIME_PROTOCOL_VERSION,
  type RealtimeEventEnvelope,
} from "@vimla/contracts";
import {
  createPrismaClient,
  type PrismaClient,
} from "@vimla/database";
import {
  RealtimeOutboxDispatcher,
  type DurableRealtimePublisher,
} from "./realtime-outbox.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const policy = {
  batchSize: 20,
  leaseMs: 10_000,
  backoffBaseMs: 500,
  backoffCapMs: 5_000,
  retentionMs: 60 * 60 * 1_000,
};

class RecordingPublisher
  implements DurableRealtimePublisher
{
  readonly events: Array<{
    recipientUserIds: readonly string[];
    event: RealtimeEventEnvelope;
  }> = [];
  failuresRemaining = 0;

  async publish(
    recipientUserIds: readonly string[],
    event: RealtimeEventEnvelope,
  ): Promise<void> {
    this.events.push({
      recipientUserIds: [...recipientUserIds],
      event,
    });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("redis unavailable");
    }
  }
}

describe("realtime outbox dispatcher", () => {
  let prisma: PrismaClient;
  const eventIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterEach(async () => {
    if (eventIds.length > 0) {
      await prisma.durableEvent.deleteMany({
        where: { id: { in: eventIds.splice(0) } },
      });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("publishes a pending durable event and marks only outbox state published", async () => {
    const now = new Date("2001-01-01T00:00:00.000Z");
    const seeded = await seedEvent(prisma, now);
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    const publisher = new RecordingPublisher();
    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
    );

    const result = await dispatcher.runOnce(now);
    expect(result).toMatchObject({
      claimed: 1,
      published: 1,
      retryScheduled: 0,
      leaseLost: 0,
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]).toEqual({
      recipientUserIds: seeded.userIds,
      event: {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "EVENT",
        eventId: seeded.eventId,
        eventType: "DIRECT_MESSAGE_CREATED",
        durability: "DURABLE_HINT",
        scope: {
          kind: "DIRECT_CHAT",
          id: seeded.conversationId,
        },
        occurredAt: now.toISOString(),
        payload: {
          conversationId: seeded.conversationId,
          messageId: seeded.eventId,
        },
      },
    });

    const outbox =
      await prisma.realtimeOutbox.findUniqueOrThrow({
        where: { eventId: seeded.eventId },
      });
    expect(outbox.status).toBe("PUBLISHED");
    expect(outbox.attemptCount).toBe(1);
    expect(outbox.publishedAt).not.toBeNull();
    expect(outbox.compactAfter).not.toBeNull();
    expect(outbox.processingToken).toBeNull();

    expect(
      await prisma.durableEvent.count({
        where: { id: seeded.eventId },
      }),
    ).toBe(1);
  });

  it("retries indefinitely after transport failure without losing the durable event", async () => {
    const now = new Date("2001-02-01T00:00:00.000Z");
    const seeded = await seedEvent(prisma, now);
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    const publisher = new RecordingPublisher();
    publisher.failuresRemaining = 1;
    let clockNow = now;
    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
      () => clockNow,
    );

    const first = await dispatcher.runOnce();
    expect(first.retryScheduled).toBe(1);
    const retryState =
      await prisma.realtimeOutbox.findUniqueOrThrow({
        where: { eventId: seeded.eventId },
      });
    expect(retryState.status).toBe("PENDING");
    expect(retryState.attemptCount).toBe(1);
    expect(retryState.lastErrorCode).toBe(
      "redis_publish_failed",
    );
    expect(retryState.nextAttemptAt).not.toBeNull();

    const retryAt = retryState.nextAttemptAt;
    if (!retryAt) {
      throw new Error("Retry timestamp missing");
    }
    clockNow = retryAt;
    const second = await dispatcher.runOnce();
    expect(second.published).toBe(1);
    expect(publisher.events).toHaveLength(2);

    const published =
      await prisma.realtimeOutbox.findUniqueOrThrow({
        where: { eventId: seeded.eventId },
      });
    expect(published.status).toBe("PUBLISHED");
    expect(published.attemptCount).toBe(2);
    expect(published.lastErrorCode).toBeNull();
  });

  it("reclaims an expired processing lease after worker crash", async () => {
    const now = new Date("2001-03-01T00:00:10.000Z");
    const seeded = await seedEvent(
      prisma,
      new Date("2001-03-01T00:00:00.000Z"),
      {
        status: "PROCESSING",
        attemptCount: 1,
        processingToken: randomUUID(),
        processingUntil: new Date(
          "2001-03-01T00:00:05.000Z",
        ),
        nextAttemptAt: null,
      },
    );
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    const publisher = new RecordingPublisher();
    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
    );
    const result = await dispatcher.runOnce(now);

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(publisher.events).toHaveLength(1);
    expect(
      (
        await prisma.realtimeOutbox.findUniqueOrThrow({
          where: { eventId: seeded.eventId },
        })
      ).attemptCount,
    ).toBe(2);
  });

  it("lets concurrent dispatchers claim a pending event only once", async () => {
    const now = new Date("2001-04-01T00:00:00.000Z");
    const seeded = await seedEvent(prisma, now);
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    const publisher = new RecordingPublisher();
    const first = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
    );
    const second = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
    );

    const results = await Promise.all([
      first.runOnce(now),
      second.runOnce(now),
    ]);
    expect(
      results.reduce(
        (sum, result) => sum + result.claimed,
        0,
      ),
    ).toBe(1);
    expect(publisher.events).toHaveLength(1);
  });

  it("publishes claimed events in durable sequence order within a dispatcher batch", async () => {
    const now = new Date("2001-05-01T00:00:00.000Z");
    const first = await seedEvent(prisma, now);
    const second = await seedEvent(
      prisma,
      new Date(now.getTime() + 1),
    );
    eventIds.push(first.eventId, second.eventId);
    userIds.push(...first.userIds, ...second.userIds);

    const publisher = new RecordingPublisher();
    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
    );
    const result = await dispatcher.runOnce(
      new Date(now.getTime() + 100),
    );

    expect(result.published).toBe(2);
    expect(
      publisher.events.map(
        ({ event }) => event.eventId,
      ),
    ).toEqual([first.eventId, second.eventId]);
  });

  it("recovers at-least-once after publication succeeds but lease ownership is lost before mark-complete", async () => {
    const now = new Date("2001-05-15T00:00:00.000Z");
    const seeded = await seedEvent(prisma, now);
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    let sabotage = true;
    const publishedEventIds: string[] = [];
    const publisher: DurableRealtimePublisher = {
      async publish(_recipientUserIds, event) {
        publishedEventIds.push(event.eventId);
        if (sabotage) {
          sabotage = false;
          await prisma.realtimeOutbox.update({
            where: { eventId: event.eventId },
            data: {
              processingToken: randomUUID(),
              processingUntil: new Date(
                now.getTime() + 1_000,
              ),
            },
          });
        }
      },
    };
    let clockNow = now;
    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      publisher,
      policy,
      logger,
      () => clockNow,
    );

    const first = await dispatcher.runOnce();
    expect(first.published).toBe(0);
    expect(first.leaseLost).toBe(1);
    expect(publishedEventIds).toEqual([
      seeded.eventId,
    ]);
    expect(
      (
        await prisma.realtimeOutbox.findUniqueOrThrow({
          where: { eventId: seeded.eventId },
        })
      ).status,
    ).toBe("PROCESSING");

    clockNow = new Date(now.getTime() + 1_001);
    const recovered = await dispatcher.runOnce();
    expect(recovered.published).toBe(1);
    expect(publishedEventIds).toEqual([
      seeded.eventId,
      seeded.eventId,
    ]);
    expect(
      (
        await prisma.realtimeOutbox.findUniqueOrThrow({
          where: { eventId: seeded.eventId },
        })
      ).status,
    ).toBe("PUBLISHED");
  });

  it("distributes a high-concurrency batch across dispatchers without duplicate claims", async () => {
    const now = new Date("2001-05-20T00:00:00.000Z");
    const seededIds: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const seeded = await seedEvent(
        prisma,
        new Date(now.getTime() + index),
      );
      eventIds.push(seeded.eventId);
      userIds.push(...seeded.userIds);
      seededIds.push(seeded.eventId);
    }

    const publisher = new RecordingPublisher();
    const batchPolicy = {
      ...policy,
      batchSize: 10,
    };
    const dispatchers = Array.from(
      { length: 4 },
      () =>
        new RealtimeOutboxDispatcher(
          prisma,
          publisher,
          batchPolicy,
          logger,
          () => new Date(
            now.getTime() + 1_000,
          ),
        ),
    );

    const results = await Promise.all(
      dispatchers.map((dispatcher) =>
        dispatcher.runOnce(),
      ),
    );
    expect(
      results.reduce(
        (sum, result) => sum + result.claimed,
        0,
      ),
    ).toBe(40);
    expect(
      new Set(
        publisher.events.map(
          ({ event }) => event.eventId,
        ),
      ).size,
    ).toBe(40);
    expect(
      publisher.events.map(
        ({ event }) => event.eventId,
      ),
    ).toEqual(
      expect.arrayContaining(seededIds),
    );
    expect(
      await prisma.realtimeOutbox.count({
        where: {
          eventId: { in: seededIds },
          status: "PUBLISHED",
        },
      }),
    ).toBe(40);
  });

  it("compacts published delivery state without deleting the durable event ledger", async () => {
    const now = new Date("2001-06-01T00:00:10.000Z");
    const seeded = await seedEvent(
      prisma,
      new Date("2001-06-01T00:00:00.000Z"),
      {
        status: "PUBLISHED",
        attemptCount: 1,
        nextAttemptAt: null,
        publishedAt: new Date(
          "2001-06-01T00:00:01.000Z",
        ),
        compactAfter: new Date(
          "2001-06-01T00:00:05.000Z",
        ),
      },
    );
    eventIds.push(seeded.eventId);
    userIds.push(...seeded.userIds);

    const dispatcher = new RealtimeOutboxDispatcher(
      prisma,
      new RecordingPublisher(),
      policy,
      logger,
    );
    const result = await dispatcher.runOnce(now);

    expect(result.compacted).toBe(1);
    expect(
      await prisma.realtimeOutbox.findUnique({
        where: { eventId: seeded.eventId },
      }),
    ).toBeNull();
    expect(
      await prisma.durableEvent.count({
        where: { id: seeded.eventId },
      }),
    ).toBe(1);
  });
});

type OutboxSeedState =
  | {
      status?: "PENDING";
      attemptCount?: number;
      nextAttemptAt?: Date | null;
    }
  | {
      status: "PROCESSING";
      attemptCount: number;
      processingToken: string;
      processingUntil: Date;
      nextAttemptAt: null;
    }
  | {
      status: "PUBLISHED";
      attemptCount: number;
      nextAttemptAt: null;
      publishedAt: Date;
      compactAfter: Date;
    };

async function seedEvent(
  prisma: PrismaClient,
  occurredAt: Date,
  state: OutboxSeedState = {},
): Promise<{
  eventId: string;
  conversationId: string;
  userIds: [string, string];
}> {
  const eventId = randomUUID();
  const conversationId = randomUUID();
  const userIds: [string, string] = [
    randomUUID(),
    randomUUID(),
  ];

  for (const [index, userId] of userIds.entries()) {
    await prisma.user.create({
      data: {
        id: userId,
        name: `Outbox User ${index + 1}`,
        email: `outbox-${userId}@example.test`,
        emailVerified: true,
      },
    });
  }

  const outbox =
    state.status === "PROCESSING"
      ? {
          status: state.status,
          attemptCount: state.attemptCount,
          nextAttemptAt: null,
          processingToken: state.processingToken,
          processingUntil: state.processingUntil,
        }
      : state.status === "PUBLISHED"
        ? {
            status: state.status,
            attemptCount: state.attemptCount,
            nextAttemptAt: null,
            publishedAt: state.publishedAt,
            compactAfter: state.compactAfter,
          }
        : {
            status: "PENDING",
            attemptCount: state.attemptCount ?? 0,
            nextAttemptAt:
              state.nextAttemptAt ?? occurredAt,
          };

  await prisma.durableEvent.create({
    data: {
      id: eventId,
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      eventType: "DIRECT_MESSAGE_CREATED",
      durability: "DURABLE_HINT",
      scopeKind: "DIRECT_CHAT",
      scopeId: conversationId,
      occurredAt,
      payload: {
        conversationId,
        messageId: eventId,
      },
      recipients: {
        create: userIds.map((userId) => ({
          userId,
        })),
      },
      outbox: {
        create: outbox,
      },
    },
  });

  return { eventId, conversationId, userIds };
}
