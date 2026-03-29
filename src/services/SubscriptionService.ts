import { PrismaClient, UsageTracking } from '@prisma/client';

/**
 * Subscription Service for managing user subscriptions and usage tracking
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

export enum SubscriptionTier {
  FREE = 'free',
  PAID = 'paid'
}

export interface UsageInfo {
  currentUsage: number;
  limit: number | null; // null indicates unlimited
  canCreateSession: boolean;
  tier: SubscriptionTier;
}

/**
 * Custom error class for Subscription service errors
 */
export class SubscriptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

/**
 * Subscription Service implementation
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export class SubscriptionService {
  private readonly FREE_TIER_LIMIT = 3; // 3 sessions per month for free tier

  constructor(private prisma: PrismaClient) {}

  /**
   * Validate that user can create a new session, throwing error if limit exceeded
   * Requirements: 6.2, 6.3
   */
  async validateUsageLimit(userId: string): Promise<void> {
    try {
      const canCreateSession = await this.checkUsageLimit(userId);
      
      if (!canCreateSession) {
        const usageInfo = await this.getUsageInfo(userId);
        throw new SubscriptionError(
          `You have reached your monthly limit of ${usageInfo.limit} sessions. Please upgrade your subscription for unlimited access.`,
          'USAGE_LIMIT_EXCEEDED',
          undefined
        );
      }
    } catch (error) {
      if (error instanceof SubscriptionError) {
        throw error;
      }
      throw new SubscriptionError(
        'Failed to validate usage limit',
        'USAGE_VALIDATION_FAILED',
        error as Error
      );
    }
  }
  async checkUsageLimit(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
      }

      // Normalize tier to lowercase to handle any case variations
      const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;

      // Paid users have unlimited sessions
      if (tier === SubscriptionTier.PAID) {
        return true;
      }

      // Check current month usage for free users
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
      const currentYear = currentDate.getFullYear();

      const usage = await this.getCurrentMonthUsage(userId, currentMonth, currentYear);
      return usage.sessionCount < this.FREE_TIER_LIMIT;
    } catch (error) {
      if (error instanceof SubscriptionError) {
        throw error;
      }
      throw new SubscriptionError(
        'Failed to check usage limit',
        'USAGE_CHECK_FAILED',
        error as Error
      );
    }
  }

  /**
   * Increment usage count for a user
   * Requirements: 3.5
   */
  async incrementUsage(userId: string): Promise<void> {
    try {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      // Use upsert to create or update usage record
      await this.prisma.usageTracking.upsert({
        where: {
          userId_month_year: {
            userId,
            month: currentMonth,
            year: currentYear
          }
        },
        update: {
          sessionCount: {
            increment: 1
          }
        },
        create: {
          userId,
          month: currentMonth,
          year: currentYear,
          sessionCount: 1
        }
      });
    } catch (error) {
      throw new SubscriptionError(
        'Failed to increment usage',
        'USAGE_INCREMENT_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get current usage information for a user
   * Requirements: 6.2
   */
  async getUsageInfo(userId: string): Promise<UsageInfo> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
      }

      // Normalize tier to lowercase to handle any case variations
      const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      if (tier === SubscriptionTier.PAID) {
        return {
          currentUsage: 0,
          limit: null, // null indicates unlimited
          canCreateSession: true,
          tier
        };
      }

      const usage = await this.getCurrentMonthUsage(userId, currentMonth, currentYear);
      
      return {
        currentUsage: usage.sessionCount,
        limit: this.FREE_TIER_LIMIT,
        canCreateSession: usage.sessionCount < this.FREE_TIER_LIMIT,
        tier
      };
    } catch (error) {
      if (error instanceof SubscriptionError) {
        throw error;
      }
      throw new SubscriptionError(
        'Failed to get usage info',
        'USAGE_INFO_FAILED',
        error as Error
      );
    }
  }

  /**
   * Upgrade user subscription to paid tier
   * Requirements: 6.4
   */
  async upgradeSubscription(userId: string, tier: SubscriptionTier): Promise<void> {
    try {
      // Normalize tier to lowercase to match enum values
      const normalizedTier = tier.toLowerCase() as SubscriptionTier;
      
      await this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: normalizedTier }
      });
    } catch (error) {
      throw new SubscriptionError(
        'Failed to upgrade subscription',
        'SUBSCRIPTION_UPGRADE_FAILED',
        error as Error
      );
    }
  }

  /**
   * Reset monthly usage for all users (typically run as a cron job)
   * Requirements: 6.5
   */
  async resetMonthlyUsage(): Promise<void> {
    try {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      // Delete all usage records for the current month/year
      // This effectively resets usage to 0 for all users
      await this.prisma.usageTracking.deleteMany({
        where: {
          month: currentMonth,
          year: currentYear
        }
      });
    } catch (error) {
      throw new SubscriptionError(
        'Failed to reset monthly usage',
        'USAGE_RESET_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get or create current month usage record
   * Requirements: 6.2
   */
  private async getCurrentMonthUsage(userId: string, month: number, year: number): Promise<UsageTracking> {
    let usage = await this.prisma.usageTracking.findUnique({
      where: {
        userId_month_year: {
          userId,
          month,
          year
        }
      }
    });

    if (!usage) {
      // Create new usage record if it doesn't exist
      usage = await this.prisma.usageTracking.create({
        data: {
          userId,
          month,
          year,
          sessionCount: 0
        }
      });
    }

    return usage;
  }
}