import { PrismaClient, AudioSession } from '@prisma/client';

/**
 * Dashboard Service for analytics and performance tracking
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

export interface DashboardStats {
  confidenceScore: number;
  totalSessions: number;
  averageScores: {
    clarity: number;
    confidence: number;
    tone: number;
    enthusiasm: number;
    specificity: number;
  };
  recentInsights: string[];
  usageThisMonth: number;
  usageLimit: number | null; // null indicates unlimited
}

export interface Insight {
  id: string;
  type: 'improvement' | 'strength' | 'trend';
  message: string;
  category: 'clarity' | 'confidence' | 'tone' | 'enthusiasm' | 'specificity' | 'overall';
  createdAt: Date;
}

export interface PerformanceTrend {
  date: string;
  scores: {
    clarity: number;
    confidence: number;
    tone: number;
    enthusiasm: number;
    specificity: number;
    overall: number;
  };
  sessionCount: number;
}

export interface ScoreAnalysis {
  current: number;
  previous: number;
  change: number;
  trend: 'improving' | 'declining' | 'stable';
}

/**
 * Custom error class for Dashboard service errors
 */
export class DashboardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

/**
 * Dashboard Service implementation
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class DashboardService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get comprehensive dashboard statistics
   * Requirements: 5.1, 5.2, 5.5
   */
  async getStats(userId: string): Promise<DashboardStats> {
    try {
      // Verify user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { usageTracking: true }
      });

      if (!user) {
        throw new DashboardError('User not found', 'USER_NOT_FOUND');
      }

      // Get all completed sessions for the user
      const sessions = await this.prisma.audioSession.findMany({
        where: {
          userId,
          status: 'completed'
        },
        orderBy: { createdAt: 'desc' }
      });

      // Calculate confidence score from recent sessions
      const confidenceScore = await this.calculateConfidenceScore(userId);

      // Calculate average scores across all categories
      const averageScores = this.calculateAverageScores(sessions);

      // Get recent insights from session history
      const recentInsights = await this.generateRecentInsights(sessions.slice(0, 10));

      // Get current month usage
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usageRecord = await this.prisma.usageTracking.findUnique({
        where: {
          userId_month_year: {
            userId,
            month: currentMonth,
            year: currentYear
          }
        }
      });

      const usageThisMonth = usageRecord?.sessionCount || 0;
      const usageLimit = user.subscriptionTier === 'paid' ? null : 3; // null means unlimited

      return {
        confidenceScore,
        totalSessions: sessions.length,
        averageScores,
        recentInsights,
        usageThisMonth,
        usageLimit
      };
    } catch (error) {
      if (error instanceof DashboardError) {
        throw error;
      }
      throw new DashboardError(
        'Failed to get dashboard stats',
        'STATS_RETRIEVAL_FAILED',
        error as Error
      );
    }
  }

  /**
   * Calculate confidence score from session history
   * Requirements: 5.1
   */
  async calculateConfidenceScore(userId: string): Promise<number> {
    try {
      // Get recent completed sessions (last 10 sessions or 30 days, whichever is more recent)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentSessions = await this.prisma.audioSession.findMany({
        where: {
          userId,
          status: 'completed',
          createdAt: {
            gte: thirtyDaysAgo
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      if (recentSessions.length === 0) {
        return 0; // No sessions to calculate from
      }

      // Calculate weighted average with more recent sessions having higher weight
      let totalWeightedScore = 0;
      let totalWeight = 0;

      recentSessions.forEach((session, index) => {
        // Calculate overall score for this session
        const sessionScore = this.calculateSessionOverallScore(session);
        
        // Weight decreases for older sessions (most recent = weight 1.0, oldest = weight 0.5)
        const weight = 1.0 - (index * 0.5) / recentSessions.length;
        
        totalWeightedScore += sessionScore * weight;
        totalWeight += weight;
      });

      const confidenceScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
      if (totalWeight === 0) return 0; // No sessions: no score
      // Round to nearest and ensure it's between 1-5 (out of 5)
      return Math.max(1, Math.min(5, Math.round(confidenceScore)));
    } catch (error) {
      throw new DashboardError(
        'Failed to calculate confidence score',
        'CONFIDENCE_CALCULATION_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get recent insights based on session patterns
   * Requirements: 5.4
   */
  async getRecentInsights(userId: string, limit: number = 10): Promise<Insight[]> {
    try {
      // Get recent sessions for analysis
      const sessions = await this.prisma.audioSession.findMany({
        where: {
          userId,
          status: 'completed'
        },
        orderBy: { createdAt: 'desc' },
        take: 20 // Analyze more sessions to generate better insights
      });

      if (sessions.length === 0) {
        return [];
      }

      const insights: Insight[] = [];

      // Analyze trends and patterns
      const trendInsights = this.analyzeTrends(sessions);
      insights.push(...trendInsights);

      // Analyze strengths and weaknesses
      const strengthInsights = this.analyzeStrengthsAndWeaknesses(sessions);
      insights.push(...strengthInsights);

      // Analyze improvement patterns
      const improvementInsights = this.analyzeImprovementPatterns(sessions);
      insights.push(...improvementInsights);

      // Sort by relevance and return limited results
      return insights
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    } catch (error) {
      throw new DashboardError(
        'Failed to get insights',
        'INSIGHTS_RETRIEVAL_FAILED',
        error as Error
      );
    }
  }

  /**
   * Get performance trends over time
   * Requirements: 5.2, 5.5
   */
  async getPerformanceTrends(userId: string, days: number = 30): Promise<PerformanceTrend[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get sessions within the specified time range
      const sessions = await this.prisma.audioSession.findMany({
        where: {
          userId,
          status: 'completed',
          createdAt: {
            gte: startDate
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      if (sessions.length === 0) {
        return [];
      }

      // Group sessions by date and calculate daily averages
      const dailyData = new Map<string, AudioSession[]>();

      sessions.forEach(session => {
        const dateKey = session.createdAt.toISOString().split('T')[0];
        if (!dailyData.has(dateKey)) {
          dailyData.set(dateKey, []);
        }
        dailyData.get(dateKey)!.push(session);
      });

      // Convert to trend data
      const trends: PerformanceTrend[] = [];

      for (const [date, daySessions] of dailyData.entries()) {
        const averageScores = this.calculateAverageScores(daySessions);
        const overallScore = this.calculateOverallScoreFromAverages(averageScores);

        trends.push({
          date,
          scores: {
            ...averageScores,
            overall: overallScore
          },
          sessionCount: daySessions.length
        });
      }

      return trends.sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
      throw new DashboardError(
        'Failed to get performance trends',
        'TRENDS_RETRIEVAL_FAILED',
        error as Error
      );
    }
  }

  /**
   * Calculate average scores across all categories
   * Requirements: 5.2
   */
  private calculateAverageScores(sessions: AudioSession[]): {
    clarity: number;
    confidence: number;
    tone: number;
    enthusiasm: number;
    specificity: number;
  } {
    if (sessions.length === 0) {
      return {
        clarity: 0,
        confidence: 0,
        tone: 0,
        enthusiasm: 0,
        specificity: 0
      };
    }

    const totals = {
      clarity: 0,
      confidence: 0,
      tone: 0,
      enthusiasm: 0,
      specificity: 0
    };

    let validSessionCount = 0;

    sessions.forEach(session => {
      // Only include sessions with valid scores
      if (
        session.clarityScore !== null &&
        session.confidenceScore !== null &&
        session.toneScore !== null &&
        session.enthusiasmScore !== null &&
        session.specificityScore !== null
      ) {
        totals.clarity += session.clarityScore;
        totals.confidence += session.confidenceScore;
        totals.tone += session.toneScore;
        totals.enthusiasm += session.enthusiasmScore;
        totals.specificity += session.specificityScore;
        validSessionCount++;
      }
    });

    if (validSessionCount === 0) {
      return {
        clarity: 0,
        confidence: 0,
        tone: 0,
        enthusiasm: 0,
        specificity: 0
      };
    }

    return {
      clarity: Math.round(totals.clarity / validSessionCount),
      confidence: Math.round(totals.confidence / validSessionCount),
      tone: Math.round(totals.tone / validSessionCount),
      enthusiasm: Math.round(totals.enthusiasm / validSessionCount),
      specificity: Math.round(totals.specificity / validSessionCount)
    };
  }

  /**
   * Calculate overall score for a single session
   */
  private calculateSessionOverallScore(session: AudioSession): number {
    const scores = [
      session.clarityScore,
      session.confidenceScore,
      session.toneScore,
      session.enthusiasmScore,
      session.specificityScore
    ].filter(score => score !== null) as number[];

    if (scores.length === 0) {
      return 0;
    }

    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  /**
   * Calculate overall score from average scores
   */
  private calculateOverallScoreFromAverages(averages: {
    clarity: number;
    confidence: number;
    tone: number;
    enthusiasm: number;
    specificity: number;
  }): number {
    const scores = [
      averages.clarity,
      averages.confidence,
      averages.tone,
      averages.enthusiasm,
      averages.specificity
    ];

    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }

  /**
   * Generate recent insights from session analysis
   * Requirements: 5.4
   */
  private async generateRecentInsights(sessions: AudioSession[]): Promise<string[]> {
    if (sessions.length === 0) {
      return ['Complete your first session to see personalized insights!'];
    }

    const insights: string[] = [];

    // Analyze recent performance
    const recentAverage = this.calculateAverageScores(sessions.slice(0, 3));
    const overallAverage = this.calculateAverageScores(sessions);

    // Find strongest and weakest areas
    const categories = ['clarity', 'confidence', 'tone', 'enthusiasm', 'specificity'] as const;
    const categoryScores = categories.map(cat => ({
      category: cat,
      score: recentAverage[cat]
    }));

    categoryScores.sort((a, b) => b.score - a.score);
    const strongest = categoryScores[0];
    const weakest = categoryScores[categoryScores.length - 1];

    if (strongest.score > 0) {
      insights.push(`Your ${strongest.category} is your strongest area with an average score of ${strongest.score}`);
    }

    if (weakest.score < 70 && sessions.length > 1) {
      insights.push(`Focus on improving your ${weakest.category} - current average is ${weakest.score}`);
    }

    // Analyze improvement trends
    if (sessions.length >= 3) {
      const recent3 = this.calculateOverallScoreFromAverages(this.calculateAverageScores(sessions.slice(0, 3)));
      const previous3 = this.calculateOverallScoreFromAverages(this.calculateAverageScores(sessions.slice(3, 6)));
      
      if (recent3 > previous3 + 5) {
        insights.push(`Great progress! Your recent sessions show a ${recent3 - previous3} point improvement`);
      } else if (recent3 < previous3 - 5) {
        insights.push(`Your recent performance has dipped. Consider reviewing your preparation strategy`);
      }
    }

    // Session frequency insights
    if (sessions.length >= 2) {
      const daysBetween = Math.abs(
        (sessions[0].createdAt.getTime() - sessions[1].createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysBetween > 7) {
        insights.push('Try to practice more regularly - consistent practice leads to better results');
      } else if (daysBetween <= 1) {
        insights.push('Great consistency! Regular practice is key to improvement');
      }
    }

    return insights.slice(0, 5); // Return top 5 insights
  }

  /**
   * Analyze performance trends
   */
  private analyzeTrends(sessions: AudioSession[]): Insight[] {
    const insights: Insight[] = [];
    
    if (sessions.length < 3) {
      return insights;
    }

    const categories = ['clarity', 'confidence', 'tone', 'enthusiasm', 'specificity'] as const;
    
    categories.forEach(category => {
      const scores = sessions
        .slice(0, 5) // Last 5 sessions
        .map(s => this.getScoreByCategory(s, category))
        .filter(score => score !== null) as number[];

      if (scores.length >= 3) {
        const trend = this.calculateTrend(scores);
        if (trend.trend !== 'stable') {
          insights.push({
            id: `trend-${category}-${Date.now()}`,
            type: 'trend',
            message: `Your ${category} is ${trend.trend} (${trend.change > 0 ? '+' : ''}${trend.change} points)`,
            category,
            createdAt: new Date()
          });
        }
      }
    });

    return insights;
  }

  /**
   * Analyze strengths and weaknesses
   */
  private analyzeStrengthsAndWeaknesses(sessions: AudioSession[]): Insight[] {
    const insights: Insight[] = [];
    const averages = this.calculateAverageScores(sessions.slice(0, 5));
    
    const categories = Object.entries(averages) as [keyof typeof averages, number][];
    categories.sort((a, b) => b[1] - a[1]);

    // Identify strength
    const strongest = categories[0];
    if (strongest[1] >= 80) {
      insights.push({
        id: `strength-${strongest[0]}-${Date.now()}`,
        type: 'strength',
        message: `Excellent ${strongest[0]} skills - you consistently score ${strongest[1]} in this area`,
        category: strongest[0],
        createdAt: new Date()
      });
    }

    // Identify weakness
    const weakest = categories[categories.length - 1];
    if (weakest[1] < 60) {
      insights.push({
        id: `improvement-${weakest[0]}-${Date.now()}`,
        type: 'improvement',
        message: `Focus on ${weakest[0]} - this area needs attention (current average: ${weakest[1]})`,
        category: weakest[0],
        createdAt: new Date()
      });
    }

    return insights;
  }

  /**
   * Analyze improvement patterns
   */
  private analyzeImprovementPatterns(sessions: AudioSession[]): Insight[] {
    const insights: Insight[] = [];
    
    if (sessions.length < 4) {
      return insights;
    }

    // Compare recent vs older sessions
    const recent = this.calculateAverageScores(sessions.slice(0, 3));
    const older = this.calculateAverageScores(sessions.slice(3, 6));

    const recentOverall = this.calculateOverallScoreFromAverages(recent);
    const olderOverall = this.calculateOverallScoreFromAverages(older);

    const improvement = recentOverall - olderOverall;

    if (improvement >= 10) {
      insights.push({
        id: `improvement-overall-${Date.now()}`,
        type: 'improvement',
        message: `Outstanding progress! You've improved by ${improvement} points in recent sessions`,
        category: 'overall',
        createdAt: new Date()
      });
    } else if (improvement <= -10) {
      insights.push({
        id: `improvement-decline-${Date.now()}`,
        type: 'improvement',
        message: `Recent performance has declined by ${Math.abs(improvement)} points. Consider reviewing your approach`,
        category: 'overall',
        createdAt: new Date()
      });
    }

    return insights;
  }

  /**
   * Get score by category from session
   */
  private getScoreByCategory(session: AudioSession, category: string): number | null {
    switch (category) {
      case 'clarity': return session.clarityScore;
      case 'confidence': return session.confidenceScore;
      case 'tone': return session.toneScore;
      case 'enthusiasm': return session.enthusiasmScore;
      case 'specificity': return session.specificityScore;
      default: return null;
    }
  }

  /**
   * Calculate trend from score array
   */
  private calculateTrend(scores: number[]): ScoreAnalysis {
    if (scores.length < 2) {
      return { current: scores[0] || 0, previous: 0, change: 0, trend: 'stable' };
    }

    const current = scores[0];
    const previous = scores[scores.length - 1];
    const change = current - previous;

    let trend: 'improving' | 'declining' | 'stable';
    if (change >= 5) {
      trend = 'improving';
    } else if (change <= -5) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    return { current, previous, change, trend };
  }
}