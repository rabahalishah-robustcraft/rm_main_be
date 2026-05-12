-- AlterTable
ALTER TABLE "audio_sessions" ADD COLUMN "sessionType" TEXT NOT NULL DEFAULT 'interview';

-- CreateTable
CREATE TABLE "practice_questions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "industry" TEXT,
    "jobTitle" TEXT,

    CONSTRAINT "practice_questions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
