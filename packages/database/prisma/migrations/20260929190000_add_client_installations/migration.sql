-- ARCH-03: durable product installation identity.
-- ClientInstallation is distinct from Better Auth Session and UserCryptoDevice.
-- kind/version/capabilities are metadata only and must never grant authority.

CREATE TABLE "client_installation" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appVersion" TEXT,
    "protocolVersion" INTEGER NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "client_installation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_installation_kind_chk"
      CHECK ("kind" IN ('WEB', 'DESKTOP', 'IOS', 'ANDROID')),
    CONSTRAINT "client_installation_app_version_chk"
      CHECK ("appVersion" IS NULL OR char_length("appVersion") BETWEEN 1 AND 64),
    CONSTRAINT "client_installation_protocol_version_chk"
      CHECK ("protocolVersion" BETWEEN 1 AND 1000000),
    CONSTRAINT "client_installation_capabilities_count_chk"
      CHECK (cardinality("capabilities") <= 32)
);

CREATE INDEX "client_installation_userId_revokedAt_idx"
  ON "client_installation"("userId", "revokedAt");

CREATE INDEX "client_installation_userId_lastSeenAt_idx"
  ON "client_installation"("userId", "lastSeenAt");

ALTER TABLE "client_installation"
  ADD CONSTRAINT "client_installation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "client_installation_preference" (
    "installationId" UUID NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_installation_preference_pkey"
      PRIMARY KEY ("installationId")
);

ALTER TABLE "client_installation_preference"
  ADD CONSTRAINT "client_installation_preference_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "client_installation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
