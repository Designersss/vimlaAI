import { bytesToB64, b64ToBytes, type IdentityKeyPair, type SerializedRatchetState } from "@vimla/e2ee";

const DB_NAME = "vimla-direct-e2ee";
const DB_VERSION = 2;
const PLAINTEXT_CONVERSATION_TIME_INDEX = "conversation-created-at";

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("device")) {
        db.createObjectStore("device");
      }
      if (!db.objectStoreNames.contains("ratchets")) {
        db.createObjectStore("ratchets");
      }
      const plaintexts = db.objectStoreNames.contains("plaintexts")
        ? request.transaction?.objectStore("plaintexts")
        : db.createObjectStore("plaintexts");
      if (
        plaintexts &&
        !plaintexts.indexNames.contains(PLAINTEXT_CONVERSATION_TIME_INDEX)
      ) {
        plaintexts.createIndex(
          PLAINTEXT_CONVERSATION_TIME_INDEX,
          ["conversationId", "createdAt"],
          { unique: false },
        );
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

export async function loadDeviceMaterial(): Promise<StoredDeviceMaterial | null> {
  const value = await withStore<StoredDeviceMaterial | undefined>("device", "readonly", (store) => store.get("local"));
  return value ?? null;
}

export async function saveDeviceMaterial(material: StoredDeviceMaterial): Promise<void> {
  await withStore("device", "readwrite", (store) => {
    store.put(material, "local");
  });
}

export async function loadRatchet(conversationId: string, peerDeviceId: string): Promise<SerializedRatchetState | null> {
  const value = await withStore<SerializedRatchetState | undefined>(
    "ratchets",
    "readonly",
    (store) => store.get(`${conversationId}:${peerDeviceId}`),
  );
  return value ?? null;
}

export async function saveRatchet(
  conversationId: string,
  peerDeviceId: string,
  state: SerializedRatchetState,
): Promise<void> {
  await withStore("ratchets", "readwrite", (store) => {
    store.put(state, `${conversationId}:${peerDeviceId}`);
  });
}

export async function loadPlaintext(messageId: string): Promise<StoredPlaintext | null> {
  const value = await withStore<StoredPlaintext | undefined>("plaintexts", "readonly", (store) => store.get(messageId));
  return value ?? null;
}

export async function savePlaintext(row: StoredPlaintext): Promise<void> {
  await withStore("plaintexts", "readwrite", (store) => {
    store.put(row, row.messageId);
  });
}

export async function loadConversationPlaintexts(
  conversationId: string,
  limit = 256,
): Promise<StoredPlaintext[]> {
  const boundedLimit = Math.max(1, Math.min(512, Math.trunc(limit)));
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const rows: StoredPlaintext[] = [];
    const tx = db.transaction("plaintexts", "readonly");
    const store = tx.objectStore("plaintexts");
    const index = store.index(PLAINTEXT_CONVERSATION_TIME_INDEX);
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
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    };
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
