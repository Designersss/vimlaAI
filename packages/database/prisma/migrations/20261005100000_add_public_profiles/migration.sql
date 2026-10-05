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
CREATE INDEX "public_profile_displayName_idx" ON "public_profile"("displayName");

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_handleId_fkey"
  FOREIGN KEY ("handleId") REFERENCES "handle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_display_name_bounds_check"
  CHECK (char_length(btrim("displayName")) BETWEEN 1 AND 80);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_avatar_url_bounds_check"
  CHECK ("avatarUrl" IS NULL OR char_length("avatarUrl") <= 2048);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_bio_bounds_check"
  CHECK ("bio" IS NULL OR char_length("bio") <= 280);

ALTER TABLE "public_profile"
  ADD CONSTRAINT "public_profile_status_bounds_check"
  CHECK ("status" IS NULL OR char_length("status") <= 120);

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
  "user"."name",
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "handle"
JOIN "user" ON "user"."id" = handle."userId"
WHERE
  handle."kind" = 'USER'
  AND handle."status" = 'ACTIVE'
  AND handle."userId" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;
