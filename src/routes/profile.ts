import { Router, Response, NextFunction } from 'express';
import { ServiceContainer } from '../container';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { enforceDataIsolation } from '../middleware/security';
import { uploadRateLimit } from '../middleware/rateLimiting';
import { resumeUpload } from '../utils/fileUpload';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { 
  ValidationError,
  ProfileUpdateData 
} from '../types/auth';
import { profileSchemas } from '../utils/validation';

export function createProfileRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { profileService } = services;

  // Apply authentication middleware to all profile routes
  router.use(authenticate);

  // Apply data isolation for profile access
  router.use(enforceDataIsolation('profile'));

/**
 * GET /api/profile
 * Get user profile
 * Requirements: 2.3, 2.4, 2.5
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const profile = await profileService.getProfile(userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profile
 * Update user profile
 * Requirements: 2.3, 2.5
 */
router.put('/', 
  validateRequest(validationSchemas.profile.update),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const updateData: ProfileUpdateData = req.body;
    const updatedProfile = await profileService.updateProfile(userId, updateData);
    
    res.json({
      success: true,
      data: updatedProfile,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/manual-entry
 * Manually enter profile information (alternative to resume upload)
 * Requirements: Figma design workflow
 */
router.post('/manual-entry',
  validateRequest(validationSchemas.profile.update),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const profileData: ProfileUpdateData = req.body;
    
    // Validate required fields for manual entry
    if (!profileData.fullName) {
      throw new ValidationError('Full name is required for manual entry');
    }
    
    const updatedProfile = await profileService.updateProfile(userId, profileData);
    
    res.json({
      success: true,
      data: updatedProfile,
      message: 'Profile information saved successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/resume
 * Upload resume file
 * Requirements: 2.1, 7.1, 7.2
 */
router.post('/resume', uploadRateLimit, resumeUpload.single('resume'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const file = req.file;

    if (!file) {
      throw new ValidationError('Resume file is required');
    }

    // Upload resume and get S3 key
    const resumeS3Key = await profileService.uploadResume(
      userId, 
      file.buffer, 
      file.originalname
    );
    
    res.json({
      success: true,
      data: {
        resumeS3Key,
        filename: file.originalname,
        size: file.size
      },
      message: 'Resume uploaded successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/resume/url
 * Get secure URL for resume file access
 * Requirements: 7.4
 */
router.get('/resume/url', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const expiresIn = parseInt((req.query['expiresIn'] as string) || '3600'); // Default 1 hour

    // Validate expiresIn parameter
    if (expiresIn <= 0 || expiresIn > 86400) { // Max 24 hours
      throw new ValidationError('expiresIn must be between 1 and 86400 seconds');
    }

    const signedUrl = await profileService.getResumeUrl(userId, expiresIn);
    
    res.json({
      success: true,
      data: {
        url: signedUrl,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      },
      message: 'Resume URL generated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profile/target-role
 * Set target role
 * Requirements: 2.3
 */
router.put('/target-role', 
  validateRequest(validationSchemas.profile.targetRole),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { targetIndustry, targetJobTitle } = req.body;
    await profileService.setTargetRole(userId, targetIndustry, targetJobTitle);
    
    res.json({
      success: true,
      message: 'Target role updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/profile
 * Delete user profile
 * Requirements: 9.5
 */
router.delete('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    await profileService.deleteProfile(userId);
    
    res.json({
      success: true,
      message: 'Profile deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/ai-attributes
 * Get AI attributes for user
 * Requirements: 2.4
 */
router.get('/ai-attributes', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const attributes = await profileService.getAIAttributes(userId);
    
    res.json({
      success: true,
      data: attributes
    });
  } catch (error) {
    next(error);
  }
});

  return router;
}

export default createProfileRoutes;