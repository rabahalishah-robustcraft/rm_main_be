import { Router } from 'express';
import { ServiceContainer } from '../container';
import { createAuthRoutes } from './auth';
import { createProfileRoutes } from './profile';
import { createSessionRoutes } from './sessions';
import { createSubscriptionRoutes } from './subscription';
import { createDashboardRoutes } from './dashboard';
import { createAdminRoutes } from './admin';
import { config } from '../utils/config';

export function createApiRoutes(services: ServiceContainer): Router {
  const router = Router();

  // Mount authentication routes
  router.use('/auth', createAuthRoutes(services));

  // Mount profile routes
  router.use('/profile', createProfileRoutes(services));

  // Mount session routes
  router.use('/sessions', createSessionRoutes(services));

  // Mount subscription routes
  router.use('/subscription', createSubscriptionRoutes(services));

  // Mount dashboard routes
  router.use('/dashboard', createDashboardRoutes(services));

  // Mount admin routes (if enabled)
  if (config.ENABLE_ADMIN_ENDPOINTS) {
    router.use('/admin', createAdminRoutes(services));
  }

  // Health check for API
  router.get('/health', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'API is healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // API documentation endpoint
  router.get('/', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'AI Audio Summarization Backend API',
      version: '1.0.0',
      endpoints: {
        auth: {
          'POST /api/auth/register': 'Register a new user',
          'POST /api/auth/login': 'Login user',
          'POST /api/auth/google': 'Continue with Google (ID token)',
          'POST /api/auth/logout': 'Logout user',
          'GET /api/auth/me': 'Get current user info',
          'POST /api/auth/refresh': 'Refresh JWT token',
          'GET /api/auth/validate': 'Validate JWT token',
          'POST /api/auth/forgot-password': 'Request password reset OTP',
          'POST /api/auth/verify-otp': 'Verify OTP, get reset token',
          'POST /api/auth/reset-password': 'Reset password with reset token',
          'POST /api/auth/change-password': 'Change password (authenticated)',
          'POST /api/auth/change-email': 'Change email (authenticated, password required)'
        },
        profile: {
          'GET /api/profile': 'Get user profile',
          'PUT /api/profile': 'Update user profile',
          'POST /api/profile/resume': 'Upload resume file',
          'GET /api/profile/resume/url': 'Get secure resume file URL',
          'PUT /api/profile/target-role': 'Set target role',
          'DELETE /api/profile': 'Delete user profile',
          'GET /api/profile/ai-attributes': 'Get AI attributes'
        },
        sessions: {
          'POST /api/sessions/start': 'Start a new audio session',
          'POST /api/sessions/:id/audio': 'Upload audio to session',
          'PATCH /api/sessions/:id/transcript': 'Update transcript and resubmit for insights',
          'PATCH /api/sessions/:id': 'Update session display name (event label)',
          'GET /api/sessions/:id': 'Get session details',
          'GET /api/sessions/history': 'Get session history'
        },
        subscription: {
          'GET /api/subscription/info': 'Get subscription and usage information',
          'POST /api/subscription/upgrade': 'Upgrade subscription tier'
        },
        dashboard: {
          'GET /api/dashboard/stats': 'Get comprehensive dashboard statistics',
          'GET /api/dashboard/insights': 'Get recent insights based on session patterns',
          'GET /api/dashboard/trends': 'Get performance trends over time'
        },
        ...(config.ENABLE_ADMIN_ENDPOINTS && {
          admin: {
            'GET /api/admin/health': 'Comprehensive system health check (admin only)',
            'GET /api/admin/metrics': 'System metrics and performance data (admin only)',
            'POST /api/admin/reset-usage': 'Reset monthly usage for all users (admin only)',
            'GET /api/admin/users': 'Get user statistics and management data (admin only)',
            'GET /api/admin/system-config': 'Get system configuration (admin only)'
          }
        })
      },
      documentation: 'See design document for detailed API specifications'
    });
  });

  return router;
}

// Keep the old export for backward compatibility during transition
const router = Router();
export default router;