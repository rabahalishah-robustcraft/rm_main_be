import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../container';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { User } from '../types/auth';

// Define request types
interface AuthenticatedRequest extends Request {
  user?: User;
}

interface GetInsightsQuery {
  limit?: number;
}

interface GetTrendsQuery {
  days?: number;
}

export function createDashboardRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { dashboardService } = services;

  /**
   * GET /api/dashboard/stats
   * Get comprehensive dashboard statistics
   * Requirements: 5.1, 5.2, 5.5
   */
  router.get('/stats', 
    authenticate,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      
      const stats = await dashboardService.getStats(userId);
      
      res.status(200).json(stats);
    })
  );

  /**
   * GET /api/dashboard/insights
   * Get recent insights based on session patterns
   * Requirements: 5.4
   */
  router.get('/insights',
    authenticate,
    validateRequest(validationSchemas.dashboard.insights),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const { limit }: GetInsightsQuery = req.query;
      
      const insights = await dashboardService.getRecentInsights(userId, limit);
      
      res.status(200).json({
        success: true,
        data: insights
      });
    })
  );

  /**
   * GET /api/dashboard/trends
   * Get performance trends over time
   * Requirements: 5.2, 5.4
   */
  router.get('/trends',
    authenticate,
    validateRequest(validationSchemas.dashboard.trends),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const { days }: GetTrendsQuery = req.query;
      
      const trends = await dashboardService.getPerformanceTrends(userId, days);
      
      res.status(200).json({
        success: true,
        data: trends
      });
    })
  );

  return router;
}

export default createDashboardRoutes;