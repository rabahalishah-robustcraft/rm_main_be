jest.mock('../../src/services/practiceAnalysisService', () => ({
  analyzePracticeAnswer: jest.fn().mockResolvedValue({
    overallScore: 80,
    overallLabel: 'Excellent',
    summary: 'Mock re-analysis summary.',
    attributes: {
      clarity: { score: 80, feedback: 'Clear.', coachTip: 'Tip.' },
      confidence: { score: 80, feedback: 'Confident.', coachTip: 'Tip.' },
      specificity: { score: 80, feedback: 'Specific.', coachTip: 'Tip.' },
      tone: { score: 80, feedback: 'Good tone.', coachTip: 'Tip.' },
      enthusiasm: { score: 80, feedback: 'Enthusiastic.', coachTip: 'Tip.' }
    },
    insights: {
      strengths: ['One two three', 'Four five six', 'Seven eight nine'],
      focusAreas: ['Alpha beta gamma', 'Delta epsilon zeta', 'Eta theta iota']
    }
  })
}));

import { randomUUID } from 'crypto';
import type { Application } from 'express';
import request from 'supertest';
import { analyzePracticeAnswer } from '../../src/services/practiceAnalysisService';
import { createApp } from '../../src/index';
import prisma from '../../src/lib/prisma';
import { safeEmailVerificationOTPDeleteMany } from './helpers/safePrismaCleanup';
import { getVerifiedAuthToken } from './helpers/verifiedAuth';

const mockAnalyzePracticeAnswer = analyzePracticeAnswer as jest.MockedFunction<
  typeof analyzePracticeAnswer
>;

describe('PATCH /api/practice/sessions/:id re-analyze', () => {
  let app: Application;
  let token: string;
  let userId: string;
  const email = `practice_re_${randomUUID()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    app = await createApp();
    const auth = await getVerifiedAuthToken(app, email, password);
    token = auth.token;
    userId = auth.userId;
  });

  beforeEach(() => {
    mockAnalyzePracticeAnswer.mockClear();
  });

  afterAll(async () => {
    await prisma.audioSession.deleteMany({ where: { userId } });
    await safeEmailVerificationOTPDeleteMany(prisma, { email: email.toLowerCase() });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns 400 PRACTICE_SESSION_REQUIRED for interview sessions', async () => {
    const row = await prisma.audioSession.create({
      data: {
        userId,
        sessionType: 'interview',
        audioS3Key: `int-${randomUUID()}`,
        status: 'completed',
        overallScore: 50,
        clarityScore: 50,
        confidenceScore: 50,
        toneScore: 50,
        enthusiasmScore: 50,
        specificityScore: 50
      }
    });

    const res = await request(app)
      .patch(`/api/practice/sessions/${row.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ transcript: 'This is my edited answer with enough length.' })
      .expect(400);

    expect(res.body.error.code).toBe('PRACTICE_SESSION_REQUIRED');
    await prisma.audioSession.delete({ where: { id: row.id } });
  });

  it('returns 400 MISSING_PRACTICE_CONTEXT when stored aiAnalysis has no question', async () => {
    const row = await prisma.audioSession.create({
      data: {
        userId,
        sessionType: 'practice',
        audioS3Key: `pr-${randomUUID()}`,
        status: 'completed',
        overallScore: 50,
        clarityScore: 50,
        confidenceScore: 50,
        toneScore: 50,
        enthusiasmScore: 50,
        specificityScore: 50,
        aiAnalysis: { overallScore: 50 } as object
      }
    });

    const res = await request(app)
      .patch(`/api/practice/sessions/${row.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ transcript: 'This is my edited answer with enough length.' })
      .expect(400);

    expect(res.body.error.code).toBe('MISSING_PRACTICE_CONTEXT');
    await prisma.audioSession.delete({ where: { id: row.id } });
  });

  it('returns 200 and updates same session using mocked coaching', async () => {
    const storedQuestion = 'Tell me about a challenge you overcame.';
    const row = await prisma.audioSession.create({
      data: {
        userId,
        sessionType: 'practice',
        audioS3Key: `pr-${randomUUID()}`,
        status: 'completed',
        transcript: 'Old transcript text here.',
        overallScore: 50,
        clarityScore: 50,
        confidenceScore: 50,
        toneScore: 50,
        enthusiasmScore: 50,
        specificityScore: 50,
        aiAnalysis: {
          overallScore: 50,
          question: storedQuestion,
          questionIndex: 1,
          attributes: {
            clarity: { score: 50 },
            confidence: { score: 50 },
            specificity: { score: 50 },
            tone: { score: 50 },
            enthusiasm: { score: 50 }
          },
          insights: { strengths: ['a', 'b', 'c'], focusAreas: ['d', 'e', 'f'] }
        } as object
      }
    });

    const newText =
      'This is the fully edited answer text that is long enough for validation and analysis.';

    const res = await request(app)
      .patch(`/api/practice/sessions/${row.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ transcript: newText })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(row.id);
    expect(res.body.data.transcript).toBe(newText);
    expect(res.body.data.aiAnalysis.overallScore).toBe(80);
    expect(res.body.data.aiAnalysis.question).toBe(storedQuestion);
    expect(res.body.data.aiAnalysis.questionIndex).toBe(1);
    expect(res.body.data.scores.overall).toBe(80);

    expect(mockAnalyzePracticeAnswer).toHaveBeenCalledTimes(1);
    expect(mockAnalyzePracticeAnswer).toHaveBeenCalledWith(newText, storedQuestion);

    const fromDb = await prisma.audioSession.findUnique({ where: { id: row.id } });
    expect(fromDb?.transcript).toBe(newText);
    expect(fromDb?.status).toBe('completed');
    expect((fromDb?.aiAnalysis as { overallScore: number }).overallScore).toBe(80);

    await prisma.audioSession.delete({ where: { id: row.id } });
  });
});
