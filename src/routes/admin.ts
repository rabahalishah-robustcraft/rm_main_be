import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../container';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireAdminAccess } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { createSystemIntegrationValidator } from '../utils/systemIntegration';

export function createAdminRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { monitoringService, errorHandlingService, prisma } = services;
  
  // Create system integration validator
  const systemValidator = createSystemIntegrationValidator(services);

  // Apply authentication and admin access to all admin routes
  router.use(authenticate);
  router.use(requireAdminAccess);

/**
 * GET /api/admin/health
 * Comprehensive system health check with error handling status
 */
router.get('/health', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const systemStatus = await monitoringService.getSystemStatus();
    const errorHandlingStatus = errorHandlingService.getSystemHealth();
    
    // Combine system status with error handling status
    const overallStatus = systemStatus.status === 'healthy' && errorHandlingStatus.overallStatus === 'healthy' 
      ? 'healthy' 
      : errorHandlingStatus.overallStatus === 'critical' || systemStatus.status === 'critical'
      ? 'critical'
      : 'degraded';
    
    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    res.status(statusCode).json({
      success: overallStatus === 'healthy',
      data: {
        ...systemStatus,
        status: overallStatus,
        errorHandling: {
          circuitBreakers: Object.keys(errorHandlingStatus.circuitBreakers).reduce((acc, key) => {
            acc[key] = errorHandlingStatus.circuitBreakers[key].state;
            return acc;
          }, {} as Record<string, string>),
          activeDegradations: Object.keys(errorHandlingStatus.degradations).length,
          pendingFileOperations: Object.keys(errorHandlingStatus.pendingFileOperations).length,
          overallStatus: errorHandlingStatus.overallStatus
        }
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    
    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_ERROR',
        message: 'Failed to perform health check'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * GET /api/admin/metrics
 * System metrics and performance data with error handling metrics and API metrics
 * Requirements: 8.5
 */
router.get('/metrics', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = 10 } = req.query;
    
    const recentMetrics = monitoringService.getRecentMetrics(Number(limit));
    const recentAlerts = monitoringService.getRecentAlerts(20);
    const errorHandlingStatus = errorHandlingService.getSystemHealth();
    const apiMetrics = monitoringService.getAPIMetrics();
    
    res.status(200).json({
      success: true,
      data: {
        current: recentMetrics[0] || null,
        history: recentMetrics,
        alerts: recentAlerts,
        errorHandling: errorHandlingStatus,
        apiMetrics,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Metrics collection error:', error);
    
    res.status(500).json({
      error: {
        code: 'METRICS_ERROR',
        message: 'Failed to collect system metrics'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * POST /api/admin/reset-usage
 * Reset monthly usage for all users (admin only)
 */
router.post('/reset-usage', 
  validateRequest(validationSchemas.admin.resetUsage),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { month, year, dryRun = false } = req.body;
      
      // Get current usage records
      const currentUsage = await prisma.usageTracking.findMany({
        where: {
          month: month || new Date().getMonth() + 1,
          year: year || new Date().getFullYear()
        },
        include: {
          user: {
            select: { id: true, email: true }
          }
        }
      });

      if (dryRun) {
        return res.status(200).json({
          success: true,
          message: 'Dry run completed',
          data: {
            affectedUsers: currentUsage.length,
            totalSessions: currentUsage.reduce((sum, usage) => sum + usage.sessionCount, 0),
            users: currentUsage.map(usage => ({
              userId: usage.userId,
              email: usage.user.email,
              currentSessions: usage.sessionCount
            }))
          }
        });
      }

      // Reset usage for all users
      const resetResult = await prisma.usageTracking.updateMany({
        where: {
          month: month || new Date().getMonth() + 1,
          year: year || new Date().getFullYear()
        },
        data: {
          sessionCount: 0
        }
      });

      // Log admin action
      console.log('Usage reset performed:', {
        adminUserId: req.user!.id,
        adminEmail: req.user!.email,
        affectedRecords: resetResult.count,
        month: month || new Date().getMonth() + 1,
        year: year || new Date().getFullYear(),
        timestamp: new Date().toISOString()
      });

      res.status(200).json({
        success: true,
        message: 'Usage reset completed successfully',
        data: {
          affectedRecords: resetResult.count,
          resetDate: new Date().toISOString()
        }
      });
      return;
    } catch (error) {
      console.error('Usage reset error:', error);
      
      res.status(500).json({
        error: {
          code: 'USAGE_RESET_ERROR',
          message: 'Failed to reset usage data'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }
  }));

/**
 * GET /api/admin/users
 * Get user statistics and management data
 */
router.get('/users', 
  validateRequest(validationSchemas.admin.users),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, search, subscriptionTier } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    
    // Build where clause
    const where: any = {};
    
    if (search) {
      where.email = {
        contains: String(search),
        mode: 'insensitive'
      };
    }
    
    if (subscriptionTier) {
      where.subscriptionTier = subscriptionTier;
    }

    // Get users with pagination
    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          createdAt: true,
          updatedAt: true,
          profile: {
            select: {
              targetIndustry: true,
              targetJobTitle: true
            }
          },
          _count: {
            select: {
              audioSessions: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.user.count({ where })
    ]);

    // Get usage data for users
    const userIds = users.map(user => user.id);
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    const usageData = await prisma.usageTracking.findMany({
      where: {
        userId: { in: userIds },
        month: currentMonth,
        year: currentYear
      },
      select: {
        userId: true,
        sessionCount: true
      }
    });

    const usageMap = new Map(usageData.map(usage => [usage.userId, usage.sessionCount]));

    // Combine user data with usage
    const enrichedUsers = users.map(user => ({
      ...user,
      currentMonthSessions: usageMap.get(user.id) || 0,
      totalSessions: user._count.audioSessions
    }));

    res.status(200).json({
      success: true,
      data: {
        users: enrichedUsers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('User management error:', error);
    
    res.status(500).json({
      error: {
        code: 'USER_MANAGEMENT_ERROR',
        message: 'Failed to retrieve user data'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * GET /api/admin/system-config
 * Get system configuration
 */
router.get('/system-config', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = {
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      database: {
        url: process.env.DATABASE_URL ? '[CONFIGURED]' : '[NOT_CONFIGURED]'
      },
      openai: {
        gptApiKey: process.env.OPENAI_API_KEY ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        whisperApiKey: process.env.WHISPER_API_KEY ? '[CONFIGURED]' : '[NOT_CONFIGURED]'
      },
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        region: process.env.AWS_REGION || '[NOT_SET]',
        s3Bucket: process.env.AWS_S3_BUCKET || '[NOT_SET]'
      },
      security: {
        jwtSecret: process.env.JWT_SECRET ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        adminEmails: process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').length : 0
      },
      features: {
        corsOrigin: process.env.CORS_ORIGIN || '*',
        port: process.env.PORT || 3000
      }
    };

    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('System config error:', error);
    
    res.status(500).json({
      error: {
        code: 'CONFIG_ERROR',
        message: 'Failed to retrieve system configuration'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * GET /api/admin/error-handling
 * Detailed error handling system status
 */
router.get('/error-handling', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = errorHandlingService.getSystemHealth();

    res.status(200).json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error handling status error:', error);
    
    res.status(500).json({
      error: {
        code: 'ERROR_HANDLING_STATUS_ERROR',
        message: 'Failed to retrieve error handling status'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * POST /api/admin/circuit-breaker/:serviceName/reset
 * Reset circuit breaker for a specific service
 */
router.post('/circuit-breaker/:serviceName/reset', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { serviceName } = req.params;
    
    const success = errorHandlingService.resetCircuitBreaker(serviceName);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Circuit breaker not found for service: ${serviceName}`
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Log admin action
    console.log('Circuit breaker reset:', {
      adminUserId: req.user!.id,
      adminEmail: req.user!.email,
      serviceName,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker reset for service: ${serviceName}`,
      timestamp: new Date().toISOString()
    });
    return;
  } catch (error) {
    console.error('Circuit breaker reset error:', error);
    
    res.status(500).json({
      error: {
        code: 'CIRCUIT_BREAKER_RESET_ERROR',
        message: 'Failed to reset circuit breaker'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
}));

/**
 * POST /api/admin/degradation/:serviceName/deactivate
 * Deactivate graceful degradation for a specific service
 */
router.post('/degradation/:serviceName/deactivate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { serviceName } = req.params;
    
    errorHandlingService.deactivateDegradation(serviceName);

    // Log admin action
    console.log('Degradation deactivated:', {
      adminUserId: req.user!.id,
      adminEmail: req.user!.email,
      serviceName,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: `Degradation deactivated for service: ${serviceName}`,
      timestamp: new Date().toISOString()
    });
    return;
  } catch (error) {
    console.error('Degradation deactivation error:', error);
    
    res.status(500).json({
      error: {
        code: 'DEGRADATION_DEACTIVATION_ERROR',
        message: 'Failed to deactivate degradation'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
}));

/**
 * GET /api/admin/system-integration
 * Comprehensive system integration health check
 * Requirements: Task 13.1 - Complete system integration
 */
router.get('/system-integration', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const integrationReport = await systemValidator.performHealthCheck();
    
    const statusCode = integrationReport.overall === 'healthy' ? 200 : 
                      integrationReport.overall === 'degraded' ? 206 : 503;

    res.status(statusCode).json({
      success: integrationReport.overall !== 'unhealthy',
      data: integrationReport,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('System integration check error:', error);
    
    res.status(500).json({
      error: {
        code: 'SYSTEM_INTEGRATION_ERROR',
        message: 'Failed to perform system integration check'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * GET /api/admin/service-dependencies
 * Validate service dependency wiring
 * Requirements: Task 13.1 - Wire all services through dependency injection
 */
router.get('/service-dependencies', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dependencyValidation = await systemValidator.validateServiceDependencies();
    
    res.status(dependencyValidation.valid ? 200 : 500).json({
      success: dependencyValidation.valid,
      data: {
        valid: dependencyValidation.valid,
        issues: dependencyValidation.issues,
        dependencies: dependencyValidation.dependencies,
        serviceCount: Object.keys(dependencyValidation.dependencies).length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Service dependency validation error:', error);
    
    res.status(500).json({
      error: {
        code: 'DEPENDENCY_VALIDATION_ERROR',
        message: 'Failed to validate service dependencies'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

/**
 * POST /api/admin/test-request-flow
 * Test complete request/response flow
 * Requirements: Task 13.1 - Implement complete request/response flow
 */
router.post('/test-request-flow', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const flowTest = await systemValidator.testRequestResponseFlow();
    
    res.status(flowTest.success ? 200 : 500).json({
      success: flowTest.success,
      data: {
        overallSuccess: flowTest.success,
        steps: flowTest.steps,
        totalDuration: flowTest.steps.reduce((sum, step) => sum + step.duration, 0),
        successfulSteps: flowTest.steps.filter(step => step.success).length,
        failedSteps: flowTest.steps.filter(step => !step.success).length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Request flow test error:', error);
    
    res.status(500).json({
      error: {
        code: 'REQUEST_FLOW_TEST_ERROR',
        message: 'Failed to test request/response flow'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
}));

  return router;
}

export default createAdminRoutes;