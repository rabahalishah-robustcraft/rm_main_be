/**
 * Complete System Integration Tests
 * Tests all aspects of Task 13.1: Complete system integration
 * - Wire all services together through dependency injection
 * - Implement complete request/response flow
 * - Add comprehensive input validation across all endpoints
 * - Create integration tests for complete workflows
 * Requirements: All requirements integration - Task 13.1
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import container from '../../src/container';
import { createApp } from '../../src/index';
import { createSystemIntegrationValidator } from '../../src/utils/systemIntegration';

describe('Complete System Integration Tests - Task 13.1', () => {
  let app: any;
  let services: any;
  let prisma: PrismaClient;
  let systemValidator: any;
  let testUsers: Array<{ id: string; email: string; token: string; isAdmin?: boolean }> = [];

  beforeAll(async () => {
    // Initialize container and services
    services = await container.initialize();
    prisma = services.prisma;
    systemValidator = createSystemIntegrationValidator(services);
    
    // Create the app (without listening on a port)
    app = await createApp();

    // Clean up any existing test data
    await cleanupTestData();

    // Create test users including admin
    await createTestUsers();
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

  async function createTestUsers() {
    // Create regular user
    const regularUserResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'system-integration-test-user@example.com',
        password: 'ValidPassword123!'
      });

    testUsers.push({
      id: regularUserResponse.body.user.id,
      email: regularUserResponse.body.user.email,
      token: regularUserResponse.body.token
    });

    // Create admin user (assuming admin emails are configured)
    const adminUserResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'system-integration-test-admin@example.com',
        password: 'ValidPassword123!'
      });

    testUsers.push({
      id: adminUserResponse.body.user.id,
      email: adminUserResponse.body.user.email,
      token: adminUserResponse.body.token,
      isAdmin: true
    });
  }

  describe('1. Service Container and Dependency Injection Wiring', () => {
    it('should have all required services properly wired in container', async () => {
      const requiredServices = [
        'prisma',
        'authService',
        'profileService',
        'audioSessionService',
        'subscriptionService',
        'dashboardService',
        'openaiService',
        's3Service',
        'monitoringService',
        'errorHandlingService'
      ];

      for (const serviceName of requiredServices) {
        expect(services[serviceName]).toBeDefined();
        expect(services[serviceName]).not.toBeNull();
      }
    });

    it('should validate service dependencies through admin endpoint', async () => {
      const adminUser = testUsers.find(user => user.isAdmin);
      if (!adminUser) {
        console.warn('Admin user not available, skipping admin endpoint test');
        return;
      }

      const response = await request(app)
        .get('/api/admin/service-dependencies')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.valid).toBe(true);
      expect(response.body.data.dependencies).toBeDefined();
      expect(Object.keys(response.body.data.dependencies).length).toBeGreaterThan(0);
    });

    it('should have proper service instantiation with correct dependencies', () => {
      // AuthService should have Prisma dependency
      expect(services.authService).toBeDefined();
      
      // ProfileService should have S3, OpenAI, and Prisma dependencies
      expect(services.profileService).toBeDefined();
      
      // AudioSessionService should have Prisma, OpenAI, S3, and Subscription dependencies
      expect(services.audioSessionService).toBeDefined();
      
      // All services should be instances of their respective classes
      expect(services.authService.constructor.name).toBe('AuthService');
      expect(services.profileService.constructor.name).toBe('ProfileService');
      expect(services.audioSessionService.constructor.name).toBe('AudioSessionService');
      expect(services.subscriptionService.constructor.name).toBe('SubscriptionService');
      expect(services.dashboardService.constructor.name).toBe('DashboardService');
    });

    it('should perform comprehensive system integration health check', async () => {
      const integrationReport = await systemValidator.performHealthCheck();
      
      expect(integrationReport).toBeDefined();
      expect(integrationReport.overall).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(integrationReport.overall);
      expect(integrationReport.checks).toBeDefined();
      expect(Array.isArray(integrationReport.checks)).toBe(true);
      expect(integrationReport.dependencies).toBeDefined();
      expect(integrationReport.dependencies.database).toBeDefined();
      expect(integrationReport.dependencies.serviceContainer).toBeDefined();
    });
  });

  describe('2. Complete Request/Response Flow Implementation', () => {
    it('should handle complete authentication flow with proper service integration', async () => {
      // Test registration flow
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'system-integration-flow-test@example.com',
          password: 'ValidPassword123!'
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user).toBeDefined();
      expect(registerResponse.body.token).toBeDefined();

      const { user, token } = registerResponse.body;

      // Test login flow
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'system-integration-flow-test@example.com',
          password: 'ValidPassword123!'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.user.id).toBe(user.id);

      // Test authenticated endpoint access
      const profileResponse = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.userId).toBe(user.id);

      // Test logout flow
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutResponse.status).toBe(200);

      // Test that token is invalidated
      const invalidTokenResponse = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(invalidTokenResponse.status).toBe(401);

      // Cleanup
      await prisma.audioSession.deleteMany({ where: { userId: user.id } });
      await prisma.usageTracking.deleteMany({ where: { userId: user.id } });
      await prisma.userProfile.delete({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    });

    it('should handle complete user workflow with service integration', async () => {
      const user = testUsers[0];
      
      // 1. Profile management
      const profileUpdateResponse = await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          targetIndustry: 'Technology',
          targetJobTitle: 'Software Engineer'
        });

      expect(profileUpdateResponse.status).toBe(200);

      // 2. Session management
      const sessionResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${user.token}`);

      expect(sessionResponse.status).toBe(201);
      const sessionId = sessionResponse.body.data.sessionId;

      // 3. Session history
      const historyResponse = await request(app)
        .get('/api/sessions/history')
        .set('Authorization', `Bearer ${user.token}`);

      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.data.sessions.length).toBeGreaterThan(0);

      // 4. Dashboard analytics
      const statsResponse = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.token}`);

      expect(statsResponse.status).toBe(200);

      // 5. Subscription management
      const subscriptionResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${user.token}`);

      expect(subscriptionResponse.status).toBe(200);
    });

    it('should test request/response flow through admin endpoint', async () => {
      const adminUser = testUsers.find(user => user.isAdmin);
      if (!adminUser) {
        console.warn('Admin user not available, skipping admin flow test');
        return;
      }

      const response = await request(app)
        .post('/api/admin/test-request-flow')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.overallSuccess).toBe(true);
      expect(response.body.data.steps).toBeDefined();
      expect(Array.isArray(response.body.data.steps)).toBe(true);
      expect(response.body.data.successfulSteps).toBeGreaterThan(0);
    });
  });

  describe('3. Comprehensive Input Validation Across All Endpoints', () => {
    const user = () => testUsers[0];

    describe('Authentication Endpoint Validation', () => {
      it('should comprehensively validate registration input', async () => {
        const testCases = [
          {
            input: { password: 'ValidPassword123!' },
            expectedError: 'VALIDATION_ERROR',
            description: 'missing email'
          },
          {
            input: { email: 'not-an-email', password: 'ValidPassword123!' },
            expectedError: 'VALIDATION_ERROR',
            description: 'invalid email format'
          },
          {
            input: { email: 'test@example.com', password: 'weak' },
            expectedError: 'VALIDATION_ERROR',
            description: 'weak password'
          },
          {
            input: { email: 'test@example.com', password: 'NoSpecialChars123' },
            expectedError: 'VALIDATION_ERROR',
            description: 'password without special characters'
          },
          {
            input: { email: 'test@example.com', password: 'nouppercase123!' },
            expectedError: 'VALIDATION_ERROR',
            description: 'password without uppercase'
          }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .post('/api/auth/register')
            .send(testCase.input);

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe(testCase.expectedError);
        }
      });

      it('should validate login input comprehensively', async () => {
        const testCases = [
          {
            input: { email: 'test@example.com' },
            description: 'missing password'
          },
          {
            input: { password: 'password' },
            description: 'missing email'
          },
          {
            input: { email: 'not-an-email', password: 'password' },
            description: 'invalid email format'
          }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .post('/api/auth/login')
            .send(testCase.input);

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_ERROR');
        }
      });
    });

    describe('Profile Endpoint Validation', () => {
      it('should validate profile update input comprehensively', async () => {
        // Empty update should fail
        const emptyResponse = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user().token}`)
          .send({});

        expect(emptyResponse.status).toBe(400);

        // Valid update should succeed
        const validResponse = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user().token}`)
          .send({ targetIndustry: 'Technology' });

        expect(validResponse.status).toBe(200);
      });

      it('should validate target role input comprehensively', async () => {
        const testCases = [
          {
            input: { targetIndustry: 'Technology' },
            description: 'missing job title'
          },
          {
            input: { targetJobTitle: 'Software Engineer' },
            description: 'missing industry'
          },
          {
            input: {},
            description: 'missing both fields'
          }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .put('/api/profile/target-role')
            .set('Authorization', `Bearer ${user().token}`)
            .send(testCase.input);

          expect(response.status).toBe(400);
        }

        // Valid input should succeed
        const validResponse = await request(app)
          .put('/api/profile/target-role')
          .set('Authorization', `Bearer ${user().token}`)
          .send({
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer'
          });

        expect(validResponse.status).toBe(200);
      });
    });

    describe('Session Endpoint Validation', () => {
      let sessionId: string;

      beforeAll(async () => {
        const sessionResponse = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${user().token}`);
        sessionId = sessionResponse.body.data.sessionId;
      });

      it('should validate session ID parameters comprehensively', async () => {
        // Invalid UUID formats
        const invalidUuids = [
          'invalid-uuid',
          '123',
          'not-a-uuid-at-all',
          '12345678-1234-1234-1234-12345678901',  // too long
          '12345678-1234-1234-1234-123456789012' // too long
        ];

        for (const invalidUuid of invalidUuids) {
          const response = await request(app)
            .get(`/api/sessions/${invalidUuid}`)
            .set('Authorization', `Bearer ${user().token}`);

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_ERROR');
        }

        // Valid UUID should work
        const validResponse = await request(app)
          .get(`/api/sessions/${sessionId}`)
          .set('Authorization', `Bearer ${user().token}`);

        expect(validResponse.status).toBe(200);
      });

      it('should validate session history query parameters', async () => {
        const testCases = [
          { query: '?limit=1000', description: 'limit too high' },
          { query: '?limit=0', description: 'limit too low' },
          { query: '?offset=-1', description: 'negative offset' },
          { query: '?limit=abc', description: 'non-numeric limit' },
          { query: '?offset=xyz', description: 'non-numeric offset' }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .get(`/api/sessions/history${testCase.query}`)
            .set('Authorization', `Bearer ${user().token}`);

          expect(response.status).toBe(400);
        }

        // Valid parameters should work
        const validResponse = await request(app)
          .get('/api/sessions/history?limit=10&offset=0')
          .set('Authorization', `Bearer ${user().token}`);

        expect(validResponse.status).toBe(200);
      });
    });

    describe('Dashboard Endpoint Validation', () => {
      it('should validate dashboard query parameters comprehensively', async () => {
        const testCases = [
          { endpoint: '/api/dashboard/insights', query: '?limit=100', description: 'insights limit too high' },
          { endpoint: '/api/dashboard/insights', query: '?limit=0', description: 'insights limit too low' },
          { endpoint: '/api/dashboard/trends', query: '?days=1000', description: 'trends days too high' },
          { endpoint: '/api/dashboard/trends', query: '?days=0', description: 'trends days too low' }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .get(`${testCase.endpoint}${testCase.query}`)
            .set('Authorization', `Bearer ${user().token}`);

          expect(response.status).toBe(400);
        }

        // Valid parameters should work
        const validInsightsResponse = await request(app)
          .get('/api/dashboard/insights?limit=10')
          .set('Authorization', `Bearer ${user().token}`);

        expect(validInsightsResponse.status).toBe(200);

        const validTrendsResponse = await request(app)
          .get('/api/dashboard/trends?days=30')
          .set('Authorization', `Bearer ${user().token}`);

        expect(validTrendsResponse.status).toBe(200);
      });
    });

    describe('Subscription Endpoint Validation', () => {
      it('should validate subscription upgrade input comprehensively', async () => {
        const testCases = [
          { input: { tier: 'INVALID_TIER' }, description: 'invalid tier' },
          { input: {}, description: 'missing tier' },
          { input: { tier: 123 }, description: 'numeric tier' },
          { input: { tier: null }, description: 'null tier' }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .post('/api/subscription/upgrade')
            .set('Authorization', `Bearer ${user().token}`)
            .send(testCase.input);

          expect(response.status).toBe(400);
        }

        // Valid tier should work
        const validResponse = await request(app)
          .post('/api/subscription/upgrade')
          .set('Authorization', `Bearer ${user().token}`)
          .send({ tier: 'PAID' });

        expect(validResponse.status).toBe(200);
      });
    });

    describe('Input Sanitization', () => {
      it('should sanitize XSS attempts across all endpoints', async () => {
        const xssPayload = '<script>alert("xss")</script>';
        
        const response = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user().token}`)
          .send({
            targetIndustry: `Technology${xssPayload}`,
            targetJobTitle: `Engineer${xssPayload}`
          });

        expect(response.status).toBe(200);
        expect(response.body.data.targetIndustry).not.toContain('<script>');
        expect(response.body.data.targetJobTitle).not.toContain('<script>');
      });

      it('should handle SQL injection attempts safely', async () => {
        const sqlPayload = "'; DROP TABLE users; --";
        
        const response = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user().token}`)
          .send({
            targetIndustry: `Technology${sqlPayload}`
          });

        // Should not cause a server error
        expect(response.status).toBe(200);
      });
    });
  });

  describe('4. Integration Tests for Complete Workflows', () => {
    it('should handle complete user onboarding workflow', async () => {
      // Step 1: User registration
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'workflow-integration-test@example.com',
          password: 'ValidPassword123!'
        });

      expect(registerResponse.status).toBe(201);
      const { user, token } = registerResponse.body;

      try {
        // Step 2: Profile setup
        const profileResponse = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${token}`);

        expect(profileResponse.status).toBe(200);

        // Step 3: Set target role
        const targetRoleResponse = await request(app)
          .put('/api/profile/target-role')
          .set('Authorization', `Bearer ${token}`)
          .send({
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer'
          });

        expect(targetRoleResponse.status).toBe(200);

        // Step 4: Create first session
        const sessionResponse = await request(app)
          .post('/api/sessions/start')
          .set('Authorization', `Bearer ${token}`);

        expect(sessionResponse.status).toBe(201);

        // Step 5: Check dashboard
        const dashboardResponse = await request(app)
          .get('/api/dashboard/stats')
          .set('Authorization', `Bearer ${token}`);

        expect(dashboardResponse.status).toBe(200);

        // Step 6: Check subscription status
        const subscriptionResponse = await request(app)
          .get('/api/subscription/info')
          .set('Authorization', `Bearer ${token}`);

        expect(subscriptionResponse.status).toBe(200);
        expect(subscriptionResponse.body.data.tier).toBe('FREE');
        expect(subscriptionResponse.body.data.usageThisMonth).toBe(1);

      } finally {
        // Cleanup
        await prisma.audioSession.deleteMany({ where: { userId: user.id } });
        await prisma.usageTracking.deleteMany({ where: { userId: user.id } });
        await prisma.userProfile.delete({ where: { userId: user.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      }
    });

    it('should handle subscription upgrade workflow', async () => {
      const user = testUsers[0];

      // Check initial subscription
      const initialResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${user.token}`);

      expect(initialResponse.status).toBe(200);

      // Upgrade subscription
      const upgradeResponse = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ tier: 'PAID' });

      expect(upgradeResponse.status).toBe(200);

      // Verify upgrade
      const verifyResponse = await request(app)
        .get('/api/subscription/info')
        .set('Authorization', `Bearer ${user.token}`);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.data.tier).toBe('PAID');
    });

    it('should handle error scenarios gracefully', async () => {
      const user = testUsers[0];

      // Test accessing non-existent session
      const nonExistentResponse = await request(app)
        .get('/api/sessions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.token}`);

      expect(nonExistentResponse.status).toBe(404);
      expect(nonExistentResponse.body.error.code).toBe('SESSION_NOT_FOUND');

      // Test unauthorized access
      const unauthorizedResponse = await request(app)
        .get('/api/profile');

      expect(unauthorizedResponse.status).toBe(401);
      expect(unauthorizedResponse.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('5. System Integration Health Monitoring', () => {
    it('should provide comprehensive system integration status', async () => {
      const adminUser = testUsers.find(user => user.isAdmin);
      if (!adminUser) {
        console.warn('Admin user not available, skipping integration status test');
        return;
      }

      const response = await request(app)
        .get('/api/admin/system-integration')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect([200, 206, 503]).toContain(response.status);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.overall).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.data.overall);
      expect(response.body.data.checks).toBeDefined();
      expect(Array.isArray(response.body.data.checks)).toBe(true);
    });

    it('should monitor all critical system components', async () => {
      const integrationReport = await systemValidator.performHealthCheck();
      
      const requiredChecks = [
        'database',
        'serviceContainer',
        'openai',
        's3'
      ];

      const checkServices = integrationReport.checks.map((check: any) => check.service);
      
      for (const requiredCheck of requiredChecks) {
        expect(checkServices).toContain(requiredCheck);
      }
    });
  });
});