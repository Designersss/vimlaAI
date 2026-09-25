import type {
  DirectMessageKind,
  MessageMentionInput,
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
  assertRatchetVersion,
  canAcquireRatchetLease,
  decodeStoredRatchet,
  isRatchetLeaseRecord,
  storedRatchetRecord,
  type RatchetSnapshot,
} from "./ratchet-coordination";

const DB_NAME = "vimla-direct-e2ee";
const DB_VERSION = 4;
const PLAINTEXT_CONVERSATION_TIME_INDEX = "conversation-created-at";
const RATCHET_LOCK_LEASE_MS = 5_000;
const RATCHET_LOCK_HEARTBEAT_MS = 1_000;
const RATCHET_LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
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
  prekeyStatusCheckedAt?: string;
  pendingOneTimePrekeyIds?: number[];
  nextOneTimePrekeyId?: number;
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
}

export interface OutboundRatchetUpdate {
  peerDeviceId: string;
  expectedVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
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
): Promise<void> {
  await withStore("device", "readwrite", (store) => {
    store.put(material, "local");
  });
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
    tx.objectStore("pendingSends").delete(
      input.pending.clientMessageId,
    );
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
  consumedOneTimePrekeyId: number | null;
  plaintext: StoredPlaintext;
}): Promise<RatchetSnapshot> {
  return commitRatchet(input);
}

export async function commitOutboundRatchets(input: {
  conversationId: string;
  localDeviceId: string;
  updates: OutboundRatchetUpdate[];
  pendingSend: StoredPendingSend;
}): Promise<boolean> {
  if (input.updates.length === 0) {
    throw new Error("Outbound ratchet update set is empty");
  }
  if (
    new Set(input.updates.map((update) => update.peerDeviceId))
      .size !== input.updates.length
  ) {
    throw new Error("Outbound ratchet update set contains duplicates");
  }

  const selfConsumedOneTimePrekeyIds = [
    ...new Set(
      input.updates
        .filter(
          (update) =>
            update.peerDeviceId === input.localDeviceId,
        )
        .map(
          (update) =>
            update.pendingX3dhInit?.oneTimePrekeyId ??
            null,
        )
        .filter((id): id is number => id !== null),
    ),
  ];
  const db = await openDb();
  return new Promise<boolean>((resolve, reject) => {
    let failure: Error | null = null;
    const stores: StoreName[] = [
      "ratchets",
      "pendingSends",
    ];
    if (selfConsumedOneTimePrekeyIds.length > 0) {
      stores.push("device");
    }
    const tx = db.transaction(stores, "readwrite");
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
    const deviceRequest =
      selfConsumedOneTimePrekeyIds.length > 0
        ? tx.objectStore("device").get("local")
        : null;
    let deviceReady = deviceRequest === null;

    const apply = (): void => {
      if (
        !deviceReady ||
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
        if (deviceRequest) {
          const material =
            deviceRequest.result as
              | StoredDeviceMaterial
              | undefined;
          if (
            !material ||
            material.deviceId !== input.localDeviceId
          ) {
            throw new Error(
              "Local E2EE device state is invalid",
            );
          }
          const oneTimePrekeys = {
            ...material.oneTimePrekeys,
          };
          for (const id of selfConsumedOneTimePrekeyIds) {
            delete oneTimePrekeys[String(id)];
          }
          tx.objectStore("device").put(
            {
              ...material,
              oneTimePrekeys,
              prekeyStatusCheckedAt: undefined,
            } satisfies StoredDeviceMaterial,
            "local",
          );
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

    if (deviceRequest) {
      deviceRequest.onsuccess = () => {
        deviceReady = true;
        apply();
      };
      deviceRequest.onerror = () => {
        failure =
          deviceRequest.error ??
          new Error("Local E2EE device state could not be read");
        tx.abort();
      };
    }

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
      resolve(selfConsumedOneTimePrekeyIds.length > 0);
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
  fn: () => Promise<T>,
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
  consumedOneTimePrekeyId?: number | null;
  plaintext?: StoredPlaintext;
}): Promise<RatchetSnapshot> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    const stores: StoreName[] = ["ratchets"];
    if (input.plaintext) stores.push("plaintexts");
    if (input.consumedOneTimePrekeyId !== null &&
        input.consumedOneTimePrekeyId !== undefined) {
      stores.push("device");
    }
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
    const consumedOneTimePrekeyId =
      input.consumedOneTimePrekeyId ?? null;
    const deviceRequest =
      consumedOneTimePrekeyId === null
        ? null
        : tx.objectStore("device").get("local");
    let deviceReady = deviceRequest === null;

    const apply = (): void => {
      if (!currentReady || !legacyReady || !deviceReady) return;
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
        if (
          deviceRequest &&
          consumedOneTimePrekeyId !== null
        ) {
          const material =
            deviceRequest.result as
              | StoredDeviceMaterial
              | undefined;
          if (
            !material ||
            material.deviceId !== input.localDeviceId ||
            !material.oneTimePrekeys[
              String(consumedOneTimePrekeyId)
            ]
          ) {
            throw new Error(
              "Consumed local E2EE prekey material is missing",
            );
          }
          const oneTimePrekeys = {
            ...material.oneTimePrekeys,
          };
          delete oneTimePrekeys[
            String(consumedOneTimePrekeyId)
          ];
          tx.objectStore("device").put(
            {
              ...material,
              oneTimePrekeys,
              prekeyStatusCheckedAt: undefined,
            } satisfies StoredDeviceMaterial,
            "local",
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
    if (deviceRequest) {
      deviceRequest.onsuccess = () => {
        deviceReady = true;
        apply();
      };
      deviceRequest.onerror = () => {
        failure =
          deviceRequest.error ??
          new Error("Local E2EE device state could not be read");
        tx.abort();
      };
    }
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
  fn: () => Promise<T>,
): Promise<T> {
  const runWithLease = (): Promise<T> =>
    withFallbackRatchetLease(key, fn);
  if (
    typeof navigator !== "undefined" &&
    navigator.locks
  ) {
    return navigator.locks.request(
      key,
      { mode: "exclusive" },
      runWithLease,
    );
  }
  return runWithLease();
}

async function withFallbackRatchetLease<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const owner = crypto.randomUUID();
  const deadline =
    Date.now() + RATCHET_LOCK_ACQUIRE_TIMEOUT_MS;
  let acquired = false;
  while (!acquired) {
    acquired = await tryAcquireRatchetLease(
      key,
      owner,
      Date.now(),
    );
    if (acquired) break;
    if (Date.now() >= deadline) {
      throw new RatchetLockLostError();
    }
    await delay(RATCHET_LOCK_POLL_MS);
  }

  let lost = false;
  let renewing = false;
  const heartbeat = globalThis.setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    void renewRatchetLease(key, owner, Date.now())
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
    const result = await fn();
    if (lost) {
      throw new RatchetLockLostError();
    }
    return result;
  } finally {
    globalThis.clearInterval(heartbeat);
    await releaseRatchetLease(key, owner).catch(
      () => undefined,
    );
  }
}

async function tryAcquireRatchetLease(
  key: string,
  owner: string,
  now: number,
): Promise<boolean> {
  return mutateRatchetLease(key, (current) => {
    if (!canAcquireRatchetLease(current, owner, now)) {
      return { changed: false, value: false };
    }
    return {
      changed: true,
      value: true,
      next: {
        owner,
        expiresAt: now + RATCHET_LOCK_LEASE_MS,
      },
    };
  });
}

async function renewRatchetLease(
  key: string,
  owner: string,
  now: number,
): Promise<boolean> {
  return mutateRatchetLease(key, (current) => {
    if (!current || current.owner !== owner) {
      return { changed: false, value: false };
    }
    return {
      changed: true,
      value: true,
      next: {
        owner,
        expiresAt: now + RATCHET_LOCK_LEASE_MS,
      },
    };
  });
}

async function releaseRatchetLease(
  key: string,
  owner: string,
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
      if (current?.owner === owner) {
        store.delete(key);
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
    current: {
      owner: string;
      expiresAt: number;
    } | null,
  ) =>
    | { changed: false; value: T }
    | {
        changed: true;
        value: T;
        next: { owner: string; expiresAt: number };
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
