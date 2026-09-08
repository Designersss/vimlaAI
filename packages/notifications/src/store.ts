import type { NotificationCoordinationStore } from "./types.js";

export class MemoryNotificationStore implements NotificationCoordinationStore {
  private readonly counters = new Map<string, { value: number; expiresAt: number }>();
  private readonly locks = new Map<string, number>();

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const current = this.counters.get(key);
    if (!current || current.expiresAt <= now) {
      this.counters.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    current.value += 1;
    return current.value;
  }

  async setNx(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.locks.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    this.locks.set(key, now + ttlSeconds * 1000);
    return true;
  }

  async del(key: string): Promise<void> {
    this.counters.delete(key);
    this.locks.delete(key);
  }
}

export function redisNotificationStore(redis: {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, expiryMode: "EX", ttl: number, setMode: "NX"): Promise<string | null>;
  del(key: string): Promise<unknown>;
}): NotificationCoordinationStore {
  return {
    async incr(key, ttlSeconds) {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return count;
    },
    async setNx(key, ttlSeconds) {
      const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    },
    async del(key) {
      await redis.del(key);
    },
  };
}
