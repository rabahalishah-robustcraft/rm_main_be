import { Router, Response, NextFunction } from 'express';
import { ServiceContainer } from '../container';
import { authenticate, requireEmailVerified, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { uploadRateLimit } from '../middleware/rateLimiting';
import { onboardingVoiceUpload, resumeUpload } from '../utils/fileUpload';
import { ProfileUpdateData, ValidationError } from '../types/auth';

function parseManualProfile(body: Record<string, unknown>): ProfileUpdateData | undefined {
  const raw = body.manualProfile ?? body.profile;
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as ProfileUpdateData;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as ProfileUpdateData;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      throw new ValidationError('manualProfile must be valid JSON');
    }
  }
  throw new ValidationError('manualProfile must be a JSON object or string');
}

/** JSON body or multipart fields: manual profile for primary step. */
function parsePrimaryManual(req: AuthenticatedRequest): ProfileUpdateData | undefined {
  const fromNested = parseManualProfile(req.body as Record<string, unknown>);
  if (fromNested) {
    return fromNested;
  }
  const b = req.body as Record<string, unknown>;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const keys = [
      'fullName',
      'currentJobTitle',
      'currentCompany',
      'school',
      'degreeInfo',
      'previousJobTitles',
      'targetIndustry',
      'targetJobTitle',
      'experienceLevel'
    ];
    if (keys.some((k) => b[k] !== undefined)) {
      return b as ProfileUpdateData;
    }
  }
  return undefined;
}

export function createOnboardingRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { onboardingService } = services;

  router.use(authenticate);
  router.use(requireEmailVerified);

  router.post(
    '/primary',
    uploadRateLimit,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      resumeUpload.single('resume')(req, res, (err) => {
        if (err) {
          next(err);
          return;
        }
        next();
      });
    },
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const file = req.file;
      const manual = parsePrimaryManual(req);
      if (file && manual && Object.keys(manual).length > 0) {
        throw new ValidationError('Provide exactly one of: resume file or manual profile, not both');
      }
      const result = await onboardingService.primary(userId, {
        resumeBuffer: file?.buffer,
        resumeFilename: file?.originalname,
        manual
      });
      res.status(200).json({
        success: true,
        message: 'Primary onboarding step saved',
        data: result
      });
    })
  );

  const voiceStepHandlers: Array<
    | typeof uploadRateLimit
    | ((req: AuthenticatedRequest, res: Response, next: NextFunction) => void)
    | ReturnType<typeof asyncHandler>
  > = [
    uploadRateLimit,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      onboardingVoiceUpload(req, res, (err) => {
        if (err) {
          next(err);
          return;
        }
        next();
      });
    },
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const list = req.files as Express.Multer.File[] | undefined;
      const file = list?.find((f) => (f.buffer?.length ?? 0) > 0) ?? list?.[0];
      if (!file?.buffer?.length) {
        throw new ValidationError(
          'Audio file is required (multipart form-data: one file part; any field name is OK, e.g. audio).'
        );
      }
      const result = await onboardingService.voice(userId, file.buffer, file.originalname);
      res.status(200).json({
        success: true,
        message: 'Voice intro processed',
        data: result
      });
    })
  ];

  router.post('/voice', ...voiceStepHandlers);
  /** Same behavior as `POST /voice` (wizard-style URL after primary). */
  router.post('/primary/voice', ...voiceStepHandlers);

  router.post(
    '/complete',
    uploadRateLimit,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const result = await onboardingService.complete(userId);
      res.status(200).json({
        success: true,
        message: 'Onboarding complete',
        data: result
      });
    })
  );

  return router;
}
