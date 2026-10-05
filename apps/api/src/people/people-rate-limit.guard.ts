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

const PEOPLE_REQUESTS_PER_MINUTE = 60;
const memoryHits = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class PeopleRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const userId = request.vimlaUser?.id;
    if (!userId || request.method === "HEAD" || request.method === "OPTIONS") {
      return true;
    }

    const operation = request.method === "GET" ? "discover" : "mutate";
    const allowed = await this.hit(
      `ratelimit:people:${operation}:user:${userId}`,
      PEOPLE_REQUESTS_PER_MINUTE,
    );
    if (!allowed) {
      throw new HttpException(
        { code: "rate_limited", message: "Too many People requests" },
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
      throw new HttpException("People rate limiter unavailable", HttpStatus.SERVICE_UNAVAILABLE);
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
