import type { DirectConversationView } from "@vimla/contracts";

/**
 * Build a trusted-directory lookup for verifying the signatures of existing
 * encrypted Direct messages. Active delivery devices and revoked historical
 * senders are different capabilities: historical keys must NEVER become
 * eligible recipients for new X3DH or signed message fan-out.
 *
 * A valid signed envelope is NOT itself a trusted identity directory: do
 * not learn the verification key from the same unauthenticated X3DH init
 * header that the key will be used to verify.
 *
 * The directory is still supplied by Vimla's server. Detecting a
 * malicious server substituting keys requires separate key verification
 * and transparency (#54).
 */
export function directSenderVerificationKeys(
  detail: Pick<DirectConversationView, "devices" | "historicalSenderIdentities">,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();

  for (const device of detail.devices) {
    if (device.revoked || keys.has(device.id)) {
      throw new Error("Invalid active Direct sender identity directory");
    }
    keys.set(device.id, device.identityEd25519Public);
  }
  for (const sender of detail.historicalSenderIdentities) {
    // A historical sender is revoked and must NOT be duplicated as an
    // active device (or represented with contradictory signing keys).
    if (keys.has(sender.deviceId)) {
      throw new Error("Conflicting Direct sender identity directory");
    }
    keys.set(sender.deviceId, sender.identityEd25519Public);
  }
  return keys;
}
