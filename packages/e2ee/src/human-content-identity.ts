import { b64ToBytes, bytesToB64, concatBytes, utf8 } from "./bytes.js";
import { hmacSha256 } from "./kdf.js";

const DOMAIN = utf8("VimlaHumanContentIdentityV2\u0000");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Generate a per-message secret in the crypto package with WebCrypto. */
export function generateHumanBindingKey(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * A uniformly random per-message secret travels ONLY in the E2EE plaintext.
 * The server sees a complete 256-bit keyed HMAC commitment to canonical
 * content but never its encrypted 256-bit key or the plaintext. Each device
 * verifies all 256 bits after ratchet decryption; the UUID is ONLY the
 * idempotency/index prefix and does NOT establish content equality.
 *
 * A malicious sender who precomputes both candidate messages faces the
 * generic 2^128 birthday bound of a 256-bit full commitment, rather than
 * the much weaker 2^61 collision bound of the 122-bit UUID prefix.
 */
export function boundHumanClientMessageId(
  secretB64: string,
  canonicalContent: string,
): string | null {
  const commitment = computeHumanContentCommitment(secretB64, canonicalContent);
  return commitment ? humanClientIdFromCommitment(commitment) : null;
}

/** The 256-bit, keyed, opaque HUMAN commitment (not a plaintext hash). */
export function boundHumanContentCommitment(
  secretB64: string,
  canonicalContent: string,
): string | null {
  return computeHumanContentCommitment(secretB64, canonicalContent);
}

function computeHumanContentCommitment(
  secretB64: string,
  canonicalContent: string,
): string | null {
  let secret: Uint8Array;
  try {
    secret = b64ToBytes(secretB64);
  } catch {
    return null;
  }
  if (secret.length !== 32 || bytesToB64(secret) !== secretB64) return null;
  return bytesToB64(hmacSha256(secret, concatBytes(DOMAIN, utf8(canonicalContent))));
}

/** UUID compatibility key truncated from a full 256-bit content commitment. */
export function humanClientIdFromCommitment(commitmentB64: string): string | null {
  let hash: Uint8Array;
  try {
    hash = b64ToBytes(commitmentB64);
  } catch {
    return null;
  }
  if (hash.length !== 32 || bytesToB64(hash) !== commitmentB64) return null;
  const bytes = hash.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isBoundHumanClientMessageId(value: string): boolean {
  return UUID.test(value);
}
