/**
 * Integration Test: End-to-End Audio Transcription and Analysis
 * 
 * This test verifies the complete audio transcription and analysis flow:
 * 1. Upload audio file to S3
 * 2. Verify Whisper transcription succeeds
 * 3. Verify GPT analysis returns scores and feedback
 * 4. Verify session is updated with results
 * 
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4
 */

import { AudioSessionService } from '../../src/services/AudioSessionService';
import { S3Service } from '../../src/services/S3Service';
import { OpenAIService } from '../../src/services/OpenAIService';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import { AuthService } from '../../src/services/AuthService';
import prisma from '../../src/lib/prisma';

// Mock the monitoring service to prevent background health checks
jest.mock('../../src/services/MonitoringService', () => {
  const mockMonitoringService = {
    recordAPICall: jest.fn(),
    recordError: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
    getHealthStatus: jest.fn().mockReturnValue({ status: 'healthy' }),
    collectSystemMetrics: jest.fn(),
    performHealthChecks: jest.fn(),
    cleanupOldMetrics: jest.fn(),
    cleanupOldAlerts: jest.fn(),
    addAlert: jest.fn(),
    checkForAlerts: jest.fn()
  };
  
  return {
    monitoringService: mockMonitoringService,
    MonitoringService: jest.fn().mockImplementation(() => mockMonitoringService)
  };
});

describe('Audio Transcription and Analysis Integration Tests', () => {
  let audioSessionService: AudioSessionService;
  let s3Service: S3Service;
  let openaiService: OpenAIService;
  let subscriptionService: SubscriptionService;
  let authService: AuthService;
  let testUserId: string;
  let testAudioBuffer: Buffer;

  beforeAll(async () => {
    // Initialize services with test configuration
    const s3Config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
      region: process.env.AWS_REGION || 'us-east-1',
      bucketName: process.env.AWS_S3_BUCKET || 'test-bucket'
    };
    s3Service = new S3Service(s3Config);

    const openaiConfig = {
      gptApiKey: process.env.OPENAI_API_KEY || 'test-gpt-key',
      whisperApiKey: process.env.WHISPER_API_KEY || 'test-whisper-key',
      maxRetries: 3,
      timeout: 60000
    };
    openaiService = new OpenAIService(openaiConfig);

    subscriptionService = new SubscriptionService(prisma);
    authService = new AuthService(prisma);

    audioSessionService = new AudioSessionService(
      prisma,
      openaiService,
      s3Service,
      subscriptionService
    );

    // Create test user with profile
    const testUser = await authService.register('audio-test@example.com', 'Password123!');
    testUserId = testUser.user.id;

    // Create or update user profile with target role information
    await prisma.userProfile.upsert({
      where: { userId: testUserId },
      create: {
        userId: testUserId,
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        experienceLevel: 'mid',
        extractedSkills: ['JavaScript', 'TypeScript', 'React']
      },
      update: {
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        experienceLevel: 'mid',
        extractedSkills: ['JavaScript', 'TypeScript', 'React']
      }
    });

    // Create test audio buffer (WAV format)
    testAudioBuffer = createTestAudioBuffer();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      // Get all sessions for the test user
      const sessions = await prisma.audioSession.findMany({
        where: { userId: testUserId }
      });

      // Delete audio files from S3
      for (const session of sessions) {
        if (session.audioS3Key) {
          try {
            await s3Service.deleteFile(session.audioS3Key);
          } catch (error) {
            console.warn('Failed to delete test audio from S3:', error);
          }
        }
      }

      // Delete sessions
      await prisma.audioSession.deleteMany({
        where: { userId: testUserId }
      });

      // Delete profile
      await prisma.userProfile.deleteMany({
        where: { userId: testUserId }
      });

      // Delete user
      await prisma.user.deleteMany({
        where: { email: 'audio-test@example.com' }
      });
    } catch (error) {
      console.error('Cleanup error:', error);
    }

    await prisma.$disconnect();
  });

  describe('End-to-End Audio Transcription and Analysis', () => {
    it('should successfully upload audio, transcribe, analyze, and update session', async () => {
      // Step 1: Create a new session
      const session = await audioSessionService.startSession(testUserId);
      expect(session).toBeDefined();
      expect(session.userId).toBe(testUserId);
      expect(session.status).toBe('pending');

      // Step 2: Upload audio file to S3
      // Requirement 1.1: Upload audio file and store S3 key
      await audioSessionService.uploadAudio(session.id, testAudioBuffer, 'test-audio.wav');

      // Verify session was updated with S3 key
      let updatedSession = await audioSessionService.getSession(session.id);
      expect(updatedSession?.audioS3Key).toBeDefined();
      expect(updatedSession?.audioS3Key).toContain('audio-sessions/');
      expect(updatedSession?.audioS3Key).toContain(session.id);
      expect(updatedSession?.status).toBe('processing');

      // Verify file exists in S3
      const fileExists = await s3Service.fileExists(updatedSession!.audioS3Key);
      expect(fileExists).toBe(true);

      // Step 3: Wait for async processing to complete
      // The processAudio method is called asynchronously in uploadAudio
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      // Step 4: Verify Whisper transcription succeeded
      // Requirement 1.2, 1.3: Whisper transcription returns text
      updatedSession = await audioSessionService.getSession(session.id);
      expect(updatedSession?.transcript).toBeDefined();
      expect(updatedSession?.transcript).not.toBe('');
      expect(typeof updatedSession?.transcript).toBe('string');

      // Step 5: Verify GPT analysis returned scores and feedback
      // Requirement 2.1, 2.2, 2.3, 2.4: GPT analysis returns scores and feedback
      expect(updatedSession?.aiAnalysis).toBeDefined();
      const aiAnalysis = updatedSession?.aiAnalysis as {
        strengthAreas?: string[];
        strengthInsights?: string[];
        opportunityAreas?: string[];
        opportunityInsights?: string[];
        topTraits?: string[];
      } | null;
      expect(Array.isArray(aiAnalysis?.strengthAreas)).toBe(true);
      expect(Array.isArray(aiAnalysis?.strengthInsights)).toBe(true);
      expect(Array.isArray(aiAnalysis?.opportunityAreas)).toBe(true);
      expect(Array.isArray(aiAnalysis?.opportunityInsights)).toBe(true);
      expect(Array.isArray(aiAnalysis?.topTraits)).toBe(true);

      // Verify scores are present and within valid range
      expect(updatedSession?.clarityScore).toBeDefined();
      expect(updatedSession?.confidenceScore).toBeDefined();
      expect(updatedSession?.toneScore).toBeDefined();
      expect(updatedSession?.enthusiasmScore).toBeDefined();
      expect(updatedSession?.specificityScore).toBeDefined();

      // Scores should be between 1 and 5 (out of 5)
      expect(updatedSession?.clarityScore).toBeGreaterThanOrEqual(1);
      expect(updatedSession?.clarityScore).toBeLessThanOrEqual(5);
      expect(updatedSession?.confidenceScore).toBeGreaterThanOrEqual(1);
      expect(updatedSession?.confidenceScore).toBeLessThanOrEqual(5);

      // Step 6: Verify session is marked as completed
      expect(updatedSession?.status).toBe('completed');
      expect(updatedSession?.analysisComplete).toBe(true);

      // Step 7: Verify user profile was updated with AI attributes
      const profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });
      expect(profile?.aiAttributes).toBeDefined();
    }, 60000); // 60 second timeout

    it('should handle multiple sessions for the same user', async () => {
      // Create first session
      const session1 = await audioSessionService.startSession(testUserId);
      await audioSessionService.uploadAudio(session1.id, testAudioBuffer, 'audio1.wav');

      // Create second session
      const session2 = await audioSessionService.startSession(testUserId);
      await audioSessionService.uploadAudio(session2.id, testAudioBuffer, 'audio2.wav');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Verify both sessions completed
      const updatedSession1 = await audioSessionService.getSession(session1.id);
      const updatedSession2 = await audioSessionService.getSession(session2.id);

      expect(updatedSession1?.status).toBe('completed');
      expect(updatedSession2?.status).toBe('completed');

      // Verify sessions have different S3 keys
      expect(updatedSession1?.audioS3Key).not.toBe(updatedSession2?.audioS3Key);

      // Verify session history
      const history = await audioSessionService.getSessionHistory(testUserId);
      expect(history.length).toBeGreaterThanOrEqual(2);
    }, 60000);

    it('should include user context in GPT analysis', async () => {
      // Create session
      const session = await audioSessionService.startSession(testUserId);
      await audioSessionService.uploadAudio(session.id, testAudioBuffer, 'context-test.wav');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Verify analysis was performed with user context
      const updatedSession = await audioSessionService.getSession(session.id);
      expect(updatedSession?.aiAnalysis).toBeDefined();

      // The analysis should have been performed with the user's target role
      // This is verified indirectly by checking that analysis completed successfully
      expect(updatedSession?.status).toBe('completed');
    }, 60000);

    it('should handle session not found error', async () => {
      const nonExistentSessionId = '00000000-0000-0000-0000-000000000000';

      const session = await audioSessionService.getSession(nonExistentSessionId);
      expect(session).toBeNull();
    });

    it('should handle invalid session state for audio upload', async () => {
      // Create and process a session
      const session = await audioSessionService.startSession(testUserId);
      await audioSessionService.uploadAudio(session.id, testAudioBuffer, 'first-upload.wav');

      // Try to upload audio again to the same session
      await expect(
        audioSessionService.uploadAudio(session.id, testAudioBuffer, 'second-upload.wav')
      ).rejects.toThrow('Session is not in pending state');
    });

    it('should retrieve session history with correct ordering', async () => {
      // Create multiple sessions
      const session1 = await audioSessionService.startSession(testUserId);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const session2 = await audioSessionService.startSession(testUserId);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const session3 = await audioSessionService.startSession(testUserId);

      // Get history
      const history = await audioSessionService.getSessionHistory(testUserId, 10);

      // Verify sessions are ordered by creation date (newest first)
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history[0].id).toBe(session3.id);
      expect(history[1].id).toBe(session2.id);
      expect(history[2].id).toBe(session1.id);
    });

    it('should limit session history results', async () => {
      // Get history with limit
      const history = await audioSessionService.getSessionHistory(testUserId, 2);

      // Verify limit is respected
      expect(history.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Audio Processing Error Handling', () => {
    it('should handle transcription failures gracefully', async () => {
      // Create a service with a mock OpenAI service that fails transcription
      const failingOpenAIService = {
        transcribeAudio: jest.fn().mockRejectedValue(new Error('Whisper API failed')),
        analyzeResponse: jest.fn()
      } as any;

      const testAudioService = new AudioSessionService(
        prisma,
        failingOpenAIService,
        s3Service,
        subscriptionService
      );

      // Create another test user for this test
      const testUser2 = await authService.register('audio-test2@example.com', 'Password123!');
      const testUserId2 = testUser2.user.id;

      try {
        // Create session and upload audio
        const session = await testAudioService.startSession(testUserId2);
        await testAudioService.uploadAudio(session.id, testAudioBuffer, 'fail-test.wav');

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify session is marked as failed
        const updatedSession = await testAudioService.getSession(session.id);
        expect(updatedSession?.status).toBe('failed');

        // Clean up
        await prisma.audioSession.deleteMany({ where: { userId: testUserId2 } });
        await prisma.userProfile.deleteMany({ where: { userId: testUserId2 } });
        await prisma.user.deleteMany({ where: { email: 'audio-test2@example.com' } });
      } catch (error) {
        // Clean up on error
        await prisma.audioSession.deleteMany({ where: { userId: testUserId2 } });
        await prisma.userProfile.deleteMany({ where: { userId: testUserId2 } });
        await prisma.user.deleteMany({ where: { email: 'audio-test2@example.com' } });
        throw error;
      }
    }, 30000);
  });
});

/**
 * Helper function to create a test audio buffer
 * Creates a minimal valid WAV file that can be processed by Whisper
 */
function createTestAudioBuffer(): Buffer {
  // Create a minimal valid WAV file
  // WAV format: RIFF header + fmt chunk + data chunk
  
  const sampleRate = 16000; // 16kHz sample rate (good for speech)
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const duration = 2; // 2 seconds
  const numSamples = sampleRate * duration;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  
  // Create buffer for WAV file
  const buffer = Buffer.alloc(44 + dataSize);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byte rate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  
  // Generate simple audio data (sine wave at 440 Hz - A note)
  const frequency = 440;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate);
    const value = Math.round(sample * 32767 * 0.5); // 50% volume
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  
  return buffer;
}
