import { Router, Response } from 'express';
import { ServiceContainer } from '../container';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { enforceDataIsolation } from '../middleware/security';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { SubscriptionError, SubscriptionTier } from '../services/SubscriptionService';

/**
 * Subscription Management Routes
 * Requirements: 6.4, 6.5
 */

export function createSubscriptionRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { subscriptionService } = services;

// Apply authentication and data isolation to all subscription routes
router.use(authenticate);
router.use(enforceDataIsolation('usage'));

/**
 * Get current subscription and usage information
 * GET /api/subscription/info
 * Requirements: 6.2
 */
router.get('/info', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const usageInfo = await subscriptionService.getUsageInfo(userId);

    res.status(200).json({
      success: true,
      data: {
        tier: usageInfo.tier,
        currentUsage: usageInfo.currentUsage,
        limit: usageInfo.limit,
        canCreateSession: usageInfo.canCreateSession
      }
    });
    return;
  } catch (error) {
    if (error instanceof SubscriptionError) {
      const statusCode = error.code === 'USER_NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Subscription info error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve subscription information'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Upgrade subscription to paid tier
 * POST /api/subscription/upgrade
 * Requirements: 6.4
 */
router.post('/upgrade', 
  validateRequest(validationSchemas.subscription.upgrade),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { tier } = req.body;

    await subscriptionService.upgradeSubscription(userId, tier);

    res.status(200).json({
      success: true,
      message: `Subscription upgraded to ${tier} tier successfully`,
      data: {
        tier
      }
    });
    return;
  } catch (error) {
    if (error instanceof SubscriptionError) {
      const statusCode = error.code === 'USER_NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Subscription upgrade error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to upgrade subscription'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

  return router;
}

export default createSubscriptionRoutes;