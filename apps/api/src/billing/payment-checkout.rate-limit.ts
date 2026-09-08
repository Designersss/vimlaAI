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

const memoryHits = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class PaymentCheckoutRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const userId = request.vimlaUser?.id;
    if (!userId) {
      return true;
    }

    const allowed = await this.hit(
      `ratelimit:payment-checkout:${userId}`,
      this.config.paymentCheckoutLimitPerMinute,
    );
    if (!allowed) {
      throw new HttpException(
        { code: "payment_rate_limited", message: "Too many payment requests" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async hit(key: string, max: number): Promise<boolean> {
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, 60);
      }
      return count <= max;
    } catch {
      if (this.config.appEnv === "local" || this.config.appEnv === "test") {
        return memoryHit(key, max);
      }
      throw new HttpException(
        { code: "payment_temporarily_unavailable", message: "Payment rate limiter unavailable" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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
