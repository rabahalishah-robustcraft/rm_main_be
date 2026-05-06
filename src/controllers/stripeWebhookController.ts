import { Request, Response } from 'express';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { config } from '../utils/config';
import { processStripeWebhookEvent } from '../services/stripeWebhookService';

/**
 * Stripe webhook: requires raw body on `req.rawBody` and Stripe-Signature header.
 */
export function createStripeWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not set');
      res.status(500).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Stripe webhook secret missing' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_SIGNATURE', message: 'Missing Stripe-Signature header' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_RAW_BODY', message: 'Raw body required for webhook verification' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    if (!config.STRIPE_SECRET_KEY) {
      res.status(500).json({
        success: false,
        error: { code: 'STRIPE_NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY missing' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Stripe webhook] signature verification failed:', msg);
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    try {
      await processStripeWebhookEvent(prisma, event);
    } catch (err) {
      console.error('[Stripe webhook] handler error:', err);
      res.status(500).json({
        success: false,
        error: { code: 'WEBHOOK_HANDLER_ERROR', message: 'Failed to process webhook' },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    res.status(200).json({ received: true });
  };
}
