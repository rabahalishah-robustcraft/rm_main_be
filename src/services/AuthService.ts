import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { User, AuthService as IAuthService, SubscriptionTier, AuthenticationError, ValidationError } from '../types/auth';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password';
import { generateToken, validateToken, generateResetToken, validateResetToken } from '../utils/jwt';
import { PrismaClient } from '@prisma/client';
import prismaClient from '../lib/prisma';
import { IEmailService } from './EmailService';

const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

export class AuthService implements IAuthService {
  constructor(
    private prismaInstance?: PrismaClient,
    private emailService?: IEmailService,
    private googleClientId?: string
  ) {}

  private get prisma(): PrismaClient {
    return this.prismaInstance || prismaClient;
  }

  private dbUserToUser(dbUser: {
    id: string;
    email: string;
    passwordHash: string | null;
    subscriptionTier: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      passwordHash: dbUser.passwordHash,
      subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt
    };
  }
  /**
   * Register a new user with email and password
   * Requirements: 1.1, 9.1
   */
  async register(email: string, password: string): Promise<{ user: User; token: string }> {
    try {
      // Validate input
      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new ValidationError('Invalid email format');
      }

      // Validate password strength
      validatePassword(password);

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (existingUser) {
        throw new ValidationError('User with this email already exists');
      }

      // Hash password with bcrypt (minimum 12 salt rounds)
      const passwordHash = await hashPassword(password);

      // Use a transaction to ensure atomicity - if anything fails, rollback everything
      const result = await this.prisma.$transaction(async (tx) => {
        // Create user with default free subscription tier
        const dbUser = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            passwordHash,
            subscriptionTier: SubscriptionTier.FREE
          }
        });

        // Convert database user to application user type
        const user = this.dbUserToUser(dbUser);

        // Generate JWT token (if this fails, the transaction will rollback)
        const token = generateToken({
          userId: user.id,
          email: user.email,
          subscriptionTier: user.subscriptionTier
        });

        // Create default user profile
        await tx.userProfile.create({
          data: {
            userId: user.id,
            aiAttributes: {},
            extractedSkills: []
          }
        });

        return { user, token };
      });

      return result;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }
      // Log the actual error for debugging
      console.error('Registration error:', error);
      throw new AuthenticationError('Registration failed', { 
        error: (error as Error).message,
        stack: (error as Error).stack 
      });
    }
  }

  /**
   * Login user with email and password
   * Requirements: 1.2, 9.2
   */
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    try {
      // Validate input
      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }

      // Find user by email
      const dbUser = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!dbUser) {
        throw new AuthenticationError('Invalid credentials');
      }

      // Google OAuth users cannot login with password
      if (!dbUser.passwordHash) {
        throw new AuthenticationError('Invalid credentials');
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, dbUser.passwordHash);
      if (!isValidPassword) {
        throw new AuthenticationError('Invalid credentials');
      }

      const user = this.dbUserToUser(dbUser);

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier
      });

      return { user, token };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Login failed', { error: (error as Error).message });
    }
  }

  /**
   * Validate JWT token and return user
   * Requirements: 1.3, 9.2
   */
  async validateToken(token: string): Promise<User> {
    try {
      if (!token) {
        throw new AuthenticationError('Token is required');
      }

      // Validate and decode JWT token
      const payload = validateToken(token);

      // Find user in database to ensure they still exist
      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.userId }
      });

      if (!dbUser) {
        throw new AuthenticationError('User not found');
      }

      return this.dbUserToUser(dbUser);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Token validation failed', { error: (error as Error).message });
    }
  }

  /**
   * Logout user by invalidating token
   * Requirements: 1.4
   * Note: Since we're using stateless JWT tokens, logout is handled client-side
   * In a production system, you might want to implement a token blacklist
   */
  async logout(token: string): Promise<void> {
    try {
      // Validate token to ensure it's valid before "logout"
      await this.validateToken(token);
      
      // For stateless JWT tokens, logout is primarily handled client-side
      // The client should remove the token from storage
      // In a more sophisticated system, you could:
      // 1. Add token to a blacklist/revocation list
      // 2. Store active sessions in Redis with expiration
      // 3. Use shorter-lived tokens with refresh tokens
      
      // For now, we just validate the token exists and is valid
      // The actual "logout" happens when the client discards the token
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Logout failed', { error: (error as Error).message });
    }
  }

  /**
   * Refresh JWT token
   * Requirements: 9.2
   */
  async refreshToken(token: string): Promise<string> {
    try {
      // Validate current token
      const user = await this.validateToken(token);

      // Generate new token with same payload
      const newToken = generateToken({
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier
      });

      return newToken;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Token refresh failed', { error: (error as Error).message });
    }
  }

  /**
   * Get user by ID (internal helper method)
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!dbUser) {
        return null;
      }

      return this.dbUserToUser(dbUser);
    } catch (error) {
      throw new AuthenticationError('Failed to get user', { error: (error as Error).message });
    }
  }

  /**
   * Update user subscription tier
   */
  async updateSubscriptionTier(userId: string, tier: SubscriptionTier): Promise<User> {
    try {
      const dbUser = await this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: tier }
      });

      return this.dbUserToUser(dbUser);
    } catch (error) {
      throw new AuthenticationError('Failed to update subscription tier', { error: (error as Error).message });
    }
  }

  /**
   * Login or register with Google ID token
   * Verifies the token, then creates or finds user
   */
  async loginWithGoogle(idToken: string): Promise<{ user: User; token: string }> {
    if (!this.googleClientId) {
      throw new AuthenticationError('Google Sign-In is not configured');
    }

    const client = new OAuth2Client(this.googleClientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: this.googleClientId
      });
      payload = ticket.getPayload();
    } catch (error) {
      throw new AuthenticationError('Invalid Google token', { error: (error as Error).message });
    }

    if (!payload || !payload.email) {
      throw new AuthenticationError('Invalid Google token: missing email');
    }

    const email = payload.email.toLowerCase();
    const googleId = payload.sub;

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { googleId }]
      }
    });

    if (existingUser) {
      if (existingUser.authProvider === 'local') {
        throw new AuthenticationError(
          'An account with this email already exists. Please sign in with your password.'
        );
      }
      const user = this.dbUserToUser(existingUser);
      const token = generateToken({
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier
      });
      return { user, token };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const dbUser = await tx.user.create({
        data: {
          email,
          passwordHash: null,
          authProvider: 'google',
          googleId,
          subscriptionTier: SubscriptionTier.FREE
        }
      });

      await tx.userProfile.create({
        data: {
          userId: dbUser.id,
          aiAttributes: {},
          extractedSkills: []
        }
      });

      const user = this.dbUserToUser(dbUser);
      const token = generateToken({
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier
      });
      return { user, token };
    });

    return result;
  }

  /**
   * Request password reset - sends OTP to email if user exists
   * Always returns same response for security (no email enumeration)
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      return;
    }

    if (user.authProvider !== 'local' || !user.passwordHash) {
      return;
    }

    if (!this.emailService?.isConfigured()) {
      throw new ValidationError(
        'Email service is not configured. Please contact support.'
      );
    }

    const otp = this.generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.passwordResetOTP.create({
      data: {
        email: normalizedEmail,
        otpHash,
        expiresAt
      }
    });

    await this.emailService.sendOTP(normalizedEmail, otp);
  }

  /**
   * Verify OTP and return reset token
   */
  async verifyOTP(email: string, otp: string): Promise<{ resetToken: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    const records = await this.prisma.passwordResetOTP.findMany({
      where: { email: normalizedEmail },
      orderBy: { createdAt: 'desc' }
    });

    for (const record of records) {
      if (new Date() > record.expiresAt) continue;

      const isValid = await verifyPassword(otp, record.otpHash);
      if (isValid) {
        await this.prisma.passwordResetOTP.deleteMany({
          where: { email: normalizedEmail }
        });
        const resetToken = generateResetToken(normalizedEmail);
        return { resetToken };
      }
    }

    throw new AuthenticationError('Invalid or expired OTP');
  }

  /**
   * Reset password using reset token
   */
  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const payload = validateResetToken(resetToken);
    validatePassword(newPassword);

    const passwordHash = await hashPassword(newPassword);

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email }
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (user.authProvider !== 'local') {
      throw new AuthenticationError('Password reset is not available for Google accounts');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });
  }

  /**
   * Change password for authenticated user (current password required).
   * Profile settings: edit password.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!dbUser) {
      throw new AuthenticationError('User not found');
    }

    if (dbUser.authProvider !== 'local' || !dbUser.passwordHash) {
      throw new AuthenticationError('Password change is not available for this account');
    }

    const isValid = await verifyPassword(currentPassword, dbUser.passwordHash);
    if (!isValid) {
      throw new AuthenticationError('Current password is incorrect');
    }

    validatePassword(newPassword);
    const passwordHash = await hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });
  }

  /**
   * Change email for authenticated user (current password required for verification).
   * Profile settings: edit email.
   */
  async changeEmail(userId: string, newEmail: string, password: string): Promise<User> {
    const normalizedNewEmail = newEmail.toLowerCase().trim();

    if (!normalizedNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNewEmail)) {
      throw new ValidationError('Invalid email format');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!dbUser) {
      throw new AuthenticationError('User not found');
    }

    if (dbUser.authProvider !== 'local' || !dbUser.passwordHash) {
      throw new AuthenticationError('Email change requires password verification. Use your account password.');
    }

    const isValid = await verifyPassword(password, dbUser.passwordHash);
    if (!isValid) {
      throw new AuthenticationError('Password is incorrect');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedNewEmail }
    });
    if (existing && existing.id !== userId) {
      throw new ValidationError('An account with this email already exists');
    }

    if (normalizedNewEmail === dbUser.email.toLowerCase()) {
      return this.dbUserToUser(dbUser);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: normalizedNewEmail }
    });

    return this.dbUserToUser(updated);
  }

  private generateOTP(): string {
    let otp = '';
    for (let i = 0; i < OTP_LENGTH; i++) {
      otp += Math.floor(Math.random() * 10).toString();
    }
    return otp;
  }
}

// Export singleton instance
export const authService = new AuthService();