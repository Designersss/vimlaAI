import type { Redis } from "ioredis";

const FIXED_WINDOW_HIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

export async function redisFixedWindowHit(
  redis: Redis,
  key: string,
  max: number,
  windowMs = 60_000,
): Promise<boolean> {
  const result = await redis.eval(FIXED_WINDOW_HIT_SCRIPT, 1, key, String(windowMs));
  const count = typeof result === "number" ? result : Number(result);
  if (!Number.isFinite(count)) {
    throw new Error("Redis rate limiter returned an invalid count");
  }
  return count <= max;
}
