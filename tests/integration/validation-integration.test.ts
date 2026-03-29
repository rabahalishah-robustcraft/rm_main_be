/**
 * Validation Integration Tests
 * Tests comprehensive input validation across all endpoints
 * Requirements: All requirements integration - input validation
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import container from '../../src/container';
import { createApp } from '../../src/index';

describe('Validation Integration Tests', () => {
  let app: any;
  let services: any;
  let prisma: PrismaClient;
  let authToken: string;

  beforeAll(async () => {
    services = await container.initialize();
    prisma = services.prisma;
    app = await createApp();

    // Create a test user for authenticated endpoints
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'validation-test@example.com',
        password: 'ValidPassword123!'
      });

    authToken = registerResponse.body.token;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.audioSession.deleteMany({
      where: {
        user: {
          email: 'validation-test@example.com'
        }
      }
    });
    await prisma.usageTracking.deleteMany({
      where: {
        user: {
          email: 'validation-test@example.com'
        }
      }
    });
    await prisma.userProfile.deleteMany({
      where: {
        user: {
          email: 'validation-test@example.com'
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: 'validation-test@example.com'
      }
    });

    await container.cleanup();
  });

  describe('Authentication Endpoint Validation', () => {
    it('should validate registration input', async () => {
      // Missing email
      const noEmailResponse = await request(app)
        .post('/api/auth/register')
        .send({
          password: 'ValidPassword123!'
        });

      expect(noEmailResponse.status).toBe(400);
      expect(noEmailResponse.body.error.code).toBe('VALIDATION_ERROR');

      // Invalid email format
      const invalidEmailResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'ValidPassword123!'
        });

      expect(invalidEmailResponse.status).toBe(400);

      // Weak password
      const weakPasswordResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak'
        });

      expect(weakPasswordResponse.status).toBe(400);

      // Password without special characters
      const noSpecialCharsResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123'
        });

      expect(noSpecialCharsResponse.status).toBe(400);
    });

    it('should validate login input', async () => {
      // Missing password
      const noPasswordResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com'
        });

      expect(noPasswordResponse.status).toBe(400);
      expect(noPasswordResponse.body.error.code).toBe('VALIDATION_ERROR');

      // Invalid email format
      const invalidEmailResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'not-an-email',
          password: 'password'
        });

      expect(invalidEmailResponse.status).toBe(400);
    });

    it('should validate refresh token input', async () => {
      const noTokenResponse = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(noTokenResponse.status).toBe(400);
      expect(noTokenResponse.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Profile Endpoint Validation', () => {
    it('should validate profile update input', async () => {
      // Empty update (should require at least one field)
      const emptyUpdateResponse = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(emptyUpdateResponse.status).toBe(400);

      // Valid update
      const validUpdateResponse = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: 'Technology'
        });

      expect(validUpdateResponse.status).toBe(200);
    });

    it('should validate target role input', async () => {
      // Missing required fields
      const missingFieldsResponse = await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: 'Technology'
        });

      expect(missingFieldsResponse.status).toBe(400);

      // Valid target role
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

  describe('Session Endpoint Validation', () => {
    let sessionId: string;

    beforeAll(async () => {
      // Create a session for testing
      const sessionResponse = await request(app)
        .post('/api/sessions/start')
        .set('Authorization', `Bearer ${authToken}`);
      
      sessionId = sessionResponse.body.sessionId;
    });

    it('should validate session ID parameters', async () => {
      // Invalid UUID format
      const invalidUuidResponse = await request(app)
        .get('/api/sessions/invalid-uuid')
        .set('Authorization', `Bearer ${authToken}`);

      expect(invalidUuidResponse.status).toBe(400);
      expect(invalidUuidResponse.body.error.code).toBe('VALIDATION_ERROR');

      // Valid UUID
      const validResponse = await request(app)
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(validResponse.status).toBe(200);
    });

    it('should validate session history query parameters', async () => {
      // Invalid limit (too high)
      const invalidLimitResponse = await request(app)
        .get('/api/sessions/history?limit=1000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(invalidLimitResponse.status).toBe(400);

      // Invalid offset (negative)
      const invalidOffsetResponse = await request(app)
        .get('/api/sessions/history?offset=-1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(invalidOffsetResponse.status).toBe(400);

      // Valid query parameters
      const validResponse = await request(app)
        .get('/api/sessions/history?limit=10&offset=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(validResponse.status).toBe(200);
    });
  });

  describe('Subscription Endpoint Validation', () => {
    it('should validate subscription upgrade input', async () => {
      // Invalid tier
      const invalidTierResponse = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tier: 'INVALID_TIER'
        });

      expect(invalidTierResponse.status).toBe(400);

      // Missing tier
      const missingTierResponse = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(missingTierResponse.status).toBe(400);

      // Valid tier
      const validResponse = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tier: 'PAID'
        });

      expect(validResponse.status).toBe(200);
    });
  });

  describe('Dashboard Endpoint Validation', () => {
    it('should validate insights query parameters', async () => {
      // Invalid limit (too high)
      const invalidLimitResponse = await request(app)
        .get('/api/dashboard/insights?limit=100')
        .set('Authorization', `Bearer ${authToken}`);

      expect(invalidLimitResponse.status).toBe(400);

      // Valid limit
      const validResponse = await request(app)
        .get('/api/dashboard/insights?limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(validResponse.status).toBe(200);
    });

    it('should validate trends query parameters', async () => {
      // Invalid days (too high)
      const invalidDaysResponse = await request(app)
        .get('/api/dashboard/trends?days=1000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(invalidDaysResponse.status).toBe(400);

      // Invalid days (zero)
      const zeroDaysResponse = await request(app)
        .get('/api/dashboard/trends?days=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(zeroDaysResponse.status).toBe(400);

      // Valid days
      const validResponse = await request(app)
        .get('/api/dashboard/trends?days=30')
        .set('Authorization', `Bearer ${authToken}`);

      expect(validResponse.status).toBe(200);
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize XSS attempts in profile updates', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: `Technology${xssPayload}`,
          targetJobTitle: `Engineer${xssPayload}`
        });

      expect(response.status).toBe(200);
      expect(response.body.targetIndustry).not.toContain('<script>');
      expect(response.body.targetJobTitle).not.toContain('<script>');
    });

    it('should handle SQL injection attempts', async () => {
      const sqlPayload = "'; DROP TABLE users; --";
      
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: `Technology${sqlPayload}`
        });

      // Should not cause a server error
      expect(response.status).toBe(200);
    });

    it('should trim whitespace from inputs', async () => {
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetIndustry: '  Technology  ',
          targetJobTitle: '  Software Engineer  '
        });

      expect(response.status).toBe(200);
      expect(response.body.targetIndustry).toBe('Technology');
      expect(response.body.targetJobTitle).toBe('Software Engineer');
    });
  });

  describe('File Upload Validation', () => {
    it('should validate file types for resume upload', async () => {
      // This would require actual file upload testing
      // For now, we'll test the validation logic indirectly
      const response = await request(app)
        .post('/api/profile/resume')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', Buffer.from('fake file content'), {
          filename: 'test.txt',
          contentType: 'text/plain'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('Invalid file type');
    });

    it('should validate file size limits', async () => {
      // Create a large buffer to simulate oversized file
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      
      const response = await request(app)
        .post('/api/profile/resume')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', largeBuffer, {
          filename: 'large-resume.pdf',
          contentType: 'application/pdf'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('File too large');
    });
  });

  describe('Error Response Format Consistency', () => {
    it('should return consistent error format across all endpoints', async () => {
      const endpoints = [
        { method: 'post', path: '/api/auth/register', body: { email: 'invalid' } },
        { method: 'post', path: '/api/auth/login', body: { email: 'invalid' } },
        { method: 'put', path: '/api/profile', body: {}, auth: true },
        { method: 'get', path: '/api/sessions/invalid-uuid', auth: true },
        { method: 'post', path: '/api/subscription/upgrade', body: { tier: 'INVALID' }, auth: true }
      ];

      for (const endpoint of endpoints) {
        let req;
        
        if (endpoint.method === 'get') {
          req = request(app).get(endpoint.path);
        } else if (endpoint.method === 'post') {
          req = request(app).post(endpoint.path);
        } else if (endpoint.method === 'put') {
          req = request(app).put(endpoint.path);
        } else {
          continue; // Skip unsupported methods
        }
        
        if (endpoint.auth) {
          req = req.set('Authorization', `Bearer ${authToken}`);
        }
        
        if (endpoint.body) {
          req = req.send(endpoint.body);
        }

        const response = await req;

        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBeDefined();
        expect(response.body.error.message).toBeDefined();
        expect(response.body.timestamp).toBeDefined();
        expect(response.body.path).toBeDefined();
      }
    });
  });
});