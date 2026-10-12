import type { DirectConversationView, DirectMessageView } from "@vimla/contracts";

/**
 * Signed-envelope verification directory. Historic revoked senders still
 * need BOTH public identity keys to authenticate their original X3DH
 * handshake. Neither key grants eligibility for NEW recipient fan-out.
 *
 * The directory is server supplied. Malicious-server substitutions still
 * require peer verification and key transparency (#54).
 */
export interface DirectSenderIdentity {
  identityEd25519Public: string;
  identityX25519Public: string;
}

export function directSenderVerificationKeys(
  detail: Pick<DirectConversationView, "devices" | "historicalSenderIdentities">,
): ReadonlyMap<string, DirectSenderIdentity> {
  const keys = new Map<string, DirectSenderIdentity>();

  for (const device of detail.devices) {
    if (device.revoked || keys.has(device.id)) {
      throw new Error("Invalid active Direct sender identity directory");
    }
    keys.set(device.id, {
      identityEd25519Public: device.identityEd25519Public,
      identityX25519Public: device.identityX25519Public,
    });
  }
  for (const sender of detail.historicalSenderIdentities) {
    // Historical keys are verification-only; never adopt them as
    // active peer devices or trust conflicting duplicate identities.
    if (keys.has(sender.deviceId)) {
      throw new Error("Conflicting Direct sender identity directory");
    }
    keys.set(sender.deviceId, {
      identityEd25519Public: sender.identityEd25519Public,
      identityX25519Public: sender.identityX25519Public,
    });
  }
  return keys;
}

/**
 * PRE-RATCHET immutable identity consistency check. A signature can
 * authenticate a sender-chosen X3DH header, yet the sender may claim
 * X25519 identity bytes different from the key advertised for the same
 * device in the authoritative directory. Verify the complete page before
 * committing ANY Double Ratchet state, not only each message in turn.
 *
 * Unknown sender devices are not trusted: the Web decryptor receives no
 * Ed25519 key for them and must leave their ciphertext unavailable.
 * They may legitimately arise during an outdated device-roster fetch.
 */
export function hasConflictingDirectX3dhSenderIdentity(
  messages: readonly DirectMessageView[],
  keys: ReadonlyMap<string, DirectSenderIdentity>,
): boolean {
  return messages.some((message) => {
    const header = message.envelope?.x3dhInit;
    if (!header) return false;
    const expected = keys.get(message.senderDeviceId);
    return expected !== undefined &&
      (header.identityEd25519Public !== expected.identityEd25519Public ||
       header.identityX25519Public !== expected.identityX25519Public);
  });
}
