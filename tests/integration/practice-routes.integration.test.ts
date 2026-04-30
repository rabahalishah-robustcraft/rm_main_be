import { randomUUID } from 'crypto';
import type { Application } from 'express';
import request from 'supertest';
import { createApp } from '../../src/index';
import prisma from '../../src/lib/prisma';
import { safeEmailVerificationOTPDeleteMany } from './helpers/safePrismaCleanup';
import { getVerifiedAuthToken } from './helpers/verifiedAuth';

describe('Practice routes and session history sessionType', () => {
  let app: Application;
  let token: string;
  let userId: string;
  const email = `practice_hist_${randomUUID()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    app = await createApp();
    const auth = await getVerifiedAuthToken(app, email, password);
    token = auth.token;
    userId = auth.userId;
  });

  afterAll(async () => {
    await prisma.audioSession.deleteMany({ where: { userId } });
    await prisma.practiceQuestion.deleteMany({ where: { userId } });
    await safeEmailVerificationOTPDeleteMany(prisma, { email: email.toLowerCase() });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns 401 for GET /api/practice/questions without auth', async () => {
    await request(app).get('/api/practice/questions').expect(401);
  });

  it('returns 401 for POST /api/practice/sessions without auth', async () => {
    await request(app).post('/api/practice/sessions').expect(401);
  });

  it('GET /api/practice/questions returns three sections in ai_recommended, behavioral, domain order', async () => {
    await prisma.practiceQuestion.deleteMany({ where: { userId } });

    const res = await request(app)
      .get('/api/practice/questions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const keys = res.body.data.sections.map((s: { key: string }) => s.key);
    expect(keys).toEqual(['ai_recommended', 'behavioral', 'domain']);
    for (const section of res.body.data.sections) {
      expect(section.questions).toHaveLength(3);
      expect(section.questions.map((q: { index: number }) => q.index)).toEqual([0, 1, 2]);
    }
  });

  it('rejects invalid sessionType on GET /api/sessions/history', async () => {
    const res = await request(app)
      .get('/api/sessions/history?sessionType=invalid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(['VALIDATION_ERROR', 'INVALID_SESSION_TYPE']).toContain(res.body.error.code);
  });

  it('includes sessionType on history items and filters by sessionType', async () => {
    await prisma.audioSession.deleteMany({ where: { userId } });

    await prisma.audioSession.createMany({
      data: [
        {
          userId,
          sessionType: 'interview',
          audioS3Key: `hist-int-${randomUUID()}`,
          status: 'completed',
          overallScore: 50,
          clarityScore: 50,
          confidenceScore: 50,
          toneScore: 50,
          enthusiasmScore: 50,
          specificityScore: 50
        },
        {
          userId,
          sessionType: 'practice',
          audioS3Key: `hist-prac-${randomUUID()}`,
          status: 'completed',
          overallScore: 60,
          clarityScore: 60,
          confidenceScore: 60,
          toneScore: 60,
          enthusiasmScore: 60,
          specificityScore: 60
        }
      ]
    });

    const all = await request(app)
      .get('/api/sessions/history?status=completed&sessionType=all&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(all.body.success).toBe(true);
    expect(all.body.data.filter).toEqual({ status: 'completed', sessionType: 'all' });
    const sessionTypes = all.body.data.sessions.map(
      (s: { sessionType: string }) => s.sessionType
    );
    expect(sessionTypes).toContain('interview');
    expect(sessionTypes).toContain('practice');
    expect(all.body.data.sessions[0]).toHaveProperty('sessionType');

    const interviewOnly = await request(app)
      .get('/api/sessions/history?status=completed&sessionType=interview&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(
      interviewOnly.body.data.sessions.every(
        (s: { sessionType: string }) => s.sessionType === 'interview'
      )
    ).toBe(true);

    const practiceOnly = await request(app)
      .get('/api/sessions/history?status=completed&sessionType=practice&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(
      practiceOnly.body.data.sessions.every(
        (s: { sessionType: string }) => s.sessionType === 'practice'
      )
    ).toBe(true);
  });
});
