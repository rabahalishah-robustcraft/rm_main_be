import { PrismaClient, AudioSession, UserProfile } from '@prisma/client';
import { OpenAIService, AIAnalysis, UserContext } from './OpenAIService';
import { S3Service } from './S3Service';
import { SubscriptionService, SubscriptionError } from './SubscriptionService';
import { sanitizeFilename } from '../utils/fileUpload';
import { formatSessionDisplayName } from '../utils/sessionDisplayName';

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
 * Session status enumeration
 */
export enum SessionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
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
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4
 */
export class AudioSessionService {
  constructor(
    private prisma: PrismaClient,
    private openaiService: OpenAIService,
    private s3Service: S3Service,
    private subscriptionService: SubscriptionService
  ) {}

  /**
   * Start a new audio session
   * Requirements: 3.1, 6.2, 6.3
   */
  async startSession(userId: string): Promise<AudioSession> {
    try {
      // Verify user exists and get profile
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw new AudioSessionError('User not found', 'USER_NOT_FOUND');
      }

      // Validate usage limits before creating session
      // Requirements: 6.2, 6.3
      await this.subscriptionService.validateUsageLimit(userId);

      // Create new session with pending status
      const now = new Date();
      const session = await this.prisma.audioSession.create({
        data: {
          userId,
          audioS3Key: '', // Will be set when audio is uploaded
          status: SessionStatus.PENDING,
          displayName: formatSessionDisplayName(now)
        }
      });

      return session;
    } catch (error) {
      if (error instanceof AudioSessionError) {
        throw error;
      }
      // Re-throw SubscriptionError as AudioSessionError to maintain consistent error handling
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
   * Upload audio file and initiate processing
   * Requirements: 3.2
   * 
   * IMPORTANT: Process audio BEFORE uploading to S3 to avoid GetObject permission issues
   * Flow: Receive -> Transcribe -> Analyze -> Upload to S3 (for archival only)
   */
  async uploadAudio(sessionId: string, audioBuffer: Buffer, filename: string = 'audio.wav'): Promise<void> {
    try {
      // Verify session exists and is in pending state
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
        throw new AudioSessionError(
          'Session is not in pending state',
          'INVALID_SESSION_STATE'
        );
      }

      // Require profile before processing so the user gets an immediate error if missing
      await this.getProfileForUserOrThrow(session.userId);

      // Update session to processing status
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.PROCESSING }
      });

      // Process audio immediately (before S3 upload)
      this.processAudioInMemory(sessionId, audioBuffer, filename, session).catch(error => {
        console.error(`Failed to process audio for session ${sessionId}:`, error);
        // Update session status to failed
        this.prisma.audioSession.update({
          where: { id: sessionId },
          data: { status: SessionStatus.FAILED }
        }).catch(updateError => {
          console.error(`Failed to update session status:`, updateError);
        });
      });

    } catch (error) {
      if (error instanceof AudioSessionError) {
        throw error;
      }
      throw new AudioSessionError(
        'Failed to upload audio',
        'AUDIO_UPLOAD_FAILED',
        error as Error
      );
    }
  }

  /**
   * Process audio file in memory (without downloading from S3)
   * Requirements: 3.3, 3.4, 4.1, 4.2, 4.3, 4.4
   * 
   * This method processes audio directly from memory buffer to avoid S3 GetObject permission issues
   */
  private async processAudioInMemory(
    sessionId: string, 
    audioBuffer: Buffer, 
    filename: string,
    session: any
  ): Promise<void> {
    try {
      // Step 1: Transcribe audio using Whisper (directly from buffer)
      console.log(`Starting audio transcription for session ${sessionId}`);
      const transcriptionResult = await this.openaiService.transcribeAudio(
        audioBuffer,
        filename
      );

      // Update session with transcript
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { transcript: transcriptionResult.text }
      });

      console.log(`Transcription completed for session ${sessionId}`);

      // Step 2: Analyze response using GPT with user context and past sessions summary
      const profile = await this.getProfileForUserOrThrow(session.userId);
      const pastSessionsSummary = await this.getPastSessionsSummary(session.userId, sessionId, 5);
      const userContext: UserContext = {
        profile,
        targetRole: profile.targetIndustry && profile.targetJobTitle
          ? { industry: profile.targetIndustry, jobTitle: profile.targetJobTitle }
          : undefined,
        pastSessionsSummary: pastSessionsSummary || undefined
      };

      console.log(`Starting AI analysis for session ${sessionId}`);
      const analysis = await this.openaiService.analyzeResponse(
        transcriptionResult.text,
        userContext
      );

      // Step 3: Store analysis results and scores
      await this.updateSessionWithAnalysis(sessionId, analysis);

      // Step 4: Update AI attributes in user profile
      await this.updateUserAIAttributes(session.userId, analysis.aiAttributes);

      console.log(`AI analysis completed for session ${sessionId}`);

      // Step 5: Upload audio to S3 for archival (after processing is complete)
      const sanitizedFilename = sanitizeFilename(filename);
      const s3Key = `audio-sessions/${sessionId}/${Date.now()}-${sanitizedFilename}`;
      
      try {
        await this.s3Service.upload(s3Key, audioBuffer, { contentType: 'audio/wav' });
        console.log(`Audio uploaded to S3 for session ${sessionId}: ${s3Key}`);
        
        // Update session with S3 key
        await this.prisma.audioSession.update({
          where: { id: sessionId },
          data: { audioS3Key: s3Key }
        });
      } catch (s3Error) {
        // S3 upload failure is not critical since processing is already complete
        console.error(`Failed to upload audio to S3 for session ${sessionId}:`, s3Error);
        // Continue without throwing - the session is still valid
      }

      // Mark session as completed and increment usage
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.COMPLETED }
      });

      // Increment usage count after successful session completion
      // Requirements: 3.5, 6.2
      await this.subscriptionService.incrementUsage(session.userId);

      console.log(`Session ${sessionId} processing completed successfully`);

    } catch (error) {
      const errorMessage = (error as Error)?.message || 'Processing failed';
      const processingError = errorMessage.length > 500 ? errorMessage.slice(0, 497) + '...' : errorMessage;
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.FAILED, processingError }
      }).catch(() => {});

      if (error instanceof AudioSessionError) {
        throw error;
      }
      throw new AudioSessionError(
        'Failed to process audio',
        'AUDIO_PROCESSING_FAILED',
        error as Error
      );
    }
  }

  /**
   * Process audio file through AI analysis pipeline (legacy method - downloads from S3)
   * Requirements: 3.3, 3.4, 4.1, 4.2, 4.3, 4.4
   * 
   * NOTE: This method is kept for backward compatibility but should not be used
   * due to S3 GetObject permission issues. Use processAudioInMemory instead.
   */
  async processAudio(sessionId: string): Promise<void> {
    try {
      // Get session with user profile
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

      if (!session.audioS3Key) {
        throw new AudioSessionError('No audio file found for session', 'NO_AUDIO_FILE');
      }

      // Download audio from S3
      const audioBuffer = await this.s3Service.download(session.audioS3Key);

      // Step 1: Transcribe audio using Whisper
      const transcriptionResult = await this.openaiService.transcribeAudio(
        audioBuffer,
        `session-${sessionId}.wav`
      );

      // Update session with transcript
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { transcript: transcriptionResult.text }
      });

      // Step 2: Analyze response using GPT with user context and past sessions summary
      const profile = await this.getProfileForUserOrThrow(session.userId);
      const pastSessionsSummary = await this.getPastSessionsSummary(session.userId, sessionId, 5);
      const userContext: UserContext = {
        profile,
        targetRole: profile.targetIndustry && profile.targetJobTitle
          ? { industry: profile.targetIndustry, jobTitle: profile.targetJobTitle }
          : undefined,
        pastSessionsSummary: pastSessionsSummary || undefined
      };

      const analysis = await this.openaiService.analyzeResponse(
        transcriptionResult.text,
        userContext
      );

      // Step 3: Store analysis results and scores
      await this.updateSessionWithAnalysis(sessionId, analysis);

      // Step 4: Update AI attributes in user profile
      await this.updateUserAIAttributes(session.userId, analysis.aiAttributes);

      // Mark session as completed and increment usage
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.COMPLETED }
      });

      // Increment usage count after successful session completion
      // Requirements: 3.5, 6.2
      await this.subscriptionService.incrementUsage(session.userId);

    } catch (error) {
      const errorMessage = (error as Error)?.message || 'Processing failed';
      const processingError = errorMessage.length > 500 ? errorMessage.slice(0, 497) + '...' : errorMessage;
      await this.prisma.audioSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.FAILED, processingError }
      }).catch(() => {});

      if (error instanceof AudioSessionError) {
        throw error;
      }
      throw new AudioSessionError(
        'Failed to process audio',
        'AUDIO_PROCESSING_FAILED',
        error as Error
      );
    }
  }

  /**
   * Update transcript and re-run AI analysis (edit transcript and resubmit for insights).
   * Does not increment usage count (same event).
   */
  async updateTranscriptAndReanalyze(sessionId: string, userId: string, transcript: string): Promise<SessionWithAnalysis> {
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

    if (session.userId !== userId) {
      throw new AudioSessionError('You do not have access to this session', 'SESSION_ACCESS_DENIED');
    }

    // Allow re-analysis for completed or failed sessions (user correcting transcript)
    if (session.status !== SessionStatus.COMPLETED && session.status !== SessionStatus.FAILED) {
      throw new AudioSessionError(
        'Session must be completed or failed to update transcript and re-analyze',
        'INVALID_SESSION_STATE'
      );
    }

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { transcript }
    });

    const profile = await this.getProfileForUserOrThrow(session.userId);
    const pastSessionsSummary = await this.getPastSessionsSummary(session.userId, sessionId, 5);
    const userContext: UserContext = {
      profile,
      targetRole: profile.targetIndustry && profile.targetJobTitle
        ? { industry: profile.targetIndustry, jobTitle: profile.targetJobTitle }
        : undefined,
      pastSessionsSummary: pastSessionsSummary || undefined
    };

    const analysis = await this.openaiService.analyzeResponse(transcript, userContext);
    await this.updateSessionWithAnalysis(sessionId, analysis);
    await this.updateUserAIAttributes(session.userId, analysis.aiAttributes);

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.COMPLETED }
    });

    const updated = await this.getSession(sessionId);
    if (!updated) {
      throw new AudioSessionError('Failed to retrieve updated session', 'SESSION_RETRIEVAL_FAILED');
    }
    return updated;
  }

  /**
   * Update session display name (event label) for user-editable event naming.
   */
  async updateSessionDisplayName(sessionId: string, userId: string, displayName: string | null): Promise<AudioSession> {
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
   * Requirements: 3.1
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
        processingError: session.processingError ?? (session.status === SessionStatus.FAILED ? 'Processing failed' : undefined)
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
   * Requirements: 5.3
   * 
   * @param userId - User ID
   * @param limit - Maximum number of sessions to return
   * @param statusFilter - Filter by status: 'completed', 'processing', 'failed', 'pending', or 'all'
   */
  async getSessionHistory(userId: string, limit: number = 20, statusFilter: string = 'completed'): Promise<AudioSession[]> {
    try {
      // Build where clause based on status filter
      const whereClause: any = { userId };
      
      if (statusFilter !== 'all') {
        whereClause.status = statusFilter;
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
   * Calculate performance scores from analysis
   * Requirements: 4.3
   */
  private calculatePerformanceScores(analysis: AIAnalysis): {
    clarityScore: number;
    confidenceScore: number;
    toneScore: number;
    enthusiasmScore: number;
    specificityScore: number;
  } {
    const { scores } = analysis;
    
    // Ensure scores are within valid range (1-5 out of 5)
    const clampScore = (score: number): number => Math.max(1, Math.min(5, Math.round(score)));

    return {
      clarityScore: clampScore(scores.clarity),
      confidenceScore: clampScore(scores.confidence),
      toneScore: clampScore(scores.tone),
      enthusiasmScore: clampScore(scores.enthusiasm),
      specificityScore: clampScore(scores.specificity)
    };
  }

  /**
   * Update session with analysis results
   * Requirements: 4.4
   */
  private async updateSessionWithAnalysis(sessionId: string, analysis: AIAnalysis): Promise<void> {
    const scores = this.calculatePerformanceScores(analysis);

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        aiAnalysis: analysis as any, // Cast to any to handle Prisma JSON type
        ...scores
      }
    });
  }

  /**
   * Get user profile for analysis. Throws if profile does not exist so the user is asked to create their profile first.
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

  /**
   * Build a short summary of past sessions for inclusion in the analysis prompt (DB retrieval of past events).
   */
  private async getPastSessionsSummary(userId: string, excludeSessionId: string | null, limit: number = 5): Promise<string> {
    const where: any = { userId, status: SessionStatus.COMPLETED };
    if (excludeSessionId) {
      where.id = { not: excludeSessionId };
    }
    const pastSessions = await this.prisma.audioSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    if (pastSessions.length === 0) {
      return '';
    }

    return pastSessions
      .map(s => {
        const date = s.createdAt.toISOString().split('T')[0];
        const scores = [s.clarityScore, s.confidenceScore, s.toneScore, s.enthusiasmScore, s.specificityScore]
          .filter((n): n is number => n != null);
        const overall = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        const insights =
          (s.aiAnalysis as any)?.insights != null && Array.isArray((s.aiAnalysis as any).insights)
            ? (s.aiAnalysis as any).insights.slice(0, 2).join('; ')
            : 'N/A';
        return `- ${date}: overall ~${Math.round(overall)}, insights: ${insights}`;
      })
      .join('\n');
  }

  /**
   * Update user AI attributes based on analysis
   * Requirements: 2.4
   */
  private async updateUserAIAttributes(userId: string, newAttributes: Record<string, any>): Promise<void> {
    try {
      // Get current profile
      const profile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!profile) {
        // Create profile if it doesn't exist
        await this.prisma.userProfile.create({
          data: {
            userId,
            aiAttributes: newAttributes
          }
        });
        return;
      }

      // Merge new attributes with existing ones
      const currentAttributes = (profile.aiAttributes as Record<string, any>) || {};
      const mergedAttributes = { ...currentAttributes, ...newAttributes };

      // Update profile with merged attributes
      await this.prisma.userProfile.update({
        where: { userId },
        data: { aiAttributes: mergedAttributes }
      });
    } catch (error) {
      console.error('Failed to update AI attributes:', error);
      // Don't throw error as this is not critical for session completion
    }
  }

  /**
   * Async wrapper for audio processing to avoid blocking
   * Requirements: 3.3
   */
  private async processAudioAsync(sessionId: string): Promise<void> {
    try {
      await this.processAudio(sessionId);
    } catch (error) {
      console.error(`Audio processing failed for session ${sessionId}:`, error);
      throw error;
    }
  }
}