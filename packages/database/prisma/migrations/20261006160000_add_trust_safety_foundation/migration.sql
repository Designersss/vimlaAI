CREATE TABLE "user_block" (
  "id" UUID NOT NULL,
  "blockerUserId" TEXT NOT NULL,
  "blockedUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_block_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_block_no_self_check" CHECK ("blockerUserId" <> "blockedUserId"),
  CONSTRAINT "user_block_blocker_fkey"
    FOREIGN KEY ("blockerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_block_blocked_fkey"
    FOREIGN KEY ("blockedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_block_blockerUserId_blockedUserId_key"
  ON "user_block"("blockerUserId", "blockedUserId");
CREATE INDEX "user_block_blockedUserId_createdAt_idx"
  ON "user_block"("blockedUserId", "createdAt");
CREATE INDEX "user_block_blockerUserId_createdAt_idx"
  ON "user_block"("blockerUserId", "createdAt");

CREATE TABLE "abuse_report" (
  "id" UUID NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "evidenceKind" TEXT NOT NULL DEFAULT 'NONE',
  "directConversationId" TEXT,
  "directMessageId" TEXT,
  "evidenceSenderUserId" TEXT,
  "evidenceSenderDeviceId" TEXT,
  "evidenceMessageKind" TEXT,
  "evidenceMessageCreatedAt" TIMESTAMP(3),
  "evidenceText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "abuse_report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "abuse_report_not_self_check" CHECK ("reporterUserId" <> "targetUserId"),
  CONSTRAINT "abuse_report_reason_check" CHECK (
    "reason" IN ('HARASSMENT', 'HATE', 'THREATS', 'SPAM', 'IMPERSONATION', 'SEXUAL_CONTENT', 'SELF_HARM', 'OTHER')
  ),
  CONSTRAINT "abuse_report_status_check" CHECK (
    "status" IN ('SUBMITTED', 'REVIEWING', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT "abuse_report_evidence_kind_check" CHECK (
    "evidenceKind" IN ('NONE', 'DIRECT_MESSAGE')
  ),
  CONSTRAINT "abuse_report_evidence_shape_check" CHECK (
    (
      "evidenceKind" = 'NONE'
      AND "directConversationId" IS NULL
      AND "directMessageId" IS NULL
      AND "evidenceSenderUserId" IS NULL
      AND "evidenceSenderDeviceId" IS NULL
      AND "evidenceMessageKind" IS NULL
      AND "evidenceMessageCreatedAt" IS NULL
      AND "evidenceText" IS NULL
    )
    OR
    (
      "evidenceKind" = 'DIRECT_MESSAGE'
      AND "directConversationId" IS NOT NULL
      AND "directMessageId" IS NOT NULL
      AND "evidenceSenderUserId" IS NOT NULL
      AND "evidenceSenderDeviceId" IS NOT NULL
      AND "evidenceMessageKind" IN ('HUMAN', 'OPERATOR_INVOKE')
      AND "evidenceMessageCreatedAt" IS NOT NULL
      AND "evidenceText" IS NOT NULL
      AND length("evidenceText") > 0
    )
  ),
  CONSTRAINT "abuse_report_reporter_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "abuse_report_target_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "abuse_report_direct_conversation_fkey"
    FOREIGN KEY ("directConversationId") REFERENCES "direct_conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "abuse_report_direct_message_fkey"
    FOREIGN KEY ("directMessageId") REFERENCES "direct_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "abuse_report_evidence_sender_fkey"
    FOREIGN KEY ("evidenceSenderUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "abuse_report_evidence_sender_device_fkey"
    FOREIGN KEY ("evidenceSenderDeviceId") REFERENCES "user_crypto_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "abuse_report_reporterUserId_createdAt_idx"
  ON "abuse_report"("reporterUserId", "createdAt");
CREATE INDEX "abuse_report_targetUserId_createdAt_idx"
  ON "abuse_report"("targetUserId", "createdAt");
CREATE INDEX "abuse_report_status_createdAt_idx"
  ON "abuse_report"("status", "createdAt");
CREATE INDEX "abuse_report_directMessageId_idx"
  ON "abuse_report"("directMessageId");

CREATE TABLE "communication_surface_preference" (
  "surfaceId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_surface_preference_pkey" PRIMARY KEY ("surfaceId", "userId"),
  CONSTRAINT "communication_surface_preference_surface_fkey"
    FOREIGN KEY ("surfaceId") REFERENCES "communication_surface"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "communication_surface_preference_user_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "communication_surface_preference_userId_muted_updatedAt_idx"
  ON "communication_surface_preference"("userId", "muted", "updatedAt");
