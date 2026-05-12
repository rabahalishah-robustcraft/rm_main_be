import { PrismaClient } from '@prisma/client';
import { ValidationError } from '../types/auth';
import { sanitizeFilename } from '../utils/fileUpload';
import { CoachingReport } from './analysisService';
import { OpenAIService, WHISPER_TRANSCRIPTION_PLACEHOLDER } from './OpenAIService';
import { S3Service } from './S3Service';
import { SubscriptionService } from './SubscriptionService';
import { analyzePracticeAnswer } from './practiceAnalysisService';
import { SessionStatus } from './AudioSessionService';

export class PracticeSessionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'PracticeSessionError';
  }
}

export type PracticeAnalysisWithMeta = CoachingReport & {
  question: string;
  questionIndex: number;
};

export interface PracticeSubmitResult {
  id: string;
  sessionType: 'practice';
  displayName: string | null;
  status: string;
  transcript: string;
  aiAnalysis: PracticeAnalysisWithMeta;
  scores: {
    overall: number;
    clarity: number;
    confidence: number;
    specificity: number;
    tone: number;
    enthusiasm: number;
  };
  createdAt: Date;
}

export interface PracticeReanalyzeResult {
  id: string;
  sessionType: 'practice';
  displayName: string | null;
  status: string;
  transcript: string;
  aiAnalysis: PracticeAnalysisWithMeta;
  scores: {
    overall: number;
    clarity: number;
    confidence: number;
    specificity: number;
    tone: number;
    enthusiasm: number;
  };
  updatedAt: Date;
}

function parsePracticeContextFromStoredAnalysis(
  aiAnalysis: unknown
): { question: string; questionIndex: number } | null {
  if (aiAnalysis == null || typeof aiAnalysis !== 'object') {
    return null;
  }
  const o = aiAnalysis as Record<string, unknown>;
  const q = o.question;
  if (typeof q !== 'string' || q.trim().length === 0) {
    return null;
  }
  const rawIdx = o.questionIndex;
  const qi =
    typeof rawIdx === 'number' && Number.isFinite(rawIdx)
      ? Math.floor(rawIdx)
      : typeof rawIdx === 'string' && /^\d+$/.test(rawIdx)
        ? parseInt(rawIdx, 10)
        : 0;
  const questionIndex = Math.min(2, Math.max(0, qi));
  return { question: q.trim(), questionIndex };
}

export class PracticeSessionService {
  constructor(
    private prisma: PrismaClient,
    private openaiService: OpenAIService,
    private s3Service: S3Service,
    private subscriptionService: SubscriptionService
  ) {}

  async submitPracticeAnswer(
    userId: string,
    audioBuffer: Buffer,
    filename: string,
    mimeType: string,
    question: string,
    questionIndex: number
  ): Promise<PracticeSubmitResult> {
    await this.subscriptionService.validateUsageLimit(userId);

    let transcription;
    try {
      transcription = await this.openaiService.transcribeAudio(
        audioBuffer,
        sanitizeFilename(filename),
        mimeType || 'audio/wav'
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new PracticeSessionError(err.message, 'INVALID_AUDIO', 400, err);
      }
      throw new PracticeSessionError(
        'Failed to transcribe audio',
        'TRANSCRIPTION_FAILED',
        500,
        err as Error
      );
    }

    const transcript = (transcription.text || '').trim();
    if (
      transcript === WHISPER_TRANSCRIPTION_PLACEHOLDER ||
      transcript.length < 10
    ) {
      throw new PracticeSessionError(
        'Audio was too short or silent to analyze',
        'TRANSCRIPT_TOO_SHORT',
        400
      );
    }

    const qTrim = question.trim();
    let aiReport: CoachingReport;
    try {
      aiReport = await analyzePracticeAnswer(transcript, qTrim);
    } catch (err) {
      throw new PracticeSessionError(
        'AI analysis failed. Please try again.',
        'ANALYSIS_FAILED',
        500,
        err as Error
      );
    }

    const sanitizedFilename = sanitizeFilename(filename);
    const s3Key = `practice/${userId}/${Date.now()}-${sanitizedFilename}`;
    await this.s3Service.upload(s3Key, audioBuffer, { contentType: mimeType || 'application/octet-stream' });

    const qi = Number.isFinite(questionIndex) ? Math.floor(questionIndex) : 0;
    const qIndex = Math.min(2, Math.max(0, qi));

    const displayName = `Practice Session — Q${qIndex + 1}: ${qTrim.slice(0, 60)}${qTrim.length > 60 ? '…' : ''}`;

    const enrichedReport: PracticeAnalysisWithMeta = {
      ...aiReport,
      question: qTrim,
      questionIndex: qIndex
    };

    const session = await this.prisma.audioSession.create({
      data: {
        userId,
        sessionType: 'practice',
        displayName,
        status: SessionStatus.COMPLETED,
        audioS3Key: s3Key,
        transcript,
        editedTranscript: [{ id: 0, s: 'A', t: transcript, start: 0, end: 0 }],
        aiAnalysis: enrichedReport as object,
        overallScore: enrichedReport.overallScore,
        clarityScore: enrichedReport.attributes.clarity.score,
        confidenceScore: enrichedReport.attributes.confidence.score,
        specificityScore: enrichedReport.attributes.specificity.score,
        toneScore: enrichedReport.attributes.tone.score,
        enthusiasmScore: enrichedReport.attributes.enthusiasm.score
      }
    });

    await this.subscriptionService.incrementUsage(userId);

    return {
      id: session.id,
      sessionType: 'practice',
      displayName: session.displayName,
      status: SessionStatus.COMPLETED,
      transcript,
      aiAnalysis: enrichedReport,
      scores: {
        overall: enrichedReport.overallScore,
        clarity: enrichedReport.attributes.clarity.score,
        confidence: enrichedReport.attributes.confidence.score,
        specificity: enrichedReport.attributes.specificity.score,
        tone: enrichedReport.attributes.tone.score,
        enthusiasm: enrichedReport.attributes.enthusiasm.score
      },
      createdAt: session.createdAt
    };
  }

  /**
   * Re-run practice coaching on edited transcript text for an existing practice session.
   * Updates the same AudioSession row; does not increment usage.
   */
  async reanalyzeEditedAnswer(
    sessionId: string,
    userId: string,
    transcript: string
  ): Promise<PracticeReanalyzeResult> {
    const session = await this.prisma.audioSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      throw new PracticeSessionError('Session not found', 'SESSION_NOT_FOUND', 404);
    }

    if (session.userId !== userId) {
      throw new PracticeSessionError(
        'You do not have access to this session',
        'SESSION_ACCESS_DENIED',
        403
      );
    }

    if (session.sessionType !== 'practice') {
      throw new PracticeSessionError(
        'This endpoint only supports practice sessions',
        'PRACTICE_SESSION_REQUIRED',
        400
      );
    }

    if (session.status !== SessionStatus.COMPLETED) {
      throw new PracticeSessionError(
        `Practice session must be completed to edit and re-analyze. Current state: '${session.status}'`,
        'INVALID_STATUS',
        400
      );
    }

    const ctx = parsePracticeContextFromStoredAnalysis(session.aiAnalysis);
    if (!ctx) {
      throw new PracticeSessionError(
        'This practice session has no stored question context; re-analysis is not available',
        'MISSING_PRACTICE_CONTEXT',
        400
      );
    }

    const trimmed = transcript.trim();
    if (trimmed.length < 10) {
      throw new PracticeSessionError(
        'Transcript is too short to analyze',
        'TRANSCRIPT_TOO_SHORT',
        400
      );
    }

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.ANALYZING,
        processingError: null
      }
    });

    let aiReport: CoachingReport;
    try {
      aiReport = await analyzePracticeAnswer(trimmed, ctx.question);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const processingError = msg.length > 500 ? msg.slice(0, 497) + '...' : msg;
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.FAILED,
          processingError: `Analysis failed: ${processingError}`
        }
      });
      throw new PracticeSessionError(
        'AI analysis failed. Please try again.',
        'ANALYSIS_FAILED',
        500,
        err as Error
      );
    }

    const enrichedReport: PracticeAnalysisWithMeta = {
      ...aiReport,
      question: ctx.question,
      questionIndex: ctx.questionIndex
    };

    const updated = await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        transcript: trimmed,
        editedTranscript: [{ id: 0, s: 'A', t: trimmed, start: 0, end: 0 }],
        aiAnalysis: enrichedReport as object,
        overallScore: enrichedReport.overallScore,
        clarityScore: enrichedReport.attributes.clarity.score,
        confidenceScore: enrichedReport.attributes.confidence.score,
        specificityScore: enrichedReport.attributes.specificity.score,
        toneScore: enrichedReport.attributes.tone.score,
        enthusiasmScore: enrichedReport.attributes.enthusiasm.score,
        status: SessionStatus.COMPLETED,
        processingError: null
      }
    });

    return {
      id: updated.id,
      sessionType: 'practice',
      displayName: updated.displayName,
      status: SessionStatus.COMPLETED,
      transcript: trimmed,
      aiAnalysis: enrichedReport,
      scores: {
        overall: enrichedReport.overallScore,
        clarity: enrichedReport.attributes.clarity.score,
        confidence: enrichedReport.attributes.confidence.score,
        specificity: enrichedReport.attributes.specificity.score,
        tone: enrichedReport.attributes.tone.score,
        enthusiasm: enrichedReport.attributes.enthusiasm.score
      },
      updatedAt: updated.updatedAt
    };
  }
}
