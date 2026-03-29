import request from 'supertest';
import express from 'express';
import createAuthRoutes from '../../../src/routes/auth';
import { errorHandler } from '../../../src/middleware/error';
import { authService } from '../../../src/services/AuthService';
import type { ServiceContainer } from '../../../src/container';
import { SubscriptionTier } from '../../../src/types/auth';

// Mock the AuthService
jest.mock('../../../src/services/AuthService');
const mockAuthService = authService as jest.Mocked<typeof authService>;

// Create test app
const app = express();
app.use(express.json());

// Minimal mock service container for auth routes
const mockServices = {
  authService: mockAuthService
} as unknown as ServiceContainer;

app.use('/api/auth', createAuthRoutes(mockServices));
app.use(errorHandler);

describe('Authentication Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        subscriptionTier: SubscriptionTier.FREE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockToken = 'jwt-token-123';

      mockAuthService.register.mockResolvedValue({
        user: mockUser,
        token: mockToken
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.user.subscriptionTier).toBe(SubscriptionTier.FREE);
      expect(response.body.data.token).toBe(mockToken);
      expect(response.body.data.user.passwordHash).toBeUndefined(); // Should not expose password hash
    });

    it('should return validation error for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBeFalsy();
    });

    it('should return validation error for weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBeFalsy();
    });

    it('should return validation error for missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBeFalsy();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        subscriptionTier: SubscriptionTier.FREE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockToken = 'jwt-token-123';

      mockAuthService.login.mockResolvedValue({
        user: mockUser,
        token: mockToken
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.token).toBe(mockToken);
      expect(response.body.data.user.passwordHash).toBeUndefined(); // Should not expose password hash
    });

    it('should return validation error for missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com'
          // missing password
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBeFalsy();
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh token successfully', async () => {
      const newToken = 'new-jwt-token-456';
      mockAuthService.refreshToken.mockResolvedValue(newToken);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'old-jwt-token-123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBe(newToken);
    });

    it('should return validation error for missing token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBeFalsy();
    });
  });

  describe('Error Handling', () => {
    it('should handle AuthService errors properly', async () => {
      mockAuthService.register.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!'
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBeFalsy();
    });
  });
});