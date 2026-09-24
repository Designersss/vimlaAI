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

const localHits = new Map<
  string,
  { count: number; resetAt: number }
>();

@Injectable()
export class MemoryRateLimitGuard implements CanActivate {
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
    if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const userId = request.vimlaUser?.id;
    if (!userId) return true;

    const key = `ratelimit:memory:user:${userId}`;
    let allowed: boolean;
    try {
      allowed = await redisFixedWindowHit(
        this.redis.client,
        key,
        this.config.memoryMutationLimitPerMinute,
      );
    } catch {
      if (
        this.config.appEnv !== "local" &&
        this.config.appEnv !== "test"
      ) {
        throw new HttpException(
          "Memory rate limiter unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      allowed = localHit(
        key,
        this.config.memoryMutationLimitPerMinute,
      );
    }

    if (!allowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: "Too many Memory requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

function localHit(key: string, max: number): boolean {
  const now = Date.now();
  const current = localHits.get(key);
  if (!current || current.resetAt <= now) {
    localHits.set(key, {
      count: 1,
      resetAt: now + 60_000,
    });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}
