import { hmacSha256Hex } from "@vimla/shared";

export function hashOtp(secret: string, otp: string, purpose: "email"): string {
  return hmacSha256Hex(secret, `${purpose}-otp:${otp}`);
}

export function hashIdentifier(secret: string, kind: "email" | "ip", value: string): string {
  return hmacSha256Hex(secret, `${kind}:${value.toLowerCase()}`);
}
