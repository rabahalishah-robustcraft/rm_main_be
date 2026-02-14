import prisma from '../lib/prisma';
import { config } from '../utils/config';
import OpenAI from 'openai';
import AWS from 'aws-sdk';

/**
 * API metrics tracking structure
 * Requirements: 8.5
 */
interface APIMetrics {
  total: number;
  successful: number;
  failed: number;
  responseTimes: number[];
  errorsByType: Map<string, number>;
}

/**
 * System monitoring and metrics collection service
 */
export class MonitoringService {
  private static instance: MonitoringService;
  private metrics: Map<string, any> = new Map();
  private alerts: Array<{ type: string; message: string; timestamp: Date; severity: 'low' | 'medium' | 'high' | 'critical' }> = [];
  private openaiClient: OpenAI | null = null;
  private s3Client: AWS.S3 | null = null;
  
  // Interval IDs for cleanup
  private intervals: NodeJS.Timeout[] = [];
  
  // API metrics tracking
  // Requirements: 8.5 - Track API success rates, response times, and error rates
  private apiMetrics: {
    openai: APIMetrics;
    s3: APIMetrics;
  } = {
    openai: {
      total: 0,
      successful: 0,
      failed: 0,
      responseTimes: [],
      errorsByType: new Map()
    },
    s3: {
      total: 0,
      successful: 0,
      failed: 0,
      responseTimes: [],
      errorsByType: new Map()
    }
  };

  private constructor() {
    // Initialize OpenAI client if API key is configured
    if (config.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
        maxRetries: 0, // No retries for health checks
        timeout: 5000  // 5 second timeout for health checks
      });
    }

    // Initialize S3 client if AWS credentials are configured
    if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
      try {
        AWS.config.update({
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
          region: config.AWS_REGION
        });
        
        this.s3Client = new AWS.S3({
          apiVersion: '2006-03-01',
          signatureVersion: 'v4'
        });
      } catch (error) {
        console.error('Failed to initialize S3 client:', error);
        this.s3Client = null;
      }
    }

    // Start periodic monitoring
    this.startPeriodicMonitoring();
  }

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  /**
   * Start periodic monitoring tasks
   */
  private startPeriodicMonitoring(): void {
    // Skip background tasks in test environment
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      console.log('Skipping MonitoringService background tasks in test environment');
      return;
    }

    // Collect metrics every 5 minutes
    this.intervals.push(setInterval(() => {
      this.collectSystemMetrics();
    }, 5 * 60 * 1000));

    // Check system health every minute
    this.intervals.push(setInterval(() => {
      this.performHealthChecks();
    }, 60 * 1000));

    // Clean up old metrics every hour
    this.intervals.push(setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000));

    // Clean up old alerts every 24 hours
    this.intervals.push(setInterval(() => {
      this.cleanupOldAlerts();
    }, 24 * 60 * 60 * 1000));
  }

  /**
   * Stop all periodic monitoring tasks
   */
  public stopPeriodicMonitoring(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
  }

  /**
   * Collect comprehensive system metrics
   */
  public async collectSystemMetrics(): Promise<void> {
    try {
      const timestamp = new Date();
      
      // System metrics
      const systemMetrics = this.getSystemMetrics();
      
      // Database metrics
      const dbMetrics = await this.getDatabaseMetrics();
      
      // Application metrics
      const appMetrics = await this.getApplicationMetrics();
      
      // Performance metrics
      const perfMetrics = await this.getPerformanceMetrics();

      // Store metrics
      const metricsSnapshot = {
        timestamp,
        system: systemMetrics,
        database: dbMetrics,
        application: appMetrics,
        performance: perfMetrics
      };

      this.metrics.set(timestamp.toISOString(), metricsSnapshot);

      // Check for alerts
      this.checkForAlerts(metricsSnapshot);

      console.log('System metrics collected:', {
        timestamp: timestamp.toISOString(),
        memoryUsage: systemMetrics.memory.heapUsed,
        dbConnections: dbMetrics.activeConnections || 'unknown',
        totalUsers: appMetrics.users.total
      });
    } catch (error) {
      console.error('Error collecting system metrics:', error);
      const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
      this.addAlert('critical', 'Failed to collect system metrics', errorMessage);
    }
  }

  /**
   * Get system-level metrics
   */
  private getSystemMetrics(): any {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      uptime: process.uptime(),
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        heapUsedPercentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    };
  }

  /**
   * Get database metrics
   */
  private async getDatabaseMetrics(): Promise<any> {
    try {
      const startTime = Date.now();
      
      // Test database connectivity
      await prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      // Get table counts
      const [userCount, profileCount, sessionCount, usageCount] = await Promise.all([
        prisma.user.count(),
        prisma.userProfile.count(),
        prisma.audioSession.count(),
        prisma.usageTracking.count()
      ]);

      // Get recent activity
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentUsers, recentSessions] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: last24Hours } } }),
        prisma.audioSession.count({ where: { createdAt: { gte: last24Hours } } })
      ]);

      return {
        responseTime,
        tables: {
          users: userCount,
          profiles: profileCount,
          sessions: sessionCount,
          usage: usageCount
        },
        recentActivity: {
          newUsersLast24h: recentUsers,
          newSessionsLast24h: recentSessions
        },
        status: 'healthy'
      };
    } catch (error) {
      console.error('Database metrics error:', error);
      const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
      return {
        status: 'error',
        error: errorMessage
      };
    }
  }

  /**
   * Get application-specific metrics
   */
  private async getApplicationMetrics(): Promise<any> {
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // User metrics
      const [totalUsers, newUsersLast24h, newUsersLast7d] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: last24Hours } } }),
        prisma.user.count({ where: { createdAt: { gte: last7Days } } })
      ]);

      // Session metrics
      const [totalSessions, sessionsLast24h, sessionsLast7d] = await Promise.all([
        prisma.audioSession.count(),
        prisma.audioSession.count({ where: { createdAt: { gte: last24Hours } } }),
        prisma.audioSession.count({ where: { createdAt: { gte: last7Days } } })
      ]);

      // Subscription metrics
      const subscriptionStats = await prisma.user.groupBy({
        by: ['subscriptionTier'],
        _count: true
      });

      // Usage metrics for current month
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      
      const monthlyUsage = await prisma.usageTracking.aggregate({
        where: {
          month: currentMonth,
          year: currentYear
        },
        _sum: {
          sessionCount: true
        },
        _avg: {
          sessionCount: true
        }
      });

      return {
        users: {
          total: totalUsers,
          newLast24h: newUsersLast24h,
          newLast7d: newUsersLast7d,
          subscriptions: subscriptionStats.reduce((acc, stat) => {
            acc[stat.subscriptionTier] = stat._count;
            return acc;
          }, {} as Record<string, number>)
        },
        sessions: {
          total: totalSessions,
          last24h: sessionsLast24h,
          last7d: sessionsLast7d,
          averagePerUser: totalUsers > 0 ? totalSessions / totalUsers : 0
        },
        usage: {
          totalThisMonth: monthlyUsage._sum.sessionCount || 0,
          averagePerUser: monthlyUsage._avg.sessionCount || 0
        }
      };
    } catch (error) {
      console.error('Application metrics error:', error);
      return {
        error: 'Failed to collect application metrics'
      };
    }
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(): Promise<any> {
    // In a real application, these would come from monitoring systems
    // For now, we'll provide basic metrics
    
    const memoryUsage = process.memoryUsage();
    const heapUsedPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    return {
      memoryUsage: {
        percentage: heapUsedPercentage,
        status: heapUsedPercentage > 90 ? 'critical' : heapUsedPercentage > 75 ? 'warning' : 'healthy'
      },
      uptime: {
        seconds: process.uptime(),
        status: process.uptime() > 86400 ? 'healthy' : 'warning' // 24 hours
      },
      // These would be collected from actual monitoring in production
      responseTime: {
        average: '150ms',
        p95: '300ms',
        p99: '500ms'
      },
      errorRate: {
        percentage: 0.1,
        status: 'healthy'
      },
      throughput: {
        requestsPerMinute: 100,
        status: 'healthy'
      }
    };
  }

  /**
   * Perform comprehensive health checks
   */
  public async performHealthChecks(): Promise<{ status: string; checks: any }> {
    const checks = {
      database: await this.checkDatabaseHealth(),
      externalServices: await this.checkExternalServicesHealth(),
      systemResources: this.checkSystemResourcesHealth(),
      configuration: this.checkConfigurationHealth()
    };

    const overallStatus = this.determineOverallHealth(checks);

    return {
      status: overallStatus,
      checks
    };
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<any> {
    try {
      const startTime = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime: `${responseTime}ms`,
        details: responseTime > 1000 ? 'Slow database response' : null
      };
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
      return {
        status: 'unhealthy',
        error: errorMessage
      };
    }
  }

  /**
   * Check external services health
   */
  private async checkExternalServicesHealth(): Promise<any> {
    const services = {
      openai: await this.checkOpenAIHealth(),
      aws: await this.checkAWSHealth()
    };

    return services;
  }

  /**
   * Check OpenAI service health
   * Requirements: 11.1, 11.3, 11.4
   */
  private async checkOpenAIHealth(): Promise<any> {
    if (!config.OPENAI_API_KEY || !this.openaiClient) {
      return {
        status: 'not_configured',
        message: 'OpenAI API key not configured'
      };
    }

    try {
      const startTime = Date.now();
      
      // Make lightweight test API call to OpenAI (models.list())
      // Requirement 11.1: Make a lightweight test API call
      await this.openaiClient.models.list();
      
      const responseTime = Date.now() - startTime;
      
      // Requirement 11.3, 11.4: Record response time and determine health status
      // Mark as healthy if response time < 2000ms, degraded if < 5000ms, unhealthy otherwise
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (responseTime < 2000) {
        status = 'healthy';
      } else if (responseTime < 5000) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }
      
      console.log('OpenAI health check completed', {
        status,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString()
      });
      
      return {
        status,
        responseTime: `${responseTime}ms`,
        message: status === 'healthy' ? 'OpenAI API responding normally' : 
                 status === 'degraded' ? 'OpenAI API responding slowly' :
                 'OpenAI API response time exceeded threshold',
        lastChecked: new Date()
      };
    } catch (error) {
      // Requirement 11.4: Catch and log errors, mark as unhealthy
      const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
      console.error('OpenAI health check failed', {
        error: errorMessage,
        timestamp: new Date().toISOString()
      });
      
      return {
        status: 'unhealthy',
        error: errorMessage,
        message: 'OpenAI API health check failed',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Check AWS services health
   * Requirements: 11.2, 11.3, 11.4
   */
  private async checkAWSHealth(): Promise<any> {
    const missingConfig = [];
    
    if (!config.AWS_ACCESS_KEY_ID) missingConfig.push('AWS_ACCESS_KEY_ID');
    if (!config.AWS_SECRET_ACCESS_KEY) missingConfig.push('AWS_SECRET_ACCESS_KEY');
    if (!config.AWS_S3_BUCKET) missingConfig.push('AWS_S3_BUCKET');

    if (missingConfig.length > 0) {
      return {
        status: 'not_configured',
        message: `Missing AWS configuration: ${missingConfig.join(', ')}`
      };
    }

    if (!this.s3Client) {
      return {
        status: 'not_configured',
        message: 'S3 client not initialized'
      };
    }

    // Check if S3 health checks are disabled
    if (process.env.DISABLE_S3_HEALTH_CHECK === 'true') {
      return {
        status: 'disabled',
        message: 'S3 health checks are disabled'
      };
    }

    try {
      const startTime = Date.now();
      
      // Use headBucket instead of listObjectsV2 - requires less permissions
      // Requirement 11.2: Make real API call to S3
      await this.s3Client.headBucket({
        Bucket: config.AWS_S3_BUCKET
      }).promise();
      
      const responseTime = Date.now() - startTime;
      
      // Requirement 11.3, 11.4: Record response time and determine health status
      // Mark as healthy if response time < 1000ms, degraded if < 3000ms, unhealthy otherwise
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (responseTime < 1000) {
        status = 'healthy';
      } else if (responseTime < 3000) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }
      
      console.log('S3 health check completed', {
        status,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString()
      });
      
      return {
        status,
        responseTime: `${responseTime}ms`,
        message: status === 'healthy' ? 'S3 API responding normally' : 
                 status === 'degraded' ? 'S3 API responding slowly' :
                 'S3 API response time exceeded threshold',
        lastChecked: new Date()
      };
    } catch (error) {
      // Requirement 11.4: Catch and log errors, mark as unhealthy
      // Don't log as error if it's just a permission issue - log as warning instead
      const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
      const isPermissionError = errorMessage.includes('not authorized') || errorMessage.includes('AccessDenied');
      
      if (isPermissionError) {
        console.warn('S3 health check - permission issue (non-critical)', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          suggestion: 'Add s3:HeadBucket permission or set DISABLE_S3_HEALTH_CHECK=true'
        });
      } else {
        console.error('S3 health check failed', {
          error: errorMessage,
          timestamp: new Date().toISOString()
        });
      }
      
      return {
        status: isPermissionError ? 'permission_denied' : 'unhealthy',
        error: errorMessage,
        message: isPermissionError 
          ? 'S3 health check disabled due to insufficient permissions' 
          : 'S3 API health check failed',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Check system resources health
   */
  private checkSystemResourcesHealth(): any {
    const memoryUsage = process.memoryUsage();
    const heapUsedPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    let status = 'healthy';
    let message = 'System resources normal';

    if (heapUsedPercentage > 90) {
      status = 'critical';
      message = 'Memory usage critical';
    } else if (heapUsedPercentage > 75) {
      status = 'warning';
      message = 'Memory usage high';
    }

    return {
      status,
      message,
      details: {
        memoryUsage: `${heapUsedPercentage.toFixed(1)}%`,
        uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
      }
    };
  }

  /**
   * Check configuration health
   */
  private checkConfigurationHealth(): any {
    const requiredVars = [
      'DATABASE_URL',
      'JWT_SECRET',
      'OPENAI_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);

    if (missing.length > 0) {
      return {
        status: 'unhealthy',
        message: `Missing required configuration: ${missing.join(', ')}`
      };
    }

    return {
      status: 'healthy',
      message: 'All required configuration present'
    };
  }

  /**
   * Determine overall health status
   */
  private determineOverallHealth(checks: any): string {
    const statuses = Object.values(checks).map((check: any) => check.status);
    
    if (statuses.includes('unhealthy') || statuses.includes('critical')) {
      return 'unhealthy';
    }
    
    if (statuses.includes('degraded') || statuses.includes('warning')) {
      return 'degraded';
    }
    
    return 'healthy';
  }

  /**
   * Check for alerts based on metrics
   */
  private checkForAlerts(metrics: any): void {
    // Memory usage alerts
    if (metrics.system.memory.heapUsedPercentage > 90) {
      this.addAlert('critical', 'High memory usage', `Memory usage at ${metrics.system.memory.heapUsedPercentage.toFixed(1)}%`);
    } else if (metrics.system.memory.heapUsedPercentage > 75) {
      this.addAlert('medium', 'Elevated memory usage', `Memory usage at ${metrics.system.memory.heapUsedPercentage.toFixed(1)}%`);
    }

    // Database response time alerts
    if (metrics.database.responseTime > 2000) {
      this.addAlert('high', 'Slow database response', `Database response time: ${metrics.database.responseTime}ms`);
    } else if (metrics.database.responseTime > 1000) {
      this.addAlert('medium', 'Elevated database response time', `Database response time: ${metrics.database.responseTime}ms`);
    }

    // Application growth alerts
    if (metrics.application.users.newLast24h > 100) {
      this.addAlert('low', 'High user growth', `${metrics.application.users.newLast24h} new users in last 24h`);
    }

    if (metrics.application.sessions.last24h > 1000) {
      this.addAlert('low', 'High session volume', `${metrics.application.sessions.last24h} sessions in last 24h`);
    }
  }

  /**
   * Add an alert
   */
  private addAlert(severity: 'low' | 'medium' | 'high' | 'critical', type: string, message: string): void {
    const alert = {
      type,
      message,
      severity,
      timestamp: new Date()
    };

    this.alerts.push(alert);

    // Log critical and high severity alerts immediately
    if (severity === 'critical' || severity === 'high') {
      console.error(`[${severity.toUpperCase()}] ${type}: ${message}`);
    } else {
      console.warn(`[${severity.toUpperCase()}] ${type}: ${message}`);
    }

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  /**
   * Get recent metrics
   */
  public getRecentMetrics(limit: number = 10): any[] {
    const sortedKeys = Array.from(this.metrics.keys()).sort().reverse();
    return sortedKeys.slice(0, limit).map(key => this.metrics.get(key));
  }

  /**
   * Get recent alerts
   */
  public getRecentAlerts(limit: number = 20): any[] {
    return this.alerts.slice(-limit).reverse();
  }

  /**
   * Clean up old metrics (keep last 24 hours)
   */
  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const [key, metric] of this.metrics.entries()) {
      if (metric.timestamp < cutoff) {
        this.metrics.delete(key);
      }
    }
  }

  /**
   * Clean up old alerts (keep last 7 days)
   */
  private cleanupOldAlerts(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoff);
  }

  /**
   * Get system status summary
   */
  public async getSystemStatus(): Promise<any> {
    const healthChecks = await this.performHealthChecks();
    const recentMetrics = this.getRecentMetrics(1)[0];
    const recentAlerts = this.getRecentAlerts(5);

    return {
      status: healthChecks.status,
      timestamp: new Date().toISOString(),
      health: healthChecks.checks,
      metrics: recentMetrics,
      alerts: recentAlerts,
      uptime: process.uptime()
    };
  }

  /**
   * Record an API operation for metrics tracking
   * Requirements: 8.5 - Track API success rates, response times, and error rates
   * 
   * @param service - The service name ('openai' or 's3')
   * @param success - Whether the operation succeeded
   * @param responseTime - Response time in milliseconds
   * @param errorType - Type of error if operation failed (optional)
   */
  public recordAPIOperation(
    service: 'openai' | 's3',
    success: boolean,
    responseTime: number,
    errorType?: string
  ): void {
    const metrics = this.apiMetrics[service];
    
    // Increment total calls
    metrics.total++;
    
    // Track success/failure
    if (success) {
      metrics.successful++;
    } else {
      metrics.failed++;
      
      // Track error by type
      if (errorType) {
        const currentCount = metrics.errorsByType.get(errorType) || 0;
        metrics.errorsByType.set(errorType, currentCount + 1);
      }
    }
    
    // Track response time
    metrics.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times to prevent memory issues
    if (metrics.responseTimes.length > 1000) {
      metrics.responseTimes = metrics.responseTimes.slice(-1000);
    }
  }

  /**
   * Get API metrics for monitoring endpoint
   * Requirements: 8.5 - Expose metrics via monitoring endpoint
   * 
   * @returns Object containing API metrics for OpenAI and S3
   */
  public getAPIMetrics(): any {
    return {
      openai: this.calculateServiceMetrics(this.apiMetrics.openai),
      s3: this.calculateServiceMetrics(this.apiMetrics.s3)
    };
  }

  /**
   * Calculate metrics for a service
   * Requirements: 8.5 - Calculate success rates, average response times, and error rates
   * 
   * @param metrics - The API metrics for a service
   * @returns Calculated metrics including success rate, average response time, and error breakdown
   */
  private calculateServiceMetrics(metrics: APIMetrics): any {
    const { total, successful, failed, responseTimes, errorsByType } = metrics;
    
    // Calculate average response time
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      : 0;
    
    // Calculate success rate
    const successRate = total > 0 ? (successful / total) * 100 : 0;
    
    // Calculate error rate
    const errorRate = total > 0 ? (failed / total) * 100 : 0;
    
    // Convert error map to object for JSON serialization
    const errorsByTypeObj: Record<string, number> = {};
    errorsByType.forEach((count, type) => {
      errorsByTypeObj[type] = count;
    });
    
    return {
      total,
      successful,
      failed,
      successRate: parseFloat(successRate.toFixed(2)),
      errorRate: parseFloat(errorRate.toFixed(2)),
      averageResponseTime: parseFloat(averageResponseTime.toFixed(2)),
      errorsByType: errorsByTypeObj
    };
  }

  /**
   * Reset API metrics (useful for testing or periodic resets)
   * Requirements: 8.5
   */
  public resetAPIMetrics(): void {
    this.apiMetrics.openai = {
      total: 0,
      successful: 0,
      failed: 0,
      responseTimes: [],
      errorsByType: new Map()
    };
    
    this.apiMetrics.s3 = {
      total: 0,
      successful: 0,
      failed: 0,
      responseTimes: [],
      errorsByType: new Map()
    };
  }
}

// Export singleton instance
export const monitoringService = MonitoringService.getInstance();