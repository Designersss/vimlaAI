-- MSG-03: Bound the cost of resolving signing identities for revoked
-- devices which have authored ciphertext in this conversation. No
-- plaintext, E2EE keys, or metadata beyond existing sender-device IDs.
CREATE INDEX "direct_message_conversationId_senderDeviceId_idx"
  ON "direct_message"("conversationId", "senderDeviceId");
