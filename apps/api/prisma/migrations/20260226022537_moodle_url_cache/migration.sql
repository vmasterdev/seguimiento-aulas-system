-- AlterTable
ALTER TABLE "MoodleCheck" ADD COLUMN     "moodleCourseId" TEXT,
ADD COLUMN     "moodleCourseUrl" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBaseUrl" TEXT,
ADD COLUMN     "resolvedModality" TEXT,
ADD COLUMN     "searchQuery" TEXT;
