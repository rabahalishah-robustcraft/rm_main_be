import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/index';
import { authService } from '../../src/services/AuthService';
import { SubscriptionTier } from '../../src/services/SubscriptionService';
import { safeEmailVerificationOTPDeleteMany } from './helpers/safePrismaCleanup';

const prisma = new PrismaClient();

const stripeFields = {
  stripeSubscriptionId: null,
  stripeSubscriptionStatus: null,
  stripeCurrentPeriodEnd: null
};

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
    const { user } = await authService.register(
      'subscription-test@example.com',
      'Password123!'
    );
    userId = user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true }
    });
    await safeEmailVerificationOTPDeleteMany(prisma, {
      email: 'subscription-test@example.com'
    });
    const session = await authService.login('subscription-test@example.com', 'Password123!');
    authToken = session.token;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.usageTracking.deleteMany({
      where: { userId }
    });
    await safeEmailVerificationOTPDeleteMany(prisma, {
      email: 'subscription-test@example.com'
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
          canCreateSession: true,
          ...stripeFields
        }
      });
    });

    it('should return subscription info for paid user', async () => {
      // Upgrade user to paid tier (simulates successful Stripe webhook)
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
          canCreateSession: true,
          ...stripeFields
        }
      });
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/subscription/info')
        .expect(401);
    });
  });

  describe('POST /api/subscription/checkout-session', () => {
    it('should require authentication', async () => {
      await request(app)
        .post('/api/subscription/checkout-session')
        .expect(401);
    });
  });
});
