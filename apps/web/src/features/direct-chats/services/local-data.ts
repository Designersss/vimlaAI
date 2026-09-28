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

  if (options.revokeCurrentDevice) {
    try {
      const localDevice = await loadDeviceMaterial();
      if (
        localDevice &&
        localDevice.registrationState === "REGISTERED"
      ) {
        await revokeCryptoDevice(localDevice.deviceId);
        remoteDeviceRevoked = true;
      }
    } catch (error: unknown) {
      if (!isExpectedRevokeFailure(error)) {
        remoteDeviceRevoked = false;
      }
    }
  }

  // Freeze every browser tab before deleting the shared origin stores.
  // This prevents a stale recovery/bootstrap task from recreating storage
  // while an intentional wipe is in progress.
  markLocalDeviceRevoked();

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
