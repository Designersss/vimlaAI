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
const DB_VERSION = 3;
const PLAINTEXT_CONVERSATION_TIME_INDEX = "conversation-created-at";
const RATCHET_LOCK_LEASE_MS = 5_000;
const RATCHET_LOCK_HEARTBEAT_MS = 1_000;
const RATCHET_LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
const RATCHET_LOCK_POLL_MS = 40;

type StoreName =
  | "device"
  | "ratchets"
  | "ratchetLocks"
  | "plaintexts";

export interface StoredDeviceMaterial {
  deviceId: string;
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

export async function loadRatchet(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
): Promise<RatchetSnapshot | null> {
  const value = await withStore<unknown>(
    "ratchets",
    "readonly",
    (store) => store.get(ratchetStorageKey(conversationId, peerDeviceId)),
  );
  return decodeStoredRatchet(value, localDeviceId);
}

export async function saveRatchet(
  conversationId: string,
  localDeviceId: string,
  peerDeviceId: string,
  expectedVersion: number,
  state: SerializedRatchetState,
  pendingX3dhInit: X3dhInitHeader | null,
): Promise<RatchetSnapshot> {
  return commitRatchet({
    conversationId,
    localDeviceId,
    peerDeviceId,
    expectedVersion,
    state,
    pendingX3dhInit,
  });
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
  const key = ratchetLockKey(input);
  if (
    typeof navigator !== "undefined" &&
    navigator.locks
  ) {
    return navigator.locks.request(
      key,
      { mode: "exclusive" },
      async () => fn(),
    );
  }
  return withFallbackRatchetLease(key, fn);
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

export async function savePlaintext(
  row: StoredPlaintext,
): Promise<void> {
  await withStore("plaintexts", "readwrite", (store) => {
    store.put(row, row.messageId);
  });
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
      input.peerDeviceId,
    );
    const currentRequest = ratchets.get(key);
    const nextVersion = input.expectedVersion + 1;

    currentRequest.onsuccess = () => {
      try {
        const current = decodeStoredRatchet(
          currentRequest.result,
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
    currentRequest.onerror = () => {
      failure =
        currentRequest.error ??
        new Error("Ratchet state could not be read");
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
