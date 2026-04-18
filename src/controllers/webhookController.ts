import { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { fetchTranscript } from '../services/assemblyAIService';
import { toCompactJSON } from '../services/transcriptService';

/**
 * POST /api/webhooks/assemblyai?sessionId=...
 * ACK immediately; process asynchronously.
 */
export function createAssemblyWebhookHandler(prisma: PrismaClient) {
  return async function handleAssemblyAIWebhook(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true });

    const transcriptId = (req.body as { transcript_id?: string })?.transcript_id;
    const status = (req.body as { status?: string })?.status;
    const sessionId =
      typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;

    if (!transcriptId || !sessionId) {
      console.error('[Webhook] Missing transcript_id or sessionId query — cannot process');
      return;
    }

    void processWebhook(prisma, sessionId, transcriptId, status).catch((err) => {
      console.error('[Webhook] Unhandled error:', err);
    });
  };
}

async function processWebhook(
  prisma: PrismaClient,
  sessionId: string,
  transcriptId: string,
  status: string | undefined
): Promise<void> {
  try {
    if (status === 'error') {
      let detail = `AssemblyAI transcription failed for job: ${transcriptId}`;
      try {
        const t = await fetchTranscript(transcriptId);
        if (t.error) {
          detail = `AssemblyAI: ${t.error}`;
        }
      } catch {
        // keep generic detail
      }
      await prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          processingError: detail
        }
      });
      console.error(`[Webhook] AssemblyAI reported error for session ${sessionId}`);
      return;
    }

    if (status === 'completed') {
      const transcript = await fetchTranscript(transcriptId);
      const compactTranscript = toCompactJSON(
        (transcript.utterances ?? undefined) as Parameters<typeof toCompactJSON>[0]
      );

      await prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          assemblyJobId: transcriptId,
          compactTranscript: compactTranscript as object[],
          transcript: transcript.text ?? null,
          status: 'awaiting_review'
        }
      });

      console.log(`[Webhook] Session ${sessionId} transcript ready — status: awaiting_review`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Webhook] Error processing session ${sessionId}:`, message);
    try {
      await prisma.audioSession.update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          processingError: `Webhook processing error: ${message}`
        }
      });
    } catch (updateErr) {
      console.error('[Webhook] Could not update session to failed state:', updateErr);
    }
  }
}
