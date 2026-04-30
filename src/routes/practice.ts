import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { ServiceContainer } from '../container';
import { authenticate, requireEmailVerified, AuthenticatedRequest } from '../middleware/auth';
import { aiProcessingRateLimit } from '../middleware/rateLimiting';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { enforceDataIsolation } from '../middleware/security';
import { PracticeSessionError } from '../services/practiceSessionService';
import { SubscriptionError } from '../services/SubscriptionService';
import { config } from '../utils/config';

const MAX_PRACTICE_AUDIO_BYTES = Math.min(25 * 1024 * 1024, config.MAX_FILE_SIZE);

/**
 * Practice interview: cached questions + synchronous Whisper + coaching per answer.
 */
export function createPracticeRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { prisma, questionService, practiceSessionService } = services;

  router.use(authenticate);
  router.use(requireEmailVerified);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PRACTICE_AUDIO_BYTES },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('audio/')) {
        cb(null, true);
      } else {
        cb(new Error('INVALID_AUDIO_TYPE'));
      }
    }
  });

  function practiceUploadSingle(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    upload.single('audio')(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Audio file exceeds maximum size'
            : err.message;
        res.status(400).json({
          error: {
            code: 'INVALID_AUDIO_TYPE',
            message
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }
      if ((err as Error).message === 'INVALID_AUDIO_TYPE') {
        res.status(400).json({
          error: {
            code: 'INVALID_AUDIO_TYPE',
            message: 'File is not an allowed audio type'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }
      next(err);
    });
  }

  router.get('/questions', aiProcessingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const forceRefresh = req.query.refresh === 'true';
      const userProfile = await prisma.userProfile.findUnique({ where: { userId } });
      const sections = await questionService.getOrGenerateQuestionSections(
        userId,
        userProfile,
        forceRefresh
      );
      res.status(200).json({
        success: true,
        data: {
          sections: [
            {
              key: 'ai_recommended',
              title: 'AI recommended questions',
              questions: sections.aiRecommended.map((text, index) => ({ index, text }))
            },
            {
              key: 'behavioral',
              title: 'Behavioral questions',
              questions: sections.behavioral.map((text, index) => ({ index, text }))
            },
            {
              key: 'domain',
              title: 'Technical questions',
              questions: sections.domain.map((text, index) => ({ index, text }))
            }
          ],
          personalized: !!(userProfile?.targetIndustry || userProfile?.targetJobTitle)
        }
      });
    } catch (error) {
      console.error('Practice questions error:', error);
      res.status(500).json({
        error: {
          code: 'QUESTION_GENERATION_FAILED',
          message: 'Failed to generate practice questions'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
  });

  router.post(
    '/sessions',
    aiProcessingRateLimit,
    practiceUploadSingle,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const file = req.file;
        if (!file) {
          return res.status(400).json({
            error: { code: 'MISSING_AUDIO_FILE', message: 'No audio file provided' },
            timestamp: new Date().toISOString(),
            path: req.path
          });
        }
        const question = req.body?.question;
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
          return res.status(400).json({
            error: { code: 'MISSING_QUESTION', message: 'question field is required' },
            timestamp: new Date().toISOString(),
            path: req.path
          });
        }
        const rawIndex = req.body?.questionIndex;
        const parsedIndex =
          rawIndex === undefined || rawIndex === ''
            ? 0
            : parseInt(String(rawIndex), 10);
        const questionIndex = Number.isNaN(parsedIndex) ? 0 : parsedIndex;

        const result = await practiceSessionService.submitPracticeAnswer(
          userId,
          file.buffer,
          file.originalname,
          file.mimetype || 'audio/wav',
          question,
          questionIndex
        );

        return res.status(201).json({
          success: true,
          message: 'Practice session complete.',
          data: {
            id: result.id,
            sessionType: result.sessionType,
            displayName: result.displayName,
            status: result.status,
            transcript: result.transcript,
            aiAnalysis: result.aiAnalysis,
            scores: result.scores,
            createdAt: result.createdAt
          }
        });
      } catch (error) {
        if (error instanceof SubscriptionError) {
          let statusCode = 400;
          if (error.code === 'USAGE_LIMIT_EXCEEDED') {
            statusCode = 429;
          } else if (error.code === 'USER_NOT_FOUND') {
            statusCode = 404;
          }
          return res.status(statusCode).json({
            error: { code: error.code, message: error.message },
            timestamp: new Date().toISOString(),
            path: req.path
          });
        }
        if (error instanceof PracticeSessionError) {
          return res.status(error.statusCode).json({
            error: { code: error.code, message: error.message },
            timestamp: new Date().toISOString(),
            path: req.path
          });
        }
        console.error('Practice session error:', error);
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to save session' },
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
    }
  );

  router.patch(
    '/sessions/:id',
    validateRequest(validationSchemas.practice.updateAnswer),
    enforceDataIsolation('session'),
    aiProcessingRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const sessionId = req.params.id;
        const userId = req.user!.id;
        const { transcript } = req.body as { transcript: string };

        const result = await practiceSessionService.reanalyzeEditedAnswer(
          sessionId,
          userId,
          transcript
        );

        return res.status(200).json({
          success: true,
          message: 'Analysis complete.',
          data: {
            id: result.id,
            sessionType: result.sessionType,
            displayName: result.displayName,
            status: result.status,
            transcript: result.transcript,
            aiAnalysis: result.aiAnalysis,
            scores: result.scores,
            updatedAt: result.updatedAt
          }
        });
      } catch (error) {
        if (error instanceof PracticeSessionError) {
          const statusCode = error.statusCode;
          const payload: Record<string, unknown> = {
            error: {
              code: error.code,
              message: error.message
            },
            timestamp: new Date().toISOString(),
            path: req.path
          };
          if (error.code === 'ANALYSIS_FAILED' && error.originalError?.message) {
            (payload.error as Record<string, unknown>).upstream = error.originalError.message;
          }
          return res.status(statusCode).json(payload);
        }
        console.error('Practice re-analyze error:', error);
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update practice session' },
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
    }
  );

  return router;
}
