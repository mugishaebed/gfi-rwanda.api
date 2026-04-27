CREATE TABLE "Blog" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "thumbnailStorageDriver" TEXT,
  "thumbnailStorageKey" TEXT,
  "thumbnailOriginalFileName" TEXT,
  "thumbnailMimeType" TEXT,
  "thumbnailSize" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Blog_createdAt_idx" ON "Blog"("createdAt");
