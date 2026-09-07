import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RedisService } from "../persistence/redis.service.js";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;
const memoryHits = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class MockPurchaseRateLimitGuard implements CanActivate {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const userId = request.vimlaUser?.id;
    if (!userId) {
      return true;
    }

    const key = `ratelimit:mock-purchase:${userId}`;
    const allowed = await this.hit(key);
    if (!allowed) {
      throw new HttpException("Too many mock purchase requests", HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private async hit(key: string): Promise<boolean> {
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, WINDOW_SECONDS);
      }
      return count <= MAX_REQUESTS;
    } catch {
      return memoryHit(key);
    }
  }
}

function memoryHit(key: string): boolean {
  const now = Date.now();
  const current = memoryHits.get(key);
  if (!current || current.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
    return true;
  }

  current.count += 1;
  return current.count <= MAX_REQUESTS;
}
