import { bytesToB64, b64ToBytes, type IdentityKeyPair, type SerializedRatchetState } from "@vimla/e2ee";

const DB_NAME = "vimla-direct-e2ee";
const DB_VERSION = 2;

export interface StoredDeviceMaterial {
  deviceId: string;
  identity: {
    ed25519Secret: string;
    ed25519Public: string;
    x25519Secret: string;
    x25519Public: string;
  };
  signedPrekeys: Record<string, { secret: string; publicKey: string; signature: string }>;
  oneTimePrekeys: Record<string, { secret: string; publicKey: string }>;
}

export interface StoredPlaintext {
  conversationId: string;
  messageId: string;
  text: string;
  kind: string;
  senderUserId: string;
  createdAt: string;
}

function accountKey(accountId: string, key: string): string {
  return `${accountId}:${key}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("device")) {
        db.createObjectStore("device");
      }
      if (!db.objectStoreNames.contains("ratchets")) {
        db.createObjectStore("ratchets");
      }
      if (!db.objectStoreNames.contains("plaintexts")) {
        db.createObjectStore("plaintexts");
      }
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const tx = request.transaction;
        tx?.objectStore("device").clear();
        tx?.objectStore("ratchets").clear();
        tx?.objectStore("plaintexts").clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(
  storeName: "device" | "ratchets" | "plaintexts",
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
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    };
  });
}

export async function loadDeviceMaterial(accountId: string): Promise<StoredDeviceMaterial | null> {
  const value = await withStore<StoredDeviceMaterial | undefined>("device", "readonly", (store) => store.get(accountKey(accountId, "local")));
  return value ?? null;
}

export async function saveDeviceMaterial(accountId: string, material: StoredDeviceMaterial): Promise<void> {
  await withStore("device", "readwrite", (store) => {
    store.put(material, accountKey(accountId, "local"));
  });
}

export async function loadRatchet(accountId: string, conversationId: string, peerDeviceId: string): Promise<SerializedRatchetState | null> {
  const value = await withStore<SerializedRatchetState | undefined>(
    "ratchets",
    "readonly",
    (store) => store.get(accountKey(accountId, `${conversationId}:${peerDeviceId}`)),
  );
  return value ?? null;
}

export async function saveRatchet(
  accountId: string,
  conversationId: string,
  peerDeviceId: string,
  state: SerializedRatchetState,
): Promise<void> {
  await withStore("ratchets", "readwrite", (store) => {
    store.put(state, accountKey(accountId, `${conversationId}:${peerDeviceId}`));
  });
}

export async function loadPlaintext(accountId: string, messageId: string): Promise<StoredPlaintext | null> {
  const value = await withStore<StoredPlaintext | undefined>("plaintexts", "readonly", (store) => store.get(accountKey(accountId, messageId)));
  return value ?? null;
}

export async function savePlaintext(accountId: string, row: StoredPlaintext): Promise<void> {
  await withStore("plaintexts", "readwrite", (store) => {
    store.put(row, accountKey(accountId, row.messageId));
  });
}

export async function clearAccountSensitiveState(accountId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["device", "ratchets", "plaintexts"], "readwrite");
    const range = IDBKeyRange.bound(`${accountId}:`, `${accountId}:\uffff`);
    for (const name of ["device", "ratchets", "plaintexts"] as const) {
      tx.objectStore(name).delete(range);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("IndexedDB cleanup failed")); };
  });
}

export function identityFromMaterial(material: StoredDeviceMaterial): IdentityKeyPair {
  return {
    ed25519Secret: b64ToBytes(material.identity.ed25519Secret),
    ed25519Public: b64ToBytes(material.identity.ed25519Public),
    x25519Secret: b64ToBytes(material.identity.x25519Secret),
    x25519Public: b64ToBytes(material.identity.x25519Public),
  };
}

export function encodeIdentity(identity: IdentityKeyPair): StoredDeviceMaterial["identity"] {
  return {
    ed25519Secret: bytesToB64(identity.ed25519Secret),
    ed25519Public: bytesToB64(identity.ed25519Public),
    x25519Secret: bytesToB64(identity.x25519Secret),
    x25519Public: bytesToB64(identity.x25519Public),
  };
}
