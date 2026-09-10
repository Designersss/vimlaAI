import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateConfirmationToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashConfirmationToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function confirmationTokenMatches(token: string, hash: string, secret: string): boolean {
  const actual = Buffer.from(hashConfirmationToken(token, secret), "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
