const REVOCATION_LATCH_KEY =
  "vimla:e2ee:current-device-revoked";

let fallbackRevoked = false;

function browserSharedStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function markLocalDeviceRevoked(): void {
  const storage = browserSharedStorage();
  if (!storage) {
    fallbackRevoked = true;
    return;
  }
  try {
    storage.setItem(REVOCATION_LATCH_KEY, "1");
    fallbackRevoked = false;
  } catch {
    fallbackRevoked = true;
  }
}

export function clearLocalDeviceRevocationLatch(): void {
  fallbackRevoked = false;
  try {
    browserSharedStorage()?.removeItem(
      REVOCATION_LATCH_KEY,
    );
  } catch {
    // Intentional local clear still resets this runtime's fallback latch.
  }
}

export function isLocalDeviceRevoked(): boolean {
  const storage = browserSharedStorage();
  if (!storage) {
    return fallbackRevoked;
  }
  try {
    return (
      fallbackRevoked ||
      storage.getItem(REVOCATION_LATCH_KEY) === "1"
    );
  } catch {
    return fallbackRevoked;
  }
}
