/**
 * System Integration Tests
 * Tests complete request/response flow with dependency injection
 * Requirements: All requirements integration
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import container from '../../src/container';
import { createApp } from '../../src/index';

describe('System Integration Tests', () => {
  let app: any;
  let services: any;
  let prisma: PrismaClient;
  let testUserId: string;
  let authToken: string;

  beforeAll(async () => {
    // Initialize container and services
    services = await container.initialize();
    prisma = services.prisma;
    
    // Create the app (without listening on a port)
    app = await createApp();

    // Clean up any existing test data
    await cleanupTestData();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
    
    // Cleanup container
    await container.cleanup();
  });

  async function cleanupTestData() {
    try {
      await prisma.audioSession.deleteMany({
        where: {
          user: {
            email: {
              contains: 'system-integration-test'
            }
          }
        }
      });
      await prisma.usageTracking.deleteMany({
        where: {
          user: {
            email: {
              contains: 'system-integration-test'
            }
          }
        }
      });
      await prisma.userProfile.deleteMany({
        where: {
          user: {
            email: {
              contains: 'system-integration-test'
            }
          }
        }
      });
      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'system-integration-test'
          }
        }
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  describe('1. Service Container Integration', () => {
    it('should have all services properly wired', () => {
      expect(services.prisma).toBeDefined();
      expect(services.authService).toBeDefined();
      expect(services.profileService).toBeDefined();
      expect(services.audioSessionService).toBeDefined();
      expect(services.subscriptionService).toBeDefined();
      expect(services.dashboardService).toBeDefined();
      expect(services.openaiService).toBeDefined();
      expect(services.s3Service).toBeDefined();
      expect(services.monitoringService).toBeDefined();
      expect(services.errorHandlingService).toBeDefined();
    });

    it('should have database connection established', async () => {
      const result = await prisma.$queryRaw`SELECT 1 as test`;
      expect(result).toBeDefined();
    });
  });

  describe('2. Complete Request/Response Flow', () => {
    it('should handle user registration with proper validation', async () => {
      // Test invalid email
      const invalidEmailResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'ValidPassword123!'
        });

      expect(invalidEmailResponse.status).toBe(400);
      expect(invalidEmailResponse.body.error.code).toBe('VALIDATION_ERROR');

      // Test weak password
      const weakPasswordResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'system-integration-test@example.com',
          password: 'weak'
        });

      expect(weakPasswordResponse.status).toBe(400);

      // Test valid registration
      const validResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'system-integration-test@example.com',
          password: 'ValidPassword123!'
        });

      expect(validResponse.status).toBe(201);
      expect(validResponse.body.success).toBe(true);
      expect(validResponse.body.user).toBeDefined();
      expect(validResponse.body.token).toBeDefined();

      testUserId = validResponse.body.user.id;
      authToken = validResponse.body.token;
    });

    it('should enforce authentication on protected endpoints', async () => {
      // Test without token
      const noTokenResponse = await request(app)
        .get('/api/profile');

      expect(noTokenResponse.status).toBe(401);

      // Test with invalid token
      const invalidTokenResponse = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer invalid-token');

      expect(invalidTokenResponse.status).toBe(401);

      // Test with valid token
      const validTokenResponse = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(validTokenResponse.status).toBe(200);
    });

    it('should handle profile management with validation', async () => {
      // Test profile update with invalid data
      const invalidUpdateResponse = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: '', // Empty string should be invalid
          targetJobTitle: ''
        });

      expect(invalidUpdateResponse.status).toBe(400);

      // Test valid profile update
      const validUpdateResponse = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: 'Technology',
          targetJobTitle: 'Software Engineer'
        });

      expect(validUpdateResponse.status).toBe(200);
      expect(validUpdateResponse.body.targetIndustry).toBe('Technology');
      expect(validUpdateResponse.body.targetJobTitle).toBe('Software Engineer');
    });

    it('should handle session management with subscription limits', async () => {
      // Create sessions up to the free tier limit
      const sessionIds: string[] = [];

      for (let i = 0; i < 3; i++) {
        const sessionResponse = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${authToken}`);

        expect(sessionResponse.status).toBe(201);
        sessionIds.push(sessionResponse.body.sessionId);
      }

      // Fourth session should be blocked
      const blockedSessionResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);

      expect(blockedSessionResponse.status).toBe(429);
      expect(blockedSessionResponse.body.error.code).toBe('USAGE_LIMIT_EXCEEDED');

      // Test session retrieval
      const sessionResponse = await request(app)
        .get(`/api/sessions/${sessionIds[0]}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(sessionResponse.status).toBe(200);
      expect(sessionResponse.body.id).toBe(sessionIds[0]);
    });

    it('should handle subscription management', async () => {
      // Check current subscription info
      const infoResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${authToken}`);

      expect(infoResponse.status).toBe(200);
      expect(infoResponse.body.data.tier).toBe('FREE');
      expect(infoResponse.body.data.currentUsage).toBe(3);
      expect(infoResponse.body.data.canCreateSession).toBe(false);

      // Upgrade subscription
      const upgradeResponse = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tier: 'PAID'
        });

      expect(upgradeResponse.status).toBe(200);

      // Verify upgrade
      const updatedInfoResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${authToken}`);

      expect(updatedInfoResponse.status).toBe(200);
      expect(updatedInfoResponse.body.data.tier).toBe('PAID');
      expect(updatedInfoResponse.body.data.canCreateSession).toBe(true);
    });

    it('should handle dashboard analytics', async () => {
      // Get dashboard stats
      const statsResponse = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body.confidenceScore).toBeDefined();
      expect(statsResponse.body.totalSessions).toBe(3);

      // Get insights
      const insightsResponse = await request(app)
        .get('/api/dashboard/insights')
        .set('Authorization', `Bearer ${authToken}`);

      expect(insightsResponse.status).toBe(200);
      expect(Array.isArray(insightsResponse.body.data)).toBe(true);

      // Get trends
      const trendsResponse = await request(app)
        .get('/api/dashboard/trends')
        .set('Authorization', `Bearer ${authToken}`);

      expect(trendsResponse.status).toBe(200);
      expect(Array.isArray(trendsResponse.body.data)).toBe(true);
    });
  });

  describe('3. Error Handling Integration', () => {
    it('should handle validation errors consistently', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid',
          password: 'weak'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.path).toBeDefined();
    });

    it('should handle not found errors', async () => {
      const response = await request(app)
        .get('/api/sessions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('should handle unauthorized access', async () => {
      const response = await request(app)
        .get('/api/profile');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('4. Security Integration', () => {
    it('should enforce data isolation', async () => {
      // Create another user
      const user2Response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'system-integration-test-2@example.com',
          password: 'ValidPassword123!'
        });

      const user2Token = user2Response.body.token;

      // Try to access first user's sessions with second user's token
      const sessionResponse = await request(app)
        .get('/api/sessions/history')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(sessionResponse.status).toBe(200);
      expect(sessionResponse.body.length).toBe(0); // Should not see other user's sessions
    });

    it('should sanitize input data', async () => {
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: '<script>alert("xss")</script>Technology',
          targetJobTitle: 'Software Engineer'
        });

      expect(response.status).toBe(200);
      expect(response.body.targetIndustry).not.toContain('<script>');
    });
  });

  describe('5. Performance and Monitoring', () => {
    it('should include performance headers', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      // Check for performance monitoring headers if enabled
      if (process.env.ENABLE_PERFORMANCE_MONITORING === 'true') {
        expect(response.headers['x-response-time']).toBeDefined();
      }
    });

    it('should handle health checks', async () => {
      const response = await request(app)
        .get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('API is healthy');
    });
  });

  describe('6. Logout and Cleanup', () => {
    it('should handle logout properly', async () => {
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      expect(logoutResponse.status).toBe(200);

      // Verify token is invalidated
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(meResponse.status).toBe(401);
    });
  });
});