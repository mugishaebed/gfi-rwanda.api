-- AlterTable
ALTER TABLE "BlogContent" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BlogContent_blogId_position_idx" ON "BlogContent"("blogId", "position");
