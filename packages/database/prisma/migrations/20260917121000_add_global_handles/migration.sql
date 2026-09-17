CREATE TABLE "handle" (
  "id" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "userId" TEXT,
  "aiModelId" TEXT,
  "systemKey" TEXT,
  "reservationKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "handle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "handle_normalized_key" ON "handle"("normalized");
CREATE UNIQUE INDEX "handle_userId_key" ON "handle"("userId");
CREATE UNIQUE INDEX "handle_aiModelId_key" ON "handle"("aiModelId");
CREATE UNIQUE INDEX "handle_systemKey_key" ON "handle"("systemKey");
CREATE UNIQUE INDEX "handle_reservationKey_key" ON "handle"("reservationKey");
CREATE INDEX "handle_kind_status_idx" ON "handle"("kind", "status");

ALTER TABLE "handle"
  ADD CONSTRAINT "handle_canonical_lowercase_check"
  CHECK (
    "handle" = lower("handle")
    AND "normalized" = "handle"
    AND char_length("handle") BETWEEN 3 AND 32
    AND "handle" ~ '^[a-z0-9._]+$'
    AND "handle" ~ '^[a-z0-9]'
    AND "handle" ~ '[a-z0-9]$'
    AND "handle" !~ '[._]{2}'
  );

ALTER TABLE "handle"
  ADD CONSTRAINT "handle_status_check"
  CHECK ("status" IN ('ACTIVE', 'PENDING', 'RETIRED'));

ALTER TABLE "handle"
  ADD CONSTRAINT "handle_target_shape_check"
  CHECK (
    ("kind" = 'USER' AND (
      ("status" = 'PENDING' AND "userId" IS NULL AND "reservationKey" IS NOT NULL)
      OR ("status" IN ('ACTIVE', 'RETIRED') AND "userId" IS NOT NULL)
    ) AND "aiModelId" IS NULL AND "systemKey" IS NULL)
    OR
    ("kind" = 'SYSTEM_AGENT' AND "status" IN ('ACTIVE', 'RETIRED') AND "systemKey" IS NOT NULL AND "userId" IS NULL AND "aiModelId" IS NULL AND "reservationKey" IS NULL)
    OR
    ("kind" = 'AI_MODEL' AND "status" IN ('ACTIVE', 'RETIRED') AND "aiModelId" IS NOT NULL AND "userId" IS NULL AND "systemKey" IS NULL AND "reservationKey" IS NULL)
    OR
    ("kind" = 'RESERVED' AND "status" = 'ACTIVE' AND "userId" IS NULL AND "aiModelId" IS NULL AND "systemKey" IS NULL AND "reservationKey" IS NULL)
  );

INSERT INTO "handle" ("id", "handle", "normalized", "kind", "status", "systemKey") VALUES
  ('system:vimla', 'vimla', 'vimla', 'SYSTEM_AGENT', 'ACTIVE', 'VIMLA'),
  ('system:auto', 'auto', 'auto', 'SYSTEM_AGENT', 'ACTIVE', 'AI_AUTO');

INSERT INTO "handle" ("id", "handle", "normalized", "kind", "status") VALUES
  ('reserved:chatgpt', 'chatgpt', 'chatgpt', 'RESERVED', 'ACTIVE'),
  ('reserved:claude', 'claude', 'claude', 'RESERVED', 'ACTIVE'),
  ('reserved:gemini', 'gemini', 'gemini', 'RESERVED', 'ACTIVE'),
  ('reserved:openai', 'openai', 'openai', 'RESERVED', 'ACTIVE'),
  ('reserved:anthropic', 'anthropic', 'anthropic', 'RESERVED', 'ACTIVE'),
  ('reserved:google', 'google', 'google', 'RESERVED', 'ACTIVE'),
  ('reserved:admin', 'admin', 'admin', 'RESERVED', 'ACTIVE'),
  ('reserved:administrator', 'administrator', 'administrator', 'RESERVED', 'ACTIVE'),
  ('reserved:system', 'system', 'system', 'RESERVED', 'ACTIVE'),
  ('reserved:support', 'support', 'support', 'RESERVED', 'ACTIVE'),
  ('reserved:security', 'security', 'security', 'RESERVED', 'ACTIVE'),
  ('reserved:moderator', 'moderator', 'moderator', 'RESERVED', 'ACTIVE');

INSERT INTO "handle" ("id", "handle", "normalized", "kind", "status", "aiModelId")
SELECT 'model:' || "id", lower("slug"), lower("slug"), 'AI_MODEL', CASE WHEN "active" THEN 'ACTIVE' ELSE 'RETIRED' END, "id"
FROM "ai_model"
WHERE lower("slug") NOT IN (SELECT "normalized" FROM "handle")
ON CONFLICT ("normalized") DO NOTHING;
