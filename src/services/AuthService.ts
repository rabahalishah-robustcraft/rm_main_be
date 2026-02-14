import { User, AuthService as IAuthService, SubscriptionTier, AuthenticationError, ValidationError } from '../types/auth';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password';
import { generateToken, validateToken } from '../utils/jwt';
import { PrismaClient } from '@prisma/client';
import prismaClient from '../lib/prisma';

export class AuthService implements IAuthService {
  constructor(private prismaInstance?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.prismaInstance || prismaClient;
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
        const user: User = {
          id: dbUser.id,
          email: dbUser.email,
          passwordHash: dbUser.passwordHash,
          subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
          createdAt: dbUser.createdAt,
          updatedAt: dbUser.updatedAt
        };

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

      // Verify password
      const isValidPassword = await verifyPassword(password, dbUser.passwordHash);
      if (!isValidPassword) {
        throw new AuthenticationError('Invalid credentials');
      }

      // Convert database user to application user type
      const user: User = {
        id: dbUser.id,
        email: dbUser.email,
        passwordHash: dbUser.passwordHash,
        subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt
      };

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

      // Convert database user to application user type
      const user: User = {
        id: dbUser.id,
        email: dbUser.email,
        passwordHash: dbUser.passwordHash,
        subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt
      };

      return user;
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

      return {
        id: dbUser.id,
        email: dbUser.email,
        passwordHash: dbUser.passwordHash,
        subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt
      };
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

      return {
        id: dbUser.id,
        email: dbUser.email,
        passwordHash: dbUser.passwordHash,
        subscriptionTier: dbUser.subscriptionTier as SubscriptionTier,
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt
      };
    } catch (error) {
      throw new AuthenticationError('Failed to update subscription tier', { error: (error as Error).message });
    }
  }
}

// Export singleton instance
export const authService = new AuthService();