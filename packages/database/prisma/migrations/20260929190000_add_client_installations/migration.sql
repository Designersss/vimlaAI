-- ARCH-03: durable product installation identity.
-- ClientInstallation is distinct from Better Auth Session and UserCryptoDevice.
-- kind/version/capabilities are metadata only and must never grant authority.

CREATE FUNCTION "vimla_client_installation_capabilities_valid"("values" TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    COALESCE(array_ndims("values"), 1) = 1
    AND COALESCE(array_lower("values", 1), 1) = 1
    AND cardinality("values") <= 32
    AND NOT EXISTS (
      SELECT 1
      FROM unnest("values") AS item(value)
      WHERE value IS NULL
        OR char_length(value) NOT BETWEEN 1 AND 64
        OR substring(value FROM '^[a-z0-9][a-z0-9._-]{0,63}') IS DISTINCT FROM value
    )
    AND cardinality("values") = cardinality(
      ARRAY(
        SELECT DISTINCT value
        FROM unnest("values") AS item(value)
      )
    )
$$;

CREATE TABLE "client_installation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appVersion" TEXT,
    "protocolVersion" INTEGER NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "client_installation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_installation_id_uuid_chk"
      CHECK ("id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "client_installation_kind_chk"
      CHECK ("kind" IN ('WEB', 'DESKTOP', 'IOS', 'ANDROID')),
    CONSTRAINT "client_installation_app_version_chk"
      CHECK ("appVersion" IS NULL OR char_length("appVersion") BETWEEN 1 AND 64),
    CONSTRAINT "client_installation_protocol_version_chk"
      CHECK ("protocolVersion" BETWEEN 1 AND 1000000),
    CONSTRAINT "client_installation_capabilities_chk"
      CHECK ("vimla_client_installation_capabilities_valid"("capabilities"))
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
    "installationId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_installation_preference_pkey"
      PRIMARY KEY ("installationId")
);

ALTER TABLE "client_installation_preference"
  ADD CONSTRAINT "client_installation_preference_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "client_installation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
