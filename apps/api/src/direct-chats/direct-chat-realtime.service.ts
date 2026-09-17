import {
  Inject,
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { DirectMessageKind } from "@vimla/contracts";
import type { Redis } from "ioredis";
import { Observable, interval, map, merge } from "rxjs";
import { RedisService } from "../persistence/redis.service.js";

const CHANNEL_PREFIX = "direct-chat:user:";
const PATTERN = `${CHANNEL_PREFIX}*`;
const HEARTBEAT_MS = 20_000;

export interface DirectChatRealtimeEvent {
  type: "direct_message";
  conversationId: string;
  messageId: string;
  senderUserId: string;
  kind: DirectMessageKind;
  createdAt: string;
}

@Injectable()
export class DirectChatRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<(event: DirectChatRealtimeEvent) => void>>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {
    this.subscriber = redis.client.duplicate({ maxRetriesPerRequest: 1 });
  }

  async onModuleInit(): Promise<void> {
    if (this.subscriber.status === "wait") {
      await this.subscriber.connect();
    }
    await this.subscriber.psubscribe(PATTERN);
    this.subscriber.on("pmessage", (_pattern, channel, payload) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const userId = channel.slice(CHANNEL_PREFIX.length);
      const callbacks = this.listeners.get(userId);
      if (!callbacks || callbacks.size === 0) return;
      try {
        const event = JSON.parse(payload) as DirectChatRealtimeEvent;
        if (event.type !== "direct_message") return;
        for (const callback of callbacks) callback(event);
      } catch {
        // Malformed pub/sub payloads are ignored; persisted messages remain authoritative.
      }
    });
  }

  stream(userId: string): Observable<MessageEvent> {
    const messages = new Observable<MessageEvent>((subscriber) => {
      const callback = (event: DirectChatRealtimeEvent): void => subscriber.next({ data: event });
      const current = this.listeners.get(userId) ?? new Set();
      current.add(callback);
      this.listeners.set(userId, current);
      return () => {
        const listeners = this.listeners.get(userId);
        listeners?.delete(callback);
        if (listeners?.size === 0) this.listeners.delete(userId);
      };
    });
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: "heartbeat", data: { at: new Date().toISOString() } })),
    );
    return merge(messages, heartbeat);
  }

  async publish(userIds: string[], event: DirectChatRealtimeEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await Promise.all([...new Set(userIds)].map((userId) => this.redis.client.publish(`${CHANNEL_PREFIX}${userId}`, payload)));
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    if (this.subscriber.status !== "end") {
      await this.subscriber.quit();
    }
  }
}
