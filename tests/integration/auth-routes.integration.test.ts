import request from 'supertest';
import express from 'express';
import createAuthRoutes from '../../src/routes/auth';
import { errorHandler } from '../../src/middleware/error';

// Mock the AuthService to avoid database dependencies
const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
  validateToken: jest.fn(),
  loginWithGoogle: jest.fn(),
  requestPasswordReset: jest.fn(),
  verifyOTP: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
  changeEmail: jest.fn(),
};

// Mock Prisma to avoid database dependencies
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn()
    }
  }
}));

import { SubscriptionTier } from '../../src/types/auth';

// Create test app with mock services
const app = express();
app.use(express.json());
const authRouter = createAuthRoutes({ authService: mockAuthService } as any);
app.use('/api/auth', authRouter);
app.use(errorHandler);

describe('Authentication Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a user with valid data', async () => {
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
      expect(response.body.data.user.passwordHash).toBeUndefined();
      expect(response.body.message).toBe('User registered successfully');

      expect(mockAuthService.register).toHaveBeenCalledWith('test@example.com', 'Password123!');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockAuthService.register).not.toHaveBeenCalled();
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockAuthService.register).not.toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockAuthService.register).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should successfully login with valid credentials', async () => {
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
      expect(response.body.data.user.passwordHash).toBeUndefined();
      expect(response.body.message).toBe('Login successful');

      expect(mockAuthService.login).toHaveBeenCalledWith('test@example.com', 'Password123!');
    });

    it('should return 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockAuthService.login).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should successfully refresh token', async () => {
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
      expect(response.body.message).toBe('Token refreshed successfully');

      expect(mockAuthService.refreshToken).toHaveBeenCalledWith('old-jwt-token-123');
    });

    it('should return 400 for missing token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockAuthService.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      mockAuthService.register.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!'
        });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // Rate limiting test must run last since it exhausts the rate limit window
  describe('Rate Limiting', () => {
    it('should apply rate limiting to registration endpoint', async () => {
      // Mock multiple failed registrations to trigger rate limiting
      mockAuthService.register.mockRejectedValue(new Error('Registration failed'));

      // Make multiple requests quickly (rate limit is 10 per window)
      const requests = Array(12).fill(null).map(() =>
        request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com',
            password: 'Password123!'
          })
      );

      const responses = await Promise.all(requests);

      // At least one request should be rate limited
      const hasRateLimited = responses.some(r => r.status === 429);
      expect(hasRateLimited).toBe(true);
    });
  });
});