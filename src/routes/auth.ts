import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../container';
import { authenticate } from '../middleware/auth';
import { authRateLimit, passwordResetRateLimit } from '../middleware/rateLimiting';
import { asyncHandler } from '../middleware/error';
import { validateRequest, validationSchemas } from '../middleware/validation';
import { User, SubscriptionTier } from '../types/auth';

// Define request/response types locally
interface AuthenticatedRequest extends Request {
  user?: User;
}

interface RegisterRequest {
  email: string;
  password: string;
}

interface LoginRequest {
  email: string;
  password: string;
}

interface RefreshRequest {
  refreshToken: string;
}

interface AuthResponse {
  user: User;
  token: string;
}

function toSafeUser(user: User) {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function createAuthRoutes(services: ServiceContainer): Router {
  const router = Router();
  const { authService } = services;

  /**
   * Register a new user
   * POST /api/auth/register
   * Requirements: 1.1, 9.1
   */
  router.post('/register', 
    authRateLimit, // Apply rate limiting
    validateRequest(validationSchemas.auth.register),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password }: RegisterRequest = req.body;

      const result = await authService.register(email, password);
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: toSafeUser(result.user),
          token: result.token
        }
      });
    })
  );

  /**
   * Login user
   * POST /api/auth/login
   * Requirements: 1.2, 9.2
   */
  router.post('/login',
    authRateLimit, // Apply rate limiting
    validateRequest(validationSchemas.auth.login),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password }: LoginRequest = req.body;

      const result = await authService.login(email, password);
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: toSafeUser(result.user),
          token: result.token
        }
      });
    })
  );

  /**
   * Logout user
   * POST /api/auth/logout
   * Requirements: 1.4
   */
  router.post('/logout',
    authenticate,
    asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        res.status(400).json({
          error: {
            code: 'MISSING_TOKEN',
            message: 'Authorization token is required'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }

      await authService.logout(token);
      
      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });
    })
  );

  /**
   * Get current user information
   * GET /api/auth/me
   * Requirements: 1.3
   */
  router.get('/me',
    authenticate,
    asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const user = req.user!;
      
      res.status(200).json({
        id: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      });
    })
  );

  /**
   * Refresh JWT token
   * POST /api/auth/refresh
   * Requirements: 9.2
   */
  router.post('/refresh',
    authRateLimit, // Apply rate limiting
    validateRequest(validationSchemas.auth.refresh),
    asyncHandler(async (req: Request, res: Response) => {
      const { refreshToken }: RefreshRequest = req.body;

      const newToken = await authService.refreshToken(refreshToken);
      
      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token: newToken
        }
      });
    })
  );

  /**
   * Continue with Google - verify ID token and login/register
   * POST /api/auth/google
   */
  router.post('/google',
    authRateLimit,
    validateRequest(validationSchemas.auth.google),
    asyncHandler(async (req: Request, res: Response) => {
      const { idToken } = req.body;

      const result = await authService.loginWithGoogle(idToken);
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: toSafeUser(result.user),
          token: result.token
        }
      });
    })
  );

  /**
   * Request password reset - sends OTP to email if user exists
   * POST /api/auth/forgot-password
   */
  router.post('/forgot-password',
    passwordResetRateLimit,
    validateRequest(validationSchemas.auth.forgotPassword),
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body;

      await authService.requestPasswordReset(email);
      
      res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset code.'
      });
    })
  );

  /**
   * Verify OTP and return reset token
   * POST /api/auth/verify-otp
   */
  router.post('/verify-otp',
    passwordResetRateLimit,
    validateRequest(validationSchemas.auth.verifyOtp),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, otp } = req.body;

      const { resetToken } = await authService.verifyOTP(email, otp);
      
      res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        resetToken
      });
    })
  );

  /**
   * Reset password using reset token
   * POST /api/auth/reset-password
   */
  router.post('/reset-password',
    authRateLimit,
    validateRequest(validationSchemas.auth.resetPassword),
    asyncHandler(async (req: Request, res: Response) => {
      const { resetToken, newPassword } = req.body;

      await authService.resetPassword(resetToken, newPassword);
      
      res.status(200).json({
        success: true,
        message: 'Password reset successfully'
      });
    })
  );

  /**
   * Change password (authenticated user). Profile settings: edit password.
   * POST /api/auth/change-password
   */
  router.post('/change-password',
    authenticate,
    authRateLimit,
    validateRequest(validationSchemas.auth.changePassword),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const { currentPassword, newPassword } = req.body;

      await authService.changePassword(userId, currentPassword, newPassword);
      
      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    })
  );

  /**
   * Change email (authenticated user). Profile settings: edit email.
   * POST /api/auth/change-email
   */
  router.post('/change-email',
    authenticate,
    authRateLimit,
    validateRequest(validationSchemas.auth.changeEmail),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id;
      const { newEmail, password } = req.body;

      const user = await authService.changeEmail(userId, newEmail, password);
      
      res.status(200).json({
        success: true,
        message: 'Email updated successfully',
        user: toSafeUser(user)
      });
    })
  );

  /**
   * Validate JWT token
   * GET /api/auth/validate
   * Requirements: 1.3, 9.2
   */
  router.get('/validate',
    authenticate,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Token is valid',
        user: {
          id: req.user!.id,
          email: req.user!.email,
          subscriptionTier: req.user!.subscriptionTier
        }
      });
    })
  );

  return router;
}

export default createAuthRoutes;