import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  API_CONFIG,
  type ApiRuntimeConfig,
} from "../config/api-config.js";
import { redisFixedWindowHit } from "../persistence/rate-limit.js";
import { RedisService } from "../persistence/redis.service.js";

const memoryHits = new Map<
  string,
  { count: number; resetAt: number }
>();

@Injectable()
export class SyncRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService)
    private readonly redis: RedisService,
    @Inject(API_CONFIG)
    private readonly config: ApiRuntimeConfig,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<FastifyRequest>();
    const userId = request.vimlaUser?.id;
    if (!userId) {
      return true;
    }

    const key = `ratelimit:sync:user:${userId}`;
    let allowed: boolean;
    try {
      allowed = await redisFixedWindowHit(
        this.redis.client,
        key,
        this.config.syncReadLimitPerMinute,
      );
    } catch {
      if (
        this.config.appEnv === "local" ||
        this.config.appEnv === "test"
      ) {
        allowed = memoryHit(
          key,
          this.config.syncReadLimitPerMinute,
        );
      } else {
        throw new HttpException(
          {
            code: "sync_temporarily_unavailable",
            message: "Sync rate limiter unavailable",
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    if (!allowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: "Too many sync requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

function memoryHit(
  key: string,
  max: number,
): boolean {
  const now = Date.now();
  const current = memoryHits.get(key);
  if (!current || current.resetAt <= now) {
    memoryHits.set(key, {
      count: 1,
      resetAt: now + 60_000,
    });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}
