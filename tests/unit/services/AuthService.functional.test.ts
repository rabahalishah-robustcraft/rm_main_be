import { AuthService } from '@/services/AuthService';
import {
  SubscriptionTier,
  AuthenticationError,
  ValidationError,
  EmailNotVerifiedError,
  ExternalServiceError
} from '@/types/auth';

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
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockUserProfile = {
    create: jest.fn(),
  };
  const mockEmailVerificationOTP = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn()
  };
  return {
    __esModule: true,
    default: {
      user: mockUser,
      userProfile: mockUserProfile,
      emailVerificationOTP: mockEmailVerificationOTP,
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
        return fn({ user: mockUser, userProfile: mockUserProfile });
      }),
    },
  };
});

const mockEmailService = {
  isConfigured: jest.fn(() => true),
  sendOTP: jest.fn(),
  sendEmailVerificationOTP: jest.fn().mockResolvedValue(undefined),
  sendEmailChangeConfirmationOTP: jest.fn().mockResolvedValue(undefined),
};

import * as passwordUtils from '@/utils/password';
import * as jwtUtils from '@/utils/jwt';
import prisma from '@/lib/prisma';

const mockPasswordUtils = passwordUtils as jest.Mocked<typeof passwordUtils>;
const mockJwtUtils = jwtUtils as jest.Mocked<typeof jwtUtils>;
const mockPrisma = prisma as any;

describe('AuthService Functional Tests', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService(mockPrisma, mockEmailService as any, undefined);
    jest.clearAllMocks();
    mockEmailService.isConfigured.mockReturnValue(true);
    mockEmailService.sendEmailVerificationOTP.mockResolvedValue(undefined);
    mockEmailService.sendEmailChangeConfirmationOTP.mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = 'SecurePass123!';
      const hashedPassword = 'hashed_password_123';

      const mockDbUser = {
        id: 'user_123',
        email,
        passwordHash: hashedPassword,
        subscriptionTier: 'free',
        emailVerified: false,
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPasswordUtils.validatePassword.mockImplementation(() => {});
      mockPasswordUtils.hashPassword.mockResolvedValue(hashedPassword);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockDbUser);
      mockPrisma.userProfile.create.mockResolvedValue({});
      mockPrisma.emailVerificationOTP.create.mockResolvedValue({ id: 'otp1' });

      // Act
      const result = await authService.register(email, password);

      // Assert
      expect(result).toEqual({
        user: {
          id: 'user_123',
          email,
          passwordHash: hashedPassword,
          subscriptionTier: SubscriptionTier.FREE,
          emailVerified: false,
          pendingEmail: null,
          onboardingCompletedAt: null,
          createdAt: mockDbUser.createdAt,
          updatedAt: mockDbUser.updatedAt,
        },
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
          emailVerified: false,
        },
      });
      expect(mockEmailService.sendEmailVerificationOTP).toHaveBeenCalled();
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

  describe('verifyEmail', () => {
    it('should verify OTP, clear rows, and return JWT', async () => {
      const email = 'new@example.com';
      const userRow = {
        id: 'u1',
        email,
        authProvider: 'local',
        emailVerified: false,
        passwordHash: 'h',
        subscriptionTier: 'free',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const updatedUser = { ...userRow, emailVerified: true };

      mockPrisma.user.findUnique.mockResolvedValue(userRow);
      mockPrisma.emailVerificationOTP.findMany.mockResolvedValue([
        {
          id: 'otp1',
          email,
          otpHash: 'hash',
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date()
        }
      ]);
      mockPasswordUtils.verifyPassword.mockResolvedValue(true);
      mockPrisma.emailVerificationOTP.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      mockJwtUtils.generateToken.mockReturnValue('jwt-after-verify');

      const result = await authService.verifyEmail(email, '123456');

      expect(result.user.emailVerified).toBe(true);
      expect(result.token).toBe('jwt-after-verify');
      expect(mockJwtUtils.generateToken).toHaveBeenCalledWith({
        userId: 'u1',
        email,
        subscriptionTier: 'free',
        emailVerified: true
      });
    });

    it('should return token immediately if already verified', async () => {
      const email = 'done@example.com';
      const userRow = {
        id: 'u2',
        email,
        authProvider: 'local',
        emailVerified: true,
        passwordHash: 'h',
        subscriptionTier: 'free',
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockPrisma.user.findUnique.mockResolvedValue(userRow);
      mockJwtUtils.generateToken.mockReturnValue('jwt-existing');

      const result = await authService.verifyEmail(email, '000000');

      expect(result.token).toBe('jwt-existing');
      expect(mockPrisma.emailVerificationOTP.findMany).not.toHaveBeenCalled();
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
        emailVerified: true,
        onboardingCompletedAt: null,
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
          emailVerified: true,
          pendingEmail: null,
          onboardingCompletedAt: null,
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

    it('should throw EmailNotVerifiedError when email is not verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: 'free',
        emailVerified: false,
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPasswordUtils.verifyPassword.mockResolvedValue(true);

      await expect(authService.login('test@example.com', 'SecurePass123!')).rejects.toThrow(
        EmailNotVerifiedError
      );
    });

    it('should throw AuthenticationError for invalid password', async () => {
      const mockDbUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: 'free',
        emailVerified: true,
        onboardingCompletedAt: null,
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
        emailVerified: true
      };

      const mockDbUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        subscriptionTier: 'free',
        emailVerified: true,
        onboardingCompletedAt: null,
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
        emailVerified: true,
        pendingEmail: null,
        onboardingCompletedAt: null,
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
        emailVerified: true
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
        emailVerified: true,
        pendingEmail: null,
        onboardingCompletedAt: null,
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
        emailVerified: true,
        pendingEmail: null,
        onboardingCompletedAt: null,
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
        emailVerified: true,
      });
    });
  });

  describe('requestEmailChange', () => {
    const baseUser = {
      id: 'u1',
      email: 'old@example.com',
      passwordHash: 'hash',
      authProvider: 'local',
      subscriptionTier: 'free',
      emailVerified: true,
      pendingEmail: null,
      onboardingCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    beforeEach(() => {
      mockPasswordUtils.verifyPassword.mockResolvedValue(true);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.emailVerificationOTP.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.emailVerificationOTP.create.mockResolvedValue({ id: 'otp' });
    });

    it('sets pending email and sends confirmation OTP', async () => {
      const updated = { ...baseUser, pendingEmail: 'new@example.com' };
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPrisma.user.update.mockResolvedValue(updated);

      const result = await authService.requestEmailChange('u1', 'new@example.com', 'password');

      expect(result.pendingEmail).toBe('new@example.com');
      expect(mockEmailService.sendEmailChangeConfirmationOTP).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringMatching(/^\d{6}$/)
      );
    });

    it('clears pending when new email equals current', async () => {
      const cleared = { ...baseUser, pendingEmail: null };
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPrisma.user.update.mockResolvedValue(cleared);

      const result = await authService.requestEmailChange('u1', 'old@example.com', 'password');

      expect(result.pendingEmail).toBeNull();
      expect(mockEmailService.sendEmailChangeConfirmationOTP).not.toHaveBeenCalled();
    });

    it('throws when email send fails and reverts pending', async () => {
      const updated = { ...baseUser, pendingEmail: 'new@example.com' };
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPrisma.user.update.mockResolvedValue(updated);
      mockEmailService.sendEmailChangeConfirmationOTP.mockRejectedValue(new Error('resend down'));

      await expect(
        authService.requestEmailChange('u1', 'new@example.com', 'password')
      ).rejects.toThrow(ExternalServiceError);

      expect(mockPrisma.emailVerificationOTP.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { pendingEmail: null }
      });
    });
  });

  describe('confirmEmailChange', () => {
    it('applies pending email and returns new token', async () => {
      const withPending = {
        id: 'u1',
        email: 'old@example.com',
        pendingEmail: 'new@example.com',
        passwordHash: 'h',
        authProvider: 'local',
        subscriptionTier: 'free',
        emailVerified: true,
        onboardingCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const finalUser = {
        ...withPending,
        email: 'new@example.com',
        pendingEmail: null,
        emailVerified: true
      };
      mockPrisma.user.findUnique.mockResolvedValue(withPending);
      mockPrisma.emailVerificationOTP.findMany.mockResolvedValue([
        {
          id: 'o1',
          email: 'new@example.com',
          otpHash: 'h',
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date()
        }
      ]);
      mockPasswordUtils.verifyPassword.mockResolvedValue(true);
      mockPrisma.emailVerificationOTP.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue(finalUser);
      mockJwtUtils.generateToken.mockReturnValue('jwt-new');

      const result = await authService.confirmEmailChange('u1', '123456');

      expect(result.user.email).toBe('new@example.com');
      expect(result.token).toBe('jwt-new');
      expect(mockJwtUtils.generateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          email: 'new@example.com',
          emailVerified: true
        })
      );
    });
  });
});