import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ASSEMBLY_WEBHOOK_SECRET_HEADER } from '../services/assemblyAIService';
import { config } from '../utils/config';

/**
 * Verifies AssemblyAI webhook using the static auth header configured on the transcript job.
 * Uses the same normalized secret as submit (see config.ASSEMBLYAI_WEBHOOK_SECRET).
 */
export function verifyAssemblyWebhookAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = config.ASSEMBLYAI_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Webhook] ASSEMBLYAI_WEBHOOK_SECRET not set — skipping webhook auth (dev only)');
    next();
    return;
  }

  const received = req.get(ASSEMBLY_WEBHOOK_SECRET_HEADER);
  if (!received) {
    res.status(401).json({
      success: false,
      error: { code: 'MISSING_WEBHOOK_SECRET', message: 'Webhook secret header is missing' },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }

  try {
    const a = Buffer.from(received, 'utf8');
    const b = Buffer.from(secret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('mismatch');
    }
  } catch {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_WEBHOOK_SECRET', message: 'Webhook secret header is invalid' },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }

  next();
}
