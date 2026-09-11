import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToB64, b64ToBytes, utf8 } from "./bytes.js";

export interface IdentityKeyPair {
  ed25519Secret: Uint8Array;
  ed25519Public: Uint8Array;
  x25519Secret: Uint8Array;
  x25519Public: Uint8Array;
}

export interface SignedPreKeyPair {
  keyId: number;
  secret: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export interface OneTimePreKeyPair {
  keyId: number;
  secret: Uint8Array;
  publicKey: Uint8Array;
}

export interface PublicPreKeyBundle {
  deviceId: string;
  identityEd25519Public: string;
  identityX25519Public: string;
  signedPrekeyId: number;
  signedPrekeyPublic: string;
  signedPrekeySignature: string;
  oneTimePrekeyId: number | null;
  oneTimePrekeyPublic: string | null;
}

export function generateIdentity(): IdentityKeyPair {
  const ed = ed25519.keygen();
  const x = x25519.keygen();
  return {
    ed25519Secret: ed.secretKey,
    ed25519Public: ed.publicKey,
    x25519Secret: x.secretKey,
    x25519Public: x.publicKey,
  };
}

export function generateSignedPreKey(identity: IdentityKeyPair, keyId: number): SignedPreKeyPair {
  const x = x25519.keygen();
  const signature = ed25519.sign(signedPrekeyMessage(keyId, x.publicKey), identity.ed25519Secret);
  return { keyId, secret: x.secretKey, publicKey: x.publicKey, signature };
}

export function generateOneTimePreKey(keyId: number): OneTimePreKeyPair {
  const x = x25519.keygen();
  return { keyId, secret: x.secretKey, publicKey: x.publicKey };
}

export function verifySignedPreKey(
  identityEd25519Public: Uint8Array,
  keyId: number,
  signedPrekeyPublic: Uint8Array,
  signature: Uint8Array,
): boolean {
  return ed25519.verify(signature, signedPrekeyMessage(keyId, signedPrekeyPublic), identityEd25519Public, {
    zip215: false,
  });
}

export function signDirectMessage(identityEd25519Secret: Uint8Array, payload: Uint8Array): Uint8Array {
  return ed25519.sign(payload, identityEd25519Secret);
}

export function verifyDirectMessage(
  identityEd25519Public: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): boolean {
  return ed25519.verify(signature, payload, identityEd25519Public, { zip215: false });
}

export function dh(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secret, publicKey);
}

export function publicBundleFrom(
  deviceId: string,
  identity: IdentityKeyPair,
  signed: SignedPreKeyPair,
  oneTime: OneTimePreKeyPair | null,
): PublicPreKeyBundle {
  return {
    deviceId,
    identityEd25519Public: bytesToB64(identity.ed25519Public),
    identityX25519Public: bytesToB64(identity.x25519Public),
    signedPrekeyId: signed.keyId,
    signedPrekeyPublic: bytesToB64(signed.publicKey),
    signedPrekeySignature: bytesToB64(signed.signature),
    oneTimePrekeyId: oneTime?.keyId ?? null,
    oneTimePrekeyPublic: oneTime ? bytesToB64(oneTime.publicKey) : null,
  };
}

export function decodePublicKey(value: string): Uint8Array {
  const bytes = b64ToBytes(value);
  if (bytes.byteLength !== 32) {
    throw new Error("Invalid public key length");
  }
  return bytes;
}

function signedPrekeyMessage(keyId: number, publicKey: Uint8Array): Uint8Array {
  return utf8(`VimlaSignedPreKeyV1:${keyId}:${bytesToB64(publicKey)}`);
}
