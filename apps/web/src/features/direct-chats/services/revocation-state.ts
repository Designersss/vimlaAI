const REVOCATION_LATCH_KEY =
  "vimla:e2ee:current-device-revoked";

let revokedInMemory = false;

function browserSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function markLocalDeviceRevoked(): void {
  revokedInMemory = true;
  try {
    browserSessionStorage()?.setItem(
      REVOCATION_LATCH_KEY,
      "1",
    );
  } catch {
    // The in-memory latch still prevents re-enrollment in this runtime.
  }
}

export function clearLocalDeviceRevocationLatch(): void {
  revokedInMemory = false;
  try {
    browserSessionStorage()?.removeItem(
      REVOCATION_LATCH_KEY,
    );
  } catch {
    // Session storage is best-effort metadata, never key material.
  }
}

export function isLocalDeviceRevoked(): boolean {
  if (revokedInMemory) {
    return true;
  }
  try {
    return (
      browserSessionStorage()?.getItem(
        REVOCATION_LATCH_KEY,
      ) === "1"
    );
  } catch {
    return false;
  }
}
