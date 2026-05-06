import { Router } from 'express';
import type { ServiceContainer } from '../container';
import { verifyAssemblyWebhookAuth } from '../middleware/webhookAuth';
import { createAssemblyWebhookHandler } from '../controllers/webhookController';
import { createStripeWebhookHandler } from '../controllers/stripeWebhookController';

export function createWebhookRoutes(services: ServiceContainer): Router {
  const router = Router();
  const assemblyHandler = createAssemblyWebhookHandler(services.prisma);
  const stripeHandler = createStripeWebhookHandler(services.prisma);

  router.post('/assemblyai', verifyAssemblyWebhookAuth, assemblyHandler);
  router.post('/stripe', stripeHandler);

  return router;
}
