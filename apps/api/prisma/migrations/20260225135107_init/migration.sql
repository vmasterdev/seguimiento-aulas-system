-- CreateTable
CREATE TABLE "Period" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "modality" TEXT NOT NULL,
    "executionPolicy" TEXT NOT NULL DEFAULT 'APPLIES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "costCenter" TEXT,
    "campus" TEXT,
    "region" TEXT,
    "extraJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "nrc" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "campusCode" TEXT,
    "programCode" TEXT,
    "programName" TEXT,
    "subjectName" TEXT,
    "moment" TEXT,
    "salon" TEXT,
    "salon1" TEXT,
    "teacherId" TEXT,
    "templateDeclared" TEXT,
    "d4FlagLegacy" BOOLEAN NOT NULL DEFAULT false,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodleCheck" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "detectedTemplate" TEXT,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "evidenceScreenshotPath" TEXT,
    "evidenceHtmlPath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoodleCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleGroup" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "programCode" TEXT NOT NULL,
    "moment" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "selectedCourseId" TEXT,
    "selectionSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "checklist" JSONB,
    "score" DOUBLE PRECISION NOT NULL,
    "observations" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replicatedFromCourseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "teacherId" TEXT,
    "programCode" TEXT,
    "periodId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "moment" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "emlPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Period_code_key" ON "Period"("code");

-- CreateIndex
CREATE INDEX "Course_periodId_nrc_idx" ON "Course"("periodId", "nrc");

-- CreateIndex
CREATE INDEX "Course_teacherId_idx" ON "Course"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_nrc_periodId_key" ON "Course"("nrc", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "MoodleCheck_courseId_key" ON "MoodleCheck"("courseId");

-- CreateIndex
CREATE INDEX "SampleGroup_periodId_moment_idx" ON "SampleGroup"("periodId", "moment");

-- CreateIndex
CREATE UNIQUE INDEX "SampleGroup_teacherId_periodId_programCode_moment_modality__key" ON "SampleGroup"("teacherId", "periodId", "programCode", "moment", "modality", "template");

-- CreateIndex
CREATE INDEX "Evaluation_phase_computedAt_idx" ON "Evaluation"("phase", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_courseId_phase_key" ON "Evaluation"("courseId", "phase");

-- CreateIndex
CREATE INDEX "OutboxMessage_periodId_phase_moment_status_idx" ON "OutboxMessage"("periodId", "phase", "moment", "status");

-- CreateIndex
CREATE INDEX "OutboxMessage_teacherId_status_idx" ON "OutboxMessage"("teacherId", "status");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodleCheck" ADD CONSTRAINT "MoodleCheck_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleGroup" ADD CONSTRAINT "SampleGroup_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleGroup" ADD CONSTRAINT "SampleGroup_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleGroup" ADD CONSTRAINT "SampleGroup_selectedCourseId_fkey" FOREIGN KEY ("selectedCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
