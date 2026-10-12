import { b64ToBytes, bytesToB64, concatBytes, utf8 } from "./bytes.js";
import { hmacSha256 } from "./kdf.js";
import { humanClientIdFromCommitment } from "./human-content-identity.js";

const REACTION_EVENT_DOMAIN = utf8("VimlaReactionEventV1\u0000");
const REACTION_TARGET_DOMAIN = utf8("VimlaReactionTargetIndexV1\u0000");

/**
 * Domain-separated reaction event commitment. A fresh 256-bit key remains
 * inside its E2EE plaintext; a server-visible commitment is not a
 * guessable plaintext hash of an emoji or a source reference.
 */
export function boundReactionEventCommitment(
  bindingKeyB64: string,
  canonicalEvent: string,
): string | null {
  return keyedDigest(bindingKeyB64, REACTION_EVENT_DOMAIN, canonicalEvent);
}

/**
 * Opaque, stable per-original lookup tag. The key is the ORIGINAL HUMAN v2
 * binding secret, recovered only after authenticating and decrypting that
 * source. No plaintext, reference IDs or original key are sent to the API.
 *
 * A tag is a privacy-preserving index hint, NOT proof of message existence
 * or authorization. The server must still authorize the requesting actor.
 */
export function boundReactionTargetTag(
  originalBindingKeyB64: string,
  canonicalTargetIdentity: string,
): string | null {
  return keyedDigest(originalBindingKeyB64, REACTION_TARGET_DOMAIN, canonicalTargetIdentity);
}

export function reactionClientIdFromCommitment(
  commitmentB64: string,
): string | null {
  return humanClientIdFromCommitment(commitmentB64);
}

function keyedDigest(
  keyB64: string,
  domain: Uint8Array,
  canonical: string,
): string | null {
  let key: Uint8Array;
  try {
    key = b64ToBytes(keyB64);
  } catch {
    return null;
  }
  if (key.length !== 32 || bytesToB64(key) !== keyB64) return null;
  return bytesToB64(hmacSha256(key, concatBytes(domain, utf8(canonical))));
}
