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

const memoryHits = new Map<
  string,
  { count: number; resetAt: number }
>();

@Injectable()
export class TrustRateLimitGuard implements CanActivate {
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
    if (!userId || request.method === "OPTIONS") {
      return true;
    }

    const isReport =
      request.method === "POST" &&
      request.url.split("?")[0] === "/v1/trust/reports";
    const read =
      request.method === "GET" ||
      request.method === "HEAD";
    const operation = isReport
      ? "report"
      : read
        ? "read"
        : "mutate";
    const max = isReport
      ? this.config.trustReportLimitPerMinute
      : read
        ? this.config.trustReadLimitPerMinute
        : this.config.trustMutationLimitPerMinute;

    const allowed = await this.hit(
      `ratelimit:trust:${operation}:user:${userId}`,
      max,
    );
    const ipAllowed = !isReport || await this.hit(
      `ratelimit:trust:report:ip:${request.ip}`,
      this.config.trustReportIpLimitPerMinute,
    );
    if (!allowed || !ipAllowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: isReport
            ? "Too many abuse reports"
            : "Too many safety requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async hit(
    key: string,
    max: number,
  ): Promise<boolean> {
    try {
      return await redisFixedWindowHit(
        this.redis.client,
        key,
        max,
      );
    } catch {
      if (
        this.config.appEnv === "local" ||
        this.config.appEnv === "test"
      ) {
        return memoryHit(key, max);
      }
      throw new HttpException(
        "Safety rate limiter unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function memoryHit(key: string, max: number): boolean {
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
