import { randomUUID } from "node:crypto";
import {
  realtimeEventEnvelopeSchema,
  type RealtimeEventEnvelope,
} from "@vimla/contracts";
import {
  Prisma,
  type PrismaClient,
} from "@vimla/database";
import { realtimeUserChannel } from "@vimla/shared";
import type { Redis } from "ioredis";

export interface RealtimeOutboxPolicy {
  batchSize: number;
  leaseMs: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  retentionMs: number;
}

export interface RealtimeOutboxLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface DurableRealtimePublisher {
  publish(
    recipientUserIds: readonly string[],
    event: RealtimeEventEnvelope,
  ): Promise<void>;
}

interface ClaimedRow {
  eventId: string;
}

export interface RealtimeOutboxRunResult {
  claimed: number;
  published: number;
  retryScheduled: number;
  leaseLost: number;
  compacted: number;
}

export class RedisDurableRealtimePublisher
  implements DurableRealtimePublisher
{
  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs: number,
  ) {}

  async publish(
    recipientUserIds: readonly string[],
    event: RealtimeEventEnvelope,
  ): Promise<void> {
    const recipients = [
      ...new Set(recipientUserIds),
    ];
    if (recipients.length === 0) {
      throw new Error(
        "Durable realtime event has no recipients",
      );
    }

    const parsed =
      realtimeEventEnvelopeSchema.parse(event);
    const payload = JSON.stringify(parsed);
    await withTimeout(
      Promise.all(
        recipients.map((userId) =>
          this.redis.publish(
            realtimeUserChannel(userId),
            payload,
          ),
        ),
      ).then(() => undefined),
      this.timeoutMs,
      "Realtime Redis publish timed out",
    );
  }
}

export class RealtimeOutboxDispatcher {
  constructor(
    private readonly db: PrismaClient,
    private readonly publisher: DurableRealtimePublisher,
    private readonly policy: RealtimeOutboxPolicy,
    private readonly logger: RealtimeOutboxLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(
    now = this.clock(),
  ): Promise<RealtimeOutboxRunResult> {
    const claim = await this.claim(now);
    if (claim.eventIds.length === 0) {
      return {
        claimed: 0,
        published: 0,
        retryScheduled: 0,
        leaseLost: 0,
        compacted: await this.compactPublished(now),
      };
    }

    const events = await this.db.durableEvent.findMany({
      where: {
        id: { in: claim.eventIds },
      },
      include: {
        recipients: {
          select: { userId: true },
        },
        outbox: true,
      },
      orderBy: { sequence: "asc" },
    });

    let published = 0;
    let retryScheduled = 0;
    let leaseLost = 0;

    for (const row of events) {
      const outbox = row.outbox;
      if (
        !outbox ||
        outbox.status !== "PROCESSING" ||
        outbox.processingToken !== claim.token
      ) {
        leaseLost += 1;
        continue;
      }

      const renewed = await this.renewLease(
        row.id,
        claim.token,
      );
      if (!renewed) {
        leaseLost += 1;
        continue;
      }

      let event: RealtimeEventEnvelope;
      try {
        event = realtimeEventEnvelopeSchema.parse({
          protocolVersion: row.protocolVersion,
          frameType: "EVENT",
          eventId: row.id,
          eventType: row.eventType,
          durability: row.durability,
          scope: {
            kind: row.scopeKind,
            id: row.scopeId,
          },
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload,
        });
      } catch (error: unknown) {
        const retried = await this.scheduleRetry({
          eventId: row.id,
          token: claim.token,
          attemptCount: outbox.attemptCount,
          errorCode: "event_decode_failed",
          error,
          eventType: row.eventType,
          scopeKind: row.scopeKind,
        });
        if (retried) {
          retryScheduled += 1;
        } else {
          leaseLost += 1;
        }
        continue;
      }

      try {
        await this.publisher.publish(
          row.recipients.map(
            (recipient) => recipient.userId,
          ),
          event,
        );
      } catch (error: unknown) {
        const retried = await this.scheduleRetry({
          eventId: row.id,
          token: claim.token,
          attemptCount: outbox.attemptCount,
          errorCode: "redis_publish_failed",
          error,
          eventType: row.eventType,
          scopeKind: row.scopeKind,
        });
        if (retried) {
          retryScheduled += 1;
        } else {
          leaseLost += 1;
        }
        continue;
      }

      const publishedAt = this.clock();
      const compactAfter = new Date(
        publishedAt.getTime() +
          this.policy.retentionMs,
      );
      const marked =
        await this.db.realtimeOutbox.updateMany({
          where: {
            eventId: row.id,
            status: "PROCESSING",
            processingToken: claim.token,
          },
          data: {
            status: "PUBLISHED",
            processingToken: null,
            processingUntil: null,
            nextAttemptAt: null,
            publishedAt,
            compactAfter,
            lastErrorCode: null,
          },
        });
      if (marked.count === 1) {
        published += 1;
        this.logger.info(
          {
            eventId: row.id,
            eventType: row.eventType,
            scopeKind: row.scopeKind,
            sequence: row.sequence.toString(),
            attemptCount: outbox.attemptCount,
          },
          "realtime.outbox.published",
        );
      } else {
        leaseLost += 1;
      }
    }

    return {
      claimed: claim.eventIds.length,
      published,
      retryScheduled,
      leaseLost,
      compacted: await this.compactPublished(
        this.clock(),
      ),
    };
  }

  private async scheduleRetry(input: {
    eventId: string;
    token: string;
    attemptCount: number;
    errorCode: string;
    error: unknown;
    eventType: string;
    scopeKind: string;
  }): Promise<boolean> {
    const failedAt = this.clock();
    const nextAttemptAt = new Date(
      failedAt.getTime() +
        retryBackoffMs(
          input.attemptCount,
          this.policy.backoffBaseMs,
          this.policy.backoffCapMs,
        ),
    );
    const retried =
      await this.db.realtimeOutbox.updateMany({
        where: {
          eventId: input.eventId,
          status: "PROCESSING",
          processingToken: input.token,
        },
        data: {
          status: "PENDING",
          processingToken: null,
          processingUntil: null,
          nextAttemptAt,
          lastErrorCode: input.errorCode,
        },
      });
    if (retried.count !== 1) {
      return false;
    }

    this.logger.warn(
      {
        eventId: input.eventId,
        eventType: input.eventType,
        scopeKind: input.scopeKind,
        attemptCount: input.attemptCount,
        nextAttemptAt: nextAttemptAt.toISOString(),
        errorCode: input.errorCode,
        errorName:
          input.error instanceof Error
            ? input.error.name
            : "unknown",
      },
      "realtime.outbox.retry_scheduled",
    );
    return true;
  }

  private async renewLease(
    eventId: string,
    token: string,
  ): Promise<boolean> {
    const now = this.clock();
    const result =
      await this.db.realtimeOutbox.updateMany({
        where: {
          eventId,
          status: "PROCESSING",
          processingToken: token,
        },
        data: {
          processingUntil: new Date(
            now.getTime() + this.policy.leaseMs,
          ),
        },
      });
    return result.count === 1;
  }

  async compactPublished(
    now = this.clock(),
  ): Promise<number> {
    const result =
      await this.db.realtimeOutbox.deleteMany({
        where: {
          status: "PUBLISHED",
          compactAfter: { lte: now },
        },
      });
    if (result.count > 0) {
      this.logger.info(
        { count: result.count },
        "realtime.outbox.compacted",
      );
    }
    return result.count;
  }

  private async claim(
    now: Date,
  ): Promise<{
    token: string;
    eventIds: string[];
  }> {
    const token = randomUUID();
    const processingUntil = new Date(
      now.getTime() + this.policy.leaseMs,
    );

    const rows = await this.db.$queryRaw<ClaimedRow[]>(
      Prisma.sql`
        WITH candidates AS (
          SELECT o."eventId"
          FROM "realtime_outbox" AS o
          INNER JOIN "durable_event" AS e
            ON e."id" = o."eventId"
          WHERE
            (
              o."status" = 'PENDING'
              AND o."nextAttemptAt" <= ${now}
            )
            OR
            (
              o."status" = 'PROCESSING'
              AND o."processingUntil" < ${now}
            )
          ORDER BY e."sequence" ASC
          FOR UPDATE OF o SKIP LOCKED
          LIMIT ${this.policy.batchSize}
        )
        UPDATE "realtime_outbox" AS o
        SET
          "status" = 'PROCESSING',
          "processingToken" = CAST(${token} AS UUID),
          "processingUntil" = ${processingUntil},
          "nextAttemptAt" = NULL,
          "attemptCount" = o."attemptCount" + 1,
          "updatedAt" = ${now}
        FROM candidates AS c
        WHERE o."eventId" = c."eventId"
        RETURNING o."eventId"
      `,
    );

    return {
      token,
      eventIds: rows.map((row) => row.eventId),
    };
  }
}

export function retryBackoffMs(
  attemptCount: number,
  baseMs: number,
  capMs: number,
): number {
  const exponent = Math.max(
    0,
    Math.min(attemptCount - 1, 30),
  );
  return Math.min(
    capMs,
    baseMs * 2 ** exponent,
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
