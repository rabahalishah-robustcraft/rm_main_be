-- AlterTable
ALTER TABLE "audio_sessions" ADD COLUMN     "assemblyJobId" TEXT,
ADD COLUMN     "compactTranscript" JSONB,
ADD COLUMN     "editedTranscript" JSONB,
ADD COLUMN     "overallScore" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "audio_sessions_assemblyJobId_key" ON "audio_sessions"("assemblyJobId");
