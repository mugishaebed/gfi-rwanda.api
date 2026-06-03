-- DropIndex
DROP INDEX "Client_email_key";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
