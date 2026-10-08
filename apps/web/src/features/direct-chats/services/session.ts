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
import {
  DirectChatsApiError,
  fetchDirectConversation,
  lookupOwnDirectMessage,
  fetchPrekeyBundles,
  prepareDirectMessageSend,
  registerCryptoDevice,
  sendDirectMessage,
} from "./api";
import {
  acknowledgeRatchetHandshake,
  assertLocalDeviceBootstrapLease,
  commitDecryptedRatchet,
  commitOutboundRatchets,
  completePendingOperatorIntent,
  completePendingSend,
  discardPendingSendForUnavailableInteraction,
  encodeIdentity,
  identityFromMaterial,
  loadDeviceMaterial,
  loadPendingSend,
  loadPendingSends,
  loadPlaintext,
  loadRatchet,
  pendingSendRevision,
  pruneReconciledTrustCancelledPendingSend,
  saveDeviceMaterial,
  stagePendingOperatorDelivery,
  withLocalDeviceBootstrapLock,
  withPendingOperatorIntentLock,
  withPendingSendRecoveryLock,
  withRatchetSessionLock,
  withRatchetSessionLocks,
  PendingSendConflictError,
  type OutboundRatchetUpdate,
  type StoredDeviceMaterial,
  type StoredOperatorDelivery,
  type StoredOperatorIntent,
  type StoredOperatorOutputDraft,
  type StoredOperatorOutputLink,
  type StoredPendingSend,
  type StoredPlaintext,
} from "./crypto-store";
import {
  RatchetLockLostError,
  directHumanClientMessageId,
  directHumanContentCommitment,
  cachedDirectPlaintextMatchesMessage,
  RatchetStateConflictError,
} from "@vimla/client-core";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "./payload";
import { clearLocalDataAfterDeviceRevocation } from "./local-data";
import { isLocalDeviceRevoked } from "./revocation-state";
import { selectTrustCancelledGcCandidates } from "./trust-cancelled-gc";

function assertLocalDeviceNotRevoked(): void {
  if (isLocalDeviceRevoked()) {
    throw new DirectChatsApiError(
      "direct_chat_device_revoked",
    );
  }
}

export async function ensureLocalDevice(): Promise<StoredDeviceMaterial> {
  assertLocalDeviceNotRevoked();
  return withLocalDeviceBootstrapLock(async (lease) => {
    assertLocalDeviceNotRevoked();
    const existing = await loadDeviceMaterial();
    assertLocalDeviceNotRevoked();
    if (existing) {
      if (existing.registrationState === "PENDING") {
        await assertLocalDeviceBootstrapLease(lease);
        assertLocalDeviceNotRevoked();
        try {
          await registerStoredDevice(existing);
        } catch (error: unknown) {
          if (
            error instanceof DirectChatsApiError &&
            error.code === "direct_chat_device_revoked"
          ) {
            await clearLocalDataAfterDeviceRevocation();
          }
          throw error;
        }
        const registered = {
          ...existing,
          registrationState: "REGISTERED" as const,
        };
        await saveDeviceMaterial(registered, lease);
        return registered;
      }
      return existing;
    }

    assertLocalDeviceNotRevoked();
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
    await saveDeviceMaterial(material, lease);
    assertLocalDeviceNotRevoked();
    await assertLocalDeviceBootstrapLease(lease);
    assertLocalDeviceNotRevoked();
    try {
      await registerStoredDevice(material);
    } catch (error: unknown) {
      if (
        error instanceof DirectChatsApiError &&
        error.code === "direct_chat_device_revoked"
      ) {
        await clearLocalDataAfterDeviceRevocation();
      }
      throw error;
    }
    const registered = {
      ...material,
      registrationState: "REGISTERED" as const,
    };
    await saveDeviceMaterial(registered, lease);
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
  interactionEpoch: number;
  senderUserId: string;
  peerUserId?: string;
  clientMessageId: string;
  contentCommitmentB64: string | null;
  localDevice: StoredDeviceMaterial;
  kind: DirectMessageKind;
  plaintext: string;
  devices: CryptoDeviceView[];
  mentions?: MessageMentionInput[];
  operatorIntent?: StoredOperatorIntent;
  operatorOutput?: StoredOperatorOutputLink;
  expectedPendingRevision?: number | null;
}): Promise<StoredPendingSend> {
  // The same canonical HUMAN v2 bytes MUST be used for every recipient
  // envelope. Do not allow an alternate sending/recovery call path to bind
  // arbitrary plaintext to an unrelated, sender-chosen clientMessageId.
  if (
    input.kind === "HUMAN" &&
    (directHumanClientMessageId(input.plaintext) !== input.clientMessageId ||
      directHumanContentCommitment(input.plaintext) !== input.contentCommitmentB64)
  ) {
    throw new Error("Direct HUMAN content identity mismatch");
  }
  if (input.kind !== "HUMAN" && input.contentCommitmentB64 !== null) {
    throw new Error("Unexpected content commitment");
  }
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
    interactionEpoch: input.interactionEpoch,
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
        input.interactionEpoch,
      );
      let x3dhInit: WireEnvelope["x3dhInit"] =
        existing?.pendingX3dhInit ?? null;
      let state = existing
        ? deserializeRatchet(existing.state)
        : null;
      if (!state) {
        let bundlesRequest = bundleRequests.get(device.userId);
        if (!bundlesRequest) {
          bundlesRequest = fetchPrekeyBundles(device.userId);
          bundleRequests.set(device.userId, bundlesRequest);
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
          clientMessageId: input.clientMessageId,
          contentCommitmentB64: input.contentCommitmentB64,
          recipientDeviceId: device.id,
          kind: input.kind,
          interactionEpoch: input.interactionEpoch,
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

    const expectedPendingRevision =
      input.expectedPendingRevision ?? null;
    const pending: StoredPendingSend = {
      revision:
        expectedPendingRevision === null
          ? 1
          : expectedPendingRevision + 1,
      conversationId: input.conversationId,
      clientMessageId: input.clientMessageId,
      contentCommitmentB64: input.contentCommitmentB64,
      senderUserId: input.senderUserId,
      senderDeviceId: material.deviceId,
      interactionEpoch: input.interactionEpoch,
      ...(input.peerUserId
        ? { peerUserId: input.peerUserId }
        : {}),
      kind: input.kind,
      envelopes,
      mentions: input.mentions ?? [],
      plaintext: input.plaintext,
      createdAt: new Date().toISOString(),
      ...(input.operatorIntent
        ? { operatorIntent: input.operatorIntent }
        : {}),
      ...(input.operatorOutput
        ? { operatorOutput: input.operatorOutput }
        : {}),
    };
    try {
      await commitOutboundRatchets({
        conversationId: input.conversationId,
        localDeviceId: material.deviceId,
        interactionEpoch: input.interactionEpoch,
        updates,
        pendingSend: pending,
        expectedPendingRevision,
      });
      return pending;
    } catch (caught: unknown) {
      if (!(caught instanceof PendingSendConflictError)) {
        throw caught;
      }
      const existing = await loadPendingSend(
        input.clientMessageId,
      );
      if (
        existing &&
        pendingSendMatchesInput(existing, {
          conversationId: input.conversationId,
          senderUserId: input.senderUserId,
          senderDeviceId: material.deviceId,
          interactionEpoch: input.interactionEpoch,
          kind: input.kind,
          plaintext: input.plaintext,
          mentions: input.mentions ?? [],
          ...(input.operatorIntent
            ? {
                operatorIntent:
                  input.operatorIntent,
              }
            : {}),
          ...(input.operatorOutput
            ? {
                operatorOutput:
                  input.operatorOutput,
              }
            : {}),
        })
      ) {
        return existing;
      }
      throw caught;
    }
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
    interactionEpoch: pending.interactionEpoch,
    envelopes: pending.envelopes,
  });
}

export async function recoverPendingSends(input: {
  conversationId: string;
  localDevice: StoredDeviceMaterial;
}): Promise<
  | "RESOLVED"
  | "LOCAL_DEVICE_INACTIVE"
  | "RECIPIENT_DEVICE_MISSING"
> {
  const result = await withPendingSendRecoveryLock(
    {
      conversationId: input.conversationId,
      localDeviceId: input.localDevice.deviceId,
    },
    async () => {
      const pending = await loadPendingSends(
        input.conversationId,
        input.localDevice.deviceId,
      );
      // Authoritative, read-only reconciliation precedes normal retry.
      // An old trust epoch cannot commit after a completed block/unblock,
      // but ambiguous HTTP sends must still be checked before local GC.
      const gc = await reconcileTrustCancelledPendingSends(
        pending,
        input.conversationId,
        input.localDevice.deviceId,
      );
      if (gc === "LOCAL_DEVICE_INACTIVE") {
        return gc;
      }
      let blocked:
        | "LOCAL_DEVICE_INACTIVE"
        | "RECIPIENT_DEVICE_MISSING"
        | null = null;

      for (const stored of pending) {
        let row = stored;
        if (
          row.trustCancelledAt ||
          (
            row.operatorIntent &&
            row.committedMessageId &&
            row.committedCreatedAt
          )
        ) {
          continue;
        }

        try {
          const created = await sendPendingDirectMessage(row);
          await finalizePendingSend(row, created);
          continue;
        } catch (error: unknown) {
          if (!(error instanceof DirectChatsApiError)) {
            throw error;
          }
          if (
            error.code ===
            "direct_chat_device_revoked"
          ) {
            return "LOCAL_DEVICE_INACTIVE";
          }
          if (
            error.code === "forbidden" ||
            error.code === "direct_chat_interaction_stale"
          ) {
            // sendPendingDirectMessage already removed the terminally
            // rejected outbox row. Do not let a later unblock resurrect it.
            continue;
          }
          if (
            error.code !== "validation_error" &&
            error.code !==
              "direct_chat_recipient_device_missing" &&
            error.code !== "not_found"
          ) {
            throw error;
          }

          const detail =
            await fetchDirectConversation(
              input.conversationId,
            );
          const currentIds = detail.devices
            .filter((device) => !device.revoked)
            .map((device) => device.id)
            .sort();
          const pendingIds = row.envelopes
            .map(
              (envelope) =>
                envelope.recipientDeviceId,
            )
            .sort();
          const sameDeviceSet =
            currentIds.length === pendingIds.length &&
            currentIds.every(
              (id, index) =>
                id === pendingIds[index],
            );
          const localStillActive =
            currentIds.includes(
              input.localDevice.deviceId,
            );
          const peerActive = detail.devices.some(
            (device) =>
              !device.revoked &&
              device.userId !== row.senderUserId,
          );

          if (
            sameDeviceSet &&
            error.code !== "not_found"
          ) {
            throw error;
          }
          if (!localStillActive) {
            blocked = "LOCAL_DEVICE_INACTIVE";
            continue;
          }
          if (!peerActive) {
            blocked ??=
              "RECIPIENT_DEVICE_MISSING";
            continue;
          }

          let interaction;
          try {
            interaction =
              await prepareDirectMessageSend(
                row.conversationId,
                {
                  senderDeviceId:
                    row.senderDeviceId,
                },
              );
          } catch (caught: unknown) {
            if (
              caught instanceof DirectChatsApiError &&
              caught.code === "forbidden"
            ) {
              await discardPendingSendForUnavailableInteraction(
                row,
              );
              continue;
            }
            throw caught;
          }
          if (
            interaction.interactionEpoch !==
            row.interactionEpoch
          ) {
            await discardPendingSendForUnavailableInteraction(
              row,
            );
            continue;
          }

          try {
            row = await encryptForDevices({
              conversationId:
                row.conversationId,
              interactionEpoch:
                row.interactionEpoch,
              senderUserId: row.senderUserId,
              ...(row.peerUserId
                ? { peerUserId: row.peerUserId }
                : {}),
              clientMessageId:
                row.clientMessageId,
              contentCommitmentB64: row.contentCommitmentB64,
              localDevice: input.localDevice,
              kind: row.kind,
              plaintext: row.plaintext,
              devices: detail.devices,
              mentions: row.mentions,
              expectedPendingRevision:
                pendingSendRevision(row),
              ...(row.operatorIntent
                ? {
                    operatorIntent:
                      row.operatorIntent,
                  }
                : {}),
              ...(row.operatorOutput
                ? {
                    operatorOutput:
                      row.operatorOutput,
                  }
                : {}),
            });
          } catch (caught: unknown) {
            if (
              !(
                caught instanceof
                PendingSendConflictError
              )
            ) {
              throw caught;
            }
            const current =
              await loadPendingSend(
                row.clientMessageId,
              );
            if (!current) {
              continue;
            }
            throw caught;
          }

          const created =
            await sendPendingDirectMessage(row);
          await finalizePendingSend(
            row,
            created,
          );
        }
      }

      return blocked ?? "RESOLVED";
    },
  );
  if (result === "LOCAL_DEVICE_INACTIVE") {
    await clearLocalDataAfterDeviceRevocation();
  }
  return result;
}

async function reconcileTrustCancelledPendingSends(
  pending: readonly StoredPendingSend[],
  conversationId: string,
  senderDeviceId: string,
): Promise<"RESOLVED" | "LOCAL_DEVICE_INACTIVE"> {
  // Rotate bounded pages: permanently ambiguous older rows must not
  // indefinitely starve newer cancelled outbox and Operator intent rows.
  const candidates = selectTrustCancelledGcCandidates(pending, {
    conversationId,
    senderDeviceId,
    now: Date.now(),
  });
  if (candidates.length === 0) return "RESOLVED";

  let currentEpoch: number;
  try {
    const conversation = await fetchDirectConversation(conversationId);
    currentEpoch = conversation.interactionEpoch;
  } catch {
    // A failed read is not evidence of non-commit.
    return "RESOLVED";
  }

  for (const row of candidates) {
    // This monotonic epoch advance is the required proof that a stale
    // uncommitted send cannot become valid after a later unblock.
    if (currentEpoch <= row.interactionEpoch) continue;
    try {
      const lookup = await lookupOwnDirectMessage(
        conversationId,
        senderDeviceId,
        row.clientMessageId,
      );
      if (lookup.status === "COMMITTED") {
        if (!pendingSendMatchesCommittedMessage(row, lookup.message)) {
          // A mismatched authoritative message is never safe to GC.
          continue;
        }
        await finalizePendingSend(row, lookup.message);
        const updated = await loadPendingSend(row.clientMessageId);
        if (updated?.trustCancelledAt) {
          await pruneReconciledTrustCancelledPendingSend(updated);
        }
      } else {
        await pruneReconciledTrustCancelledPendingSend(row);
      }
    } catch (error: unknown) {
      if (
        error instanceof DirectChatsApiError &&
        error.code === "direct_chat_device_revoked"
      ) {
        return "LOCAL_DEVICE_INACTIVE";
      }
      // Network, ambiguous status, metadata mismatch or local storage failure:
      // retain ciphertext and intent for a later authoritative retry.
    }
  }
  return "RESOLVED";
}

export interface PendingOperatorInvocation {
  pendingClientMessageId: string;
  conversationId: string;
  senderDeviceId: string;
  interactionEpoch: number;
  messageId: string;
  messageCreatedAt: string;
  intent: StoredOperatorIntent;
}

export async function loadPendingOperatorInvocations(input: {
  conversationId: string;
  localDeviceId: string;
}): Promise<PendingOperatorInvocation[]> {
  const rows = await loadPendingSends(
    input.conversationId,
    input.localDeviceId,
  );
  return rows.flatMap((row) =>
    !row.trustCancelledAt &&
    row.operatorIntent &&
    row.committedMessageId &&
    row.committedCreatedAt
      ? [
          {
            pendingClientMessageId: row.clientMessageId,
            conversationId: row.conversationId,
            senderDeviceId: row.senderDeviceId,
            interactionEpoch: row.interactionEpoch,
            messageId: row.committedMessageId,
            messageCreatedAt: row.committedCreatedAt,
            intent: row.operatorIntent,
          },
        ]
      : [],
  );
}

export async function finalizePendingOperatorInvocation(
  pendingClientMessageId: string,
): Promise<void> {
  await completePendingOperatorIntent(
    pendingClientMessageId,
  );
}

export async function discardPendingOperatorInvocation(
  pendingClientMessageId: string,
): Promise<void> {
  const pending = await loadPendingSend(
    pendingClientMessageId,
  );
  if (!pending) {
    return;
  }
  await discardPendingSendForUnavailableInteraction(
    pending,
  );
}

export async function stagePendingOperatorInvocationDelivery(
  input: {
    pendingClientMessageId: string;
    runId: string;
    runStatus: StoredOperatorDelivery["runStatus"];
    runUpdatedAt: string;
    outputs: readonly StoredOperatorOutputDraft[];
  },
): Promise<StoredOperatorIntent> {
  return stagePendingOperatorDelivery({
    parentClientMessageId:
      input.pendingClientMessageId,
    runId: input.runId,
    runStatus: input.runStatus,
    runUpdatedAt: input.runUpdatedAt,
    outputs: input.outputs,
  });
}

export async function withPendingOperatorInvocationLock<T>(
  input: {
    conversationId: string;
    localDeviceId: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withPendingOperatorIntentLock(
    input,
    operation,
  );
}

export async function sendPendingDirectMessage(
  row: StoredPendingSend,
): Promise<DirectMessageView> {
  // A persisted pending send may already have committed on the server while
  // the response was lost. Let the authoritative send endpoint resolve its
  // exact idempotent replay before applying current trust/epoch rejection.
  // Fresh sends are still preflighted before encryption, and an uncommitted
  // stale epoch is discarded below after the server rejects it.
  try {
    return await sendDirectMessage(
      row.conversationId,
      {
        clientMessageId: row.clientMessageId,
        senderDeviceId: row.senderDeviceId,
        interactionEpoch: row.interactionEpoch,
        kind: row.kind,
        envelopes: row.envelopes,
        mentions: row.mentions,
      },
    );
  } catch (error: unknown) {
    if (
      error instanceof DirectChatsApiError &&
      error.code === "forbidden"
    ) {
      await discardPendingSendForUnavailableInteraction(
        row,
      );
      throw error;
    }
    if (
      error instanceof DirectChatsApiError &&
      error.code === "conflict"
    ) {
      await assertPendingInteractionCurrent(row);
    }
    throw error;
  }
}

async function assertPendingInteractionCurrent(
  row: StoredPendingSend,
): Promise<void> {
  let prepared;
  try {
    prepared = await prepareDirectMessageSend(
      row.conversationId,
      {
        senderDeviceId: row.senderDeviceId,
      },
    );
  } catch (error: unknown) {
    if (
      error instanceof DirectChatsApiError &&
      error.code === "forbidden"
    ) {
      await discardPendingSendForUnavailableInteraction(
        row,
      );
    }
    throw error;
  }
  if (
    prepared.interactionEpoch === row.interactionEpoch
  ) {
    return;
  }
  await discardPendingSendForUnavailableInteraction(row);
  throw new DirectChatsApiError(
    "direct_chat_interaction_stale",
    409,
  );
}

export interface DecryptMessageResult {
  payload: DirectPlaintextPayload | null;
  needsBootstrap: boolean;
}

export async function decryptMessage(input: {
  conversationId: string;
  message: DirectMessageView;
  senderIdentityEd25519Public?: string;
}): Promise<DirectPlaintextPayload | null> {
  return (await decryptMessageWithStatus(input)).payload;
}

export async function decryptMessageWithStatus(input: {
  conversationId: string;
  message: DirectMessageView;
  senderIdentityEd25519Public?: string;
}): Promise<DecryptMessageResult> {
  const cached = await loadPlaintext(input.message.id);
  if (cached) {
    // The cache was authenticated against this identity on first decrypt.
    // Never attribute it to a relabelled message or an E2EE kind whose
    // ciphertext was not cryptographically verified under that metadata.
    if (!cachedDirectPlaintextMatchesMessage(cached, {
      messageId: input.message.id,
      conversationId: input.conversationId,
      senderUserId: input.message.senderUserId,
      clientMessageId: input.message.clientMessageId,
      senderDeviceId: input.message.senderDeviceId,
      interactionEpoch: input.message.interactionEpoch,
      kind: input.message.kind,
      createdAt: input.message.createdAt,
    })) {
      return { payload: null, needsBootstrap: false };
    }
    return {
      payload: decodeDirectPlaintext(
        input.message.kind,
        cached.text,
        input.message.clientMessageId,
      ),
      needsBootstrap: false,
    };
  }
  const envelope = input.message.envelope;
  if (!envelope) {
    return { payload: null, needsBootstrap: false };
  }

  const material = await ensureLocalDevice();
  if (
    input.message.senderDeviceId === material.deviceId
  ) {
    const pending = await loadPendingSend(
      input.message.clientMessageId,
    );
    if (
      pending &&
      pendingSendMatchesCommittedMessage(
        pending,
        input.message,
      )
    ) {
      await finalizePendingSend(
        pending,
        input.message,
      );
      return {
        payload: decodeDirectPlaintext(
          input.message.kind,
          pending.plaintext,
          input.message.clientMessageId,
        ),
        needsBootstrap: false,
      };
    }
  }

  const senderIdentityEd25519Public =
    input.senderIdentityEd25519Public;
  if (!senderIdentityEd25519Public) {
    return {
      payload: null,
      needsBootstrap: envelope.x3dhInit === null,
    };
  }
  const identity = identityFromMaterial(material);
  try {
    return await withRatchetRetry(
      {
        conversationId: input.conversationId,
        localDeviceId: material.deviceId,
        peerDeviceId: input.message.senderDeviceId,
        interactionEpoch:
          input.message.interactionEpoch,
      },
      async () => {
        const committed = await loadPlaintext(input.message.id);
        if (committed) {
          if (!cachedDirectPlaintextMatchesMessage(committed, {
            messageId: input.message.id,
            conversationId: input.conversationId,
            senderUserId: input.message.senderUserId,
            clientMessageId: input.message.clientMessageId,
            senderDeviceId: input.message.senderDeviceId,
            interactionEpoch: input.message.interactionEpoch,
            kind: input.message.kind,
            createdAt: input.message.createdAt,
          })) {
            return { payload: null, needsBootstrap: false };
          }
          return {
            payload: decodeDirectPlaintext(
              input.message.kind,
              committed.text,
              input.message.clientMessageId,
            ),
            needsBootstrap: false,
          };
        }

        const stateRecord = await loadRatchet(
          input.conversationId,
          material.deviceId,
          input.message.senderDeviceId,
          input.message.interactionEpoch,
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
            return {
              payload: null,
              needsBootstrap: false,
            };
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
          return {
            payload: null,
            needsBootstrap: envelope.x3dhInit === null,
          };
        }

        const routingContext =
          input.message.mentions.length > 0
            ? serializeDirectRoutingMentions(
                input.message.mentions,
              )
            : undefined;
        const opened = decryptEnvelope({
          senderIdentityEd25519Public: b64ToBytes(
            senderIdentityEd25519Public,
          ),
          state,
          envelope: toWire(envelope),
          ad: {
            conversationId: input.conversationId,
            senderUserId: input.message.senderUserId,
            senderDeviceId: input.message.senderDeviceId,
            clientMessageId: input.message.clientMessageId,
            contentCommitmentB64: input.message.contentCommitmentB64,
            recipientDeviceId: envelope.recipientDeviceId,
            kind: input.message.kind,
            interactionEpoch:
              input.message.interactionEpoch,
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
          clientMessageId: input.message.clientMessageId,
          senderDeviceId: input.message.senderDeviceId,
          interactionEpoch: input.message.interactionEpoch,
          createdAt: input.message.createdAt,
        };
        await commitDecryptedRatchet({
          conversationId: input.conversationId,
          localDeviceId: material.deviceId,
          peerDeviceId: input.message.senderDeviceId,
          interactionEpoch:
            input.message.interactionEpoch,
          expectedVersion: stateRecord?.stateVersion ?? 0,
          state: serializeRatchet(state),
          pendingX3dhInit:
            stateRecord?.pendingX3dhInit ?? null,
          plaintext: row,
        });
        return {
          payload: decodeDirectPlaintext(
            input.message.kind,
            text,
            input.message.clientMessageId,
          ),
          needsBootstrap: false,
        };
      },
    );
  } catch {
    return { payload: null, needsBootstrap: false };
  }
}

export async function acknowledgeSentRatchets(input: {
  conversationId: string;
  localDeviceId: string;
  interactionEpoch: number;
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
      interactionEpoch: input.interactionEpoch,
    }).catch(() => undefined);
  }
}

const RATCHET_COORDINATION_ATTEMPTS = 3;

type RatchetLockScope = {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
};

async function withRatchetRetryScopes<T>(
  scopes: ReadonlyArray<RatchetLockScope>,
  operation: () => Promise<T>,
): Promise<T> {
  return retryRatchetCoordination(() =>
    withRatchetSessionLocks(scopes, operation),
  );
}

async function withRatchetRetry<T>(
  scope: RatchetLockScope,
  operation: () => Promise<T>,
): Promise<T> {
  return retryRatchetCoordination(() =>
    withRatchetSessionLock(scope, operation),
  );
}

async function retryRatchetCoordination<T>(
  attemptOperation: () => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;
  for (
    let attempt = 0;
    attempt < RATCHET_COORDINATION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await attemptOperation();
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

function pendingSendMatchesCommittedMessage(
  pending: StoredPendingSend,
  message: DirectMessageView,
): boolean {
  const envelope = message.envelope;
  if (
    !envelope ||
    pending.conversationId !== message.conversationId ||
    pending.clientMessageId !== message.clientMessageId ||
    pending.senderUserId !== message.senderUserId ||
    pending.senderDeviceId !== message.senderDeviceId ||
    pending.interactionEpoch !== message.interactionEpoch ||
    pending.kind !== message.kind
  ) {
    return false;
  }
  const candidate = pending.envelopes.find(
    (item) =>
      item.recipientDeviceId ===
      envelope.recipientDeviceId,
  );
  if (!candidate) return false;
  return (
    candidate.headerB64 === envelope.headerB64 &&
    candidate.ciphertextB64 === envelope.ciphertextB64 &&
    candidate.dhPublicB64 === envelope.dhPublicB64 &&
    candidate.messageNumber === envelope.messageNumber &&
    candidate.previousChainLength ===
      envelope.previousChainLength &&
    candidate.senderSignatureB64 ===
      envelope.senderSignatureB64 &&
    JSON.stringify(candidate.x3dhInit ?? null) ===
      JSON.stringify(envelope.x3dhInit ?? null)
  );
}

function pendingSendMatchesInput(
  pending: StoredPendingSend,
  input: {
    conversationId: string;
    senderUserId: string;
    senderDeviceId: string;
    interactionEpoch: number;
    kind: DirectMessageKind;
    plaintext: string;
    mentions: MessageMentionInput[];
    operatorIntent?: StoredOperatorIntent;
    operatorOutput?: StoredOperatorOutputLink;
  },
): boolean {
  return (
    pending.conversationId === input.conversationId &&
    pending.senderUserId === input.senderUserId &&
    pending.senderDeviceId === input.senderDeviceId &&
    pending.interactionEpoch === input.interactionEpoch &&
    pending.kind === input.kind &&
    pending.plaintext === input.plaintext &&
    JSON.stringify(pending.mentions) ===
      JSON.stringify(input.mentions) &&
    (pending.operatorIntent?.clientRequestId ?? null) ===
      (input.operatorIntent?.clientRequestId ?? null) &&
    (pending.operatorOutput?.parentClientMessageId ??
      null) ===
      (input.operatorOutput?.parentClientMessageId ??
        null) &&
    (pending.operatorOutput?.outputId ?? null) ===
      (input.operatorOutput?.outputId ?? null)
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

