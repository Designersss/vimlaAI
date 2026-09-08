import type { Redis } from "ioredis";

const memory = new Map<string, number>();

export async function claimResendSlot(input: {
  redis?: Redis;
  key: string;
  cooldownSeconds: number;
}): Promise<boolean> {
  if (input.redis) {
    try {
      const result = await input.redis.set(input.key, "1", "EX", input.cooldownSeconds, "NX");
      return result === "OK";
    } catch {
      return claimMemorySlot(input.key, input.cooldownSeconds);
    }
  }

  return claimMemorySlot(input.key, input.cooldownSeconds);
}

function claimMemorySlot(key: string, cooldownSeconds: number): boolean {
  const now = Date.now();
  const expiresAt = memory.get(key);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  memory.set(key, now + cooldownSeconds * 1000);
  return true;
}

export function resendCooldownKey(hashedSubject: string): string {
  return `auth:otp-resend:${hashedSubject}`;
}
