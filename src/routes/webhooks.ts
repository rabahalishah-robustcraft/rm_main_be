import { Router } from 'express';
import type { ServiceContainer } from '../container';
import { verifyAssemblyWebhookAuth } from '../middleware/webhookAuth';
import { createAssemblyWebhookHandler } from '../controllers/webhookController';

export function createWebhookRoutes(services: ServiceContainer): Router {
  const router = Router();
  const handler = createAssemblyWebhookHandler(services.prisma);

  router.post('/assemblyai', verifyAssemblyWebhookAuth, handler);

  return router;
}
