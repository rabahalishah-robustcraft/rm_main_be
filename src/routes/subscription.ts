import { Router, Response } from 'express';
import { ServiceContainer } from '../container';
import { authenticate, requireEmailVerified, AuthenticatedRequest } from '../middleware/auth';
import { enforceDataIsolation } from '../middleware/security';
import { SubscriptionError } from '../services/SubscriptionService';

/**
 * Subscription Management Routes
 * Requirements: 6.4, 6.5
 */

export function createSubscriptionRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { subscriptionService, stripeBillingService } = services;

  // Apply authentication and data isolation to all subscription routes
  router.use(authenticate);
  router.use(requireEmailVerified);
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
          canCreateSession: usageInfo.canCreateSession,
          stripeSubscriptionId: usageInfo.stripeSubscriptionId ?? null,
          stripeSubscriptionStatus: usageInfo.stripeSubscriptionStatus ?? null,
          stripeCurrentPeriodEnd: usageInfo.stripeCurrentPeriodEnd ?? null
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
   * Start Stripe Checkout for subscription (redirect URL in response).
   * POST /api/subscription/checkout-session
   */
  router.post('/checkout-session', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const email = req.user!.email;
      const { url } = await stripeBillingService.createCheckoutSession(userId, email);
      res.status(200).json({ success: true, data: { url } });
      return;
    } catch (error) {
      if (error instanceof SubscriptionError) {
        const code = error.code;
        const statusCode =
          code === 'USER_NOT_FOUND'
            ? 404
            : code === 'STRIPE_INVALID_PRICE_ID'
              ? 400
              : code === 'STRIPE_NOT_CONFIGURED'
                ? 503
                : 502;
        return res.status(statusCode).json({
          error: {
            code,
            message: error.message
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      console.error('Checkout session error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create checkout session'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }
  });

  /**
   * Stripe Customer Portal (manage/cancel subscription).
   * POST /api/subscription/billing-portal
   * Body (optional): { "intent": "cancel_subscription" } — opens Stripe’s cancel subscription flow directly.
   */
  router.post('/billing-portal', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const rawIntent = req.body?.intent;
      if (
        rawIntent !== undefined &&
        rawIntent !== null &&
        rawIntent !== 'default' &&
        rawIntent !== 'cancel_subscription'
      ) {
        res.status(400).json({
          error: {
            code: 'INVALID_PORTAL_INTENT',
            message: 'intent must be "default" or "cancel_subscription" if provided'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }
      const intent = rawIntent === 'cancel_subscription' ? 'cancel_subscription' : 'default';
      const { url } = await stripeBillingService.createBillingPortalSession(userId, { intent });
      res.status(200).json({ success: true, data: { url } });
      return;
    } catch (error) {
      if (error instanceof SubscriptionError) {
        const code = error.code;
        const statusCode =
          code === 'USER_NOT_FOUND' ||
          code === 'STRIPE_CUSTOMER_MISSING' ||
          code === 'STRIPE_NO_SUBSCRIPTION_TO_CANCEL'
            ? 404
            : code === 'STRIPE_PORTAL_NOT_CONFIGURED'
              ? 503
              : 502;
        return res.status(statusCode).json({
          error: {
            code,
            message: error.message
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      console.error('Billing portal error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create billing portal session'
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
