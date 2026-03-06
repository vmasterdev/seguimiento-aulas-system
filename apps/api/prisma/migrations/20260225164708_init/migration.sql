-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN     "coordination" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "Teacher_sourceId_idx" ON "Teacher"("sourceId");

-- CreateIndex
CREATE INDEX "Teacher_documentId_idx" ON "Teacher"("documentId");

-- CreateIndex
CREATE INDEX "Teacher_coordination_idx" ON "Teacher"("coordination");
