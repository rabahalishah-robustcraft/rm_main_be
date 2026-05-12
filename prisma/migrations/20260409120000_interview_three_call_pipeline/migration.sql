-- AlterTable
ALTER TABLE "audio_sessions" ADD COLUMN     "formattedConversation" JSONB,
ADD COLUMN     "previewUserSavedAt" TIMESTAMP(3),
ADD COLUMN     "whisperDurationSeconds" DOUBLE PRECISION;
