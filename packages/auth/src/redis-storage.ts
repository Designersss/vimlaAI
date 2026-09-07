import type { Redis } from "ioredis";

export function createRedisSecondaryStorage(redis: Redis) {
  return {
    async get(key: string): Promise<string | null> {
      return redis.get(key);
    },

    async getAndDelete(key: string): Promise<string | null> {
      const value = await redis.get(key);
      if (value !== null) {
        await redis.del(key);
      }
      return value;
    },

    async increment(key: string, ttl: number): Promise<number> {
      const results = await redis.multi().incr(key).expire(key, ttl, "NX").exec();
      const incrResult = results?.[0];
      if (!incrResult) {
        throw new Error("Redis increment failed");
      }

      const [, value] = incrResult;
      if (typeof value !== "number") {
        throw new Error("Redis increment returned a non-number");
      }

      return value;
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      if (ttl === undefined) {
        await redis.set(key, value);
        return;
      }

      await redis.set(key, value, "EX", ttl);
    },

    async delete(key: string): Promise<void> {
      await redis.del(key);
    },
  };
}
