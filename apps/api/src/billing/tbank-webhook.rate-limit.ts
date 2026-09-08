import {
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
export class TbankWebhookRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = request.ip || "unknown";
    try {
      const count = await this.redis.client.incr(`ratelimit:tbank-webhook:${ip}`);
      if (count === 1) {
        await this.redis.client.expire(`ratelimit:tbank-webhook:${ip}`, 60);
      }
      return count <= this.config.paymentWebhookLimitPerMinute;
    } catch {
      return memoryWebhookHit(ip, this.config.paymentWebhookLimitPerMinute);
    }
  }
}

function memoryWebhookHit(ip: string, max: number): boolean {
  const now = Date.now();
  const key = `webhook:${ip}`;
  const current = memoryHits.get(key);
  if (!current || current.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}
