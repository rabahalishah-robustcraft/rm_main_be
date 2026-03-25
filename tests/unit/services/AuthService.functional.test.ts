import { AuthService } from '@/services/AuthService';
import { SubscriptionTier, AuthenticationError, ValidationError } from '@/types/auth';

// Mock the dependencies
jest.mock('@/utils/password', () => ({
  validatePassword: jest.fn(),
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/utils/jwt', () => ({
  generateToken: jest.fn(),
  validateToken: jest.fn(),
}));

jest.mock('@/lib/prisma', () => {
  const mockUser = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const mockUserProfile = {
    create: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      user: mockUser,
      userProfile: mockUserProfile,
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
        return fn({ user: mockUser, userProfile: mockUserProfile });
      }),
    },
  };
});

import * as passwordUtils from '@/utils/password';
import * as jwtUtils from '@/utils/jwt';
import prisma from '@/lib/prisma';

const mockPasswordUtils = passwordUtils as jest.Mocked<typeof passwordUtils>;
const mockJwtUtils = jwtUtils as jest.Mocked<typeof jwtUtils>;
const mockPrisma = prisma as any;

describe('AuthService Functional Tests', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = 'SecurePass123!';
      const hashedPassword = 'hashed_password_123';
      const token = 'jwt_token_123';

      const mockDbUser = {
        id: 'user_123',
        email,
        passwordHash: hashedPassword,
        subscriptionTier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPasswordUtils.validatePassword.mockImplementation(() => {});
      mockPasswordUtils.hashPassword.mockResolvedValue(hashedPassword);
      mockJwtUtils.generateToken.mockReturnValue(token);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockDbUser);
      mockPrisma.userProfile.create.mockResolvedValue({});

      // Act
      const result = await authService.register(email, password);

      // Assert
      expect(result).toEqual({
        user: {
          id: 'user_123',
          email,
          passwordHash: hashedPassword,
          subscriptionTier: SubscriptionTier.FREE,
          createdAt: mockDbUser.createdAt,
          updatedAt: mockDbUser.updatedAt,
        },
        token,
      });

      expect(mockPasswordUtils.validatePassword).toHaveBeenCalledWith(password);
      expect(mockPasswordUtils.hashPassword).toHaveBeenCalledWith(password);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: email.toLowerCase() },
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: email.toLowerCase(),
          passwordHash: hashedPassword,
          subscriptionTier: SubscriptionTier.FREE,
        },
      });
    });

    it('should throw ValidationError for invalid email', async () => {
      await expect(authService.register('invalid-email', 'password123'))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing email', async () => {
      await expect(authService.register('', 'password123'))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing password', async () => {
      await expect(authService.register('test@example.com', ''))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if user already exists', async () => {
      const email = 'test@example.com';
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing_user' });

      await expect(authService.register(email, 'password123'))
        .rejects.toThrow(ValidationError);
      await expect(authService.register(email, 'password123'))
        .rejects.toThrow('User with this email already exists');
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = 'SecurePass123!';
      const hashedPassword = 'hashed_password_123';
      const token = 'jwt_token_123';

      const mockDbUser = {
        id: 'user_123',
        email,
        passwordHash: hashedPassword,
        subscriptionTier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPasswordUtils.verifyPassword.mockResolvedValue(true);
      mockJwtUtils.generateToken.mockReturnValue(token);
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);

      // Act
      const result = await authService.login(email, password);

      // Assert
      expect(result).toEqual({
        user: {
          id: 'user_123',
          email,
          passwordHash: hashedPassword,
          subscriptionTier: SubscriptionTier.FREE,
          createdAt: mockDbUser.createdAt,
          updatedAt: mockDbUser.updatedAt,
        },
        token,
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: email.toLowerCase() },
      });
      expect(mockPasswordUtils.verifyPassword).toHaveBeenCalledWith(password, hashedPassword);
    });

    it('should throw AuthenticationError for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.login('test@example.com', 'password123'))
        .rejects.toThrow(AuthenticationError);
      await expect(authService.login('test@example.com', 'password123'))
        .rejects.toThrow('Invalid credentials');
    });

    it('should throw AuthenticationError for invalid password', async () => {
      const mockDbUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPasswordUtils.verifyPassword.mockResolvedValue(false);

      await expect(authService.login('test@example.com', 'wrongpassword'))
        .rejects.toThrow(AuthenticationError);
      await expect(authService.login('test@example.com', 'wrongpassword'))
        .rejects.toThrow('Invalid credentials');
    });
  });

  describe('validateToken', () => {
    it('should successfully validate token and return user', async () => {
      // Arrange
      const token = 'jwt_token_123';
      const payload = {
        userId: 'user_123',
        email: 'test@example.com',
        subscriptionTier: 'free',
      };

      const mockDbUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockJwtUtils.validateToken.mockReturnValue(payload);
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);

      // Act
      const result = await authService.validateToken(token);

      // Assert
      expect(result).toEqual({
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: SubscriptionTier.FREE,
        createdAt: mockDbUser.createdAt,
        updatedAt: mockDbUser.updatedAt,
      });

      expect(mockJwtUtils.validateToken).toHaveBeenCalledWith(token);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_123' },
      });
    });

    it('should throw AuthenticationError for missing token', async () => {
      await expect(authService.validateToken(''))
        .rejects.toThrow(AuthenticationError);
      await expect(authService.validateToken(''))
        .rejects.toThrow('Token is required');
    });

    it('should throw AuthenticationError if user not found', async () => {
      const token = 'jwt_token_123';
      const payload = {
        userId: 'user_123',
        email: 'test@example.com',
        subscriptionTier: 'free',
      };

      mockJwtUtils.validateToken.mockReturnValue(payload);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.validateToken(token))
        .rejects.toThrow(AuthenticationError);
      await expect(authService.validateToken(token))
        .rejects.toThrow('User not found');
    });
  });

  describe('logout', () => {
    it('should successfully logout with valid token', async () => {
      // Mock validateToken to return a user
      jest.spyOn(authService, 'validateToken').mockResolvedValue({
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: SubscriptionTier.FREE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(authService.logout('valid_token')).resolves.toBeUndefined();
      expect(authService.validateToken).toHaveBeenCalledWith('valid_token');
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh token', async () => {
      const oldToken = 'old_jwt_token_123';
      const newToken = 'new_jwt_token_456';

      const mockUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: SubscriptionTier.FREE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(authService, 'validateToken').mockResolvedValue(mockUser);
      mockJwtUtils.generateToken.mockReturnValue(newToken);

      const result = await authService.refreshToken(oldToken);

      expect(result).toBe(newToken);
      expect(authService.validateToken).toHaveBeenCalledWith(oldToken);
      expect(mockJwtUtils.generateToken).toHaveBeenCalledWith({
        userId: 'user_123',
        email: 'test@example.com',
        subscriptionTier: SubscriptionTier.FREE,
      });
    });
  });
});