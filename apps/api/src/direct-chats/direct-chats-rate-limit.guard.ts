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
    // Reconciliation looks up individual sender-owned idempotency keys.
    // Unlike ordinary inbox/history GETs, this is a probe endpoint and
    // requires its own Redis-backed per-actor budget.
    const lookup =
      request.method === "GET" &&
      request.routeOptions.url?.endsWith("/messages/lookup") === true;
    // An indexed opaque-tag query is still a metadata probe. Never exempt
    // repeated tag guesses from per-user limits merely because it is GET.
    const reactionHistory =
      request.method === "POST" &&
      request.routeOptions.url?.endsWith("/:id/reactions") === true;
    if (
      (request.method === "GET" && !lookup && !reactionHistory) ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const userId = request.vimlaUser?.id;
    if (!userId) {
      return true;
    }

    const preflight =
      request.method === "POST" &&
      request.routeOptions.url?.endsWith("/send-preflight") === true;
    const claimingPrekeys =
      request.method === "POST" &&
      request.routeOptions.url === "/v1/direct-chats/users/:userId/prekeys";
    // Enrollment/revocation is a security-sensitive lifecycle operation,
    // not another chat send/read. Keep a *smaller, independent* device budget
    // so normal messaging activity cannot strand a newly enrolled device.
    // Both paths remain Redis-backed, bounded, and actor-scoped.
    const deviceMutation =
      request.routeOptions.url?.startsWith("/v1/direct-chats/devices") === true;
    const allowed = await this.hit(
      claimingPrekeys
        ? `ratelimit:direct-chats:prekeys:user:${userId}`
        : preflight
          ? `ratelimit:direct-chats:preflight:user:${userId}`
          : lookup
            ? `ratelimit:direct-chats:lookup:user:${userId}`
            : reactionHistory
              ? `ratelimit:direct-chats:reactions-history:user:${userId}`
              : deviceMutation
              ? `ratelimit:direct-chats:device-mutation:user:${userId}`
              : `ratelimit:direct-chats:user:${userId}`,
      reactionHistory
        ? Math.min(30, this.config.directChatsPreflightLimitPerMinute)
        : claimingPrekeys || preflight || lookup
          ? this.config.directChatsPreflightLimitPerMinute
          : deviceMutation
          ? Math.min(10, this.config.directChatsMutationLimitPerMinute)
          : this.config.directChatsMutationLimitPerMinute,
    );
    if (!allowed) {
      throw new HttpException(
        { code: "rate_limited", message: "Too many Direct Chat requests" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (claimingPrekeys) {
      const peerId = (request.params as { userId?: unknown } | undefined)?.userId;
      if (typeof peerId !== "string" || peerId.length === 0 || peerId.length > 128) {
        throw new HttpException(
          { code: "invalid_request", message: "Invalid Direct Chat prekey target" },
          HttpStatus.BAD_REQUEST,
        );
      }
      const pair = JSON.stringify([userId, peerId]);
      if (!(await this.hit(
        `ratelimit:direct-chats:prekeys:pair:${pair}`,
        this.config.directChatsPrekeyLimitPerMinute,
      ))) {
        throw new HttpException(
          { code: "rate_limited", message: "Too many Direct Chat prekey claims" },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
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
