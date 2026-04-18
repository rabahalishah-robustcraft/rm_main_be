/**
 * Integration tests: AssemblyAI submit + webhook-style transcript ready + coaching analysis.
 */

import { AudioSessionService } from '../../src/services/AudioSessionService';
import { S3Service } from '../../src/services/S3Service';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import * as assemblyAIService from '../../src/services/assemblyAIService';
import * as analysisService from '../../src/services/analysisService';
import prisma from '../../src/lib/prisma';
import { createVerifiedUserWithProfile } from './helpers/testUserFactory';

jest.mock('../../src/services/MonitoringService', () => {
  const mockMonitoringService = {
    recordAPICall: jest.fn(),
    recordAPIOperation: jest.fn(),
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

function sampleCoachingReport() {
  return {
    overallScore: 73,
    overallLabel: 'Good effort',
    summary: 'Solid effort with room to grow.',
    attributes: {
      clarity: { score: 76, feedback: 'Clear structure.', coachTip: 'Use STAR.' },
      confidence: { score: 62, feedback: 'Some hedging.', coachTip: 'Be direct.' },
      specificity: { score: 58, feedback: 'Add metrics.', coachTip: 'Quantify wins.' },
      tone: { score: 82, feedback: 'Professional.', coachTip: 'Keep it up.' },
      enthusiasm: { score: 86, feedback: 'Strong energy.', coachTip: 'Lead with it.' }
    },
    insights: {
      strengths: ['Consistent enthusiasm', 'Adaptive tone', 'Clear pacing'],
      focusAreas: ['Add concrete metrics', 'Fewer filler words', 'Steadier delivery']
    }
  };
}

describe('Audio transcription and coaching flow', () => {
  let audioSessionService: AudioSessionService;
  let s3Service: S3Service;
  let subscriptionService: SubscriptionService;
  let testUserId: string;
  let testAudioBuffer: Buffer;

  beforeAll(async () => {
    const s3Config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
      region: process.env.AWS_REGION || 'us-east-1',
      bucketName: process.env.AWS_S3_BUCKET || 'test-bucket'
    };
    s3Service = new S3Service(s3Config);
    subscriptionService = new SubscriptionService(prisma);
    audioSessionService = new AudioSessionService(prisma, s3Service, subscriptionService);

    const testUser = await createVerifiedUserWithProfile('audio-test@example.com', 'Password123!');
    testUserId = testUser.id;

    await prisma.userProfile.update({
      where: { userId: testUserId },
      data: {
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        experienceLevel: 'mid',
        extractedSkills: ['JavaScript', 'TypeScript', 'React']
      }
    });

    testAudioBuffer = createTestAudioBuffer();
  });

  beforeEach(async () => {
    await prisma.usageTracking.deleteMany({ where: { userId: testUserId } });
    const existing = await prisma.audioSession.findMany({ where: { userId: testUserId } });
    for (const s of existing) {
      if (s.audioS3Key) {
        try {
          await s3Service.deleteFile(s.audioS3Key);
        } catch {
          // ignore
        }
      }
    }
    await prisma.audioSession.deleteMany({ where: { userId: testUserId } });

    let jobSeq = 0;
    jest.spyOn(assemblyAIService, 'submitTranscription').mockImplementation(async () => {
      jobSeq += 1;
      return `fake-assembly-job-id-${jobSeq}-${Date.now()}`;
    });
    jest.spyOn(analysisService, 'generateAIReport').mockResolvedValue(sampleCoachingReport() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const sessions = await prisma.audioSession.findMany({
        where: { userId: testUserId }
      });
      for (const session of sessions) {
        if (session.audioS3Key) {
          try {
            await s3Service.deleteFile(session.audioS3Key);
          } catch {
            // ignore
          }
        }
      }
      await prisma.audioSession.deleteMany({ where: { userId: testUserId } });
      await prisma.userProfile.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { email: 'audio-test@example.com' } });
    } catch (error) {
      console.error('Cleanup error:', error);
    }
    await prisma.$disconnect();
  });

  async function simulateAssemblyWebhookComplete(sessionId: string): Promise<void> {
    const row = await prisma.audioSession.findUnique({ where: { id: sessionId } });
    const jobId = row?.assemblyJobId || `sim-${sessionId}`;
    await prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        status: 'awaiting_review',
        assemblyJobId: jobId,
        transcript: 'Speaker A: Hello\nSpeaker B: Hi',
        compactTranscript: [
          { id: 0, s: 'A', t: 'Hello', start: 0, end: 400 },
          { id: 1, s: 'B', t: 'Hi', start: 400, end: 800 }
        ] as object[]
      }
    });
  }

  it('uploads audio, transcribing state, then coaching completes after review', async () => {
    const session = await audioSessionService.startSession(testUserId);
    expect(session.status).toBe('pending');

    const uploadResult = await audioSessionService.uploadAudio(
      session.id,
      testAudioBuffer,
      'test-audio.wav',
      'audio/wav'
    );
    expect(uploadResult.status).toBe('transcribing');
    expect(assemblyAIService.submitTranscription).toHaveBeenCalled();

    let row = await prisma.audioSession.findUnique({ where: { id: session.id } });
    expect(row?.audioS3Key).toContain('audio-sessions/');
    const fileExists = await s3Service.fileExists(row!.audioS3Key);
    expect(fileExists).toBe(true);

    await simulateAssemblyWebhookComplete(session.id);

    const turns = [
      { id: 0, s: 'A', t: 'Hello', start: 0, end: 400 },
      { id: 1, s: 'B', t: 'Hi', start: 400, end: 800 }
    ];
    const updated = await audioSessionService.updateTranscriptAndReanalyze(session.id, testUserId, turns);

    expect(updated.status).toBe('completed');
    expect(updated.aiAnalysis).toBeDefined();
    const analysis = updated.aiAnalysis as { overallScore?: number; insights?: { strengths: string[] } };
    expect(analysis.overallScore).toBe(73);
    expect(Array.isArray(analysis.insights?.strengths)).toBe(true);
    expect(updated.clarityScore).toBe(76);
    expect(updated.overallScore).toBe(73);
  }, 60000);

  it('handles multiple sessions', async () => {
    const session1 = await audioSessionService.startSession(testUserId);
    const session2 = await audioSessionService.startSession(testUserId);

    await audioSessionService.uploadAudio(session1.id, testAudioBuffer, 'a1.wav', 'audio/wav');
    await audioSessionService.uploadAudio(session2.id, testAudioBuffer, 'a2.wav', 'audio/wav');

    await simulateAssemblyWebhookComplete(session1.id);
    await simulateAssemblyWebhookComplete(session2.id);

    const turns = [{ id: 0, s: 'A', t: 'Hi', start: 0, end: 100 }];
    await audioSessionService.updateTranscriptAndReanalyze(session1.id, testUserId, turns);
    await audioSessionService.updateTranscriptAndReanalyze(session2.id, testUserId, turns);

    const s1 = await audioSessionService.getSession(session1.id);
    const s2 = await audioSessionService.getSession(session2.id);
    expect(s1?.status).toBe('completed');
    expect(s2?.status).toBe('completed');
    expect(s1?.audioS3Key).not.toBe(s2?.audioS3Key);
  }, 60000);

  it('rejects second upload when not pending', async () => {
    const session = await audioSessionService.startSession(testUserId);
    await audioSessionService.uploadAudio(session.id, testAudioBuffer, 'once.wav', 'audio/wav');
    await expect(
      audioSessionService.uploadAudio(session.id, testAudioBuffer, 'twice.wav', 'audio/wav')
    ).rejects.toMatchObject({ code: 'INVALID_SESSION_STATE' });
  });

  it('marks session failed when AssemblyAI submit throws', async () => {
    jest.spyOn(assemblyAIService, 'submitTranscription').mockRejectedValue(new Error('network down'));

    const testUser2 = await createVerifiedUserWithProfile('audio-test2@example.com', 'Password123!');
    try {
      const session = await audioSessionService.startSession(testUser2.id);
      await expect(
        audioSessionService.uploadAudio(session.id, testAudioBuffer, 'fail.wav', 'audio/wav')
      ).rejects.toMatchObject({ code: 'ASSEMBLYAI_SUBMIT_FAILED' });

      const failed = await prisma.audioSession.findUnique({ where: { id: session.id } });
      expect(failed?.status).toBe('failed');
      expect(failed?.processingError).toContain('AssemblyAI submission failed');
    } finally {
      await prisma.usageTracking.deleteMany({ where: { userId: testUser2.id } });
      await prisma.audioSession.deleteMany({ where: { userId: testUser2.id } });
      await prisma.userProfile.deleteMany({ where: { userId: testUser2.id } });
      await prisma.user.deleteMany({ where: { email: 'audio-test2@example.com' } });
    }
  });

  it('returns null for unknown session id', async () => {
    const session = await audioSessionService.getSession('c0000000000000000000000000');
    expect(session).toBeNull();
  });

  it('orders session history newest first', async () => {
    const session1 = await audioSessionService.startSession(testUserId);
    await new Promise((r) => setTimeout(r, 50));
    const session2 = await audioSessionService.startSession(testUserId);
    await new Promise((r) => setTimeout(r, 50));
    const session3 = await audioSessionService.startSession(testUserId);

    const history = await audioSessionService.getSessionHistory(testUserId, 10, 'all');
    const ids = history.map((h) => h.id);
    expect(ids.indexOf(session3.id)).toBeLessThan(ids.indexOf(session2.id));
    expect(ids.indexOf(session2.id)).toBeLessThan(ids.indexOf(session1.id));
  });

  it('respects history limit', async () => {
    const history = await audioSessionService.getSessionHistory(testUserId, 2, 'all');
    expect(history.length).toBeLessThanOrEqual(2);
  });
});

function createTestAudioBuffer(): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const duration = 2;
  const numSamples = sampleRate * duration;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const frequency = 440;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    const value = Math.round(sample * 32767 * 0.5);
    buffer.writeInt16LE(value, 44 + i * 2);
  }

  return buffer;
}
