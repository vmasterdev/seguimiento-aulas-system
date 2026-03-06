-- AlterTable
ALTER TABLE "OutboxMessage" ADD COLUMN     "coordinatorId" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientName" TEXT;

-- CreateTable
CREATE TABLE "Coordinator" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "programKey" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "campus" TEXT,
    "region" TEXT,
    "sourceSheet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coordinator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Coordinator_programId_idx" ON "Coordinator"("programId");

-- CreateIndex
CREATE INDEX "Coordinator_programKey_idx" ON "Coordinator"("programKey");

-- CreateIndex
CREATE UNIQUE INDEX "Coordinator_programKey_email_key" ON "Coordinator"("programKey", "email");

-- CreateIndex
CREATE INDEX "OutboxMessage_coordinatorId_status_idx" ON "OutboxMessage"("coordinatorId", "status");

-- CreateIndex
CREATE INDEX "OutboxMessage_audience_recipientEmail_idx" ON "OutboxMessage"("audience", "recipientEmail");

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "Coordinator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
