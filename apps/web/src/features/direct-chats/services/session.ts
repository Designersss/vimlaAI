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
  serializeDirectRoutingMentions,
  serializeRatchet,
  utf8,
  x3dhInitiate,
  x3dhRespond,
  type DirectMessageKind,
  type PublicPreKeyBundle,
  type WireEnvelope,
} from "@vimla/e2ee";
import type {
  CryptoDeviceView,
  DirectEnvelopeView,
  DirectMessageView,
  MessageMentionInput,
  WireEnvelopeDto,
} from "@vimla/contracts";
import { fetchPrekeyBundles, registerCryptoDevice } from "./api";
import {
  acknowledgeRatchetHandshake,
  encodeIdentity,
  identityFromMaterial,
  loadDeviceMaterial,
  commitDecryptedRatchet,
  loadPlaintext,
  loadRatchet,
  saveDeviceMaterial,
  saveRatchet,
  withLocalDeviceBootstrapLock,
  withRatchetSessionLock,
  type StoredDeviceMaterial,
  type StoredPlaintext,
} from "./crypto-store";
import {
  RatchetLockLostError,
  RatchetStateConflictError,
} from "./ratchet-coordination";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "./payload";

export async function ensureLocalDevice(): Promise<StoredDeviceMaterial> {
  return withLocalDeviceBootstrapLock(async () => {
    const existing = await loadDeviceMaterial();
    if (existing) {
      if (existing.registrationState === "PENDING") {
        await registerStoredDevice(existing);
        const registered = {
          ...existing,
          registrationState: "REGISTERED" as const,
        };
        await saveDeviceMaterial(registered);
        return registered;
      }
      return existing;
    }

    const identity = generateIdentity();
    const signed = generateSignedPreKey(identity, 1);
    const oneTime = Array.from(
      { length: 16 },
      (_, index) => generateOneTimePreKey(index + 1),
    );
    const material: StoredDeviceMaterial = {
      deviceId: crypto.randomUUID(),
      registrationState: "PENDING",
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
          {
            secret: bytesToB64(key.secret),
            publicKey: bytesToB64(key.publicKey),
          },
        ]),
      ),
    };
    await saveDeviceMaterial(material);
    await registerStoredDevice(material);
    const registered = {
      ...material,
      registrationState: "REGISTERED" as const,
    };
    await saveDeviceMaterial(registered);
    return registered;
  });
}

async function registerStoredDevice(
  material: StoredDeviceMaterial,
): Promise<void> {
  const signedEntry = Object.entries(material.signedPrekeys)[0];
  if (!signedEntry) {
    throw new Error("Local E2EE signed prekey is missing");
  }
  const [signedPrekeyIdRaw, signed] = signedEntry;
  const signedPrekeyId = Number(signedPrekeyIdRaw);
  if (!Number.isSafeInteger(signedPrekeyId) || signedPrekeyId < 1) {
    throw new Error("Local E2EE signed prekey id is invalid");
  }
  const oneTimePrekeys = Object.entries(material.oneTimePrekeys)
    .map(([keyIdRaw, key]) => ({
      keyId: Number(keyIdRaw),
      publicKey: key.publicKey,
    }))
    .filter(
      (key) =>
        Number.isSafeInteger(key.keyId) &&
        key.keyId >= 1,
    )
    .sort((left, right) => left.keyId - right.keyId);
  if (oneTimePrekeys.length === 0) {
    throw new Error("Local E2EE one-time prekeys are missing");
  }
  await registerCryptoDevice({
    deviceId: material.deviceId,
    identityEd25519Public: material.identity.ed25519Public,
    identityX25519Public: material.identity.x25519Public,
    signedPrekeyId,
    signedPrekeyPublic: signed.publicKey,
    signedPrekeySignature: signed.signature,
    oneTimePrekeys,
    label: "browser",
  });
}

export async function encryptForDevices(input: {
  conversationId: string;
  senderUserId: string;
  kind: DirectMessageKind;
  plaintext: string;
  devices: CryptoDeviceView[];
  mentions?: MessageMentionInput[];
}): Promise<WireEnvelopeDto[]> {
  const material = await ensureLocalDevice();
  const identity = identityFromMaterial(material);
  const envelopes: WireEnvelopeDto[] = [];
  const routingContext = input.mentions && input.mentions.length > 0
    ? serializeDirectRoutingMentions(input.mentions)
    : undefined;
  for (const device of input.devices.filter((item) => !item.revoked)) {
    const envelope = await withRatchetRetry(
      {
        conversationId: input.conversationId,
        localDeviceId: material.deviceId,
        peerDeviceId: device.id,
      },
      async () => {
        const existing = await loadRatchet(
          input.conversationId,
          material.deviceId,
          device.id,
        );
        let x3dhInit: WireEnvelope["x3dhInit"] =
          existing?.pendingX3dhInit ?? null;
        let state = existing
          ? deserializeRatchet(existing.state)
          : null;
        if (!state) {
          const bundles = await fetchPrekeyBundles(device.userId);
          const bundle = bundles.bundles.find(
            (item) => item.deviceId === device.id,
          );
          if (!bundle) {
            throw new Error("Missing prekey bundle");
          }
          const initiated = x3dhInitiate(
            identity,
            bundle as PublicPreKeyBundle,
          );
          state = initRatchetInitiator(
            initiated.sharedKey,
            initiated.remoteRatchetPublic,
          );
          x3dhInit = initiated.initHeader;
        }
        const nextEnvelope = encryptEnvelope({
          identity,
          state,
          plaintext: utf8(input.plaintext),
          ad: {
            conversationId: input.conversationId,
            senderUserId: input.senderUserId,
            senderDeviceId: material.deviceId,
            recipientDeviceId: device.id,
            kind: input.kind,
            routingContext,
          },
          x3dhInit,
        });
        await saveRatchet(
          input.conversationId,
          material.deviceId,
          device.id,
          existing?.stateVersion ?? 0,
          serializeRatchet(state),
          x3dhInit,
        );
        return nextEnvelope;
      },
    );
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
  conversationId: string;
  message: DirectMessageView;
  senderIdentityEd25519Public: string;
}): Promise<DirectPlaintextPayload | null> {
  const cached = await loadPlaintext(input.message.id);
  if (cached) {
    return decodeDirectPlaintext(input.message.kind, cached.text);
  }
  const envelope = input.message.envelope;
  if (!envelope) {
    return null;
  }
  const material = await ensureLocalDevice();
  const identity = identityFromMaterial(material);
  try {
    return await withRatchetRetry(
      {
        conversationId: input.conversationId,
        localDeviceId: material.deviceId,
        peerDeviceId: input.message.senderDeviceId,
      },
      async () => {
        const committed = await loadPlaintext(input.message.id);
        if (committed) {
          return decodeDirectPlaintext(
            input.message.kind,
            committed.text,
          );
        }

        const stateRecord = await loadRatchet(
          input.conversationId,
          material.deviceId,
          input.message.senderDeviceId,
        );
        let state = stateRecord
          ? deserializeRatchet(stateRecord.state)
          : null;
        if (!state && envelope.x3dhInit) {
          const signed =
            material.signedPrekeys[
              String(envelope.x3dhInit.signedPrekeyId)
            ];
          if (!signed) {
            return null;
          }
          const otk =
            envelope.x3dhInit.oneTimePrekeyId !== null
              ? material.oneTimePrekeys[
                  String(envelope.x3dhInit.oneTimePrekeyId)
                ]
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

        const routingContext =
          input.message.mentions.length > 0
            ? serializeDirectRoutingMentions(
                input.message.mentions,
              )
            : undefined;
        const opened = decryptEnvelope({
          senderIdentityEd25519Public: b64ToBytes(
            input.senderIdentityEd25519Public,
          ),
          state,
          envelope: toWire(envelope),
          ad: {
            conversationId: input.conversationId,
            senderUserId: input.message.senderUserId,
            senderDeviceId: input.message.senderDeviceId,
            recipientDeviceId: envelope.recipientDeviceId,
            kind: input.message.kind,
            routingContext,
          },
        });
        const text = new TextDecoder().decode(opened);
        const row: StoredPlaintext = {
          conversationId: input.conversationId,
          messageId: input.message.id,
          text,
          kind: input.message.kind,
          senderUserId: input.message.senderUserId,
          createdAt: input.message.createdAt,
        };
        await commitDecryptedRatchet({
          conversationId: input.conversationId,
          localDeviceId: material.deviceId,
          peerDeviceId: input.message.senderDeviceId,
          expectedVersion: stateRecord?.stateVersion ?? 0,
          state: serializeRatchet(state),
          pendingX3dhInit:
            stateRecord?.pendingX3dhInit ?? null,
          plaintext: row,
        });
        return decodeDirectPlaintext(
          input.message.kind,
          text,
        );
      },
    );
  } catch (error: unknown) {
    if (isRatchetCoordinationError(error)) {
      return null;
    }
    return null;
  }
}

export async function acknowledgeSentRatchets(input: {
  conversationId: string;
  localDeviceId: string;
  envelopes: readonly WireEnvelopeDto[];
}): Promise<void> {
  const pendingRecipients = input.envelopes
    .filter((envelope) => envelope.x3dhInit !== null)
    .map((envelope) => envelope.recipientDeviceId);
  for (const peerDeviceId of pendingRecipients) {
    await acknowledgeRatchetHandshake({
      conversationId: input.conversationId,
      localDeviceId: input.localDeviceId,
      peerDeviceId,
    }).catch(() => undefined);
  }
}

const RATCHET_COORDINATION_ATTEMPTS = 3;

async function withRatchetRetry<T>(
  scope: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;
  for (
    let attempt = 0;
    attempt < RATCHET_COORDINATION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await withRatchetSessionLock(
        scope,
        operation,
      );
    } catch (error: unknown) {
      if (!isRatchetCoordinationError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw (
    lastError ??
    new RatchetStateConflictError()
  );
}

function isRatchetCoordinationError(
  error: unknown,
): error is RatchetStateConflictError | RatchetLockLostError {
  return (
    error instanceof RatchetStateConflictError ||
    error instanceof RatchetLockLostError
  );
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

