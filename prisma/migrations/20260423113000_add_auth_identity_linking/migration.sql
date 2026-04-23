-- Ensure enum value exists for Google
DO $$
BEGIN
  ALTER TYPE "AuthProvider" ADD VALUE 'GOOGLE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- Backfill existing identities from User table
INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerUserId", "tenantId", "createdAt", "updatedAt")
SELECT
  ('legacy-' || "id" || '-' || "provider"::text),
  "id",
  "provider",
  "providerUserId",
  "tenantId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old unique index and legacy columns from User
DROP INDEX IF EXISTS "User_provider_providerUserId_key";

ALTER TABLE "User"
DROP COLUMN IF EXISTS "provider",
DROP COLUMN IF EXISTS "providerUserId",
DROP COLUMN IF EXISTS "tenantId";
