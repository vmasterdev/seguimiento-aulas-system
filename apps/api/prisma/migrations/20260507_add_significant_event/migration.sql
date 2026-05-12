-- CreateTable
CREATE TABLE "SignificantEvent" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "moment" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION,
    "alistamientoScore" DOUBLE PRECISION,
    "ejecucionScore" DOUBLE PRECISION,
    "coordination" TEXT,
    "campus" TEXT,
    "isNewTeacher" BOOLEAN NOT NULL DEFAULT false,
    "tenureDays" INTEGER,
    "fechaInicio" TIMESTAMP(3),
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),
    "signedNotes" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "deliveryNotes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedFolder" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "SignificantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignificantEvent_teacherId_periodCode_moment_phase_key" ON "SignificantEvent"("teacherId", "periodCode", "moment", "phase");

-- CreateIndex
CREATE INDEX "SignificantEvent_periodCode_moment_idx" ON "SignificantEvent"("periodCode", "moment");

-- CreateIndex
CREATE INDEX "SignificantEvent_phase_idx" ON "SignificantEvent"("phase");

-- CreateIndex
CREATE INDEX "SignificantEvent_signed_delivered_archived_idx" ON "SignificantEvent"("signed", "delivered", "archived");

-- AddForeignKey
ALTER TABLE "SignificantEvent" ADD CONSTRAINT "SignificantEvent_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
