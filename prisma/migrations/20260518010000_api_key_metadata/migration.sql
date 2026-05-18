ALTER TABLE "api_keys"
  ALTER COLUMN "apiKey" DROP NOT NULL,
  ADD COLUMN "keyHash" TEXT,
  ADD COLUMN "prefix" TEXT,
  ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");
CREATE INDEX "api_keys_organizationId_createdAt_idx" ON "api_keys"("organizationId", "createdAt");
CREATE INDEX "api_keys_userId_createdAt_idx" ON "api_keys"("userId", "createdAt");
