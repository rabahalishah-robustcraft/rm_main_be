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
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: string | null;
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
export type InterviewPlanLimits = {
  tier: SubscriptionTier;
  /** null = unlimited (paid) */
  interviewSessionsLimit: number | null;
  interviewSessionsUsedThisMonth: number;
  /** null = unlimited */
  interviewSessionsRemaining: number | null;
  maxInterviewAudioSeconds: number;
};

export class SubscriptionService {
  private readonly FREE_TIER_LIMIT = 3; // practice sessions per month (usage_tracking)
  private readonly FREE_INTERVIEW_SESSIONS_PER_MONTH = 3;

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

  /**
   * Paid users may call GET /api/practice/questions?refresh=true anytime.
   * Free users must rely on the 24h rotation (profile edits do not reset the timer).
   */
  async assertCanForceRefreshPracticeQuestions(
    userId: string,
    forceRefresh: boolean
  ): Promise<void> {
    if (!forceRefresh) {
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
    }
    const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;
    if (tier === SubscriptionTier.PAID) {
      return;
    }
    throw new SubscriptionError(
      'On-demand refresh is available on Pro. Free plans get new practice questions every 24 hours; updating your profile does not reset that timer.',
      'PRACTICE_REFRESH_REQUIRES_UPGRADE'
    );
  }

  /**
   * Real-time interview starts (POST /api/sessions/start): free = 3 per calendar month
   * by interview row count; independent of practice usage_tracking. Paid = unlimited.
   */
  async validateInterviewSessionStart(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });
      if (!user) {
        throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
      }
      const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;
      if (tier === SubscriptionTier.PAID) {
        return;
      }
      const used = await this.countInterviewSessionsThisMonth(userId);
      if (used >= this.FREE_INTERVIEW_SESSIONS_PER_MONTH) {
        throw new SubscriptionError(
          `You have reached your monthly limit of ${this.FREE_INTERVIEW_SESSIONS_PER_MONTH} real-time interview sessions. Upgrade for unlimited interviews or try again next month.`,
          'INTERVIEW_SESSION_LIMIT_EXCEEDED'
        );
      }
    } catch (error) {
      if (error instanceof SubscriptionError) {
        throw error;
      }
      throw new SubscriptionError(
        'Failed to validate interview session limit',
        'INTERVIEW_LIMIT_VALIDATION_FAILED',
        error as Error
      );
    }
  }

  /** Interview rows with sessionType interview created in the current local calendar month. */
  async countInterviewSessionsThisMonth(userId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return this.prisma.audioSession.count({
      where: {
        userId,
        sessionType: 'interview',
        createdAt: { gte: start, lt: end }
      }
    });
  }

  /**
   * Snapshot for GET /api/sessions/:id (interview) and clients.
   * maxInterviewAudioSeconds: 30 min free, 60 min paid (aligned with AudioSessionService upload cap).
   */
  async getInterviewPlanLimits(userId: string): Promise<InterviewPlanLimits> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
    }
    const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;
    const used = await this.countInterviewSessionsThisMonth(userId);
    if (tier === SubscriptionTier.PAID) {
      return {
        tier,
        interviewSessionsLimit: null,
        interviewSessionsUsedThisMonth: used,
        interviewSessionsRemaining: null,
        maxInterviewAudioSeconds: 60 * 60
      };
    }
    const limit = this.FREE_INTERVIEW_SESSIONS_PER_MONTH;
    return {
      tier,
      interviewSessionsLimit: limit,
      interviewSessionsUsedThisMonth: used,
      interviewSessionsRemaining: Math.max(0, limit - used),
      maxInterviewAudioSeconds: 30 * 60
    };
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

      const stripeExtra = {
        stripeSubscriptionId: user.stripeSubscriptionId ?? null,
        stripeSubscriptionStatus: user.stripeSubscriptionStatus ?? null,
        stripeCurrentPeriodEnd: user.stripeCurrentPeriodEnd?.toISOString() ?? null
      };

      if (tier === SubscriptionTier.PAID) {
        return {
          currentUsage: 0,
          limit: null, // null indicates unlimited
          canCreateSession: true,
          tier,
          ...stripeExtra
        };
      }

      const usage = await this.getCurrentMonthUsage(userId, currentMonth, currentYear);
      
      return {
        currentUsage: usage.sessionCount,
        limit: this.FREE_TIER_LIMIT,
        canCreateSession: usage.sessionCount < this.FREE_TIER_LIMIT,
        tier,
        ...stripeExtra
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