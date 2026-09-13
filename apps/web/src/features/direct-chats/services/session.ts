import {
  b64ToBytes,
  bytesToB64,
  decryptEnvelope,
  deserializeRatchet,
  encryptEnvelope,
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  initRatchetInitiator,
  initRatchetResponder,
  serializeRatchet,
  utf8,
  x3dhInitiate,
  x3dhRespond,
  type DirectMessageKind,
  type PublicPreKeyBundle,
  type WireEnvelope,
} from "@vimla/e2ee";
import type { CryptoDeviceView, DirectEnvelopeView, DirectMessageView, WireEnvelopeDto } from "@vimla/contracts";
import { fetchMyCryptoDevices, fetchPrekeyBundles, registerCryptoDevice, DirectChatsApiError } from "./api";
import {
  clearAccountSensitiveState,
  encodeIdentity,
  identityFromMaterial,
  loadDeviceMaterial,
  loadPlaintext,
  loadRatchet,
  saveDeviceMaterial,
  savePlaintext,
  saveRatchet,
  type StoredDeviceMaterial,
  type StoredPlaintext,
} from "./crypto-store";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "./payload";

export async function ensureLocalDevice(accountId: string): Promise<StoredDeviceMaterial> {
  const existing = await loadDeviceMaterial(accountId);
  if (existing) {
    const registered = (await fetchMyCryptoDevices()).find((device) => device.id === existing.deviceId);
    if (registered?.revoked) {
      await clearAccountSensitiveState(accountId);
      throw new DirectChatsApiError("direct_chat_device_revoked");
    }
    return existing;
  }
  const identity = generateIdentity();
  const signed = generateSignedPreKey(identity, 1);
  const oneTime = Array.from({ length: 16 }, (_, index) => generateOneTimePreKey(index + 1));
  const deviceId = crypto.randomUUID();
  const material: StoredDeviceMaterial = {
    deviceId,
    identity: encodeIdentity(identity),
    signedPrekeys: {
      [String(signed.keyId)]: {
        secret: bytesToB64(signed.secret),
        publicKey: bytesToB64(signed.publicKey),
        signature: bytesToB64(signed.signature),
      },
    },
    oneTimePrekeys: Object.fromEntries(
      oneTime.map((key) => [
        String(key.keyId),
        { secret: bytesToB64(key.secret), publicKey: bytesToB64(key.publicKey) },
      ]),
    ),
  };
  await registerCryptoDevice({
    deviceId,
    identityEd25519Public: material.identity.ed25519Public,
    identityX25519Public: material.identity.x25519Public,
    signedPrekeyId: signed.keyId,
    signedPrekeyPublic: bytesToB64(signed.publicKey),
    signedPrekeySignature: bytesToB64(signed.signature),
    oneTimePrekeys: oneTime.map((key) => ({ keyId: key.keyId, publicKey: bytesToB64(key.publicKey) })),
    label: "browser",
  });
  await saveDeviceMaterial(accountId, material);
  return material;
}

export async function encryptForDevices(input: {
  conversationId: string;
  senderUserId: string;
  kind: DirectMessageKind;
  plaintext: string;
  devices: CryptoDeviceView[];
}): Promise<WireEnvelopeDto[]> {
  const material = await ensureLocalDevice(input.senderUserId);
  const identity = identityFromMaterial(material);
  const envelopes: WireEnvelopeDto[] = [];
  for (const device of input.devices.filter((item) => !item.revoked)) {
    const existing = await loadRatchet(input.senderUserId, input.conversationId, device.id);
    let x3dhInit: WireEnvelope["x3dhInit"] = null;
    let state = existing ? deserializeRatchet(existing) : null;
    if (!state) {
      const bundles = await fetchPrekeyBundles(device.userId);
      const bundle = bundles.bundles.find((item) => item.deviceId === device.id);
      if (!bundle) {
        throw new Error("Missing prekey bundle");
      }
      const initiated = x3dhInitiate(identity, bundle as PublicPreKeyBundle);
      state = initRatchetInitiator(initiated.sharedKey, initiated.remoteRatchetPublic);
      x3dhInit = initiated.initHeader;
    }
    const envelope = encryptEnvelope({
      identity,
      state,
      plaintext: utf8(input.plaintext),
      ad: {
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        senderDeviceId: material.deviceId,
        recipientDeviceId: device.id,
        kind: input.kind,
      },
      x3dhInit,
    });
    await saveRatchet(input.senderUserId, input.conversationId, device.id, serializeRatchet(state));
    envelopes.push({
      recipientDeviceId: device.id,
      headerB64: envelope.headerB64,
      ciphertextB64: envelope.ciphertextB64,
      dhPublicB64: envelope.dhPublicB64,
      messageNumber: envelope.messageNumber,
      previousChainLength: envelope.previousChainLength,
      senderSignatureB64: envelope.senderSignatureB64,
      x3dhInit: envelope.x3dhInit,
    });
  }
  return envelopes;
}

export async function decryptMessage(input: {
  accountId: string;
  conversationId: string;
  message: DirectMessageView;
  senderIdentityEd25519Public: string;
}): Promise<DirectPlaintextPayload | null> {
  const material = await ensureLocalDevice(input.accountId);
  const cached = await loadPlaintext(input.accountId, input.message.id);
  if (cached) {
    return decodeDirectPlaintext(input.message.kind, cached.text);
  }
  const envelope = input.message.envelope;
  if (!envelope) {
    return null;
  }
  const identity = identityFromMaterial(material);
  const stateRecord = await loadRatchet(input.accountId, input.conversationId, input.message.senderDeviceId);
  let state = stateRecord ? deserializeRatchet(stateRecord) : null;
  if (!state && envelope.x3dhInit) {
    const signed = material.signedPrekeys[String(envelope.x3dhInit.signedPrekeyId)];
    if (!signed) {
      return null;
    }
    const otk =
      envelope.x3dhInit.oneTimePrekeyId !== null
        ? material.oneTimePrekeys[String(envelope.x3dhInit.oneTimePrekeyId)]
        : null;
    const shared = x3dhRespond(
      identity,
      b64ToBytes(signed.secret),
      otk ? b64ToBytes(otk.secret) : null,
      envelope.x3dhInit,
    );
    state = initRatchetResponder(shared.sharedKey, {
      secret: b64ToBytes(signed.secret),
      publicKey: b64ToBytes(signed.publicKey),
    });
  }
  if (!state) {
    return null;
  }
  try {
    const opened = decryptEnvelope({
      senderIdentityEd25519Public: b64ToBytes(input.senderIdentityEd25519Public),
      state,
      envelope: toWire(envelope),
      ad: {
        conversationId: input.conversationId,
        senderUserId: input.message.senderUserId,
        senderDeviceId: input.message.senderDeviceId,
        recipientDeviceId: envelope.recipientDeviceId,
        kind: input.message.kind,
      },
    });
    const text = new TextDecoder().decode(opened);
    await saveRatchet(input.accountId, input.conversationId, input.message.senderDeviceId, serializeRatchet(state));
    const row: StoredPlaintext = {
      conversationId: input.conversationId,
      messageId: input.message.id,
      text,
      kind: input.message.kind,
      senderUserId: input.message.senderUserId,
      createdAt: input.message.createdAt,
    };
    await savePlaintext(input.accountId, row);
    return decodeDirectPlaintext(input.message.kind, text);
  } catch {
    return null;
  }
}

export function encodePayload(payload: DirectPlaintextPayload): string {
  return encodeDirectPlaintext(payload);
}

function toWire(envelope: DirectEnvelopeView): WireEnvelope {
  return {
    headerB64: envelope.headerB64,
    ciphertextB64: envelope.ciphertextB64,
    dhPublicB64: envelope.dhPublicB64,
    messageNumber: envelope.messageNumber,
    previousChainLength: envelope.previousChainLength,
    senderSignatureB64: envelope.senderSignatureB64,
    x3dhInit: envelope.x3dhInit,
  };
}
