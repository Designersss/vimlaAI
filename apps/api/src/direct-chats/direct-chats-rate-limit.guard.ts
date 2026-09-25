import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { RedisService } from "../persistence/redis.service.js";
import { redisFixedWindowHit } from "../persistence/rate-limit.js";

const memoryHits = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class DirectChatsRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const userId = request.vimlaUser?.id;
    if (!userId) {
      return true;
    }

    const isReadReceipt =
      request.method === "POST" &&
      /\/v1\/direct-chats\/[^/?]+\/read(?:\?|$)/.test(
        request.url,
      );
    const bucket = isReadReceipt
      ? "read"
      : "mutation";
    const allowed = await this.hit(
      `ratelimit:direct-chats:${bucket}:user:${userId}`,
      this.config.directChatsMutationLimitPerMinute,
    );
    if (!allowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: isReadReceipt
            ? "Too many Direct Chat read receipts"
            : "Too many Direct Chat requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private async hit(key: string, max: number): Promise<boolean> {
    try {
      return await redisFixedWindowHit(this.redis.client, key, max);
    } catch {
      if (this.config.appEnv === "local" || this.config.appEnv === "test") {
        return memoryHit(key, max);
      }
      throw new HttpException("Direct Chat rate limiter unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

function memoryHit(key: string, max: number): boolean {
  const now = Date.now();
  const current = memoryHits.get(key);
  if (!current || current.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  current.count += 1;
  return current.count <= max;
}
