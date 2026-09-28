const KEYRING_DB_NAME = "vimla-e2ee-keyring";
const KEYRING_DB_VERSION = 1;
const KEYRING_STORE = "keys";
const WRAPPING_KEY_ID = "local-wrap-v1";
const PROTECTED_PREFIX = "vimla-protected:v1:";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class LocalE2eeProtectionError extends Error {
  constructor(message = "Protected local E2EE payload is invalid") {
    super(message);
    this.name = "LocalE2eeProtectionError";
  }
}

interface ProtectedPayloadV1 {
  v: 1;
  iv: string;
  ciphertext: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(
  value: string,
): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new LocalE2eeProtectionError();
  }
}

function openKeyring(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      KEYRING_DB_NAME,
      KEYRING_DB_VERSION,
    );
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYRING_STORE)) {
        db.createObjectStore(KEYRING_STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error("E2EE keyring is unavailable"),
      );
    request.onblocked = () =>
      reject(
        new Error(
          "E2EE keyring upgrade is blocked by another browser context",
        ),
      );
  });
}

async function generateWrappingKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  if (!(key instanceof CryptoKey)) {
    throw new Error("E2EE wrapping key generation failed");
  }
  return key;
}

async function localWrappingKey(): Promise<CryptoKey> {
  const candidate = await generateWrappingKey();
  const db = await openKeyring();
  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction(KEYRING_STORE, "readwrite");
      const store = tx.objectStore(KEYRING_STORE);
      const request = store.get(WRAPPING_KEY_ID);
      let selected: CryptoKey | null = null;
      request.onsuccess = () => {
        const current = request.result;
        if (current instanceof CryptoKey) {
          selected = current;
          return;
        }
        if (current !== undefined) {
          tx.abort();
          reject(
            new LocalE2eeProtectionError(
              "Persisted E2EE wrapping key is invalid",
            ),
          );
          return;
        }
        selected = candidate;
        store.put(candidate, WRAPPING_KEY_ID);
      };
      request.onerror = () => {
        reject(
          request.error ??
            new Error("E2EE wrapping key read failed"),
        );
      };
      tx.oncomplete = () => {
        if (!selected) {
          reject(
            new Error("E2EE wrapping key transaction was incomplete"),
          );
          return;
        }
        resolve(selected);
      };
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error("E2EE wrapping key transaction aborted"),
        );
      tx.onerror = () => undefined;
    });
  } finally {
    db.close();
  }
}

export function isProtectedLocalString(
  value: string,
): boolean {
  return value.startsWith(PROTECTED_PREFIX);
}

export async function protectLocalString(
  plaintext: string,
  aad: string,
): Promise<string> {
  const key = await localWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(aad),
      tagLength: 128,
    },
    key,
    encoder.encode(plaintext),
  );
  const payload: ProtectedPayloadV1 = {
    v: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(
      new Uint8Array(encrypted),
    ),
  };
  return `${PROTECTED_PREFIX}${bytesToBase64(
    encoder.encode(JSON.stringify(payload)),
  )}`;
}

export async function unprotectLocalString(
  value: string,
  aad: string,
): Promise<string> {
  if (!isProtectedLocalString(value)) {
    throw new LocalE2eeProtectionError();
  }

  try {
    const encoded = value.slice(PROTECTED_PREFIX.length);
    const parsed: unknown = JSON.parse(
      decoder.decode(base64ToBytes(encoded)),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new LocalE2eeProtectionError();
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.v !== 1 ||
      typeof record.iv !== "string" ||
      typeof record.ciphertext !== "string"
    ) {
      throw new LocalE2eeProtectionError();
    }
    const key = await localWrappingKey();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
        additionalData: encoder.encode(aad),
        tagLength: 128,
      },
      key,
      base64ToBytes(record.ciphertext),
    );
    return decoder.decode(decrypted);
  } catch (error: unknown) {
    if (error instanceof LocalE2eeProtectionError) {
      throw error;
    }
    throw new LocalE2eeProtectionError();
  }
}

export async function protectLocalJson(
  value: unknown,
  aad: string,
): Promise<string> {
  return protectLocalString(JSON.stringify(value), aad);
}

export async function unprotectLocalJson(
  value: string,
  aad: string,
): Promise<unknown> {
  const plaintext = await unprotectLocalString(value, aad);
  try {
    return JSON.parse(plaintext) as unknown;
  } catch {
    throw new LocalE2eeProtectionError();
  }
}

export async function clearLocalProtectionKey(): Promise<void> {
  await deleteIndexedDb(KEYRING_DB_NAME);
}

export async function deleteIndexedDb(
  name: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            "IndexedDB deletion remained blocked",
          ),
        );
      }
    }, 5_000);
    const finish = (
      result: () => void,
    ): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      result();
    };
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () =>
      finish(resolve);
    request.onerror = () =>
      finish(() =>
        reject(
          request.error ??
            new Error("IndexedDB deletion failed"),
        ),
      );
    request.onblocked = () => {
      // Existing Direct Chat transactions are short-lived and close their
      // connection. Keep waiting for the browser to finish deletion.
    };
  });
}

export const LOCAL_E2EE_KEYRING_DB_NAME =
  KEYRING_DB_NAME;
