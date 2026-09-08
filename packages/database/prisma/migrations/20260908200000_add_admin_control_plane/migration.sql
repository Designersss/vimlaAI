-- Phase 5: Admin control plane, MFA tables, project entitlement-ready guardrails.
-- TOPUP buckets still never expire.

ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "business_guardrail_version"
    ADD COLUMN "projectCreationWindowDays" INTEGER,
    ADD COLUMN "projectCreationLimitFree" INTEGER,
    ADD COLUMN "projectCreationLimit199" INTEGER,
    ADD COLUMN "projectCreationLimit499" INTEGER,
    ADD COLUMN "projectCreationLimit999" INTEGER,
    ADD COLUMN "freeActiveProjectReallocationCooldownDays" INTEGER,
    ADD COLUMN "projectTrashRetentionDays" INTEGER,
    ADD COLUMN "sourceQuality" TEXT NOT NULL DEFAULT 'UNVERIFIED';

CREATE TABLE "two_factor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factor_userId_key" ON "two_factor"("userId");

ALTER TABLE "two_factor"
    ADD CONSTRAINT "two_factor_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");
CREATE INDEX "passkey_credentialID_idx" ON "passkey"("credentialID");

ALTER TABLE "passkey"
    ADD CONSTRAINT "passkey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "admin_role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_role_code_key" ON "admin_role"("code");

CREATE TABLE "admin_principal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,

    CONSTRAINT "admin_principal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_principal_status_allowed" CHECK ("status" IN ('ACTIVE', 'DISABLED'))
);

CREATE UNIQUE INDEX "admin_principal_userId_key" ON "admin_principal"("userId");
CREATE INDEX "admin_principal_status_idx" ON "admin_principal"("status");

ALTER TABLE "admin_principal"
    ADD CONSTRAINT "admin_principal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "admin_principal_role" (
    "principalId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "admin_principal_role_pkey" PRIMARY KEY ("principalId", "roleId")
);

ALTER TABLE "admin_principal_role"
    ADD CONSTRAINT "admin_principal_role_principalId_fkey"
    FOREIGN KEY ("principalId") REFERENCES "admin_principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_principal_role"
    ADD CONSTRAINT "admin_principal_role_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "admin_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "admin_session" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastStrongAuthAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgentSummary" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_session_tokenHash_key" ON "admin_session"("tokenHash");
CREATE INDEX "admin_session_principalId_revokedAt_idx" ON "admin_session"("principalId", "revokedAt");
CREATE INDEX "admin_session_expiresAt_idx" ON "admin_session"("expiresAt");

ALTER TABLE "admin_session"
    ADD CONSTRAINT "admin_session_principalId_fkey"
    FOREIGN KEY ("principalId") REFERENCES "admin_principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "principalId" TEXT,
    "adminSessionId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT,
    "ipHash" TEXT,
    "userAgentSummary" TEXT,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");
CREATE INDEX "admin_audit_log_adminUserId_createdAt_idx" ON "admin_audit_log"("adminUserId", "createdAt");
CREATE INDEX "admin_audit_log_action_createdAt_idx" ON "admin_audit_log"("action", "createdAt");

ALTER TABLE "admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_principalId_fkey"
    FOREIGN KEY ("principalId") REFERENCES "admin_principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "operator_setting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "operator_setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "admin_security_event" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "admin_security_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_security_event_kind_createdAt_idx" ON "admin_security_event"("kind", "createdAt");

CREATE OR REPLACE FUNCTION reject_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "admin_audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION reject_admin_audit_mutation();
