import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8 } from "./bytes.js";

const ZERO_SALT = new Uint8Array(32);

export function hkdfSha256(ikm: Uint8Array, info: string, length: number, salt: Uint8Array = ZERO_SALT): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8(info), length);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

export function kdfRoot(rootKey: Uint8Array, dhOut: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const material = hkdfSha256(dhOut, "VimlaDoubleRatchetRK", 64, rootKey);
  return { rootKey: material.slice(0, 32), chainKey: material.slice(32, 64) };
}

export function kdfChain(chainKey: Uint8Array): { chainKey: Uint8Array; messageKey: Uint8Array } {
  return {
    messageKey: hmacSha256(chainKey, new Uint8Array([0x01])),
    chainKey: hmacSha256(chainKey, new Uint8Array([0x02])),
  };
}

export function messageNonce(messageKey: Uint8Array): Uint8Array {
  return hkdfSha256(messageKey, "VimlaMsgNonce", 12);
}
