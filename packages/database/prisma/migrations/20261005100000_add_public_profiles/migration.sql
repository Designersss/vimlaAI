CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "public_profile" (
  "userId" TEXT NOT NULL,
  "handleId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "bio" TEXT,
  "status" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_profile_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "public_profile_handleId_key" ON "public_profile"("handleId");
CREATE UNIQUE INDEX "handle_id_userId_key" ON "handle"("id", "userId");
CREATE INDEX "handle_normalized_pattern_idx"
  ON "handle"("normalized" text_pattern_ops);
CREATE INDEX "handle_normalized_trgm_idx"
  ON "handle" USING GIN ("normalized" gin_trgm_ops);
CREATE INDEX "public_profile_displayName_lower_pattern_idx"
  ON "public_profile"(lower("displayName") text_pattern_ops);
CREATE INDEX "public_profile_displayName_trgm_idx"
  ON "public_profile" USING GIN ("displayName" gin_trgm_ops);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_handle_owner_fkey"
  FOREIGN KEY ("handleId", "userId") REFERENCES "handle"("id", "userId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_display_name_bounds_check"
  CHECK (
    char_length("displayName") BETWEEN 1 AND 80
    AND "displayName" ~ '[^[:space:]]'
    AND "displayName" !~ '^[[:space:]]'
    AND "displayName" !~ '[[:space:]]$'
  );

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_avatar_url_bounds_check"
  CHECK ("avatarUrl" IS NULL OR char_length("avatarUrl") <= 2048);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_bio_bounds_check"
  CHECK ("bio" IS NULL OR char_length("bio") <= 280);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_status_bounds_check"
  CHECK ("status" IS NULL OR char_length("status") <= 80);

INSERT INTO "public_profile" (
  "userId",
  "handleId",
  "displayName",
  "avatarUrl",
  "bio",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  handle."userId",
  handle."id",
  handle."handle",
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "handle"
WHERE
  handle."kind" = 'USER'
  AND handle."status" = 'ACTIVE'
  AND handle."userId" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;
