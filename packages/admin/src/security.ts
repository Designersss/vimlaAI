import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashAdminToken(token: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${token}`, "utf8").digest("hex");
}

export function generateAdminToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashIp(ip: string, secret: string): string {
  return createHash("sha256").update(`${secret}:ip:${ip}`, "utf8").digest("hex").slice(0, 32);
}

export function summarizeUserAgent(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.slice(0, 180);
}

export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

const SENSITIVE_KEY = /password|secret|otp|token|cookie|authorization|backup|totp|webauthn|challenge|tbank_password|proxyapi/i;

export function sanitizeAuditSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditSnapshot(item));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = sanitizeAuditSnapshot(nested);
      }
    }
    return output;
  }
  return value;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean; path?: string },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return rest.join("=");
    }
  }
  return null;
}

export function reportingRangeToUtc(
  from: Date,
  to: Date,
): { from: Date; to: Date } {
  return { from, to };
}
