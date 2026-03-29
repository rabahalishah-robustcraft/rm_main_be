import { Router, Response } from 'express';
import multer from 'multer';
import { ServiceContainer } from '../container';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { enforceDataIsolation } from '../middleware/security';
import { aiProcessingRateLimit, uploadRateLimit } from '../middleware/rateLimiting';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { AudioSessionError } from '../services/AudioSessionService';
import { config } from '../utils/config';
import { formatSessionDisplayName } from '../utils/sessionDisplayName';

/**
 * Audio Session Routes
 * Requirements: 3.1, 3.2, 5.3
 */

export function createSessionRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { audioSessionService } = services;

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE, // Use config for file size limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

/**
 * Start a new audio session
 * POST /api/sessions/start
 * Requirements: 3.1, 6.2, 6.3
 */
router.post('/start', authenticate, aiProcessingRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Create new session (includes usage limit validation)
    const session = await audioSessionService.startSession(userId);

    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        createdAt: session.createdAt
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      let statusCode = 400;
      
      // Handle specific error codes
      if (error.code === 'USER_NOT_FOUND') {
        statusCode = 404;
      } else if (error.code === 'USAGE_LIMIT_EXCEEDED') {
        statusCode = 429;
      }
      
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Session creation error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create session'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Upload audio file to session
 * POST /api/sessions/:id/audio
 * Requirements: 3.2
 */
router.post('/:id/audio', 
  authenticate, 
  enforceDataIsolation('session'), 
  validateRequest(validationSchemas.sessions.sessionId),
  uploadRateLimit, 
  upload.single('audio'), 
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.id;
    const audioFile = req.file;

    if (!audioFile) {
      return res.status(400).json({
        error: {
          code: 'MISSING_AUDIO_FILE',
          message: 'Audio file is required'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Verify session belongs to user
    const session = await audioSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    if (session.userId !== userId) {
      return res.status(403).json({
        error: {
          code: 'SESSION_ACCESS_DENIED',
          message: 'You do not have access to this session'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Upload audio and start processing
    await audioSessionService.uploadAudio(sessionId, audioFile.buffer, audioFile.originalname);

    res.status(200).json({
      success: true,
      message: 'Audio uploaded successfully. Processing started.',
      data: {
        sessionId,
        status: 'processing'
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      const statusCode = error.code === 'SESSION_NOT_FOUND' ? 404 : 
                        error.code === 'INVALID_SESSION_STATE' ? 409 : 400;
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Audio upload error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to upload audio'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Get user's session history
 * GET /api/sessions/history
 * Requirements: 5.3
 * 
 * Query params:
 * - limit: number of sessions to return (1-100, default 20)
 * - status: filter by status - 'completed', 'processing', 'failed', 'pending', 'all' (default: 'completed')
 */
router.get('/history', 
  authenticate, 
  enforceDataIsolation('session'), 
  validateRequest(validationSchemas.sessions.history),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const statusFilter = (req.query.status as string) || 'completed';

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        error: {
          code: 'INVALID_LIMIT',
          message: 'Limit must be between 1 and 100'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Validate status filter
    const validStatuses = ['completed', 'processing', 'failed', 'pending', 'all'];
    if (!validStatuses.includes(statusFilter)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          message: `Status must be one of: ${validStatuses.join(', ')}`
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    const sessions = await audioSessionService.getSessionHistory(userId, limit, statusFilter);

    const formattedSessions = sessions.map(session => ({
      id: session.id,
      displayName: session.displayName ?? formatSessionDisplayName(session.createdAt),
      status: session.status,
      scores: {
        clarity: session.clarityScore,
        confidence: session.confidenceScore,
        tone: session.toneScore,
        enthusiasm: session.enthusiasmScore,
        specificity: session.specificityScore
      },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        sessions: formattedSessions,
        total: sessions.length,
        filter: statusFilter
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      return res.status(400).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Session history error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve session history'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Update transcript and resubmit for insights
 * PATCH /api/sessions/:id/transcript
 * Body: { transcript: string }
 */
router.patch('/:id/transcript',
  authenticate,
  enforceDataIsolation('session'),
  validateRequest(validationSchemas.sessions.updateTranscript),
  aiProcessingRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.id;
    const { transcript } = req.body;

    const session = await audioSessionService.updateTranscriptAndReanalyze(sessionId, userId, transcript);

    res.status(200).json({
      success: true,
      message: 'Transcript updated and analysis completed',
      data: {
        id: session.id,
        status: session.status,
        transcript: session.transcript,
        aiAnalysis: session.aiAnalysis,
        scores: {
          clarity: session.clarityScore,
          confidence: session.confidenceScore,
          tone: session.toneScore,
          enthusiasm: session.enthusiasmScore,
          specificity: session.specificityScore
        },
        updatedAt: session.updatedAt
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      const statusCode = error.code === 'SESSION_NOT_FOUND' ? 404 :
                        error.code === 'SESSION_ACCESS_DENIED' ? 403 : 400;
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    console.error('Transcript update error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update transcript and re-analyze'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Update session display name (event label)
 * PATCH /api/sessions/:id
 * Body: { displayName?: string }
 */
router.patch('/:id',
  authenticate,
  enforceDataIsolation('session'),
  validateRequest(validationSchemas.sessions.updateDisplayName),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.id;
    const { displayName } = req.body;

    const session = await audioSessionService.updateSessionDisplayName(
      sessionId,
      userId,
      displayName === undefined ? undefined : (displayName === '' ? null : displayName)
    );

    res.status(200).json({
      success: true,
      message: 'Session display name updated',
      data: {
        id: session.id,
        displayName: session.displayName ?? null,
        updatedAt: session.updatedAt
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      const statusCode = error.code === 'SESSION_NOT_FOUND' ? 404 :
                        error.code === 'SESSION_ACCESS_DENIED' ? 403 : 400;
      return res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    console.error('Display name update error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update session display name'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Get session details
 * GET /api/sessions/:id
 * Requirements: 3.1
 */
router.get('/:id', 
  authenticate, 
  enforceDataIsolation('session'), 
  validateRequest(validationSchemas.sessions.sessionId),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    const session = await audioSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Verify session belongs to user
    if (session.userId !== userId) {
      return res.status(403).json({
        error: {
          code: 'SESSION_ACCESS_DENIED',
          message: 'You do not have access to this session'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: session.id,
        displayName: session.displayName ?? null,
        status: session.status,
        transcript: session.transcript,
        aiAnalysis: session.aiAnalysis,
        scores: {
          clarity: session.clarityScore,
          confidence: session.confidenceScore,
          tone: session.toneScore,
          enthusiasm: session.enthusiasmScore,
          specificity: session.specificityScore
        },
        analysisComplete: session.analysisComplete,
        processingError: session.processingError,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    });
    return;
  } catch (error) {
    if (error instanceof AudioSessionError) {
      return res.status(400).json({
        error: {
          code: error.code,
          message: error.message
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    console.error('Session retrieval error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve session'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

/**
 * Get audio file URL for playback
 * GET /api/sessions/:id/audio-url
 * Requirements: 5.3
 * 
 * NOTE: This endpoint requires S3 GetObject permissions
 * Returns a presigned URL valid for 1 hour for audio playback
 */
router.get('/:id/audio-url', 
  authenticate, 
  enforceDataIsolation('session'), 
  validateRequest(validationSchemas.sessions.sessionId),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    const session = await audioSessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Verify session belongs to user
    if (session.userId !== userId) {
      return res.status(403).json({
        error: {
          code: 'SESSION_ACCESS_DENIED',
          message: 'You do not have access to this session'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Check if audio file exists
    if (!session.audioS3Key) {
      return res.status(404).json({
        error: {
          code: 'AUDIO_NOT_FOUND',
          message: 'Audio file not found for this session'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    // Generate presigned URL (valid for 1 hour)
    const presignedUrl = await services.s3Service.getSignedUrl(session.audioS3Key, 3600);

    res.status(200).json({
      success: true,
      data: {
        url: presignedUrl,
        expiresIn: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('Audio URL generation error:', error);
    
    // Check if it's an S3 permission error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'AccessDenied') {
      return res.status(403).json({
        error: {
          code: 'S3_ACCESS_DENIED',
          message: 'Unable to access audio file. S3 GetObject permission may be missing.'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate audio URL'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }
});

  return router;
}

export default createSessionRoutes;
