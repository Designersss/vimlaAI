import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { RedisService } from "../persistence/redis.service.js";

const memoryCounts = new Map<string, number>();

@Injectable()
export class AiConcurrencyService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  async acquire(userId: string): Promise<void> {
    const key = `ai:concurrent:${userId}`;
    const max = this.config.aiMaxConcurrentTextRequestsPerUser;

    try {
      const count = await this.redis.client.incr(key);
      await this.redis.client.expire(key, 600);
      if (count > max) {
        await this.redis.client.decr(key);
        throw new HttpException("Too many concurrent AI requests", HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (this.config.appEnv === "local" || this.config.appEnv === "test") {
        const next = (memoryCounts.get(key) ?? 0) + 1;
        if (next > max) {
          throw new HttpException("Too many concurrent AI requests", HttpStatus.TOO_MANY_REQUESTS);
        }
        memoryCounts.set(key, next);
        return;
      }

      throw new HttpException("AI concurrency limiter unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async release(userId: string): Promise<void> {
    const key = `ai:concurrent:${userId}`;
    try {
      const count = await this.redis.client.decr(key);
      if (count < 0) {
        await this.redis.client.set(key, "0");
      }
    } catch {
      const current = memoryCounts.get(key) ?? 0;
      memoryCounts.set(key, current > 0 ? current - 1 : 0);
    }
  }
}
