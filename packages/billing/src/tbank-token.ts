import { createHash, timingSafeEqual } from "node:crypto";

const EXCLUDED_TOKEN_KEYS = new Set(["token"]);

/**
 * T-Bank EACQ request/notification Token.
 * Official algorithm (Dev Portal «Токен», API 1.32):
 * 1. root scalar fields only (exclude Token, nested objects/arrays such as Receipt/DATA/Data);
 * 2. add Password;
 * 3. sort keys lexicographically;
 * 4. concatenate values;
 * 5. UTF-8 SHA-256 hex.
 */
export function signTBankToken(
  fields: Record<string, unknown>,
  password: string,
): string {
  return sha256Hex(canonicalTokenString(fields, password));
}

export function verifyTBankToken(
  fields: Record<string, unknown>,
  password: string,
  expectedToken: string,
): boolean {
  const actual = signTBankToken(fields, password);
  return timingSafeEqualHex(actual, expectedToken);
}

export function canonicalTokenString(
  fields: Record<string, unknown>,
  password: string,
): string {
  const pairs: Array<{ key: string; value: string }> = [];

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    if (EXCLUDED_TOKEN_KEYS.has(rawKey.toLowerCase())) {
      continue;
    }
    const encoded = encodeRootScalar(rawValue);
    if (encoded === null) {
      continue;
    }
    pairs.push({ key: rawKey, value: encoded });
  }

  pairs.push({ key: "Password", value: password });
  pairs.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return pairs.map((pair) => pair.value).join("");
}

function encodeRootScalar(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
