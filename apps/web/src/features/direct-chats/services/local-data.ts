import {
  AuthRequiredError,
} from "../../auth/services/current-user";
import {
  DirectChatsApiError,
  revokeCryptoDevice,
} from "./api";
import {
  clearLocalE2eeData,
  loadDeviceMaterial,
} from "./crypto-store";
import {
  clearLocalDeviceRevocationLatch,
  markLocalDeviceRevoked,
} from "./revocation-state";

export interface LocalDirectChatCleanupResult {
  remoteDeviceRevoked: boolean;
}

function isExpectedRevokeFailure(
  error: unknown,
): boolean {
  return (
    error instanceof AuthRequiredError ||
    (error instanceof DirectChatsApiError &&
      (error.code === "direct_chat_device_revoked" ||
        error.code === "not_found"))
  );
}

export async function clearLocalDirectChatData(
  options: {
    revokeCurrentDevice?: boolean;
    preserveRevocationLatch?: boolean;
  } = {},
): Promise<LocalDirectChatCleanupResult> {
  let remoteDeviceRevoked = false;
  let localDevice:
    | Awaited<ReturnType<typeof loadDeviceMaterial>>
    | null = null;

  if (options.revokeCurrentDevice) {
    try {
      localDevice = await loadDeviceMaterial();
    } catch {
      // A corrupt/unavailable local store must not prevent an intentional
      // privacy wipe. Remote revoke is best-effort when the device id cannot
      // be recovered locally.
    }
  }

  // Freeze every browser tab before any network wait or deletion. A stale
  // recovery/bootstrap task must not mutate or recreate E2EE storage once
  // destructive cleanup has begun.
  markLocalDeviceRevoked();

  if (
    options.revokeCurrentDevice &&
    localDevice &&
    localDevice.registrationState === "REGISTERED"
  ) {
    try {
      await revokeCryptoDevice(localDevice.deviceId);
      remoteDeviceRevoked = true;
    } catch (error: unknown) {
      if (!isExpectedRevokeFailure(error)) {
        remoteDeviceRevoked = false;
      }
    }
  }

  // Local privacy wins over a failed network revoke. H05 owns durable
  // device lifecycle/recovery; H02 must not leave keys/plaintext behind
  // merely because the server is unreachable during logout/local wipe.
  await clearLocalE2eeData();
  if (!options.preserveRevocationLatch) {
    clearLocalDeviceRevocationLatch();
  }

  return { remoteDeviceRevoked };
}

export async function clearLocalDataAfterDeviceRevocation(): Promise<void> {
  markLocalDeviceRevoked();
  await clearLocalE2eeData();
}

export function releaseLocalDirectChatRevocationLatch(): void {
  clearLocalDeviceRevocationLatch();
}
