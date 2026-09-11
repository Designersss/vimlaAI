-- Phase 9: Secure Direct Chats + Contextual @Vimla. Additive only.
-- Server stores ciphertext, public device material and metadata. No message plaintext.

ALTER TABLE "operator_run"
    ADD COLUMN "invocationScope" TEXT NOT NULL DEFAULT 'PERSONAL',
    ADD COLUMN "directConversationId" TEXT,
    ADD COLUMN "contextOwnIncluded" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "contextPeerIncluded" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "contextPeerDenied" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "operator_run"
    ADD CONSTRAINT "operator_run_invocation_scope_chk"
    CHECK ("invocationScope" IN ('PERSONAL', 'DIRECT_CHAT'));

ALTER TABLE "workspace_task"
    ADD COLUMN "assignedByUserId" TEXT,
    ADD COLUMN "assignmentSourceType" TEXT,
    ADD COLUMN "assignmentSourceId" TEXT;

CREATE TABLE "user_crypto_device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityEd25519Public" TEXT NOT NULL,
    "identityX25519Public" TEXT NOT NULL,
    "signedPrekeyId" INTEGER NOT NULL,
    "signedPrekeyPublic" TEXT NOT NULL,
    "signedPrekeySignature" TEXT NOT NULL,
    "label" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_crypto_device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_one_time_prekey" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_one_time_prekey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_conversation" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_conversation_member" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "lastReadMessageCreatedAt" TIMESTAMP(3),
    "shareOwnHistoryWithVimla" BOOLEAN NOT NULL DEFAULT false,
    "includePeerHistoryWhenInvoking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_conversation_member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_message_kind_chk" CHECK ("kind" IN ('HUMAN', 'OPERATOR_INVOKE', 'OPERATOR_RESPONSE', 'OPERATOR_ACTION'))
);

CREATE TABLE "direct_message_envelope" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "headerB64" TEXT NOT NULL,
    "ciphertextB64" TEXT NOT NULL,
    "dhPublicB64" TEXT NOT NULL,
    "messageNumber" INTEGER NOT NULL,
    "previousChainLength" INTEGER NOT NULL,
    "senderSignatureB64" TEXT NOT NULL,
    "x3dhInitJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_envelope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_message_envelope_ciphertext_chk" CHECK (char_length("ciphertextB64") >= 16)
);

CREATE UNIQUE INDEX "direct_conversation_pairKey_key" ON "direct_conversation"("pairKey");
CREATE INDEX "direct_conversation_lastMessageAt_idx" ON "direct_conversation"("lastMessageAt");

CREATE INDEX "user_crypto_device_userId_revokedAt_idx" ON "user_crypto_device"("userId", "revokedAt");
CREATE UNIQUE INDEX "direct_one_time_prekey_deviceId_keyId_key" ON "direct_one_time_prekey"("deviceId", "keyId");
CREATE INDEX "direct_one_time_prekey_deviceId_consumedAt_idx" ON "direct_one_time_prekey"("deviceId", "consumedAt");

CREATE UNIQUE INDEX "direct_conversation_member_conversationId_userId_key" ON "direct_conversation_member"("conversationId", "userId");
CREATE INDEX "direct_conversation_member_userId_lastReadAt_idx" ON "direct_conversation_member"("userId", "lastReadAt");

CREATE UNIQUE INDEX "direct_message_conversationId_senderUserId_clientMessageId_key" ON "direct_message"("conversationId", "senderUserId", "clientMessageId");
CREATE INDEX "direct_message_conversationId_createdAt_idx" ON "direct_message"("conversationId", "createdAt");
CREATE INDEX "direct_message_senderDeviceId_createdAt_idx" ON "direct_message"("senderDeviceId", "createdAt");

CREATE UNIQUE INDEX "direct_message_envelope_messageId_recipientDeviceId_key" ON "direct_message_envelope"("messageId", "recipientDeviceId");
CREATE UNIQUE INDEX "direct_message_envelope_replay_key" ON "direct_message_envelope"("senderDeviceId", "recipientDeviceId", "dhPublicB64", "messageNumber");
CREATE INDEX "direct_message_envelope_recipientDeviceId_createdAt_idx" ON "direct_message_envelope"("recipientDeviceId", "createdAt");

CREATE INDEX "operator_run_directConversationId_createdAt_idx" ON "operator_run"("directConversationId", "createdAt");
CREATE INDEX "workspace_task_assignedByUserId_idx" ON "workspace_task"("assignedByUserId");

ALTER TABLE "user_crypto_device" ADD CONSTRAINT "user_crypto_device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_one_time_prekey" ADD CONSTRAINT "direct_one_time_prekey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "user_crypto_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_member" ADD CONSTRAINT "direct_conversation_member_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "direct_conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_member" ADD CONSTRAINT "direct_conversation_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "direct_conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "user_crypto_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_message_envelope" ADD CONSTRAINT "direct_message_envelope_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "direct_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_message_envelope" ADD CONSTRAINT "direct_message_envelope_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "user_crypto_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operator_run" ADD CONSTRAINT "operator_run_directConversationId_fkey" FOREIGN KEY ("directConversationId") REFERENCES "direct_conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_task" ADD CONSTRAINT "workspace_task_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
