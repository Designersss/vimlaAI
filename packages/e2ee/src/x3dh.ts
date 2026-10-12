import { x25519 } from "@noble/curves/ed25519.js";
import { b64ToBytes, bytesToB64, concatBytes } from "./bytes.js";
import { dh, decodePublicKey, type IdentityKeyPair, type PublicPreKeyBundle, verifySignedPreKey } from "./keys.js";
import { hkdfSha256 } from "./kdf.js";

export interface X3dhInitHeader {
  identityEd25519Public: string;
  identityX25519Public: string;
  ephemeralPublic: string;
  signedPrekeyId: number;
  oneTimePrekeyId: number | null;
}

export interface X3dhInitiation {
  sharedKey: Uint8Array;
  associatedData: Uint8Array;
  initHeader: X3dhInitHeader;
  remoteRatchetPublic: Uint8Array;
}

export function x3dhInitiate(local: IdentityKeyPair, remote: PublicPreKeyBundle): X3dhInitiation {
  // An OTK is either an atomic (id, public key) pair or completely absent.
  // Without this check a malformed API bundle could derive 4DH while
  // transmitting a null OTK id (or vice versa), leaving a session that
  // its recipient can never reconstruct.
  if ((remote.oneTimePrekeyId === null) !== (remote.oneTimePrekeyPublic === null) ||
      (remote.oneTimePrekeyId !== null &&
        (!Number.isSafeInteger(remote.oneTimePrekeyId) || remote.oneTimePrekeyId < 1))) {
    throw new Error("Inconsistent X3DH one-time prekey bundle");
  }
  const remoteIdentityEd = decodePublicKey(remote.identityEd25519Public);
  const remoteIdentityX = decodePublicKey(remote.identityX25519Public);
  const remoteSigned = decodePublicKey(remote.signedPrekeyPublic);
  const signature = decodeFixed(remote.signedPrekeySignature, 64);
  if (!verifySignedPreKey(remoteIdentityEd, remote.signedPrekeyId, remoteSigned, signature)) {
    throw new Error("Signed prekey failed verification");
  }

  const ephemeral = x25519.keygen();
  const dh1 = dh(local.x25519Secret, remoteSigned);
  const dh2 = dh(ephemeral.secretKey, remoteIdentityX);
  const dh3 = dh(ephemeral.secretKey, remoteSigned);
  const parts = [dh1, dh2, dh3];
  if (remote.oneTimePrekeyPublic !== null) {
    parts.push(dh(ephemeral.secretKey, decodePublicKey(remote.oneTimePrekeyPublic)));
  }

  return {
    sharedKey: hkdfSha256(concatBytes(...parts), "VimlaX3DH", 32),
    associatedData: concatBytes(local.ed25519Public, remoteIdentityEd),
    initHeader: {
      identityEd25519Public: bytesToB64(local.ed25519Public),
      identityX25519Public: bytesToB64(local.x25519Public),
      ephemeralPublic: bytesToB64(ephemeral.publicKey),
      signedPrekeyId: remote.signedPrekeyId,
      oneTimePrekeyId: remote.oneTimePrekeyId,
    },
    remoteRatchetPublic: remoteSigned,
  };
}

export function x3dhRespond(
  local: IdentityKeyPair,
  signedPrekeySecret: Uint8Array,
  oneTimeSecret: Uint8Array | null,
  init: X3dhInitHeader,
): { sharedKey: Uint8Array; associatedData: Uint8Array } {
  // A sender-authenticated X3DH init header commits to whether an OTK
  // participated in the KDF. Never silently derive the other handshake
  // variant when local key material has been lost or misidentified.
  if ((init.oneTimePrekeyId === null) !== (oneTimeSecret === null) ||
      (init.oneTimePrekeyId !== null &&
        (!Number.isSafeInteger(init.oneTimePrekeyId) || init.oneTimePrekeyId < 1))) {
    throw new Error("X3DH one-time prekey does not match init header");
  }
  const remoteIdentityEd = decodePublicKey(init.identityEd25519Public);
  const remoteIdentityX = decodePublicKey(init.identityX25519Public);
  const ephemeral = decodePublicKey(init.ephemeralPublic);
  const dh1 = dh(signedPrekeySecret, remoteIdentityX);
  const dh2 = dh(local.x25519Secret, ephemeral);
  const dh3 = dh(signedPrekeySecret, ephemeral);
  const parts = [dh1, dh2, dh3];
  if (oneTimeSecret) {
    parts.push(dh(oneTimeSecret, ephemeral));
  }
  return {
    sharedKey: hkdfSha256(concatBytes(...parts), "VimlaX3DH", 32),
    associatedData: concatBytes(remoteIdentityEd, local.ed25519Public),
  };
}

function decodeFixed(value: string, length: number): Uint8Array {
  const bytes = b64ToBytes(value);
  if (bytes.byteLength !== length) {
    throw new Error("Invalid key material length");
  }
  return bytes;
}
