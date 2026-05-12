-- AlterTable
ALTER TABLE "audio_sessions" ADD COLUMN IF NOT EXISTS "lastAnalyzedTranscriptHash" TEXT;
ALTER TABLE "audio_sessions" ADD COLUMN IF NOT EXISTS "lastAnalysisPromptVersion" TEXT;
