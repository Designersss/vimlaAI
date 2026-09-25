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
import { fetchPrekeyBundles, fetchPrekeyStatus, registerCryptoDevice, replenishOneTimePrekeys, sendDirectMessage } from "./api";
import {
  acknowledgeRatchetHandshake,
  commitDecryptedRatchet,
  commitOutboundRatchets,
  completePendingSend,
  encodeIdentity,
  identityFromMaterial,
  loadDeviceMaterial,
  loadPendingSends,
  loadPlaintext,
  loadRatchet,
  saveDeviceMaterial,
  withLocalDeviceBootstrapLock,
  withRatchetSessionLock,
  withRatchetSessionLocks,
  type OutboundRatchetUpdate,
  type StoredDeviceMaterial,
  type StoredPendingSend,
  type StoredPlaintext,
} from "./crypto-store";
import {
  RatchetLockLostError,
  RatchetStateConflictError,
} from "./ratchet-coordination";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "./payload";

const PREKEY_LOW_WATER = 8;
const PREKEY_TARGET = 16;
const PREKEY_STATUS_MAX_AGE_MS = 5 * 60_000;

export async function ensureLocalDevice(
  options: { forcePrekeyCheck?: boolean } = {},
): Promise<StoredDeviceMaterial> {
  return withLocalDeviceBootstrapLock(async () => {
    const existing = await loadDeviceMaterial();
    if (existing) {
      let current = existing;
      if (current.registrationState === "PENDING") {
        await registerStoredDevice(current);
        current = {
          ...current,
          registrationState: "REGISTERED" as const,
          prekeyStatusCheckedAt: new Date().toISOString(),
        };
        await saveDeviceMaterial(current);
      }
      return ensurePrekeySupply(
        current,
        options.forcePrekeyCheck === true,
      );
    }

    const identity = generateIdentity();
    const signed = generateSignedPreKey(identity, 1);
    const oneTime = Array.from(
      { length: PREKEY_TARGET },
      (_, index) => generateOneTimePreKey(index + 1),
    );
    const material: StoredDeviceMaterial = {
      deviceId: crypto.randomUUID(),
      registrationState: "PENDING",
      nextOneTimePrekeyId: PREKEY_TARGET + 1,
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
    const registered: StoredDeviceMaterial = {
      ...material,
      registrationState: "REGISTERED",
      prekeyStatusCheckedAt: new Date().toISOString(),
    };
    await saveDeviceMaterial(registered);
    return registered;
  });
}

async function ensurePrekeySupply(
  material: StoredDeviceMaterial,
  forceCheck: boolean,
): Promise<StoredDeviceMaterial> {
  let current = material;
  if (
    current.nextOneTimePrekeyId === undefined ||
    !Number.isSafeInteger(current.nextOneTimePrekeyId) ||
    current.nextOneTimePrekeyId < 1
  ) {
    const existingIds = Object.keys(
      current.oneTimePrekeys,
    )
      .map(Number)
      .filter(Number.isSafeInteger);
    current = {
      ...current,
      nextOneTimePrekeyId:
        (existingIds.length > 0
          ? Math.max(...existingIds)
          : 0) + 1,
    };
    await saveDeviceMaterial(current);
  }
  const pendingIds =
    current.pendingOneTimePrekeyIds ?? [];
  if (pendingIds.length > 0) {
    await uploadPendingOneTimePrekeys(
      current,
      pendingIds,
    );
    current = {
      ...current,
      pendingOneTimePrekeyIds: [],
      prekeyStatusCheckedAt: undefined,
    };
    await saveDeviceMaterial(current);
  }

  const checkedAt = current.prekeyStatusCheckedAt
    ? Date.parse(current.prekeyStatusCheckedAt)
    : Number.NaN;
  if (
    !forceCheck &&
    Number.isFinite(checkedAt) &&
    Date.now() - checkedAt < PREKEY_STATUS_MAX_AGE_MS
  ) {
    return current;
  }

  const status = await fetchPrekeyStatus(
    current.deviceId,
  );
  if (status.available >= PREKEY_LOW_WATER) {
    const checked: StoredDeviceMaterial = {
      ...current,
      prekeyStatusCheckedAt: new Date().toISOString(),
    };
    await saveDeviceMaterial(checked);
    return checked;
  }

  const needed = Math.min(
    PREKEY_TARGET - status.available,
    32,
  );
  const nextOneTimePrekeyId =
    current.nextOneTimePrekeyId ?? 1;
  if (
    nextOneTimePrekeyId + needed - 1 >
    1_000_000
  ) {
    throw new Error("Local E2EE prekey id space exhausted");
  }
  const generated = Array.from(
    { length: needed },
    (_, index) =>
      generateOneTimePreKey(
        nextOneTimePrekeyId + index,
      ),
  );
  const next: StoredDeviceMaterial = {
    ...current,
    oneTimePrekeys: {
      ...current.oneTimePrekeys,
      ...Object.fromEntries(
        generated.map((key) => [
          String(key.keyId),
          {
            secret: bytesToB64(key.secret),
            publicKey: bytesToB64(key.publicKey),
          },
        ]),
      ),
    },
    pendingOneTimePrekeyIds: generated.map(
      (key) => key.keyId,
    ),
    nextOneTimePrekeyId:
      nextOneTimePrekeyId + generated.length,
  };
  await saveDeviceMaterial(next);
  await uploadPendingOneTimePrekeys(
    next,
    next.pendingOneTimePrekeyIds ?? [],
  );
  const completed: StoredDeviceMaterial = {
    ...next,
    pendingOneTimePrekeyIds: [],
    prekeyStatusCheckedAt: new Date().toISOString(),
  };
  await saveDeviceMaterial(completed);
  return completed;
}

async function uploadPendingOneTimePrekeys(
  material: StoredDeviceMaterial,
  ids: readonly number[],
): Promise<void> {
  if (ids.length === 0) return;
  const oneTimePrekeys = ids.map((keyId) => {
    const key =
      material.oneTimePrekeys[String(keyId)];
    if (!key) {
      throw new Error(
        "Pending local E2EE prekey material is missing",
      );
    }
    return {
      keyId,
      publicKey: key.publicKey,
    };
  });
  await replenishOneTimePrekeys(
    material.deviceId,
    { oneTimePrekeys },
  );
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
  clientMessageId: string;
  localDevice: StoredDeviceMaterial;
  kind: DirectMessageKind;
  plaintext: string;
  devices: CryptoDeviceView[];
  mentions?: MessageMentionInput[];
}): Promise<StoredPendingSend> {
  const material = input.localDevice;
  const identity = identityFromMaterial(material);
  const activeDevices = input.devices
    .filter((item) => !item.revoked)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (activeDevices.length === 0) {
    throw new Error("Direct Chat has no active crypto devices");
  }
  const scopes = activeDevices.map((device) => ({
    conversationId: input.conversationId,
    localDeviceId: material.deviceId,
    peerDeviceId: device.id,
  }));
  const bundleRequests = new Map<
    string,
    ReturnType<typeof fetchPrekeyBundles>
  >();
  const routingContext =
    input.mentions && input.mentions.length > 0
      ? serializeDirectRoutingMentions(input.mentions)
      : undefined;

  return withRatchetRetryScopes(scopes, async () => {
    const envelopes: WireEnvelopeDto[] = [];
    const updates: OutboundRatchetUpdate[] = [];

    for (const device of activeDevices) {
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
        let bundlesRequest = bundleRequests.get(device.id);
        if (!bundlesRequest) {
          bundlesRequest = fetchPrekeyBundles(
            device.userId,
            device.id,
          );
          bundleRequests.set(device.id, bundlesRequest);
        }
        const bundles = await bundlesRequest;
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
          routingContext,
        },
        x3dhInit,
      });
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
      updates.push({
        peerDeviceId: device.id,
        expectedVersion: existing?.stateVersion ?? 0,
        state: serializeRatchet(state),
        pendingX3dhInit: x3dhInit,
      });
    }

    const pending: StoredPendingSend = {
      conversationId: input.conversationId,
      clientMessageId: input.clientMessageId,
      senderUserId: input.senderUserId,
      senderDeviceId: material.deviceId,
      kind: input.kind,
      envelopes,
      mentions: input.mentions ?? [],
      plaintext: input.plaintext,
      createdAt: new Date().toISOString(),
    };
    await commitOutboundRatchets({
      conversationId: input.conversationId,
      localDeviceId: material.deviceId,
      updates,
      pendingSend: pending,
    });
    return pending;
  });
}

export async function finalizePendingSend(
  pending: StoredPendingSend,
  created: DirectMessageView,
): Promise<void> {
  await completePendingSend({
    pending,
    messageId: created.id,
    serverCreatedAt: created.createdAt,
  });
  void acknowledgeSentRatchets({
    conversationId: pending.conversationId,
    localDeviceId: pending.senderDeviceId,
    envelopes: pending.envelopes,
  });
}

export async function recoverPendingSends(input: {
  conversationId: string;
  localDeviceId: string;
}): Promise<void> {
  const pending = await loadPendingSends(
    input.conversationId,
    input.localDeviceId,
  );
  for (const row of pending) {
    const created = await sendDirectMessage(
      row.conversationId,
      {
        clientMessageId: row.clientMessageId,
        senderDeviceId: row.senderDeviceId,
        kind: row.kind,
        envelopes: row.envelopes,
        mentions: row.mentions,
      },
    );
    await finalizePendingSend(row, created);
  }
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
        let consumedOneTimePrekeyId: number | null = null;
        if (!state && envelope.x3dhInit) {
          const signed =
            material.signedPrekeys[
              String(envelope.x3dhInit.signedPrekeyId)
            ];
          if (!signed) {
            return null;
          }
          const oneTimePrekeyId =
            envelope.x3dhInit.oneTimePrekeyId;
          const otk =
            oneTimePrekeyId !== null
              ? material.oneTimePrekeys[
                  String(oneTimePrekeyId)
                ]
              : null;
          if (oneTimePrekeyId !== null && !otk) {
            return null;
          }
          consumedOneTimePrekeyId = oneTimePrekeyId;
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
          consumedOneTimePrekeyId,
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

async function withRatchetRetryScopes<T>(
  scopes: ReadonlyArray<{
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
  }>,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;
  for (
    let attempt = 0;
    attempt < RATCHET_COORDINATION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await withRatchetSessionLocks(
        scopes,
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

