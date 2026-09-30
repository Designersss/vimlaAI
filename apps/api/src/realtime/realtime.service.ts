import {
  randomUUID,
} from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  REALTIME_PROTOCOL_VERSION,
  realtimeEventEnvelopeSchema,
  type RealtimeEventEnvelope,
} from "@vimla/contracts";
import {
  REALTIME_USER_CHANNEL_PREFIX,
  realtimeUserChannel,
  realtimeUserIdFromChannel,
} from "@vimla/shared";
import type { Redis } from "ioredis";
import { RedisService } from "../persistence/redis.service.js";

const PATTERN = `${REALTIME_USER_CHANNEL_PREFIX}*`;

export type RealtimeListener = (
  event: RealtimeEventEnvelope,
) => void;

@Injectable()
export class RealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeService.name);
  private readonly subscriber: Redis;
  private readonly listeners = new Map<
    string,
    Set<RealtimeListener>
  >();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    this.subscriber = redis.client.duplicate({
      maxRetriesPerRequest: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.subscriber.status === "wait") {
      await this.subscriber.connect();
    }
    await this.subscriber.psubscribe(PATTERN);
    this.subscriber.on(
      "pmessage",
      (_pattern, channel, payload) => {
        const userId = realtimeUserIdFromChannel(channel);
        if (!userId) {
          return;
        }
        const callbacks = this.listeners.get(userId);
        if (!callbacks || callbacks.size === 0) {
          return;
        }

        let parsed: RealtimeEventEnvelope;
        try {
          parsed = realtimeEventEnvelopeSchema.parse(
            JSON.parse(payload) as unknown,
          );
        } catch {
          this.logger.warn({
            msg: "realtime.invalid_pubsub_event",
          });
          return;
        }

        for (const callback of callbacks) {
          try {
            callback(parsed);
          } catch (error: unknown) {
            this.logger.warn({
              msg: "realtime.listener_failed",
              ...realtimeEventTelemetry(parsed),
              errorName:
                error instanceof Error
                  ? error.name
                  : "unknown",
            });
          }
        }
      },
    );
  }

  subscribe(
    userId: string,
    listener: RealtimeListener,
  ): () => void {
    const current =
      this.listeners.get(userId) ?? new Set<RealtimeListener>();
    current.add(listener);
    this.listeners.set(userId, current);

    return () => {
      const listeners = this.listeners.get(userId);
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }

  async publishToUsers(
    userIds: readonly string[],
    event: RealtimeEventEnvelope,
  ): Promise<void> {
    const parsed = realtimeEventEnvelopeSchema.parse(event);
    const payload = JSON.stringify(parsed);
    try {
      await Promise.all(
        [...new Set(userIds)].map((userId) =>
          this.redis.client.publish(
            realtimeUserChannel(userId),
            payload,
          ),
        ),
      );
    } catch (error: unknown) {
      this.logger.warn({
        msg: "realtime.publish_failed",
        ...realtimeEventTelemetry(parsed),
        recipientCount: new Set(userIds).size,
        error:
          error instanceof Error
            ? error.message
            : "unknown",
      });
    }
  }

  async publishDirectMessageCreated(
    userIds: readonly string[],
    input: {
      conversationId: string;
      messageId: string;
      occurredAt: string;
    },
  ): Promise<void> {
    await this.publishToUsers(userIds, {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "EVENT",
      eventId: input.messageId,
      eventType: "DIRECT_MESSAGE_CREATED",
      durability: "DURABLE_HINT",
      scope: {
        kind: "DIRECT_CHAT",
        id: input.conversationId,
      },
      occurredAt: input.occurredAt,
      payload: {
        conversationId: input.conversationId,
        messageId: input.messageId,
      },
    });
  }

  createConnectionId(): string {
    return randomUUID();
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    if (this.subscriber.status !== "end") {
      await this.subscriber.quit();
    }
  }
}


export function realtimeEventTelemetry(
  event: RealtimeEventEnvelope,
): {
  eventId: string;
  eventType: RealtimeEventEnvelope["eventType"];
  durability: RealtimeEventEnvelope["durability"];
  scopeKind: RealtimeEventEnvelope["scope"]["kind"];
} {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    durability: event.durability,
    scopeKind: event.scope.kind,
  };
}
