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
  // Keep an in-memory fail-closed latch even when shared storage succeeds.
  // If localStorage later becomes unavailable in this tab, revocation must
  // not silently downgrade back to "active".
  fallbackRevoked = true;
  const storage = browserSharedStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(REVOCATION_LATCH_KEY, "1");
  } catch {
    // The in-memory latch remains authoritative in this runtime.
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
