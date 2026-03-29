import request from 'supertest';
import { createApp } from '../../src/index';
import { authService } from '../../src/services/AuthService';
import prisma from '../../src/lib/prisma';

describe('Profile Routes Integration Tests', () => {
  let app: any;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await createApp();

    // Create a test user and get auth token
    const testUser = await authService.register('test@example.com', 'Password123!');
    authToken = testUser.token;
    userId = testUser.user.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.userProfile.deleteMany({
      where: { userId }
    });
    await prisma.user.deleteMany({
      where: { email: 'test@example.com' }
    });
    await prisma.$disconnect();
  });

  describe('GET /api/profile', () => {
    it('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('userId', userId);
    });

    it('should return 401 without auth token', async () => {
      await request(app)
        .get('/api/profile')
        .expect(401);
    });
  });

  describe('PUT /api/profile', () => {
    it('should update profile successfully', async () => {
      const updateData = {
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        experienceLevel: 'mid'
      };

      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.targetIndustry).toBe('Technology');
      expect(response.body.data.targetJobTitle).toBe('Software Engineer');
    });

    it('should return 400 for invalid data', async () => {
      const invalidData = {
        targetIndustry: '', // Empty string should be invalid
        targetJobTitle: 'Software Engineer'
      };

      await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });
  });

  describe('PUT /api/profile/target-role', () => {
    it('should set target role successfully', async () => {
      const targetRole = {
        industry: 'Technology',
        jobTitle: 'Software Engineer'
      };

      const response = await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send(targetRole)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Target role updated successfully');
    });

    it('should return 400 for invalid industry', async () => {
      const invalidRole = {
        industry: 'InvalidIndustry',
        jobTitle: 'Software Engineer'
      };

      await request(app)
        .put('/api/profile/target-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRole)
        .expect(400);
    });
  });

  describe('GET /api/profile/ai-attributes', () => {
    it('should get AI attributes successfully', async () => {
      const response = await request(app)
        .get('/api/profile/ai-attributes')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('POST /api/profile/resume', () => {
    it('should handle missing file', async () => {
      await request(app)
        .post('/api/profile/resume')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });
});