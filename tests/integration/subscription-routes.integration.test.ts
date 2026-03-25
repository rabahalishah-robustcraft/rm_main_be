import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/index';
import { authService } from '../../src/services/AuthService';
import { SubscriptionTier } from '../../src/services/SubscriptionService';

const prisma = new PrismaClient();

describe('Subscription Routes Integration Tests', () => {
  let app: any;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await createApp();

    // Clean up any existing test data
    await prisma.usageTracking.deleteMany({
      where: {
        user: {
          email: {
            contains: 'subscription-test'
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'subscription-test'
        }
      }
    });
  });

  beforeEach(async () => {
    // Create test user and get auth token
    const testUser = await authService.register(
      'subscription-test@example.com',
      'Password123!'
    );
    authToken = testUser.token;
    userId = testUser.user.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.usageTracking.deleteMany({
      where: { userId }
    });
    await prisma.user.delete({
      where: { id: userId }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/subscription/info', () => {
    it('should return subscription info for free user', async () => {
      const response = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          tier: SubscriptionTier.FREE,
          currentUsage: 0,
          limit: 3,
          canCreateSession: true
        }
      });
    });

    it('should return subscription info for paid user', async () => {
      // Upgrade user to paid tier
      await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: SubscriptionTier.PAID }
      });

      const response = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          tier: SubscriptionTier.PAID,
          currentUsage: 0,
          limit: null,
          canCreateSession: true
        }
      });
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/subscription/info')
        .expect(401);
    });
  });

  describe('POST /api/subscription/upgrade', () => {
    it('should upgrade subscription to paid tier', async () => {
      const response = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ tier: SubscriptionTier.PAID })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Subscription upgraded to paid tier successfully',
        data: {
          tier: SubscriptionTier.PAID
        }
      });

      // Verify user was upgraded in database
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      expect(user?.subscriptionTier).toBe(SubscriptionTier.PAID);
    });

    it('should allow downgrade to free tier', async () => {
      // First upgrade to paid
      await prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: SubscriptionTier.PAID }
      });

      const response = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ tier: SubscriptionTier.FREE })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Subscription upgraded to free tier successfully',
        data: {
          tier: SubscriptionTier.FREE
        }
      });

      // Verify user was downgraded in database
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      expect(user?.subscriptionTier).toBe(SubscriptionTier.FREE);
    });

    it('should reject invalid tier', async () => {
      const response = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ tier: 'invalid' })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_TIER');
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/subscription/upgrade')
        .send({ tier: SubscriptionTier.PAID })
        .expect(401);
    });

    it('should require tier in request body', async () => {
      const response = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_TIER');
    });
  });
});