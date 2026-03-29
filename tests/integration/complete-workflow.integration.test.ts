import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/index';

const prisma = new PrismaClient();

describe('Complete User Workflow Integration Tests', () => {
  let app: any;
  let userId: string;
  let authToken: string;
  let sessionId: string;

  beforeAll(async () => {
    app = await createApp();

    // Clean up any existing test data
    await prisma.audioSession.deleteMany({
      where: {
        user: {
          email: {
            contains: 'workflow-test'
          }
        }
      }
    });
    await prisma.usageTracking.deleteMany({
      where: {
        user: {
          email: {
            contains: 'workflow-test'
          }
        }
      }
    });
    await prisma.userProfile.deleteMany({
      where: {
        user: {
          email: {
            contains: 'workflow-test'
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'workflow-test'
        }
      }
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (userId) {
      await prisma.audioSession.deleteMany({
        where: { userId }
      });
      await prisma.usageTracking.deleteMany({
        where: { userId }
      });
      await prisma.userProfile.delete({
        where: { userId }
      }).catch(() => {}); // Ignore if not exists
      await prisma.user.delete({
        where: { id: userId }
      }).catch(() => {}); // Ignore if not exists
    }
  });

  describe('1. User Registration', () => {
    it('should successfully register a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'workflow-test@example.com',
          password: 'SecurePassword123!'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('workflow-test@example.com');
      expect(response.body.user.subscriptionTier).toBe('FREE');

      userId = response.body.user.id;
      authToken = response.body.token;
    });

    it('should create a default user profile', async () => {
      const profile = await prisma.userProfile.findUnique({
        where: { userId }
      });

      expect(profile).toBeTruthy();
      expect(profile?.userId).toBe(userId);
    });

    it('should create usage tracking record', async () => {
      const currentDate = new Date();
      const usage = await prisma.usageTracking.findFirst({
        where: {
          userId,
          month: currentDate.getMonth() + 1,
          year: currentDate.getFullYear()
        }
      });

      expect(usage).toBeTruthy();
      expect(usage?.sessionCount).toBe(0);
    });
  });

  describe('2. Profile Management', () => {
    it('should get user profile', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body.userId).toBe(userId);
    });

    it('should update target role', async () => {
      const response = await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: 'Technology',
          targetJobTitle: 'Software Engineer'
        });

      expect(response.status).toBe(200);
      expect(response.body.targetIndustry).toBe('Technology');
      expect(response.body.targetJobTitle).toBe('Software Engineer');
    });

    it('should update profile with additional data', async () => {
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: 'Technology',
          targetJobTitle: 'Senior Software Engineer'
        });

      expect(response.status).toBe(200);
      expect(response.body.targetJobTitle).toBe('Senior Software Engineer');
    });
  });

  describe('3. Session Management', () => {
    it('should check usage limits before session creation', async () => {
      // First verify we can create sessions (free tier allows 3)
      const response = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body.status).toBe('PENDING');

      sessionId = response.body.sessionId;
    });

    it('should get session details', async () => {
      const response = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(sessionId);
      expect(response.body.userId).toBe(userId);
      expect(response.body.status).toBe('PENDING');
    });

    it('should get session history', async () => {
      const response = await request(app)
        .get('/api/sessions/history')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].id).toBe(sessionId);
    });
  });

  describe('4. Subscription Limits', () => {
    it('should track usage correctly', async () => {
      // Create additional sessions to test limits
      const session2Response = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);
      expect(session2Response.status).toBe(201);

      const session3Response = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);
      expect(session3Response.status).toBe(201);

      // Fourth session should be blocked (free tier limit is 3)
      const session4Response = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);
      expect(session4Response.status).toBe(429); // Too Many Requests
      expect(session4Response.body.error.code).toBe('USAGE_LIMIT_EXCEEDED');
    });

    it('should get subscription info', async () => {
      const response = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.tier).toBe('FREE');
      expect(response.body.usageThisMonth).toBe(3); // 3 sessions created
      expect(response.body.monthlyLimit).toBe(3);
    });

    it('should allow subscription upgrade', async () => {
      const response = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tier: 'PAID'
        });

      expect(response.status).toBe(200);
      expect(response.body.subscriptionTier).toBe('PAID');
    });

    it('should allow unlimited sessions after upgrade', async () => {
      const response = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('sessionId');
    });
  });

  describe('5. Authentication Flow', () => {
    it('should validate JWT tokens', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(userId);
      expect(response.body.email).toBe('workflow-test@example.com');
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
    });

    it('should reject requests with logged out token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe('6. Login Flow', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'workflow-test@example.com',
          password: 'SecurePassword123!'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.id).toBe(userId);

      // Update token for cleanup
      authToken = response.body.token;
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'workflow-test@example.com',
          password: 'WrongPassword'
        });

      expect(response.status).toBe(401);
    });
  });
});