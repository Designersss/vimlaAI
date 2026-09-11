-- Phase 8: Projects + collaboration foundation. Additive only.
-- Access/lock state is computed from entitlements + lastOpenedAt, not stored on project.

CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_member" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_member_role_chk" CHECK ("role" IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'))
);

CREATE TABLE "project_invite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_invite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_invite_role_chk" CHECK ("role" IN ('ADMIN', 'MEMBER', 'VIEWER'))
);

CREATE INDEX "project_ownerUserId_createdAt_idx" ON "project"("ownerUserId", "createdAt");

CREATE UNIQUE INDEX "project_member_projectId_userId_key" ON "project_member"("projectId", "userId");

CREATE INDEX "project_member_userId_lastOpenedAt_idx" ON "project_member"("userId", "lastOpenedAt");

CREATE INDEX "project_member_projectId_role_idx" ON "project_member"("projectId", "role");

CREATE UNIQUE INDEX "project_invite_tokenHash_key" ON "project_invite"("tokenHash");

CREATE INDEX "project_invite_projectId_email_idx" ON "project_invite"("projectId", "email");

CREATE INDEX "project_invite_email_expiresAt_idx" ON "project_invite"("email", "expiresAt");

ALTER TABLE "project" ADD CONSTRAINT "project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_member" ADD CONSTRAINT "project_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_member" ADD CONSTRAINT "project_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
