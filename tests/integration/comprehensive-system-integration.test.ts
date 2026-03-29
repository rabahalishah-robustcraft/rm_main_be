/**
 * Comprehensive System Integration Tests
 * Tests complete system integration with dependency injection, validation, and workflows
 * Requirements: All requirements integration - Task 13.1
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import container from '../../src/container';
import { createApp } from '../../src/index';

describe('Comprehensive System Integration Tests', () => {
  let app: any;
  let services: any;
  let prisma: PrismaClient;
  let testUsers: Array<{ id: string; email: string; token: string }> = [];

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
              contains: 'comprehensive-test'
            }
          }
        }
      });
      await prisma.usageTracking.deleteMany({
        where: {
          user: {
            email: {
              contains: 'comprehensive-test'
            }
          }
        }
      });
      await prisma.userProfile.deleteMany({
        where: {
          user: {
            email: {
              contains: 'comprehensive-test'
            }
          }
        }
      });
      await prisma.user.deleteMany({
        where: {
          email: {
            contains: 'comprehensive-test'
          }
        }
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  describe('1. Service Container and Dependency Injection', () => {
    it('should have all services properly wired in container', () => {
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

    it('should have proper service dependencies', () => {
      // AudioSessionService should have dependencies
      expect(services.audioSessionService).toBeDefined();
      
      // ProfileService should have S3 and OpenAI dependencies
      expect(services.profileService).toBeDefined();
      
      // All services should be instances of their respective classes
      expect(services.authService.constructor.name).toBe('AuthService');
      expect(services.profileService.constructor.name).toBe('ProfileService');
      expect(services.audioSessionService.constructor.name).toBe('AudioSessionService');
    });
  });

  describe('2. Comprehensive Input Validation', () => {
    describe('Authentication Validation', () => {
      it('should validate registration input comprehensively', async () => {
        // Test missing email
        const noEmailResponse = await request(app)
          .post('/api/auth/register')
          .send({ password: 'ValidPassword123!' });
        expect(noEmailResponse.status).toBe(400);
        expect(noEmailResponse.body.error.code).toBe('VALIDATION_ERROR');

        // Test invalid email format
        const invalidEmailResponse = await request(app)
          .post('/api/auth/register')
          .send({ email: 'not-an-email', password: 'ValidPassword123!' });
        expect(invalidEmailResponse.status).toBe(400);

        // Test weak password (no uppercase)
        const noUppercaseResponse = await request(app)
          .post('/api/auth/register')
          .send({ email: 'test@example.com', password: 'validpassword123!' });
        expect(noUppercaseResponse.status).toBe(400);

        // Test weak password (no special characters)
        const noSpecialResponse = await request(app)
          .post('/api/auth/register')
          .send({ email: 'test@example.com', password: 'ValidPassword123' });
        expect(noSpecialResponse.status).toBe(400);

        // Test weak password (too short)
        const tooShortResponse = await request(app)
          .post('/api/auth/register')
          .send({ email: 'test@example.com', password: 'Val1!' });
        expect(tooShortResponse.status).toBe(400);
      });

      it('should validate login input', async () => {
        // Test missing fields
        const noPasswordResponse = await request(app)
          .post('/api/auth/login')
          .send({ email: 'test@example.com' });
        expect(noPasswordResponse.status).toBe(400);

        const noEmailResponse = await request(app)
          .post('/api/auth/login')
          .send({ password: 'password' });
        expect(noEmailResponse.status).toBe(400);

        // Test invalid email format
        const invalidEmailResponse = await request(app)
          .post('/api/auth/login')
          .send({ email: 'not-an-email', password: 'password' });
        expect(invalidEmailResponse.status).toBe(400);
      });
    });

    describe('Profile Validation', () => {
      let authToken: string;

      beforeAll(async () => {
        // Create a test user for profile tests
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'comprehensive-test-profile@example.com',
            password: 'ValidPassword123!'
          });
        authToken = registerResponse.body.token;
      });

      it('should validate profile update input', async () => {
        // Test empty update (should require at least one field)
        const emptyUpdateResponse = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${authToken}`)
          .send({});
        expect(emptyUpdateResponse.status).toBe(400);

        // Test valid update
        const validUpdateResponse = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ targetIndustry: 'Technology' });
        expect(validUpdateResponse.status).toBe(200);
      });

      it('should validate target role input', async () => {
        // Test missing required fields
        const missingJobTitleResponse = await request(app)
          .put('/api/profile/target-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ targetIndustry: 'Technology' });
        expect(missingJobTitleResponse.status).toBe(400);

        const missingIndustryResponse = await request(app)
          .put('/api/profile/target-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ targetJobTitle: 'Software Engineer' });
        expect(missingIndustryResponse.status).toBe(400);

        // Test valid target role
        const validResponse = await request(app)
          .put('/api/profile/target-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer'
          });
        expect(validResponse.status).toBe(200);
      });
    });

    describe('Session Validation', () => {
      let authToken: string;
      let sessionId: string;

      beforeAll(async () => {
        // Create a test user for session tests
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'comprehensive-test-session@example.com',
            password: 'ValidPassword123!'
          });
        authToken = registerResponse.body.token;

        // Create a session
        const sessionResponse = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${authToken}`);
        sessionId = sessionResponse.body.data.sessionId;
      });

      it('should validate session ID parameters', async () => {
        // Test invalid UUID format
        const invalidUuidResponse = await request(app)
          .get('/api/sessions/invalid-uuid')
          .set('Authorization', `Bearer ${authToken}`);
        expect(invalidUuidResponse.status).toBe(400);
        expect(invalidUuidResponse.body.error.code).toBe('VALIDATION_ERROR');

        // Test valid UUID
        const validResponse = await request(app)
          .get(`/api/sessions/${sessionId}`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(validResponse.status).toBe(200);
      });

      it('should validate session history query parameters', async () => {
        // Test invalid limit (too high)
        const invalidLimitResponse = await request(app)
          .get('/api/sessions/history?limit=1000')
          .set('Authorization', `Bearer ${authToken}`);
        expect(invalidLimitResponse.status).toBe(400);

        // Test invalid offset (negative)
        const invalidOffsetResponse = await request(app)
          .get('/api/sessions/history?offset=-1')
          .set('Authorization', `Bearer ${authToken}`);
        expect(invalidOffsetResponse.status).toBe(400);

        // Test valid parameters
        const validResponse = await request(app)
          .get('/api/sessions/history?limit=10&offset=0')
          .set('Authorization', `Bearer ${authToken}`);
        expect(validResponse.status).toBe(200);
      });
    });

    describe('Dashboard Validation', () => {
      let authToken: string;

      beforeAll(async () => {
        // Create a test user for dashboard tests
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'comprehensive-test-dashboard@example.com',
            password: 'ValidPassword123!'
          });
        authToken = registerResponse.body.token;
      });

      it('should validate dashboard query parameters', async () => {
        // Test invalid insights limit
        const invalidInsightsResponse = await request(app)
          .get('/api/dashboard/insights?limit=100')
          .set('Authorization', `Bearer ${authToken}`);
        expect(invalidInsightsResponse.status).toBe(400);

        // Test invalid trends days
        const invalidTrendsResponse = await request(app)
          .get('/api/dashboard/trends?days=1000')
          .set('Authorization', `Bearer ${authToken}`);
        expect(invalidTrendsResponse.status).toBe(400);

        // Test valid parameters
        const validInsightsResponse = await request(app)
          .get('/api/dashboard/insights?limit=10')
          .set('Authorization', `Bearer ${authToken}`);
        expect(validInsightsResponse.status).toBe(200);

        const validTrendsResponse = await request(app)
          .get('/api/dashboard/trends?days=30')
          .set('Authorization', `Bearer ${authToken}`);
        expect(validTrendsResponse.status).toBe(200);
      });
    });

    describe('Subscription Validation', () => {
      let authToken: string;

      beforeAll(async () => {
        // Create a test user for subscription tests
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'comprehensive-test-subscription@example.com',
            password: 'ValidPassword123!'
          });
        authToken = registerResponse.body.token;
      });

      it('should validate subscription upgrade input', async () => {
        // Test invalid tier
        const invalidTierResponse = await request(app)
          .post('/api/subscription/upgrade')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ tier: 'INVALID_TIER' });
        expect(invalidTierResponse.status).toBe(400);

        // Test missing tier
        const missingTierResponse = await request(app)
          .post('/api/subscription/upgrade')
          .set('Authorization', `Bearer ${authToken}`)
          .send({});
        expect(missingTierResponse.status).toBe(400);

        // Test valid tier
        const validResponse = await request(app)
          .post('/api/subscription/upgrade')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ tier: 'PAID' });
        expect(validResponse.status).toBe(200);
      });
    });
  });

  describe('3. Complete Request/Response Flow Integration', () => {
    it('should handle complete user workflow with proper service integration', async () => {
      // 1. User Registration
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-workflow@example.com',
          password: 'ValidPassword123!'
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user).toBeDefined();
      expect(registerResponse.body.token).toBeDefined();

      const { user, token } = registerResponse.body;
      testUsers.push({ id: user.id, email: user.email, token });

      // 2. Profile Management
      const profileResponse = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${token}`);
      expect(profileResponse.status).toBe(200);

      const profileUpdateResponse = await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${token}`)
        .send({
          targetIndustry: 'Technology',
          targetJobTitle: 'Software Engineer'
        });
      expect(profileUpdateResponse.status).toBe(200);

      // 3. Session Management
      const sessionResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${token}`);
      expect(sessionResponse.status).toBe(201);

      const sessionId = sessionResponse.body.data.sessionId;

      // 4. Session History
      const historyResponse = await request(app)
        .get('/api/sessions/history')
        .set('Authorization', `Bearer ${token}`);
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.data.sessions.length).toBeGreaterThan(0);

      // 5. Dashboard Analytics
      const statsResponse = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${token}`);
      expect(statsResponse.status).toBe(200);

      // 6. Subscription Management
      const subscriptionInfoResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${token}`);
      expect(subscriptionInfoResponse.status).toBe(200);
      expect(subscriptionInfoResponse.body.data.tier).toBe('FREE');
    });

    it('should enforce authentication across all protected endpoints', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/api/profile' },
        { method: 'put', path: '/api/profile' },
        { method: 'post', path: '/api/sessions/start' },
        { method: 'get', path: '/api/sessions/history' },
        { method: 'get', path: '/api/dashboard/stats' },
        { method: 'get', path: '/api/subscription/info' }
      ];

      for (const endpoint of protectedEndpoints) {
        let response;
        if (endpoint.method === 'get') {
          response = await request(app).get(endpoint.path);
        } else if (endpoint.method === 'post') {
          response = await request(app).post(endpoint.path);
        } else if (endpoint.method === 'put') {
          response = await request(app).put(endpoint.path);
        } else {
          continue; // Skip unsupported methods
        }
        
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      }
    });

    it('should enforce data isolation between users', async () => {
      // Create two users
      const user1Response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-user1@example.com',
          password: 'ValidPassword123!'
        });

      const user2Response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-user2@example.com',
          password: 'ValidPassword123!'
        });

      const user1Token = user1Response.body.token;
      const user2Token = user2Response.body.token;

      testUsers.push(
        { id: user1Response.body.user.id, email: user1Response.body.user.email, token: user1Token },
        { id: user2Response.body.user.id, email: user2Response.body.user.email, token: user2Token }
      );

      // Create session for user1
      const user1SessionResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(user1SessionResponse.status).toBe(201);

      // User2 should not see user1's sessions
      const user2HistoryResponse = await request(app)
        .get('/api/sessions/history')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(user2HistoryResponse.status).toBe(200);
      expect(user2HistoryResponse.body.data.sessions.length).toBe(0);

      // User2 should not be able to access user1's session
      const sessionId = user1SessionResponse.body.data.sessionId;
      const user2AccessResponse = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(user2AccessResponse.status).toBe(403);
    });
  });

  describe('4. Error Handling Integration', () => {
    let authToken: string;

    beforeAll(async () => {
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-errors@example.com',
          password: 'ValidPassword123!'
        });
      authToken = registerResponse.body.token;
      testUsers.push({ 
        id: registerResponse.body.user.id, 
        email: registerResponse.body.user.email, 
        token: authToken 
      });
    });

    it('should handle validation errors consistently', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
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

    it('should sanitize input data', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: `Technology${xssPayload}`,
          targetJobTitle: `Engineer${xssPayload}`
        });

      expect(response.status).toBe(200);
      expect(response.body.data.targetIndustry).not.toContain('<script>');
      expect(response.body.data.targetJobTitle).not.toContain('<script>');
    });
  });

  describe('5. System Health and Monitoring', () => {
    it('should provide health check endpoints', async () => {
      const apiHealthResponse = await request(app)
        .get('/api/health');
      expect(apiHealthResponse.status).toBe(200);
      expect(apiHealthResponse.body.success).toBe(true);

      const rootHealthResponse = await request(app)
        .get('/');
      expect(rootHealthResponse.status).toBe(200);
      expect(rootHealthResponse.body.success).toBe(true);
    });

    it('should include performance monitoring headers', async () => {
      const response = await request(app)
        .get('/api/health');

      expect(response.status).toBe(200);
      // Check for security headers
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
    });
  });

  describe('6. API Documentation and Discovery', () => {
    it('should provide comprehensive API documentation', async () => {
      const response = await request(app)
        .get('/api');

      expect(response.status).toBe(200);
      expect(response.body.endpoints).toBeDefined();
      expect(response.body.endpoints.auth).toBeDefined();
      expect(response.body.endpoints.profile).toBeDefined();
      expect(response.body.endpoints.sessions).toBeDefined();
      expect(response.body.endpoints.subscription).toBeDefined();
      expect(response.body.endpoints.dashboard).toBeDefined();
    });

    it('should provide root endpoint with system information', async () => {
      const response = await request(app)
        .get('/');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('AI Audio Summarization Backend API');
      expect(response.body.environment).toBeDefined();
      expect(response.body.startup).toBeDefined();
    });
  });

  describe('7. Subscription Limits Integration', () => {
    let freeUserToken: string;
    let paidUserToken: string;

    beforeAll(async () => {
      // Create free tier user
      const freeUserResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-free@example.com',
          password: 'ValidPassword123!'
        });
      freeUserToken = freeUserResponse.body.token;
      testUsers.push({ 
        id: freeUserResponse.body.user.id, 
        email: freeUserResponse.body.user.email, 
        token: freeUserToken 
      });

      // Create paid tier user
      const paidUserResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'comprehensive-test-paid@example.com',
          password: 'ValidPassword123!'
        });
      paidUserToken = paidUserResponse.body.token;
      testUsers.push({ 
        id: paidUserResponse.body.user.id, 
        email: paidUserResponse.body.user.email, 
        token: paidUserToken 
      });

      // Upgrade second user to paid
      await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${paidUserToken}`)
        .send({ tier: 'PAID' });
    });

    it('should enforce free tier limits', async () => {
      // Create 3 sessions (free tier limit)
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${freeUserToken}`);
        expect(response.status).toBe(201);
      }

      // Fourth session should be blocked
      const blockedResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${freeUserToken}`);
      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.body.error.code).toBe('USAGE_LIMIT_EXCEEDED');
    });

    it('should allow unlimited sessions for paid tier', async () => {
      // Create multiple sessions for paid user
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${paidUserToken}`);
        expect(response.status).toBe(201);
      }
    });
  });
});