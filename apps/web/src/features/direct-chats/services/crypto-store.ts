import type {
  DirectMessageKind,
  MessageMentionInput,
  OperatorContextBundle,
  OperatorRunStatus,
  WireEnvelopeDto,
} from "@vimla/contracts";
import {
  bytesToB64,
  b64ToBytes,
  type IdentityKeyPair,
  type SerializedRatchetState,
  type X3dhInitHeader,
} from "@vimla/e2ee";
import {
  RatchetLockLostError,
  RatchetStateConflictError,
  RatchetStateCorruptError,
  LEGACY_RATCHET_RECORD_SCHEMA_VERSION,
  RATCHET_RECORD_SCHEMA_VERSION,
  acquireRatchetLeaseRecord,
  assertRatchetVersion,
  renewRatchetLeaseRecord,
  decodeStoredRatchet,
  isRatchetLeaseRecord,
  markLegacyRatchetOwner,
  type RatchetLeaseRecord,
  type RatchetSnapshot,
} from "@vimla/client-core";
import {
  clearLocalProtectionKey,
  deleteIndexedDb,
  isProtectedLocalString,
  LocalE2eeProtectionError,
  protectLocalJson,
  protectLocalString,
  unprotectLocalJson,
  unprotectLocalString,
} from "./local-protection";
import { isLocalDeviceRevoked } from "./revocation-state";

const DB_NAME = "vimla-direct-e2ee";
const DB_VERSION = 6;
const PLAINTEXT_CONVERSATION_TIME_INDEX = "conversation-created-at";
const PENDING_SEND_SCOPE_INDEX =
  "conversation-sender-device";
const RATCHET_LOCK_LEASE_MS = 5_000;
const RATCHET_LOCK_HEARTBEAT_MS = 1_000;
const RATCHET_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const RATCHET_SESSION_LOCK_MAX_HOLD_MS = 90_000;
const LOCAL_DEVICE_LOCK_MAX_HOLD_MS = 60_000;
const PENDING_SEND_RECOVERY_LOCK_MAX_HOLD_MS = 120_000;
const PENDING_OPERATOR_LOCK_MAX_HOLD_MS = 120_000;
const RATCHET_LOCK_POLL_MS = 40;
const LOCAL_DEVICE_LOCK_KEY = "vimla-local-device-bootstrap";
const LEGACY_LOCAL_PROTECTION_VERSION = 0 as const;
const LOCAL_PROTECTION_VERSION = 1 as const;
type LocalProtectionVersion =
  | typeof LEGACY_LOCAL_PROTECTION_VERSION
  | typeof LOCAL_PROTECTION_VERSION;

type StoreName =
  | "device"
  | "ratchets"
  | "ratchetLocks"
  | "pendingSends"
  | "plaintexts";

export interface StoredDeviceMaterial {
  protectionVersion?: LocalProtectionVersion;
  deviceId: string;
  registrationState?: "PENDING" | "REGISTERED";
  identity: {
    ed25519Secret: string;
    ed25519Public: string;
    x25519Secret: string;
    x25519Public: string;
  };
  signedPrekeys: Record<
    string,
    { secret: string; publicKey: string; signature: string }
  >;
  oneTimePrekeys: Record<
    string,
    { secret: string; publicKey: string }
  >;
}

export interface StoredPlaintext {
  protectionVersion?: LocalProtectionVersion;
  conversationId: string;
  messageId: string;
  text: string;
  kind: string;
  senderUserId: string;
  createdAt: string;
}

export interface StoredOperatorOutput {
  id: string;
  clientMessageId: string;
  kind: DirectMessageKind;
  plaintext: string;
  delivered: boolean;
}

export interface StoredOperatorOutputDraft {
  id: string;
  kind: DirectMessageKind;
  plaintext: string;
}

export interface StoredOperatorDelivery {
  runId: string;
  runStatus: OperatorRunStatus;
  runUpdatedAt: string;
  outputs: StoredOperatorOutput[];
}

export interface StoredOperatorIntent {
  clientRequestId: string;
  content: string;
  contextBundle: OperatorContextBundle;
  delivery?: StoredOperatorDelivery;
}

export interface StoredOperatorOutputLink {
  parentClientMessageId: string;
  outputId: StoredOperatorOutput["id"];
}

export interface StoredPendingSend {
  protectionVersion?: LocalProtectionVersion;
  revision?: number;
  conversationId: string;
  clientMessageId: string;
  senderUserId: string;
  senderDeviceId: string;
  interactionEpoch: number;
  peerUserId?: string;
  kind: DirectMessageKind;
  envelopes: WireEnvelopeDto[];
  mentions: MessageMentionInput[];
  plaintext: string;
  createdAt: string;
  operatorIntent?: StoredOperatorIntent;
  operatorOutput?: StoredOperatorOutputLink;
  committedMessageId?: string;
  committedCreatedAt?: string;
  trustCancelledAt?: string;
}

export interface OutboundRatchetUpdate {
  peerDeviceId: string;
  expectedVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}

export interface CoordinationLease {
  key: string;
  owner: string;
  fence: number;
}

export class PendingSendConflictError extends Error {
  constructor() {
    super("Pending send changed concurrently");
    this.name = "PendingSendConflictError";
  }
}

export class PendingOperatorInvocationGoneError extends Error {
  constructor() {
    super("Pending operator invocation was already completed");
    this.name = "PendingOperatorInvocationGoneError";
  }
}

const PROTECTED_RATCHET_SCHEMA_VERSION = 2 as const;

interface ProtectedRatchetRecord {
  schemaVersion: typeof PROTECTED_RATCHET_SCHEMA_VERSION;
  localDeviceId: string;
  stateVersion: number;
  protectedState: string;
  pendingX3dhInit: X3dhInitHeader | null;
}

function deviceSecretAad(
  deviceId: string,
  field: string,
): string {
  return `vimla:e2ee:device:${deviceId}:${field}`;
}

function plaintextAad(messageId: string): string {
  return `vimla:e2ee:plaintext:${messageId}:text`;
}

function pendingAad(
  clientMessageId: string,
  field: string,
): string {
  return `vimla:e2ee:pending:${clientMessageId}:${field}`;
}

function ratchetStateAad(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
  stateVersion: number;
}): string {
  return [
    "vimla:e2ee:ratchet",
    input.conversationId,
    input.localDeviceId,
    input.peerDeviceId,
    `epoch-${input.interactionEpoch}`,
    String(input.stateVersion),
  ].join(":");
}

function localProtectionVersion(
  value: { protectionVersion?: LocalProtectionVersion },
  recordType: string,
): LocalProtectionVersion {
  if (
    value.protectionVersion ===
      LEGACY_LOCAL_PROTECTION_VERSION ||
    value.protectionVersion === LOCAL_PROTECTION_VERSION
  ) {
    return value.protectionVersion;
  }
  throw new LocalE2eeProtectionError(
    `Persisted ${recordType} protection version is invalid`,
  );
}

function assertLegacyValueIsRaw(
  value: string,
  recordType: string,
): void {
  if (isProtectedLocalString(value)) {
    throw new LocalE2eeProtectionError(
      `Persisted ${recordType} cannot downgrade a protected envelope to legacy plaintext`,
    );
  }
}

function assertLegacyDeviceMaterialIsRaw(
  material: StoredDeviceMaterial,
): void {
  assertLegacyValueIsRaw(
    material.identity.ed25519Secret,
    "device identity",
  );
  assertLegacyValueIsRaw(
    material.identity.x25519Secret,
    "device identity",
  );
  for (const key of Object.values(material.signedPrekeys)) {
    assertLegacyValueIsRaw(
      key.secret,
      "device signed prekey",
    );
  }
  for (const key of Object.values(material.oneTimePrekeys)) {
    assertLegacyValueIsRaw(
      key.secret,
      "device one-time prekey",
    );
  }
}

function assertLegacyPendingSendIsRaw(
  pending: StoredPendingSend,
): void {
  assertLegacyValueIsRaw(
    pending.plaintext,
    "pending send",
  );
  if (!pending.operatorIntent) {
    return;
  }
  assertLegacyValueIsRaw(
    pending.operatorIntent.content,
    "pending operator content",
  );
  for (const message of pending.operatorIntent.contextBundle.messages) {
    assertLegacyValueIsRaw(
      message.text,
      "pending operator context",
    );
  }
  for (const output of pending.operatorIntent.delivery?.outputs ?? []) {
    assertLegacyValueIsRaw(
      output.plaintext,
      "pending operator output",
    );
  }
}

async function protectDeviceMaterial(
  material: StoredDeviceMaterial,
): Promise<StoredDeviceMaterial> {
  const signedPrekeys = Object.fromEntries(
    await Promise.all(
      Object.entries(material.signedPrekeys).map(
        async ([keyId, key]) => [
          keyId,
          {
            ...key,
            secret: await protectLocalString(
              key.secret,
              deviceSecretAad(
                material.deviceId,
                `signed-prekey:${keyId}`,
              ),
            ),
          },
        ],
      ),
    ),
  );
  const oneTimePrekeys = Object.fromEntries(
    await Promise.all(
      Object.entries(material.oneTimePrekeys).map(
        async ([keyId, key]) => [
          keyId,
          {
            ...key,
            secret: await protectLocalString(
              key.secret,
              deviceSecretAad(
                material.deviceId,
                `one-time-prekey:${keyId}`,
              ),
            ),
          },
        ],
      ),
    ),
  );
  return {
    ...material,
    protectionVersion: LOCAL_PROTECTION_VERSION,
    identity: {
      ...material.identity,
      ed25519Secret: await protectLocalString(
        material.identity.ed25519Secret,
        deviceSecretAad(
          material.deviceId,
          "identity:ed25519",
        ),
      ),
      x25519Secret: await protectLocalString(
        material.identity.x25519Secret,
        deviceSecretAad(
          material.deviceId,
          "identity:x25519",
        ),
      ),
    },
    signedPrekeys,
    oneTimePrekeys,
  };
}

async function unprotectDeviceMaterial(
  material: StoredDeviceMaterial,
): Promise<StoredDeviceMaterial> {
  if (
    localProtectionVersion(material, "device") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  ) {
    assertLegacyDeviceMaterialIsRaw(material);
    return {
      ...material,
      protectionVersion: undefined,
    };
  }
  const signedPrekeys = Object.fromEntries(
    await Promise.all(
      Object.entries(material.signedPrekeys).map(
        async ([keyId, key]) => [
          keyId,
          {
            ...key,
            secret: await unprotectLocalString(
              key.secret,
              deviceSecretAad(
                material.deviceId,
                `signed-prekey:${keyId}`,
              ),
            ),
          },
        ],
      ),
    ),
  );
  const oneTimePrekeys = Object.fromEntries(
    await Promise.all(
      Object.entries(material.oneTimePrekeys).map(
        async ([keyId, key]) => [
          keyId,
          {
            ...key,
            secret: await unprotectLocalString(
              key.secret,
              deviceSecretAad(
                material.deviceId,
                `one-time-prekey:${keyId}`,
              ),
            ),
          },
        ],
      ),
    ),
  );
  return {
    ...material,
    protectionVersion: undefined,
    identity: {
      ...material.identity,
      ed25519Secret: await unprotectLocalString(
        material.identity.ed25519Secret,
        deviceSecretAad(
          material.deviceId,
          "identity:ed25519",
        ),
      ),
      x25519Secret: await unprotectLocalString(
        material.identity.x25519Secret,
        deviceSecretAad(
          material.deviceId,
          "identity:x25519",
        ),
      ),
    },
    signedPrekeys,
    oneTimePrekeys,
  };
}

function deviceMaterialNeedsProtection(
  material: StoredDeviceMaterial,
): boolean {
  return (
    localProtectionVersion(material, "device") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  );
}

async function protectPlaintext(
  row: StoredPlaintext,
): Promise<StoredPlaintext> {
  return {
    ...row,
    protectionVersion: LOCAL_PROTECTION_VERSION,
    text: await protectLocalString(
      row.text,
      plaintextAad(row.messageId),
    ),
  };
}

async function unprotectPlaintext(
  row: StoredPlaintext,
): Promise<StoredPlaintext> {
  if (
    localProtectionVersion(row, "plaintext") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  ) {
    assertLegacyValueIsRaw(
      row.text,
      "plaintext cache",
    );
    return {
      ...row,
      protectionVersion: undefined,
    };
  }
  return {
    ...row,
    protectionVersion: undefined,
    text: await unprotectLocalString(
      row.text,
      plaintextAad(row.messageId),
    ),
  };
}

async function protectOperatorIntent(
  clientMessageId: string,
  intent: StoredOperatorIntent,
): Promise<StoredOperatorIntent> {
  const contextBundle = {
    ...intent.contextBundle,
    messages: await Promise.all(
      intent.contextBundle.messages.map(
        async (message) => ({
          ...message,
          text: await protectLocalString(
            message.text,
            pendingAad(
              clientMessageId,
              `context:${message.messageId}`,
            ),
          ),
        }),
      ),
    ),
  };
  const delivery = intent.delivery
    ? {
        ...intent.delivery,
        outputs: await Promise.all(
          intent.delivery.outputs.map(
            async (output) => ({
              ...output,
              plaintext: await protectLocalString(
                output.plaintext,
                pendingAad(
                  clientMessageId,
                  `operator-output:${output.id}`,
                ),
              ),
            }),
          ),
        ),
      }
    : undefined;
  return {
    ...intent,
    content: await protectLocalString(
      intent.content,
      pendingAad(clientMessageId, "operator-content"),
    ),
    contextBundle,
    ...(delivery ? { delivery } : {}),
  };
}

async function unprotectOperatorIntent(
  clientMessageId: string,
  intent: StoredOperatorIntent,
): Promise<StoredOperatorIntent> {
  const contextBundle = {
    ...intent.contextBundle,
    messages: await Promise.all(
      intent.contextBundle.messages.map(
        async (message) => ({
          ...message,
          text: await unprotectLocalString(
            message.text,
            pendingAad(
              clientMessageId,
              `context:${message.messageId}`,
            ),
          ),
        }),
      ),
    ),
  };
  const delivery = intent.delivery
    ? {
        ...intent.delivery,
        outputs: await Promise.all(
          intent.delivery.outputs.map(
            async (output) => ({
              ...output,
              plaintext: await unprotectLocalString(
                output.plaintext,
                pendingAad(
                  clientMessageId,
                  `operator-output:${output.id}`,
                ),
              ),
            }),
          ),
        ),
      }
    : undefined;
  return {
    ...intent,
    content: await unprotectLocalString(
      intent.content,
      pendingAad(clientMessageId, "operator-content"),
    ),
    contextBundle,
    ...(delivery ? { delivery } : {}),
  };
}

async function protectPendingSend(
  pending: StoredPendingSend,
): Promise<StoredPendingSend> {
  return {
    ...pending,
    protectionVersion: LOCAL_PROTECTION_VERSION,
    plaintext: await protectLocalString(
      pending.plaintext,
      pendingAad(
        pending.clientMessageId,
        "message-plaintext",
      ),
    ),
    ...(pending.operatorIntent
      ? {
          operatorIntent: await protectOperatorIntent(
            pending.clientMessageId,
            pending.operatorIntent,
          ),
        }
      : {}),
  };
}

async function unprotectPendingSend(
  pending: StoredPendingSend,
): Promise<StoredPendingSend> {
  if (
    localProtectionVersion(pending, "pending send") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  ) {
    assertLegacyPendingSendIsRaw(pending);
    return {
      ...pending,
      protectionVersion: undefined,
    };
  }
  return {
    ...pending,
    protectionVersion: undefined,
    plaintext: await unprotectLocalString(
      pending.plaintext,
      pendingAad(
        pending.clientMessageId,
        "message-plaintext",
      ),
    ),
    ...(pending.operatorIntent
      ? {
          operatorIntent: await unprotectOperatorIntent(
            pending.clientMessageId,
            pending.operatorIntent,
          ),
        }
      : {}),
  };
}

function isProtectedRatchetRecord(
  value: unknown,
): value is ProtectedRatchetRecord {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion ===
      PROTECTED_RATCHET_SCHEMA_VERSION &&
    typeof record.localDeviceId === "string" &&
    record.localDeviceId.length > 0 &&
    typeof record.stateVersion === "number" &&
    Number.isSafeInteger(record.stateVersion) &&
    record.stateVersion >= 0 &&
    typeof record.protectedState === "string" &&
    isProtectedLocalString(record.protectedState)
  );
}

async function protectRatchetRecord(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
  stateVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}): Promise<ProtectedRatchetRecord> {
  return {
    schemaVersion: PROTECTED_RATCHET_SCHEMA_VERSION,
    localDeviceId: input.localDeviceId,
    stateVersion: input.stateVersion,
    protectedState: await protectLocalJson(
      input.state,
      ratchetStateAad(input),
    ),
    pendingX3dhInit: input.pendingX3dhInit,
  };
}

async function decodePersistedRatchet(
  value: unknown,
  input: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
    interactionEpoch: number;
  },
): Promise<RatchetSnapshot | null> {
  if (!isProtectedRatchetRecord(value)) {
    return decodeStoredRatchet(
      value,
      input.localDeviceId,
    );
  }
  if (value.localDeviceId !== input.localDeviceId) {
    throw new RatchetStateCorruptError();
  }
  const state = await unprotectLocalJson(
    value.protectedState,
    ratchetStateAad({
      ...input,
      stateVersion: value.stateVersion,
    }),
  );
  return decodeStoredRatchet(
    value.stateVersion === 0
      ? {
          schemaVersion:
            LEGACY_RATCHET_RECORD_SCHEMA_VERSION,
          localDeviceId: value.localDeviceId,
          state,
        }
      : {
          schemaVersion:
            RATCHET_RECORD_SCHEMA_VERSION,
          localDeviceId: value.localDeviceId,
          stateVersion: value.stateVersion,
          state,
          pendingX3dhInit: value.pendingX3dhInit,
        },
    input.localDeviceId,
  );
}

function assertPersistedRatchetVersion(
  value: unknown,
  localDeviceId: string,
  expectedVersion: number,
): void {
  if (isProtectedRatchetRecord(value)) {
    if (value.localDeviceId !== localDeviceId) {
      throw new RatchetStateCorruptError();
    }
    if (value.stateVersion !== expectedVersion) {
      throw new RatchetStateConflictError();
    }
    return;
  }
  assertRatchetVersion(
    decodeStoredRatchet(value, localDeviceId),
    expectedVersion,
  );
}

function openDb(): Promise<IDBDatabase> {
  if (isLocalDeviceRevoked()) {
    return Promise.reject(
      new LocalE2eeProtectionError(
        "Local E2EE device is revoked",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      if (isLocalDeviceRevoked()) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      if (!db.objectStoreNames.contains("device")) {
        db.createObjectStore("device");
      }
      if (!db.objectStoreNames.contains("ratchets")) {
        db.createObjectStore("ratchets");
      }
      if (!db.objectStoreNames.contains("ratchetLocks")) {
        db.createObjectStore("ratchetLocks");
      }
      const pendingSends = db.objectStoreNames.contains(
        "pendingSends",
      )
        ? request.transaction?.objectStore("pendingSends")
        : db.createObjectStore("pendingSends");
      if (
        pendingSends &&
        !pendingSends.indexNames.contains(
          PENDING_SEND_SCOPE_INDEX,
        )
      ) {
        pendingSends.createIndex(
          PENDING_SEND_SCOPE_INDEX,
          ["conversationId", "senderDeviceId"],
          { unique: false },
        );
      }
      const plaintexts = db.objectStoreNames.contains("plaintexts")
        ? request.transaction?.objectStore("plaintexts")
        : db.createObjectStore("plaintexts");
      if (
        plaintexts &&
        !plaintexts.indexNames.contains(
          PLAINTEXT_CONVERSATION_TIME_INDEX,
        )
      ) {
        plaintexts.createIndex(
          PLAINTEXT_CONVERSATION_TIME_INDEX,
          ["conversationId", "createdAt"],
          { unique: false },
        );
      }
      if (
        event.oldVersion > 0 &&
        event.oldVersion < DB_VERSION &&
        request.transaction
      ) {
        markLegacyLocalRecordsDuringUpgrade(
          request.transaction,
        );
        markLegacyRatchetsDuringUpgrade(
          request.transaction,
        );
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "E2EE storage upgrade is blocked by another browser context",
        ),
      );
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      if (isLocalDeviceRevoked()) {
        db.close();
        void deleteIndexedDb(DB_NAME).catch(
          () => undefined,
        );
        reject(
          new LocalE2eeProtectionError(
            "Local E2EE device is revoked",
          ),
        );
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(
        request.error ?? new Error("IndexedDB unavailable"),
      );
  });
}

async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = fn(store);
    tx.oncomplete = () => {
      db.close();
      if (request) {
        resolve(request.result);
      } else {
        resolve(undefined as T);
      }
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ?? new Error("IndexedDB transaction aborted"),
      );
    };
    tx.onerror = () => {
      db.close();
      reject(
        tx.error ?? new Error("IndexedDB transaction failed"),
      );
    };
  });
}

export async function loadDeviceMaterial(): Promise<StoredDeviceMaterial | null> {
  const value = await withStore<StoredDeviceMaterial | undefined>(
    "device",
    "readonly",
    (store) => store.get("local"),
  );
  if (!value) {
    return null;
  }
  const needsMigration =
    deviceMaterialNeedsProtection(value);
  const material = await unprotectDeviceMaterial(value);
  if (needsMigration) {
    await migrateDeviceMaterial(value);
  }
  return material;
}

async function migrateDeviceMaterial(
  legacy: StoredDeviceMaterial,
): Promise<void> {
  assertLegacyDeviceMaterialIsRaw(legacy);
  const protectedMaterial =
    await protectDeviceMaterial(legacy);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("device", "readwrite");
    const store = tx.objectStore("device");
    const request = store.get("local");
    request.onsuccess = () => {
      const current = request.result as
        | StoredDeviceMaterial
        | undefined;
      if (
        current &&
        deviceMaterialNeedsProtection(current) &&
        JSON.stringify(current) ===
          JSON.stringify(legacy)
      ) {
        store.put(protectedMaterial, "local");
      }
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            "Legacy E2EE device migration read failed",
          ),
      );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Legacy E2EE device migration aborted",
          ),
      );
    };
  });
}

export async function saveDeviceMaterial(
  material: StoredDeviceMaterial,
  lease: CoordinationLease,
): Promise<void> {
  const persisted =
    await protectDeviceMaterial(material);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      ["device", "ratchetLocks"],
      "readwrite",
    );
    const deviceStore = tx.objectStore("device");
    const lockRequest = tx
      .objectStore("ratchetLocks")
      .get(lease.key);
    lockRequest.onsuccess = () => {
      try {
        assertActiveCoordinationLease(
          lockRequest.result,
          lease,
          Date.now(),
        );
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new RatchetLockLostError();
        tx.abort();
        return;
      }
      const deviceRequest = deviceStore.get("local");
      deviceRequest.onsuccess = () => {
        const current = deviceRequest.result as
          | StoredDeviceMaterial
          | undefined;
        if (
          current &&
          current.deviceId !== material.deviceId
        ) {
          failure = new RatchetLockLostError();
          tx.abort();
          return;
        }
        deviceStore.put(persisted, "local");
      };
      deviceRequest.onerror = () => {
        failure =
          deviceRequest.error ??
          new Error("Local E2EE device read failed");
        tx.abort();
      };
    };
    lockRequest.onerror = () => {
      failure =
        lockRequest.error ??
        new Error("Local E2EE bootstrap lease read failed");
      tx.abort();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error("Local E2EE device write aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Local E2EE device write failed");
    };
  });
}

export async function assertLocalDeviceBootstrapLease(
  lease: CoordinationLease,
): Promise<void> {
  await assertCoordinationLease(lease);
}

export async function clearLocalE2eeData(): Promise<void> {
  let failure: Error | null = null;
  try {
    await deleteIndexedDb(DB_NAME);
  } catch (error: unknown) {
    failure =
      error instanceof Error
        ? error
        : new Error("Local E2EE data deletion failed");
  }
  try {
    await clearLocalProtectionKey();
  } catch (error: unknown) {
    failure ??=
      error instanceof Error
        ? error
        : new Error("Local E2EE key deletion failed");
  }
  if (failure) {
    throw new Error(
      "Local E2EE data could not be fully cleared",
      { cause: failure },
    );
  }
}

function pendingSendNeedsProtection(
  pending: StoredPendingSend,
): boolean {
  return (
    localProtectionVersion(pending, "pending send") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  );
}

async function migratePendingSend(
  legacy: StoredPendingSend,
): Promise<void> {
  assertLegacyPendingSendIsRaw(legacy);
  const protectedPending =
    await protectPendingSend(legacy);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      "pendingSends",
      "readwrite",
    );
    const store = tx.objectStore("pendingSends");
    const request = store.get(legacy.clientMessageId);
    request.onsuccess = () => {
      const current = request.result as
        | StoredPendingSend
        | undefined;
      if (
        current &&
        pendingSendNeedsProtection(current) &&
        JSON.stringify(current) ===
          JSON.stringify(legacy)
      ) {
        store.put(
          protectedPending,
          legacy.clientMessageId,
        );
      }
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            "Legacy pending-send migration read failed",
          ),
      );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Legacy pending-send migration aborted",
          ),
      );
    };
  });
}

export async function loadPendingSends(
  conversationId: string,
  senderDeviceId: string,
): Promise<StoredPendingSend[]> {
  const db = await openDb();
  const rows = await new Promise<StoredPendingSend[]>(
    (resolve, reject) => {
      const tx = db.transaction(
        "pendingSends",
        "readonly",
      );
      const store = tx.objectStore("pendingSends");
      const request = store
        .index(PENDING_SEND_SCOPE_INDEX)
        .getAll(
          IDBKeyRange.only([
            conversationId,
            senderDeviceId,
          ]),
        );
      request.onsuccess = () =>
        resolve(
          request.result as StoredPendingSend[],
        );
      request.onerror = () =>
        reject(
          request.error ??
            new Error(
              "Pending send index read failed",
            ),
        );
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error(
              "Pending send index transaction aborted",
            ),
        );
    },
  ).finally(() => db.close());
  for (const row of rows) {
    if (pendingSendNeedsProtection(row)) {
      await migratePendingSend(row);
    }
  }
  const decrypted = await Promise.all(
    rows.map((row) => unprotectPendingSend(row)),
  );
  return decrypted.sort(
    (left, right) =>
      Date.parse(left.createdAt) -
        Date.parse(right.createdAt) ||
      left.clientMessageId.localeCompare(
        right.clientMessageId,
      ),
  );
}

export async function loadPendingSend(
  clientMessageId: string,
): Promise<StoredPendingSend | null> {
  const value = await withStore<
    StoredPendingSend | undefined
  >(
    "pendingSends",
    "readonly",
    (store) => store.get(clientMessageId),
  );
  if (!value) {
    return null;
  }
  if (pendingSendNeedsProtection(value)) {
    await migratePendingSend(value);
  }
  return unprotectPendingSend(value);
}

export function pendingSendRevision(
  pending: StoredPendingSend,
): number {
  return Number.isSafeInteger(pending.revision) &&
    (pending.revision ?? 0) >= 0
    ? (pending.revision ?? 0)
    : 0;
}

export async function cancelPendingSendsForTrust(input: {
  conversationId?: string;
  senderDeviceId?: string;
  peerUserId?: string;
}): Promise<void> {
  if (
    !input.conversationId &&
    !input.peerUserId
  ) {
    throw new Error(
      "Trust pending-send cancellation scope is required",
    );
  }
  const cancelledAt = new Date().toISOString();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("pendingSends", "readwrite");
    const store = tx.objectStore("pendingSends");
    const request =
      input.conversationId && input.senderDeviceId
        ? store
            .index(PENDING_SEND_SCOPE_INDEX)
            .openCursor(
              IDBKeyRange.only([
                input.conversationId,
                input.senderDeviceId,
              ]),
            )
        : store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value as StoredPendingSend;
      const matches =
        (input.conversationId === undefined ||
          row.conversationId === input.conversationId) &&
        (input.senderDeviceId === undefined ||
          row.senderDeviceId === input.senderDeviceId) &&
        (input.peerUserId === undefined ||
          row.peerUserId === input.peerUserId);
      if (matches && !row.trustCancelledAt) {
        cursor.update({
          ...row,
          revision: pendingSendRevision(row) + 1,
          trustCancelledAt: cancelledAt,
        } satisfies StoredPendingSend);
      }
      cursor.continue();
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Trust pending-send cancellation transaction aborted",
          ),
      );
    };
  });
}

export async function discardPendingSendForUnavailableInteraction(
  pending: StoredPendingSend,
): Promise<void> {
  const operatorParentClientMessageId =
    pending.operatorIntent
      ? pending.clientMessageId
      : pending.operatorOutput?.parentClientMessageId ?? null;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("pendingSends", "readwrite");
    const store = tx.objectStore("pendingSends");

    if (!operatorParentClientMessageId) {
      store.delete(pending.clientMessageId);
    } else {
      const request = store
        .index(PENDING_SEND_SCOPE_INDEX)
        .openCursor(
          IDBKeyRange.only([
            pending.conversationId,
            pending.senderDeviceId,
          ]),
        );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value as StoredPendingSend;
        if (
          row.clientMessageId ===
            operatorParentClientMessageId ||
          row.clientMessageId === pending.clientMessageId ||
          row.operatorOutput?.parentClientMessageId ===
            operatorParentClientMessageId
        ) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () => tx.abort();
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Pending send cancellation transaction aborted",
          ),
      );
    };
  });
}

export async function completePendingSend(input: {
  pending: StoredPendingSend;
  messageId: string;
  serverCreatedAt: string;
}): Promise<void> {
  const plaintextRecord = await protectPlaintext({
    conversationId: input.pending.conversationId,
    messageId: input.messageId,
    text: input.pending.plaintext,
    kind: input.pending.kind,
    senderUserId: input.pending.senderUserId,
    createdAt: input.serverCreatedAt,
  });
  const protectedPending =
    await protectPendingSend(input.pending);
  if (input.pending.operatorOutput) {
    await loadPendingSend(
      input.pending.operatorOutput.parentClientMessageId,
    );
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      ["pendingSends", "plaintexts"],
      "readwrite",
    );
    tx.objectStore("plaintexts").put(
      plaintextRecord,
      input.messageId,
    );
    const pendingStore = tx.objectStore("pendingSends");

    if (input.pending.operatorIntent) {
      const currentRequest = pendingStore.get(
        input.pending.clientMessageId,
      );
      currentRequest.onsuccess = () => {
        const current = currentRequest.result as
          | StoredPendingSend
          | undefined;
        if (!current) {
          return;
        }
        if (
          !current.operatorIntent ||
          current.operatorIntent.clientRequestId !==
            input.pending.operatorIntent!.clientRequestId
        ) {
          failure = new Error(
            "Pending operator invocation identity changed",
          );
          tx.abort();
          return;
        }
        const operatorIntent =
          current.operatorIntent.delivery
            ? current.operatorIntent
            : protectedPending.operatorIntent!;
        pendingStore.put(
          {
            // Preserve the newest durable row. A sibling recovery may have
            // rebuilt recipient envelopes or advanced local outbox metadata
            // while this HTTP response was in flight; finalization must only
            // add commit metadata, never restore the caller's stale snapshot.
            ...current,
            revision:
              Math.max(
                pendingSendRevision(current),
                pendingSendRevision(input.pending),
              ) + 1,
            operatorIntent,
            committedMessageId: input.messageId,
            committedCreatedAt: input.serverCreatedAt,
          } satisfies StoredPendingSend,
          input.pending.clientMessageId,
        );
      };
      currentRequest.onerror = () => {
        failure =
          currentRequest.error ??
          new Error(
            "Pending operator invocation merge read failed",
          );
        tx.abort();
      };
    } else if (input.pending.operatorOutput) {
      const link = input.pending.operatorOutput;
      const parentRequest = pendingStore.get(
        link.parentClientMessageId,
      );
      parentRequest.onsuccess = () => {
        const parent = parentRequest.result as
          | StoredPendingSend
          | undefined;
        const delivery = parent?.operatorIntent?.delivery;
        const output = delivery?.outputs.find(
          (candidate) =>
            candidate.id === link.outputId &&
            candidate.clientMessageId ===
              input.pending.clientMessageId,
        );
        if (!parent) {
          pendingStore.delete(
            input.pending.clientMessageId,
          );
          return;
        }
        if (!delivery || !output) {
          failure = new Error(
            "Pending operator output parent is inconsistent",
          );
          tx.abort();
          return;
        }
        if (output.delivered) {
          pendingStore.delete(
            input.pending.clientMessageId,
          );
          return;
        }
        pendingStore.put(
          {
            ...parent,
            operatorIntent: {
              ...parent.operatorIntent!,
              delivery: {
                ...delivery,
                outputs: delivery.outputs.map(
                  (candidate) =>
                    candidate.id === link.outputId
                      ? {
                          ...candidate,
                          delivered: true,
                        }
                      : candidate,
                ),
              },
            },
          } satisfies StoredPendingSend,
          link.parentClientMessageId,
        );
        pendingStore.delete(
          input.pending.clientMessageId,
        );
      };
      parentRequest.onerror = () => {
        failure =
          parentRequest.error ??
          new Error(
            "Pending operator output parent read failed",
          );
        tx.abort();
      };
    } else {
      pendingStore.delete(
        input.pending.clientMessageId,
      );
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error("Pending send completion aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Pending send completion failed");
    };
  });
}

export async function stagePendingOperatorDelivery(input: {
  parentClientMessageId: string;
  runId: string;
  runStatus: OperatorRunStatus;
  runUpdatedAt: string;
  outputs: readonly StoredOperatorOutputDraft[];
}): Promise<StoredOperatorIntent> {
  // Reading through the public boundary upgrades any legacy plaintext row
  // before this transaction mutates delivery metadata in place.
  await loadPendingSend(input.parentClientMessageId);
  const protectedDrafts = await Promise.all(
    input.outputs.map(async (draft) => ({
      ...draft,
      plaintext: await protectLocalString(
        draft.plaintext,
        pendingAad(
          input.parentClientMessageId,
          `operator-output:${draft.id}`,
        ),
      ),
    })),
  );
  const db = await openDb();
  const persisted = await new Promise<StoredOperatorIntent>(
    (resolve, reject) => {
      let failure: Error | null = null;
      let result: StoredOperatorIntent | null = null;
      const tx = db.transaction(
        "pendingSends",
        "readwrite",
      );
      const store = tx.objectStore("pendingSends");
      const request = store.get(
        input.parentClientMessageId,
      );
      request.onsuccess = () => {
        const parent = request.result as
          | StoredPendingSend
          | undefined;
        if (!parent) {
          failure =
            new PendingOperatorInvocationGoneError();
          tx.abort();
          return;
        }
        if (
          !parent.operatorIntent ||
          !parent.committedMessageId ||
          !parent.committedCreatedAt
        ) {
          failure = new Error(
            "Pending operator invocation is not committed",
          );
          tx.abort();
          return;
        }
        const existing =
          parent.operatorIntent.delivery;
        if (existing && existing.runId !== input.runId) {
          failure = new Error(
            "Pending operator delivery run does not match",
          );
          tx.abort();
          return;
        }
        if (
          existing &&
          (isOlderOperatorDelivery(
            input.runUpdatedAt,
            existing.runUpdatedAt,
          ) ||
            (input.runUpdatedAt ===
              existing.runUpdatedAt &&
              isTerminalOperatorStatus(
                existing.runStatus,
              ) &&
              !isTerminalOperatorStatus(
                input.runStatus,
              )))
        ) {
          result = parent.operatorIntent;
          return;
        }

        const outputs = [
          ...(existing?.outputs ?? []),
        ];
        for (const draft of protectedDrafts) {
          if (
            outputs.some(
              (output) => output.id === draft.id,
            )
          ) {
            continue;
          }
          outputs.push({
            id: draft.id,
            clientMessageId: crypto.randomUUID(),
            kind: draft.kind,
            plaintext: draft.plaintext,
            delivered: false,
          });
        }

        const delivery: StoredOperatorDelivery = {
          runId: input.runId,
          runStatus: input.runStatus,
          runUpdatedAt: input.runUpdatedAt,
          outputs,
        };
        result = {
          ...parent.operatorIntent,
          delivery,
        };
        store.put(
          {
            ...parent,
            operatorIntent: result,
          } satisfies StoredPendingSend,
          input.parentClientMessageId,
        );
      };
      request.onerror = () => {
        failure =
          request.error ??
          new Error(
            "Pending operator invocation read failed",
          );
        tx.abort();
      };
      tx.oncomplete = () => {
        db.close();
        if (!result) {
          reject(
            new Error(
              "Pending operator delivery was not staged",
            ),
          );
          return;
        }
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(
          failure ??
            tx.error ??
            new Error(
              "Pending operator delivery staging aborted",
            ),
        );
      };
      tx.onerror = () => {
        failure ??=
          tx.error ??
          new Error(
            "Pending operator delivery staging failed",
          );
      };
    },
  );
  return unprotectOperatorIntent(
    input.parentClientMessageId,
    persisted,
  );
}

export async function completePendingOperatorIntent(
  clientMessageId: string,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      "pendingSends",
      "readwrite",
    );
    const store = tx.objectStore("pendingSends");
    const request = store.get(clientMessageId);
    request.onsuccess = () => {
      const pending = request.result as
        | StoredPendingSend
        | undefined;
      if (!pending) return;
      const delivery = pending.operatorIntent?.delivery;
      if (
        !delivery ||
        delivery.outputs.some(
          (output) => !output.delivered,
        )
      ) {
        failure = new Error(
          "Pending operator delivery is incomplete",
        );
        tx.abort();
        return;
      }
      if (!isTerminalOperatorStatus(delivery.runStatus)) {
        return;
      }
      store.delete(clientMessageId);
    };
    request.onerror = () => {
      failure =
        request.error ??
        new Error(
          "Pending operator invocation read failed",
        );
      tx.abort();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error(
            "Pending operator invocation completion aborted",
          ),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error(
          "Pending operator invocation completion failed",
        );
    };
  });
}

async function migrateLegacyRatchet(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
  sourceKey: string;
  snapshot: RatchetSnapshot;
}): Promise<void> {
  const protectedRecord = await protectRatchetRecord({
    conversationId: input.conversationId,
    localDeviceId: input.localDeviceId,
    peerDeviceId: input.peerDeviceId,
    interactionEpoch: input.interactionEpoch,
    stateVersion: input.snapshot.stateVersion,
    state: input.snapshot.state,
    pendingX3dhInit: input.snapshot.pendingX3dhInit,
  });
  const targetKey = ratchetStorageKey(
    input.conversationId,
    input.localDeviceId,
    input.peerDeviceId,
    input.interactionEpoch,
  );
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      "ratchets",
      "readwrite",
    );
    const store = tx.objectStore("ratchets");
    const request = store.get(input.sourceKey);
    request.onsuccess = () => {
      const current = request.result;
      if (
        current === undefined ||
        isProtectedRatchetRecord(current)
      ) {
        return;
      }
      try {
        const currentSnapshot = decodeStoredRatchet(
          current,
          input.localDeviceId,
        );
        if (
          !currentSnapshot ||
          currentSnapshot.stateVersion !==
            input.snapshot.stateVersion
        ) {
          return;
        }
        store.put(protectedRecord, targetKey);
        if (input.sourceKey !== targetKey) {
          store.delete(input.sourceKey);
        }
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new RatchetStateCorruptError();
        tx.abort();
      }
    };
    request.onerror = () => {
      failure =
        request.error ??
        new Error(
          "Legacy ratchet migration read failed",
        );
      tx.abort();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error(
            "Legacy ratchet migration aborted",
          ),
      );
    };
  });
}

export async function loadRatchet(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
  interactionEpoch: number,
): Promise<RatchetSnapshot | null> {
  const scopedKey = ratchetStorageKey(
    conversationId,
    localDeviceId,
    peerDeviceId,
    interactionEpoch,
  );
  const scoped = await withStore<unknown>(
    "ratchets",
    "readonly",
    (store) => store.get(scopedKey),
  );
  if (scoped === undefined) {
    return null;
  }
  const snapshot = await decodePersistedRatchet(
    scoped,
    {
      conversationId,
      localDeviceId,
      peerDeviceId,
      interactionEpoch,
    },
  );
  if (
    snapshot &&
    !isProtectedRatchetRecord(scoped)
  ) {
    await migrateLegacyRatchet({
      conversationId,
      localDeviceId,
      peerDeviceId,
      interactionEpoch,
      sourceKey: scopedKey,
      snapshot,
    });
  }
  return snapshot;
}

export async function commitDecryptedRatchet(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
  expectedVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
  plaintext: StoredPlaintext;
}): Promise<RatchetSnapshot> {
  return commitRatchet(input);
}

export async function commitOutboundRatchets(input: {
  conversationId: string;
  localDeviceId: string;
  interactionEpoch: number;
  updates: OutboundRatchetUpdate[];
  pendingSend: StoredPendingSend;
  expectedPendingRevision: number | null;
}): Promise<void> {
  const protectedPendingSend =
    await protectPendingSend(input.pendingSend);
  if (input.updates.length === 0) {
    throw new Error("Outbound ratchet update set is empty");
  }
  if (
    new Set(
      input.updates.map(
        (update) => update.peerDeviceId,
      ),
    ).size !== input.updates.length
  ) {
    throw new Error(
      "Outbound ratchet update set contains duplicates",
    );
  }

  const protectedRatchets = new Map(
    await Promise.all(
      input.updates.map(async (update) => [
        update.peerDeviceId,
        await protectRatchetRecord({
          conversationId: input.conversationId,
          localDeviceId: input.localDeviceId,
          peerDeviceId: update.peerDeviceId,
          interactionEpoch: input.interactionEpoch,
          stateVersion:
            update.expectedVersion + 1,
          state: update.state,
          pendingX3dhInit:
            update.pendingX3dhInit,
        }),
      ] as const),
    ),
  );

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      ["ratchets", "pendingSends"],
      "readwrite",
    );
    const ratchets = tx.objectStore("ratchets");
    const pendingSends =
      tx.objectStore("pendingSends");
    const pendingRequest = pendingSends.get(
      input.pendingSend.clientMessageId,
    );
    const operatorOutputLink =
      input.pendingSend.operatorOutput;
    const operatorParentRequest =
      operatorOutputLink
        ? pendingSends.get(
            operatorOutputLink.parentClientMessageId,
          )
        : null;
    let pendingReady = false;
    let operatorParentReady =
      operatorParentRequest === null;

    const reads = input.updates.map((update) => {
      const key = ratchetStorageKey(
        input.conversationId,
        input.localDeviceId,
        update.peerDeviceId,
        input.interactionEpoch,
      );
      return {
        update,
        key,
        current: ratchets.get(key),
        currentReady: false,
      };
    });

    const apply = (): void => {
      if (
        !pendingReady ||
        !operatorParentReady ||
        reads.some((read) => !read.currentReady)
      ) {
        return;
      }

      try {
        const currentPending =
          pendingRequest.result as
            | StoredPendingSend
            | undefined;
        if (input.expectedPendingRevision === null) {
          if (currentPending !== undefined) {
            throw new PendingSendConflictError();
          }
        } else if (
          currentPending === undefined ||
          pendingSendRevision(currentPending) !==
            input.expectedPendingRevision
        ) {
          throw new PendingSendConflictError();
        }

        if (
          operatorOutputLink &&
          operatorParentRequest
        ) {
          const parent =
            operatorParentRequest.result as
              | StoredPendingSend
              | undefined;
          const output =
            parent?.operatorIntent?.delivery?.outputs.find(
              (candidate) =>
                candidate.id ===
                  operatorOutputLink.outputId &&
                candidate.clientMessageId ===
                  input.pendingSend.clientMessageId,
            );
          if (!parent || !output || output.delivered) {
            throw new PendingOperatorInvocationGoneError();
          }
        }

        for (const read of reads) {
          assertPersistedRatchetVersion(
            read.current.result,
            input.localDeviceId,
            read.update.expectedVersion,
          );
          const protectedRecord =
            protectedRatchets.get(
              read.update.peerDeviceId,
            );
          if (!protectedRecord) {
            throw new RatchetStateCorruptError();
          }
          ratchets.put(
            protectedRecord,
            read.key,
          );
        }

        pendingSends.put(
          protectedPendingSend,
          input.pendingSend.clientMessageId,
        );
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new Error(
                "Outbound ratchet commit failed",
              );
        tx.abort();
      }
    };

    pendingRequest.onsuccess = () => {
      pendingReady = true;
      apply();
    };
    pendingRequest.onerror = () => {
      failure =
        pendingRequest.error ??
        new Error("Pending send read failed");
      tx.abort();
    };
    if (operatorParentRequest) {
      operatorParentRequest.onsuccess = () => {
        operatorParentReady = true;
        apply();
      };
      operatorParentRequest.onerror = () => {
        failure =
          operatorParentRequest.error ??
          new Error(
            "Pending operator output parent read failed",
          );
        tx.abort();
      };
    }

    for (const read of reads) {
      read.current.onsuccess = () => {
        read.currentReady = true;
        apply();
      };
      read.current.onerror = () => {
        failure =
          read.current.error ??
          new Error(
            "Outbound ratchet read failed",
          );
        tx.abort();
      };
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error(
            "Outbound ratchet commit aborted",
          ),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error(
          "Outbound ratchet commit failed",
        );
    };
  });
}

export async function acknowledgeRatchetHandshake(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
}): Promise<void> {
  await withRatchetSessionLock(input, async () => {
    const current = await loadRatchet(
      input.conversationId,
      input.localDeviceId,
      input.peerDeviceId,
      input.interactionEpoch,
    );
    if (!current?.pendingX3dhInit) return;
    await commitRatchet({
      ...input,
      expectedVersion: current.stateVersion,
      state: current.state,
      pendingX3dhInit: null,
    });
  });
}

export async function withRatchetSessionLock<T>(
  input: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
    interactionEpoch: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  return withCoordinationLock(
    ratchetLockKey(input),
    fn,
    { maxHoldMs: RATCHET_SESSION_LOCK_MAX_HOLD_MS },
  );
}

export async function withRatchetSessionLocks<T>(
  scopes: ReadonlyArray<{
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
    interactionEpoch: number;
  }>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(scopes.map(ratchetLockKey))].sort();
  const acquire = async (index: number): Promise<T> => {
    const key = keys[index];
    if (!key) return fn();
    return withCoordinationLock(
      key,
      () => acquire(index + 1),
      { maxHoldMs: RATCHET_SESSION_LOCK_MAX_HOLD_MS },
    );
  };
  return acquire(0);
}

export async function withLocalDeviceBootstrapLock<T>(
  fn: (lease: CoordinationLease) => Promise<T>,
): Promise<T> {
  return withCoordinationLock(
    LOCAL_DEVICE_LOCK_KEY,
    fn,
    { maxHoldMs: LOCAL_DEVICE_LOCK_MAX_HOLD_MS },
  );
}

export async function withPendingSendRecoveryLock<T>(
  input: {
    conversationId: string;
    localDeviceId: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  return withCoordinationLock(
    [
      "vimla-pending-send-recovery",
      input.conversationId,
      input.localDeviceId,
    ].join(":"),
    fn,
    {
      maxHoldMs:
        PENDING_SEND_RECOVERY_LOCK_MAX_HOLD_MS,
    },
  );
}

export async function withPendingOperatorIntentLock<T>(
  input: {
    conversationId: string;
    localDeviceId: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  return withCoordinationLock(
    [
      "vimla-pending-operator-intent",
      input.conversationId,
      input.localDeviceId,
    ].join(":"),
    () => fn(),
    {
      maxHoldMs:
        PENDING_OPERATOR_LOCK_MAX_HOLD_MS,
    },
  );
}

async function migratePlaintext(
  legacy: StoredPlaintext,
): Promise<void> {
  assertLegacyValueIsRaw(
    legacy.text,
    "plaintext cache",
  );
  const protectedRow = await protectPlaintext(legacy);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      "plaintexts",
      "readwrite",
    );
    const store = tx.objectStore("plaintexts");
    const request = store.get(legacy.messageId);
    request.onsuccess = () => {
      const current = request.result as
        | StoredPlaintext
        | undefined;
      if (
        current &&
        localProtectionVersion(
          current,
          "plaintext",
        ) === LEGACY_LOCAL_PROTECTION_VERSION &&
        current.text === legacy.text &&
        current.conversationId ===
          legacy.conversationId
      ) {
        store.put(protectedRow, legacy.messageId);
      }
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            "Legacy plaintext migration read failed",
          ),
      );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Legacy plaintext migration aborted",
          ),
      );
    };
  });
}

export async function loadPlaintext(
  messageId: string,
): Promise<StoredPlaintext | null> {
  const value = await withStore<StoredPlaintext | undefined>(
    "plaintexts",
    "readonly",
    (store) => store.get(messageId),
  );
  if (!value) {
    return null;
  }
  if (
    localProtectionVersion(value, "plaintext") ===
    LEGACY_LOCAL_PROTECTION_VERSION
  ) {
    await migratePlaintext(value);
  }
  return unprotectPlaintext(value);
}

export async function loadConversationPlaintexts(
  conversationId: string,
  limit = 256,
): Promise<StoredPlaintext[]> {
  const boundedLimit = Math.max(
    1,
    Math.min(512, Math.trunc(limit)),
  );
  const db = await openDb();
  const rows = await new Promise<StoredPlaintext[]>(
    (resolve, reject) => {
      const result: StoredPlaintext[] = [];
      const tx = db.transaction(
        "plaintexts",
        "readonly",
      );
      const store = tx.objectStore("plaintexts");
      const index = store.index(
        PLAINTEXT_CONVERSATION_TIME_INDEX,
      );
      const range = IDBKeyRange.bound(
        [conversationId, ""],
        [conversationId, "\uffff"],
      );
      const request = index.openCursor(
        range,
        "prev",
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (
          !cursor ||
          result.length >= boundedLimit
        ) {
          return;
        }
        result.push(
          cursor.value as StoredPlaintext,
        );
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(
          tx.error ??
            new Error(
              "IndexedDB transaction aborted",
            ),
        );
      };
      tx.onerror = () => {
        db.close();
        reject(
          tx.error ??
            new Error(
              "IndexedDB transaction failed",
            ),
        );
      };
    },
  );
  for (const row of rows) {
    if (
      localProtectionVersion(row, "plaintext") ===
      LEGACY_LOCAL_PROTECTION_VERSION
    ) {
      await migratePlaintext(row);
    }
  }
  return Promise.all(
    rows.map((row) => unprotectPlaintext(row)),
  );
}

export function identityFromMaterial(
  material: StoredDeviceMaterial,
): IdentityKeyPair {
  return {
    ed25519Secret: b64ToBytes(
      material.identity.ed25519Secret,
    ),
    ed25519Public: b64ToBytes(
      material.identity.ed25519Public,
    ),
    x25519Secret: b64ToBytes(
      material.identity.x25519Secret,
    ),
    x25519Public: b64ToBytes(
      material.identity.x25519Public,
    ),
  };
}

export function encodeIdentity(
  identity: IdentityKeyPair,
): StoredDeviceMaterial["identity"] {
  return {
    ed25519Secret: bytesToB64(identity.ed25519Secret),
    ed25519Public: bytesToB64(identity.ed25519Public),
    x25519Secret: bytesToB64(identity.x25519Secret),
    x25519Public: bytesToB64(identity.x25519Public),
  };
}

async function commitRatchet(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
  expectedVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
  plaintext?: StoredPlaintext;
}): Promise<RatchetSnapshot> {
  const nextVersion = input.expectedVersion + 1;
  const protectedRecord = await protectRatchetRecord({
    conversationId: input.conversationId,
    localDeviceId: input.localDeviceId,
    peerDeviceId: input.peerDeviceId,
    interactionEpoch: input.interactionEpoch,
    stateVersion: nextVersion,
    state: input.state,
    pendingX3dhInit: input.pendingX3dhInit,
  });
  const protectedPlaintext = input.plaintext
    ? await protectPlaintext(input.plaintext)
    : undefined;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    const stores = input.plaintext
      ? ["ratchets", "plaintexts"]
      : ["ratchets"];
    const tx = db.transaction(stores, "readwrite");
    const ratchets = tx.objectStore("ratchets");
    const key = ratchetStorageKey(
      input.conversationId,
      input.localDeviceId,
      input.peerDeviceId,
      input.interactionEpoch,
    );
    const currentRequest = ratchets.get(key);
    let currentReady = false;

    const apply = (): void => {
      if (!currentReady) return;
      try {
        assertPersistedRatchetVersion(
          currentRequest.result,
          input.localDeviceId,
          input.expectedVersion,
        );
        ratchets.put(
          protectedRecord,
          key,
        );
        if (protectedPlaintext) {
          tx.objectStore("plaintexts").put(
            protectedPlaintext,
            protectedPlaintext.messageId,
          );
        }
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new Error("Ratchet persistence failed");
        tx.abort();
      }
    };
    currentRequest.onsuccess = () => {
      currentReady = true;
      apply();
    };
    currentRequest.onerror = () => {
      failure =
        currentRequest.error ??
        new Error("Ratchet state could not be read");
      tx.abort();
    };
    tx.oncomplete = () => {
      db.close();
      resolve({
        stateVersion: nextVersion,
        state: input.state,
        pendingX3dhInit: input.pendingX3dhInit,
      });
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error("Ratchet persistence aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Ratchet persistence failed");
    };
  });
}

async function withCoordinationLock<T>(
  key: string,
  fn: (lease: CoordinationLease) => Promise<T>,
  options: { maxHoldMs: number },
): Promise<T> {
  const runWithLease = (): Promise<T> =>
    withFallbackRatchetLease(
      key,
      fn,
      options.maxHoldMs,
    );
  if (
    typeof navigator !== "undefined" &&
    navigator.locks
  ) {
    return navigator.locks.request(
      key,
      {
        mode: "exclusive",
        ifAvailable: true,
      },
      () => runWithLease(),
    );
  }
  return runWithLease();
}

async function withFallbackRatchetLease<T>(
  key: string,
  fn: (lease: CoordinationLease) => Promise<T>,
  maxHoldMs: number,
): Promise<T> {
  const owner = crypto.randomUUID();
  const deadline =
    Date.now() + RATCHET_LOCK_ACQUIRE_TIMEOUT_MS;
  let lease: CoordinationLease | null = null;
  while (!lease) {
    lease = await tryAcquireRatchetLease(
      key,
      owner,
      Date.now(),
      maxHoldMs,
    );
    if (lease) break;
    if (Date.now() >= deadline) {
      throw new RatchetLockLostError();
    }
    await delay(RATCHET_LOCK_POLL_MS);
  }

  const acquiredLease = lease;
  let lost = false;
  let renewing = false;
  const heartbeat = globalThis.setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    void renewRatchetLease(
      key,
      acquiredLease.owner,
      acquiredLease.fence,
      Date.now(),
    )
      .then((renewed) => {
        if (!renewed) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        renewing = false;
      });
  }, RATCHET_LOCK_HEARTBEAT_MS);

  try {
    const result = await fn(acquiredLease);
    if (lost) {
      throw new RatchetLockLostError();
    }
    await assertCoordinationLease(acquiredLease);
    return result;
  } finally {
    globalThis.clearInterval(heartbeat);
    await releaseRatchetLease(
      key,
      acquiredLease.owner,
      acquiredLease.fence,
    ).catch(() => undefined);
  }
}

async function tryAcquireRatchetLease(
  key: string,
  owner: string,
  now: number,
  maxHoldMs: number,
): Promise<CoordinationLease | null> {
  const fence = await mutateRatchetLease<number | null>(
    key,
    (current) => {
      const acquired = acquireRatchetLeaseRecord({
        current,
        owner,
        now,
        leaseMs: RATCHET_LOCK_LEASE_MS,
        maxHoldMs,
      });
      if (!acquired) {
        return { changed: false, value: null };
      }
      return {
        changed: true,
        value: acquired.fence,
        next: acquired.record,
      };
    },
  );
  return fence === null
    ? null
    : { key, owner, fence };
}

async function renewRatchetLease(
  key: string,
  owner: string,
  fence: number,
  now: number,
): Promise<boolean> {
  return mutateRatchetLease(key, (current) => {
    const renewed = renewRatchetLeaseRecord({
      current,
      owner,
      fence,
      now,
      leaseMs: RATCHET_LOCK_LEASE_MS,
    });
    if (!renewed) {
      return { changed: false, value: false };
    }
    return {
      changed: true,
      value: true,
      next: renewed,
    };
  });
}

async function releaseRatchetLease(
  key: string,
  owner: string,
  fence: number,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      "ratchetLocks",
      "readwrite",
    );
    const store = tx.objectStore("ratchetLocks");
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result;
      if (
        current !== undefined &&
        !isRatchetLeaseRecord(current)
      ) {
        failure = new Error(
          "Persisted ratchet lock is invalid",
        );
        tx.abort();
        return;
      }
      if (
        current?.owner === owner &&
        (current.fence ?? 0) === fence
      ) {
        store.put(
          {
            owner,
            fence,
            expiresAt: 0,
          } satisfies RatchetLeaseRecord,
          key,
        );
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error("Ratchet lock release aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Ratchet lock release failed");
    };
  });
}

async function mutateRatchetLease<T>(
  key: string,
  decide: (
    current: RatchetLeaseRecord | null,
  ) =>
    | { changed: false; value: T }
    | {
        changed: true;
        value: T;
        next: RatchetLeaseRecord;
      },
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    let result: T | undefined;
    let hasResult = false;
    const tx = db.transaction(
      "ratchetLocks",
      "readwrite",
    );
    const store = tx.objectStore("ratchetLocks");
    const request = store.get(key);
    request.onsuccess = () => {
      const raw = request.result;
      if (
        raw !== undefined &&
        !isRatchetLeaseRecord(raw)
      ) {
        failure = new Error(
          "Persisted ratchet lock is invalid",
        );
        tx.abort();
        return;
      }
      const current = raw ?? null;
      const decision = decide(current);
      result = decision.value;
      hasResult = true;
      if (decision.changed) {
        store.put(decision.next, key);
      }
    };
    tx.oncomplete = () => {
      db.close();
      if (!hasResult) {
        reject(
          new Error("Ratchet lock transaction was incomplete"),
        );
        return;
      }
      resolve(result as T);
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ??
          tx.error ??
          new Error("Ratchet lock transaction aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Ratchet lock transaction failed");
    };
  });
}

async function assertCoordinationLease(
  lease: CoordinationLease,
): Promise<void> {
  const current = await withStore<unknown>(
    "ratchetLocks",
    "readonly",
    (store) => store.get(lease.key),
  );
  assertActiveCoordinationLease(
    current,
    lease,
    Date.now(),
  );
}

function assertActiveCoordinationLease(
  value: unknown,
  lease: CoordinationLease,
  now: number,
): void {
  if (
    !isRatchetLeaseRecord(value) ||
    value.owner !== lease.owner ||
    (value.fence ?? 0) !== lease.fence ||
    value.expiresAt <= now ||
    (value.hardExpiresAt !== undefined &&
      value.hardExpiresAt <= now)
  ) {
    throw new RatchetLockLostError();
  }
}

function markLegacyLocalRecordsDuringUpgrade(
  tx: IDBTransaction,
): void {
  for (const storeName of [
    "device",
    "plaintexts",
  ] as const) {
    if (!tx.db.objectStoreNames.contains(storeName)) {
      continue;
    }
    const cursorRequest = tx
      .objectStore(storeName)
      .openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        return;
      }
      const value = cursor.value;
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        const record = value as Record<string, unknown>;
        if (record.protectionVersion === undefined) {
          cursor.update({
            ...record,
            protectionVersion:
              LEGACY_LOCAL_PROTECTION_VERSION,
          });
        }
      }
      cursor.continue();
    };
  }
  markLegacyPendingSendsDuringUpgrade(tx);
}

function markLegacyPendingSendsDuringUpgrade(
  tx: IDBTransaction,
): void {
  if (!tx.db.objectStoreNames.contains("pendingSends")) {
    return;
  }
  const store = tx.objectStore("pendingSends");
  const rows: Array<{
    key: IDBValidKey;
    value: StoredPendingSend;
  }> = [];
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      const value = cursor.value;
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        rows.push({
          key: cursor.primaryKey,
          value: value as StoredPendingSend,
        });
      }
      cursor.continue();
      return;
    }

    const outputIds = new Map<string, string>();
    const linkKey = (
      parentClientMessageId: string,
      outputId: string,
    ): string =>
      JSON.stringify([
        parentClientMessageId,
        outputId,
      ]);
    const mappedOutputId = (
      parentClientMessageId: string,
      outputId: string,
    ): string => {
      const key = linkKey(
        parentClientMessageId,
        outputId,
      );
      const existing = outputIds.get(key);
      if (existing) {
        return existing;
      }
      const created =
        `legacy-output:${crypto.randomUUID()}`;
      outputIds.set(key, created);
      return created;
    };

    for (const { value } of rows) {
      const parentClientMessageId =
        value.clientMessageId;
      for (const output of
        value.operatorIntent?.delivery?.outputs ??
        []) {
        mappedOutputId(
          parentClientMessageId,
          output.id,
        );
      }
    }
    for (const { value } of rows) {
      if (value.operatorOutput) {
        mappedOutputId(
          value.operatorOutput
            .parentClientMessageId,
          value.operatorOutput.outputId,
        );
      }
    }

    for (const { key, value } of rows) {
      const parentClientMessageId =
        value.clientMessageId;
      const operatorIntent =
        value.operatorIntent?.delivery
          ? {
              ...value.operatorIntent,
              delivery: {
                ...value.operatorIntent.delivery,
                outputs:
                  value.operatorIntent.delivery.outputs.map(
                    (output) => ({
                      ...output,
                      id: mappedOutputId(
                        parentClientMessageId,
                        output.id,
                      ),
                    }),
                  ),
              },
            }
          : value.operatorIntent;
      const operatorOutput =
        value.operatorOutput
          ? {
              ...value.operatorOutput,
              outputId: mappedOutputId(
                value.operatorOutput
                  .parentClientMessageId,
                value.operatorOutput.outputId,
              ),
            }
          : undefined;
      store.put(
        {
          ...value,
          protectionVersion:
            LEGACY_LOCAL_PROTECTION_VERSION,
          ...(operatorIntent
            ? { operatorIntent }
            : {}),
          ...(operatorOutput
            ? { operatorOutput }
            : {}),
        } satisfies StoredPendingSend,
        key,
      );
    }
  };
}

function markLegacyRatchetsDuringUpgrade(
  tx: IDBTransaction,
): void {
  const deviceRequest = tx
    .objectStore("device")
    .get("local");
  deviceRequest.onsuccess = () => {
    const device = deviceRequest.result as
      | { deviceId?: unknown }
      | undefined;
    if (
      !device ||
      typeof device.deviceId !== "string" ||
      device.deviceId.length === 0
    ) {
      return;
    }
    const localDeviceId = device.deviceId;
    const ratchets = tx.objectStore("ratchets");
    const cursorRequest = ratchets.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const marked = markLegacyRatchetOwner(
        cursor.value,
        localDeviceId,
      );
      if (marked !== cursor.value) {
        cursor.update(marked);
      }
      cursor.continue();
    };
  };
}

function isOlderOperatorDelivery(
  incomingUpdatedAt: string,
  currentUpdatedAt: string,
): boolean {
  const incoming = Date.parse(incomingUpdatedAt);
  const current = Date.parse(currentUpdatedAt);
  if (
    Number.isFinite(incoming) &&
    Number.isFinite(current)
  ) {
    return incoming < current;
  }
  return incomingUpdatedAt < currentUpdatedAt;
}

function isTerminalOperatorStatus(
  status: OperatorRunStatus,
): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELED" ||
    status === "PARTIAL" ||
    status === "AWAITING_CLARIFICATION"
  );
}

function ratchetStorageKey(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
  interactionEpoch: number,
): string {
  return [
    conversationId,
    localDeviceId,
    peerDeviceId,
    `epoch-${interactionEpoch}`,
  ].join(":");
}

function ratchetLockKey(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
  interactionEpoch: number;
}): string {
  return [
    "vimla-ratchet",
    input.conversationId,
    input.localDeviceId,
    input.peerDeviceId,
    `epoch-${input.interactionEpoch}`,
  ].join(":");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
