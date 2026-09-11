import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { b64ToBytes, bytesToB64, concatBytes, constantTimeEqual, readU32be, u32be } from "./bytes.js";
import { dh } from "./keys.js";
import { kdfChain, kdfRoot, messageNonce } from "./kdf.js";

export const MAX_SKIP = 200;

export interface RatchetHeader {
  dhPublic: Uint8Array;
  n: number;
  pn: number;
}

export interface SerializedRatchetState {
  dhsSecret: string;
  dhsPublic: string;
  dhrPublic: string | null;
  rootKey: string;
  sendingChainKey: string | null;
  receivingChainKey: string | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, string>;
}

export interface RatchetState {
  dhsSecret: Uint8Array;
  dhsPublic: Uint8Array;
  dhrPublic: Uint8Array | null;
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array | null;
  receivingChainKey: Uint8Array | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Map<string, Uint8Array>;
}

export function initRatchetInitiator(sharedKey: Uint8Array, remoteRatchetPublic: Uint8Array): RatchetState {
  const local = x25519.keygen();
  const { rootKey, chainKey } = kdfRoot(sharedKey, dh(local.secretKey, remoteRatchetPublic));
  return {
    dhsSecret: local.secretKey,
    dhsPublic: local.publicKey,
    dhrPublic: remoteRatchetPublic,
    rootKey,
    sendingChainKey: chainKey,
    receivingChainKey: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

export function initRatchetResponder(sharedKey: Uint8Array, localRatchet: { secret: Uint8Array; publicKey: Uint8Array }): RatchetState {
  return {
    dhsSecret: localRatchet.secret,
    dhsPublic: localRatchet.publicKey,
    dhrPublic: null,
    rootKey: sharedKey,
    sendingChainKey: null,
    receivingChainKey: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

export function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array, associatedData: Uint8Array): {
  header: RatchetHeader;
  ciphertext: Uint8Array;
} {
  if (!state.sendingChainKey) {
    throw new Error("Sending chain is not initialized");
  }
  const { chainKey, messageKey } = kdfChain(state.sendingChainKey);
  state.sendingChainKey = chainKey;
  const header: RatchetHeader = { dhPublic: state.dhsPublic, n: state.ns, pn: state.pn };
  state.ns += 1;
  const ciphertext = aeadEncrypt(messageKey, plaintext, concatBytes(associatedData, encodeHeader(header)));
  return { header, ciphertext };
}

export function ratchetDecrypt(state: RatchetState, header: RatchetHeader, ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array {
  const skipped = trySkipped(state, header, ciphertext, associatedData);
  if (skipped) {
    return skipped;
  }
  if (!state.dhrPublic || !constantTimeEqual(header.dhPublic, state.dhrPublic)) {
    skipMessageKeys(state, header.pn);
    dhRatchet(state, header);
  }
  skipMessageKeys(state, header.n);
  if (!state.receivingChainKey) {
    throw new Error("Receiving chain is not initialized");
  }
  const { chainKey, messageKey } = kdfChain(state.receivingChainKey);
  state.receivingChainKey = chainKey;
  state.nr += 1;
  return aeadDecrypt(messageKey, ciphertext, concatBytes(associatedData, encodeHeader(header)));
}

export function encodeHeader(header: RatchetHeader): Uint8Array {
  return concatBytes(header.dhPublic, u32be(header.pn), u32be(header.n));
}

export function decodeHeader(bytes: Uint8Array): RatchetHeader {
  if (bytes.byteLength !== 40) {
    throw new Error("Invalid ratchet header");
  }
  return {
    dhPublic: bytes.slice(0, 32),
    pn: readU32be(bytes, 32),
    n: readU32be(bytes, 36),
  };
}

export function serializeRatchet(state: RatchetState): SerializedRatchetState {
  const skipped: Record<string, string> = {};
  for (const [key, value] of state.skipped.entries()) {
    skipped[key] = bytesToB64(value);
  }
  return {
    dhsSecret: bytesToB64(state.dhsSecret),
    dhsPublic: bytesToB64(state.dhsPublic),
    dhrPublic: state.dhrPublic ? bytesToB64(state.dhrPublic) : null,
    rootKey: bytesToB64(state.rootKey),
    sendingChainKey: state.sendingChainKey ? bytesToB64(state.sendingChainKey) : null,
    receivingChainKey: state.receivingChainKey ? bytesToB64(state.receivingChainKey) : null,
    ns: state.ns,
    nr: state.nr,
    pn: state.pn,
    skipped,
  };
}

export function deserializeRatchet(serialized: SerializedRatchetState): RatchetState {
  const skipped = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(serialized.skipped)) {
    skipped.set(key, b64ToBytes(value));
  }
  return {
    dhsSecret: b64ToBytes(serialized.dhsSecret),
    dhsPublic: b64ToBytes(serialized.dhsPublic),
    dhrPublic: serialized.dhrPublic ? b64ToBytes(serialized.dhrPublic) : null,
    rootKey: b64ToBytes(serialized.rootKey),
    sendingChainKey: serialized.sendingChainKey ? b64ToBytes(serialized.sendingChainKey) : null,
    receivingChainKey: serialized.receivingChainKey ? b64ToBytes(serialized.receivingChainKey) : null,
    ns: serialized.ns,
    nr: serialized.nr,
    pn: serialized.pn,
    skipped,
  };
}

function skipMessageKeys(state: RatchetState, until: number): void {
  if (!state.receivingChainKey) {
    return;
  }
  if (until - state.nr > MAX_SKIP) {
    throw new Error("Too many skipped message keys");
  }
  while (state.nr < until) {
    const { chainKey, messageKey } = kdfChain(state.receivingChainKey);
    state.receivingChainKey = chainKey;
    if (!state.dhrPublic) {
      throw new Error("Cannot skip without a remote ratchet key");
    }
    state.skipped.set(skippedKey(state.dhrPublic, state.nr), messageKey);
    state.nr += 1;
  }
}

function trySkipped(
  state: RatchetState,
  header: RatchetHeader,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
): Uint8Array | null {
  const key = skippedKey(header.dhPublic, header.n);
  const messageKey = state.skipped.get(key);
  if (!messageKey) {
    return null;
  }
  state.skipped.delete(key);
  return aeadDecrypt(messageKey, ciphertext, concatBytes(associatedData, encodeHeader(header)));
}

function dhRatchet(state: RatchetState, header: RatchetHeader): void {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhrPublic = header.dhPublic;
  const recv = kdfRoot(state.rootKey, dh(state.dhsSecret, header.dhPublic));
  state.rootKey = recv.rootKey;
  state.receivingChainKey = recv.chainKey;
  const next = x25519.keygen();
  state.dhsSecret = next.secretKey;
  state.dhsPublic = next.publicKey;
  const send = kdfRoot(state.rootKey, dh(state.dhsSecret, header.dhPublic));
  state.rootKey = send.rootKey;
  state.sendingChainKey = send.chainKey;
}

function aeadEncrypt(messageKey: Uint8Array, plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array {
  return chacha20poly1305(messageKey, messageNonce(messageKey), associatedData).encrypt(plaintext);
}

function aeadDecrypt(messageKey: Uint8Array, ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array {
  try {
    return chacha20poly1305(messageKey, messageNonce(messageKey), associatedData).decrypt(ciphertext);
  } catch {
    throw new Error("Message authentication failed");
  }
}

function skippedKey(dhPublic: Uint8Array, n: number): string {
  return `${bytesToB64(dhPublic)}:${n}`;
}
