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
  options: { revokeCurrentDevice?: boolean } = {},
): Promise<LocalDirectChatCleanupResult> {
  let remoteDeviceRevoked = false;
  let revokeFailure: unknown = null;

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
        revokeFailure = error;
      }
    }
  }

  // Local privacy wins over a failed network revoke. H05 owns durable
  // device lifecycle/recovery; H02 must not leave keys/plaintext behind
  // merely because the server is unreachable during logout/local wipe.
  await clearLocalE2eeData();

  if (revokeFailure) {
    throw new Error(
      "Local Direct Chat data was cleared, but the remote device could not be revoked",
      { cause: revokeFailure },
    );
  }

  return { remoteDeviceRevoked };
}

export async function clearLocalDataAfterDeviceRevocation(): Promise<void> {
  await clearLocalE2eeData();
}
