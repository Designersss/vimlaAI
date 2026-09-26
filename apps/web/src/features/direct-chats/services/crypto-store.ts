import type {
  DirectMessageKind,
  MessageMentionInput,
  OperatorContextBundle,
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
  acquireRatchetLeaseRecord,
  assertRatchetVersion,
  renewRatchetLeaseRecord,
  decodeStoredRatchet,
  isRatchetLeaseRecord,
  markLegacyRatchetOwner,
  storedRatchetRecord,
  type RatchetLeaseRecord,
  type RatchetSnapshot,
} from "./ratchet-coordination";

const DB_NAME = "vimla-direct-e2ee";
const DB_VERSION = 4;
const PLAINTEXT_CONVERSATION_TIME_INDEX = "conversation-created-at";
const RATCHET_LOCK_LEASE_MS = 5_000;
const RATCHET_LOCK_HEARTBEAT_MS = 1_000;
const RATCHET_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const RATCHET_LOCK_MAX_HOLD_MS = 150_000;
const RATCHET_LOCK_POLL_MS = 40;
const LOCAL_DEVICE_LOCK_KEY = "vimla-local-device-bootstrap";

type StoreName =
  | "device"
  | "ratchets"
  | "ratchetLocks"
  | "pendingSends"
  | "plaintexts";

export interface StoredDeviceMaterial {
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
  conversationId: string;
  messageId: string;
  text: string;
  kind: string;
  senderUserId: string;
  createdAt: string;
}

export interface StoredOperatorOutput {
  id: "response" | "action";
  clientMessageId: string;
  kind: DirectMessageKind;
  plaintext: string;
  delivered: boolean;
}

export interface StoredOperatorDelivery {
  runId: string;
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
  conversationId: string;
  clientMessageId: string;
  senderUserId: string;
  senderDeviceId: string;
  kind: DirectMessageKind;
  envelopes: WireEnvelopeDto[];
  mentions: MessageMentionInput[];
  plaintext: string;
  createdAt: string;
  operatorIntent?: StoredOperatorIntent;
  operatorOutput?: StoredOperatorOutputLink;
  committedMessageId?: string;
  committedCreatedAt?: string;
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
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
      if (!db.objectStoreNames.contains("pendingSends")) {
        db.createObjectStore("pendingSends");
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
  return value ?? null;
}

export async function saveDeviceMaterial(
  material: StoredDeviceMaterial,
  lease: CoordinationLease,
): Promise<void> {
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
        deviceStore.put(material, "local");
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

export async function loadPendingSends(
  conversationId: string,
  senderDeviceId: string,
): Promise<StoredPendingSend[]> {
  const rows = await withStore<StoredPendingSend[]>(
    "pendingSends",
    "readonly",
    (store) => store.getAll(),
  );
  return rows
    .filter(
      (row) =>
        row.conversationId === conversationId &&
        row.senderDeviceId === senderDeviceId,
    )
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) -
          Date.parse(right.createdAt) ||
        left.clientMessageId.localeCompare(
          right.clientMessageId,
        ),
    );
}

export async function completePendingSend(input: {
  pending: StoredPendingSend;
  messageId: string;
  serverCreatedAt: string;
}): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      ["pendingSends", "plaintexts"],
      "readwrite",
    );
    tx.objectStore("plaintexts").put(
      {
        conversationId: input.pending.conversationId,
        messageId: input.messageId,
        text: input.pending.plaintext,
        kind: input.pending.kind,
        senderUserId: input.pending.senderUserId,
        createdAt: input.serverCreatedAt,
      } satisfies StoredPlaintext,
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
        if (
          current?.operatorIntent &&
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
          current?.operatorIntent?.delivery
            ? current.operatorIntent
            : input.pending.operatorIntent!;
        pendingStore.put(
          {
            ...input.pending,
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
        if (!parent || !delivery || !output) {
          failure = new Error(
            "Pending operator output parent is missing or inconsistent",
          );
          tx.abort();
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
  delivery: StoredOperatorDelivery;
}): Promise<StoredOperatorIntent> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
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
      if (
        !parent?.operatorIntent ||
        !parent.committedMessageId ||
        !parent.committedCreatedAt
      ) {
        failure = new Error(
          "Pending operator invocation is not committed",
        );
        tx.abort();
        return;
      }
      const existing = parent.operatorIntent.delivery;
      if (existing) {
        if (existing.runId !== input.delivery.runId) {
          failure = new Error(
            "Pending operator delivery run does not match",
          );
          tx.abort();
          return;
        }
        result = parent.operatorIntent;
        return;
      }
      result = {
        ...parent.operatorIntent,
        delivery: input.delivery,
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
  });
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

export async function loadRatchet(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
): Promise<RatchetSnapshot | null> {
  const scoped = await withStore<unknown>(
    "ratchets",
    "readonly",
    (store) =>
      store.get(
        ratchetStorageKey(
          conversationId,
          localDeviceId,
          peerDeviceId,
        ),
      ),
  );
  if (scoped !== undefined) {
    return decodeStoredRatchet(scoped, localDeviceId);
  }
  const legacy = await withStore<unknown>(
    "ratchets",
    "readonly",
    (store) =>
      store.get(
        legacyRatchetStorageKey(
          conversationId,
          peerDeviceId,
        ),
      ),
  );
  return decodeStoredRatchet(legacy, localDeviceId);
}

export async function commitDecryptedRatchet(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
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
  updates: OutboundRatchetUpdate[];
  pendingSend: StoredPendingSend;
}): Promise<void> {
  if (input.updates.length === 0) {
    throw new Error("Outbound ratchet update set is empty");
  }
  if (
    new Set(input.updates.map((update) => update.peerDeviceId))
      .size !== input.updates.length
  ) {
    throw new Error("Outbound ratchet update set contains duplicates");
  }

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(
      ["ratchets", "pendingSends"],
      "readwrite",
    );
    const ratchets = tx.objectStore("ratchets");
    const reads = input.updates.map((update) => {
      const key = ratchetStorageKey(
        input.conversationId,
        input.localDeviceId,
        update.peerDeviceId,
      );
      const legacyKey = legacyRatchetStorageKey(
        input.conversationId,
        update.peerDeviceId,
      );
      return {
        update,
        key,
        legacyKey,
        current: ratchets.get(key),
        legacy: ratchets.get(legacyKey),
        currentReady: false,
        legacyReady: false,
      };
    });

    const apply = (): void => {
      if (
        reads.some(
          (read) =>
            !read.currentReady || !read.legacyReady,
        )
      ) {
        return;
      }
      try {
        for (const read of reads) {
          const useLegacy =
            read.current.result === undefined &&
            read.legacy.result !== undefined;
          const raw = useLegacy
            ? read.legacy.result
            : read.current.result;
          const current = decodeStoredRatchet(
            raw,
            input.localDeviceId,
          );
          assertRatchetVersion(
            current,
            read.update.expectedVersion,
          );
          ratchets.put(
            storedRatchetRecord({
              localDeviceId: input.localDeviceId,
              stateVersion:
                read.update.expectedVersion + 1,
              state: read.update.state,
              pendingX3dhInit:
                read.update.pendingX3dhInit,
            }),
            read.key,
          );
          if (useLegacy) {
            ratchets.delete(read.legacyKey);
          }
        }
        tx.objectStore("pendingSends").put(
          input.pendingSend,
          input.pendingSend.clientMessageId,
        );
      } catch (error: unknown) {
        failure =
          error instanceof Error
            ? error
            : new Error("Outbound ratchet commit failed");
        tx.abort();
      }
    };

    for (const read of reads) {
      read.current.onsuccess = () => {
        read.currentReady = true;
        apply();
      };
      read.legacy.onsuccess = () => {
        read.legacyReady = true;
        apply();
      };
      read.current.onerror = () => {
        failure =
          read.current.error ??
          new Error("Outbound ratchet read failed");
        tx.abort();
      };
      read.legacy.onerror = () => {
        failure =
          read.legacy.error ??
          new Error("Outbound legacy ratchet read failed");
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
          new Error("Outbound ratchet commit aborted"),
      );
    };
    tx.onerror = () => {
      failure ??=
        tx.error ??
        new Error("Outbound ratchet commit failed");
    };
  });
}

export async function acknowledgeRatchetHandshake(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
}): Promise<void> {
  await withRatchetSessionLock(input, async () => {
    const current = await loadRatchet(
      input.conversationId,
      input.localDeviceId,
      input.peerDeviceId,
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
  },
  fn: () => Promise<T>,
): Promise<T> {
  return withCoordinationLock(
    ratchetLockKey(input),
    fn,
  );
}

export async function withRatchetSessionLocks<T>(
  scopes: ReadonlyArray<{
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
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
  );
}

export async function loadPlaintext(
  messageId: string,
): Promise<StoredPlaintext | null> {
  const value = await withStore<StoredPlaintext | undefined>(
    "plaintexts",
    "readonly",
    (store) => store.get(messageId),
  );
  return value ?? null;
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
  return new Promise((resolve, reject) => {
    const rows: StoredPlaintext[] = [];
    const tx = db.transaction("plaintexts", "readonly");
    const store = tx.objectStore("plaintexts");
    const index = store.index(
      PLAINTEXT_CONVERSATION_TIME_INDEX,
    );
    const range = IDBKeyRange.bound(
      [conversationId, ""],
      [conversationId, "\uffff"],
    );
    const request = index.openCursor(range, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= boundedLimit) return;
      rows.push(cursor.value as StoredPlaintext);
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve(rows);
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
  expectedVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
  plaintext?: StoredPlaintext;
}): Promise<RatchetSnapshot> {
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
    );
    const legacyKey = legacyRatchetStorageKey(
      input.conversationId,
      input.peerDeviceId,
    );
    const currentRequest = ratchets.get(key);
    const legacyRequest = ratchets.get(legacyKey);
    const nextVersion = input.expectedVersion + 1;
    let currentReady = false;
    let legacyReady = false;

    const apply = (): void => {
      if (!currentReady || !legacyReady) return;
      try {
        const useLegacy =
          currentRequest.result === undefined &&
          legacyRequest.result !== undefined;
        const raw = useLegacy
          ? legacyRequest.result
          : currentRequest.result;
        const current = decodeStoredRatchet(
          raw,
          input.localDeviceId,
        );
        assertRatchetVersion(
          current,
          input.expectedVersion,
        );
        ratchets.put(
          storedRatchetRecord({
            localDeviceId: input.localDeviceId,
            stateVersion: nextVersion,
            state: input.state,
            pendingX3dhInit: input.pendingX3dhInit,
          }),
          key,
        );
        if (useLegacy) {
          ratchets.delete(legacyKey);
        }
        if (input.plaintext) {
          tx.objectStore("plaintexts").put(
            input.plaintext,
            input.plaintext.messageId,
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
    legacyRequest.onsuccess = () => {
      legacyReady = true;
      apply();
    };
    const failRead = (request: IDBRequest): void => {
      failure =
        request.error ??
        new Error("Ratchet state could not be read");
      tx.abort();
    };
    currentRequest.onerror = () => failRead(currentRequest);
    legacyRequest.onerror = () => failRead(legacyRequest);
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
): Promise<T> {
  const runWithLease = (): Promise<T> =>
    withFallbackRatchetLease(key, fn);
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
): Promise<CoordinationLease | null> {
  const fence = await mutateRatchetLease<number | null>(
    key,
    (current) => {
      const acquired = acquireRatchetLeaseRecord({
        current,
        owner,
        now,
        leaseMs: RATCHET_LOCK_LEASE_MS,
        maxHoldMs: RATCHET_LOCK_MAX_HOLD_MS,
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

function ratchetStorageKey(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
): string {
  return [
    conversationId,
    localDeviceId,
    peerDeviceId,
  ].join(":");
}

function legacyRatchetStorageKey(
  conversationId: string,
  peerDeviceId: string,
): string {
  return `${conversationId}:${peerDeviceId}`;
}

function ratchetLockKey(input: {
  conversationId: string;
  localDeviceId: string;
  peerDeviceId: string;
}): string {
  return [
    "vimla-ratchet",
    input.conversationId,
    input.localDeviceId,
    input.peerDeviceId,
  ].join(":");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
