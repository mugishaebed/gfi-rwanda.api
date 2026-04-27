/*
  Warnings:

  - You are about to drop the column `content` on the `Blog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Blog" DROP COLUMN "content";

-- CreateTable
CREATE TABLE "BlogContent" (
    "id" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "header" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageStorageDriver" TEXT,
    "imageStorageKey" TEXT,
    "imageOriginalFileName" TEXT,
    "imageMimeType" TEXT,
    "imageSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogContent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BlogContent" ADD CONSTRAINT "BlogContent_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
