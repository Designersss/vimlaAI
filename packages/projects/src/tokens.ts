import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function inviteTokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function inviteUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/$/, "")}/projects/join?token=${encodeURIComponent(token)}`;
}
