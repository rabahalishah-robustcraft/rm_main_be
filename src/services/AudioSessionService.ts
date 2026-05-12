import { PrismaClient, AudioSession, UserProfile } from '@prisma/client';
import { parseBuffer } from 'music-metadata';
import { S3Service } from './S3Service';
import { SubscriptionService, SubscriptionError, SubscriptionTier } from './SubscriptionService';
import { sanitizeFilename } from '../utils/fileUpload';
import { formatSessionDisplayName } from '../utils/sessionDisplayName';
import { config } from '../utils/config';
import { fetchTranscript, submitTranscription } from './assemblyAIService';
import { toMarkdown, CompactTranscriptLine, toCompactJSON } from './transcriptService';
import { generateAIReport, CoachingReport } from './analysisService';

/**
 * Audio Session Service for managing recording sessions and AI analysis
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4
 */

export interface SessionCreationData {
  userId: string;
}

export interface AudioUploadData {
  sessionId: string;
  audioBuffer: Buffer;
  filename?: string;
}

export interface SessionWithAnalysis extends Omit<AudioSession, 'processingError'> {
  analysisComplete: boolean;
  processingError?: string | null;
}

/**
 * Session status values (string column in DB)
 */
export enum SessionStatus {
  PENDING = 'pending',
  /** Legacy in-flight */
  PROCESSING = 'processing',
  TRANSCRIBING = 'transcribing',
  AWAITING_REVIEW = 'awaiting_review',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

const IN_FLIGHT_STATUSES = [
  SessionStatus.PROCESSING,
  SessionStatus.TRANSCRIBING,
  SessionStatus.AWAITING_REVIEW,
  SessionStatus.ANALYZING
];

/** Max interview recording length (seconds) for real-time session upload by subscription tier. */
const INTERVIEW_AUDIO_MAX_SECONDS: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 30 * 60,
  [SubscriptionTier.PAID]: 60 * 60
};

function formatAudioDurationLimitLabel(maxSeconds: number): string {
  if (maxSeconds % 3600 === 0 && maxSeconds >= 3600) {
    const h = maxSeconds / 3600;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (maxSeconds % 60 === 0) {
    const m = maxSeconds / 60;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  return `${maxSeconds} seconds`;
}

/**
 * Duration from a linear PCM WAVE file (fmt + data chunks). Returns undefined if not PCM RIFF/WAVE.
 */
function wavPcmDurationSeconds(buffer: Buffer): number | undefined {
  if (buffer.length < 36) return undefined;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return undefined;
  }
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + size > buffer.length) {
      return undefined;
    }
    if (id === 'fmt ') {
      if (size < 16) return undefined;
      const audioFormat = buffer.readUInt16LE(chunkStart);
      if (audioFormat !== 1) {
        return undefined;
      }
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    } else if (id === 'data') {
      if (byteRate > 0 && size > 0) {
        return size / byteRate;
      }
      return undefined;
    }
    offset = chunkStart + size + (size % 2);
  }
  return undefined;
}

async function readAudioDurationSeconds(
  buffer: Buffer,
  mimeType: string
): Promise<number | undefined> {
  const fromWav = wavPcmDurationSeconds(buffer);
  if (fromWav !== undefined && Number.isFinite(fromWav) && fromWav >= 0) {
    return fromWav;
  }
  try {
    const meta = await parseBuffer(buffer, mimeType || undefined);
    const d = meta.format.duration;
    if (typeof d === 'number' && Number.isFinite(d) && d >= 0) {
      return d;
    }
  } catch {
    // Unsupported or corrupt container; caller treats as unknown duration
  }
  return undefined;
}

/**
 * Custom error class for AudioSession service errors
 */
export class AudioSessionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'AudioSessionError';
  }
}

/**
 * AudioSession Service implementation
 */
export class AudioSessionService {
  constructor(
    private prisma: PrismaClient,
    private s3Service: S3Service,
    private subscriptionService: SubscriptionService
  ) {}

  /**
   * Start a new audio session
   */
  async startSession(userId: string): Promise<AudioSession> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw new AudioSessionError('User not found', 'USER_NOT_FOUND');
      }

      await this.subscriptionService.validateInterviewSessionStart(userId);

      const now = new Date();
      const session = await this.prisma.audioSession.create({
        data: {
          userId,
          sessionType: 'interview',
          audioS3Key: '',
          status: SessionStatus.PENDING,
          displayName: formatSessionDisplayName(now)
        }
      });

      return session;
    } catch (error) {
      if (error instanceof AudioSessionError) {
        throw error;
      }
      if (error instanceof SubscriptionError) {
        throw new AudioSessionError(error.message, error.code, error);
      }
      throw new AudioSessionError(
        'Failed to create session',
        'SESSION_CREATION_FAILED',
        error as Error
      );
    }
  }

  /**
   * Upload audio to S3, submit AssemblyAI transcription (webhook completes transcript).
   */
  async uploadAudio(
    sessionId: string,
    audioBuffer: Buffer,
    filename: string = 'audio.wav',
    contentType: string = 'audio/wav'
  ): Promise<{ id: string; status: string }> {
    try {
      const session = await this.prisma.audioSession.findUnique({
        where: { id: sessionId },
        include: {
          user: {
            include: { profile: true }
          }
        }
      });

      if (!session) {
        throw new AudioSessionError('Session not found', 'SESSION_NOT_FOUND');
      }

      if (session.status !== SessionStatus.PENDING) {
        throw new AudioSessionError('Session is not in pending state', 'INVALID_SESSION_STATE');
      }

      await this.getProfileForUserOrThrow(session.userId);

      const usage = await this.subscriptionService.getUsageInfo(session.userId);
      const tier =
        usage.tier === SubscriptionTier.PAID ? SubscriptionTier.PAID : SubscriptionTier.FREE;
      const maxAudioSeconds = INTERVIEW_AUDIO_MAX_SECONDS[tier];

      const durationSeconds = await readAudioDurationSeconds(audioBuffer, contentType);
      if (durationSeconds === undefined) {
        throw new AudioSessionError(
          'Could not determine audio length. Please upload a supported format (for example WAV, MP3, or M4A).',
          'AUDIO_DURATION_UNKNOWN'
        );
      }
      if (durationSeconds > maxAudioSeconds) {
        const limitLabel = formatAudioDurationLimitLabel(maxAudioSeconds);
        throw new AudioSessionError(
          `Interview audio exceeds the maximum length (${limitLabel}) for your plan.`,
          'INTERVIEW_AUDIO_LENGTH_LIMIT_EXCEEDED'
        );
      }

      if (!config.ASSEMBLYAI_API_KEY) {
        throw new AudioSessionError(
          'AssemblyAI is not configured on the server',
          'ASSEMBLYAI_SUBMIT_FAILED'
        );
      }
      if (!config.WEBHOOK_BASE_URL) {
        throw new AudioSessionError(
          'WEBHOOK_BASE_URL is not configured',
          'ASSEMBLYAI_SUBMIT_FAILED'
        );
      }

      const sanitizedFilename = sanitizeFilename(filename);
      const s3Key = `audio-sessions/${sessionId}/${Date.now()}-${sanitizedFilename}`;

      await this.s3Service.upload(s3Key, audioBuffer, { contentType });

      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { audioS3Key: s3Key }
      });

      const publicAudioUrl = await this.s3Service.getSignedUrl(s3Key, 3600);

      let assemblyJobId: string;
      try {
        assemblyJobId = await submitTranscription({
          audioUrl: publicAudioUrl,
          sessionId,
          webhookBaseUrl: config.WEBHOOK_BASE_URL,
          webhookSecret: config.ASSEMBLYAI_WEBHOOK_SECRET || undefined
        });
      } catch (err) {
        console.error('[AudioSession] AssemblyAI submitTranscription failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        const processingError = msg.length > 500 ? msg.slice(0, 497) + '...' : msg;
        await this.prisma.audioSession.update({
          where: { id: sessionId },
          data: {
            status: SessionStatus.FAILED,
            processingError: `AssemblyAI submission failed: ${processingError}`
          }
        });
        const clientHint =
          msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
        throw new AudioSessionError(
          `Failed to submit audio for transcription: ${clientHint}`,
          'ASSEMBLYAI_SUBMIT_FAILED',
          err as Error
        );
      }

      const updated = await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          assemblyJobId,
          status: SessionStatus.TRANSCRIBING
        }
      });

      return { id: updated.id, status: updated.status };
    } catch (error) {
      if (error instanceof AudioSessionError) {
        throw error;
      }
      if (error instanceof SubscriptionError) {
        throw new AudioSessionError(error.message, error.code, error);
      }
      throw new AudioSessionError(
        'Failed to upload audio',
        'AUDIO_UPLOAD_FAILED',
        error as Error
      );
    }
  }

  /**
   * Pull transcript status from AssemblyAI and advance the session when completed.
   * Use when the webhook URL was wrong or deliveries failed (session stuck in transcribing).
   */
  async syncTranscriptFromAssembly(sessionId: string, userId: string): Promise<SessionWithAnalysis> {
    if (!config.ASSEMBLYAI_API_KEY) {
      throw new AudioSessionError(
        'AssemblyAI is not configured on the server',
        'ASSEMBLYAI_NOT_CONFIGURED'
      );
    }

    const session = await this.prisma.audioSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) {
      throw new AudioSessionError('Session not found', 'SESSION_NOT_FOUND');
    }
    if (session.userId !== userId) {
      throw new AudioSessionError('You do not have access to this session', 'SESSION_ACCESS_DENIED');
    }
    if (!session.assemblyJobId) {
      throw new AudioSessionError(
        'This session has no AssemblyAI job id yet',
        'ASSEMBLY_JOB_MISSING'
      );
    }
    if (session.status !== SessionStatus.TRANSCRIBING) {
      throw new AudioSessionError(
        'Sync is only available while the session is transcribing',
        'INVALID_SESSION_STATE'
      );
    }

    const remote = await fetchTranscript(session.assemblyJobId);

    if (remote.status === 'error') {
      const detail = remote.error?.trim() ? remote.error : 'AssemblyAI transcription failed';
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.FAILED,
          processingError: `AssemblyAI: ${detail}`
        }
      });
      const failed = await this.getSession(sessionId);
      if (!failed) {
        throw new AudioSessionError('Failed to retrieve session', 'SESSION_RETRIEVAL_FAILED');
      }
      return failed;
    }

    if (remote.status === 'queued' || remote.status === 'processing') {
      throw new AudioSessionError(
        `Transcription is still in progress (status: ${remote.status})`,
        'TRANSCRIPT_NOT_READY'
      );
    }

    if (remote.status !== 'completed') {
      throw new AudioSessionError(
        `Unexpected transcript status: ${remote.status}`,
        'ASSEMBLY_SYNC_UNEXPECTED'
      );
    }

    const compactTranscript = toCompactJSON(
      (remote.utterances ?? undefined) as Parameters<typeof toCompactJSON>[0]
    );

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        assemblyJobId: session.assemblyJobId,
        compactTranscript: compactTranscript as object[],
        transcript: remote.text ?? null,
        status: SessionStatus.AWAITING_REVIEW
      }
    });

    const updated = await this.getSession(sessionId);
    if (!updated) {
      throw new AudioSessionError('Failed to retrieve session', 'SESSION_RETRIEVAL_FAILED');
    }
    return updated;
  }

  /**
   * Submit user-edited compact transcript and run coaching analysis (GPT JSON).
   */
  async updateTranscriptAndReanalyze(
    sessionId: string,
    userId: string,
    transcript: CompactTranscriptLine[]
  ): Promise<SessionWithAnalysis> {
    const session = await this.prisma.audioSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      throw new AudioSessionError('Session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId !== userId) {
      throw new AudioSessionError('You do not have access to this session', 'SESSION_ACCESS_DENIED');
    }

    const canAnalyze =
      session.status === SessionStatus.AWAITING_REVIEW ||
      (session.status === SessionStatus.FAILED &&
        typeof session.processingError === 'string' &&
        session.processingError.startsWith('Analysis failed'));

    if (!canAnalyze) {
      throw new AudioSessionError(
        `Session must be in 'awaiting_review' or a retryable analysis failure. Current state: '${session.status}'`,
        'INVALID_STATUS'
      );
    }

    if (!Array.isArray(transcript) || transcript.length === 0) {
      throw new AudioSessionError(
        'transcript must be a non-empty array of turn objects',
        'INVALID_TRANSCRIPT'
      );
    }

    let markdownTranscript: string;
    try {
      markdownTranscript = toMarkdown(transcript);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AudioSessionError(msg, 'INVALID_TRANSCRIPT', err as Error);
    }

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        editedTranscript: transcript as object[],
        status: SessionStatus.ANALYZING
      }
    });

    let aiReport: CoachingReport;
    try {
      aiReport = await generateAIReport(markdownTranscript);
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
      throw new AudioSessionError('AI analysis failed. Please try again.', 'ANALYSIS_FAILED', err as Error);
    }

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        aiAnalysis: aiReport as object,
        overallScore: aiReport.overallScore,
        clarityScore: aiReport.attributes.clarity.score,
        confidenceScore: aiReport.attributes.confidence.score,
        specificityScore: aiReport.attributes.specificity.score,
        toneScore: aiReport.attributes.tone.score,
        enthusiasmScore: aiReport.attributes.enthusiasm.score,
        status: SessionStatus.COMPLETED
      }
    });

    const updated = await this.getSession(sessionId);
    if (!updated) {
      throw new AudioSessionError('Failed to retrieve updated session', 'SESSION_RETRIEVAL_FAILED');
    }
    return updated;
  }

  /**
   * Update session display name (event label).
   */
  async updateSessionDisplayName(
    sessionId: string,
    userId: string,
    displayName: string | null
  ): Promise<AudioSession> {
    const session = await this.prisma.audioSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      throw new AudioSessionError('Session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId !== userId) {
      throw new AudioSessionError('You do not have access to this session', 'SESSION_ACCESS_DENIED');
    }

    return this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { displayName: displayName && displayName.trim() ? displayName.trim() : null }
    });
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<SessionWithAnalysis | null> {
    try {
      const session = await this.prisma.audioSession.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        return null;
      }

      return {
        ...session,
        analysisComplete: session.status === SessionStatus.COMPLETED,
        processingError:
          session.processingError ??
          (session.status === SessionStatus.FAILED ? 'Processing failed' : undefined)
      };
    } catch (error) {
      throw new AudioSessionError(
        'Failed to get session',
        'SESSION_RETRIEVAL_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get user's session history
   *
   * @param statusFilter - completed | failed | pending | processing | transcribing | awaiting_review | analyzing | all
   */
  async getSessionHistory(
    userId: string,
    limit: number = 20,
    statusFilter: string = 'completed',
    sessionTypeFilter: 'interview' | 'practice' | 'all' = 'all'
  ): Promise<AudioSession[]> {
    try {
      const whereClause: {
        userId: string;
        status?: string | { in: string[] };
        sessionType?: string;
      } = { userId };

      if (statusFilter !== 'all') {
        if (statusFilter === 'processing') {
          whereClause.status = { in: IN_FLIGHT_STATUSES };
        } else {
          whereClause.status = statusFilter;
        }
      }

      if (sessionTypeFilter !== 'all') {
        whereClause.sessionType = sessionTypeFilter;
      }

      const sessions = await this.prisma.audioSession.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return sessions;
    } catch (error) {
      throw new AudioSessionError(
        'Failed to get session history',
        'HISTORY_RETRIEVAL_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get user profile for analysis. Throws if profile does not exist.
   */
  private async getProfileForUserOrThrow(userId: string): Promise<UserProfile> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId }
    });
    if (!profile) {
      throw new AudioSessionError(
        'Please create your profile first. Processing will be available after you complete your profile.',
        'PROFILE_REQUIRED'
      );
    }
    return profile;
  }

}
