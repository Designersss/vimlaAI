import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisVimlaCoreFairUseLimiter } from "./vimla-core-planner.js";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}

describe("RedisVimlaCoreFairUseLimiter", () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisUrl);
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("keeps a newer concurrency lease when an expired older lease releases late", async () => {
    const limiter = new RedisVimlaCoreFairUseLimiter(
      async (script, numberOfKeys, ...args) =>
        redis.eval(script, numberOfKeys, ...args),
      100,
      1,
      50,
    );
    const actorUserId = `fair-use-${randomUUID()}`;

    const expiredLease = await limiter.acquire(actorUserId);
    expect(expiredLease).not.toBeNull();
    await expect(limiter.acquire(actorUserId)).resolves.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const currentLease = await limiter.acquire(actorUserId);
    expect(currentLease).not.toBeNull();

    await expiredLease?.release();
    await expect(limiter.acquire(actorUserId)).resolves.toBeNull();

    await currentLease?.release();
    const nextLease = await limiter.acquire(actorUserId);
    expect(nextLease).not.toBeNull();
    await nextLease?.release();
  });
});
