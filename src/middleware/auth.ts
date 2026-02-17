import { Request, Response, NextFunction } from 'express';
import { jwtUtils } from '../utils/jwt';
import prisma from '../lib/prisma';

// Local type definitions to avoid import issues
interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  subscriptionTier: SubscriptionTier;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthenticatedRequest extends Request {
  user?: User;
}

enum SubscriptionTier {
  FREE = 'free',
  PAID = 'paid'
}

class AuthenticationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Authentication middleware - validates JWT token and attaches user to request
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const token = jwtUtils.extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      throw new AuthenticationError('No token provided');
    }

    // Validate and decode token
    const payload = jwtUtils.validateToken(token);

    // Fetch user from database to ensure they still exist and get latest data
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    // Convert database user to application User type
    const appUser: User = {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      subscriptionTier: user.subscriptionTier as SubscriptionTier,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Attach user to request
    req.user = appUser;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export const optionalAuthenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = jwtUtils.extractTokenFromHeader(req.headers.authorization);
    
    if (token) {
      // If token is provided, validate it
      const payload = jwtUtils.validateToken(token);
      
      const user = await prisma.user.findUnique({
        where: { id: payload.userId }
      });

      if (user) {
        const appUser: User = {
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          subscriptionTier: user.subscriptionTier as SubscriptionTier,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };

        req.user = appUser;
      }
    }

    // Continue regardless of authentication status
    next();
  } catch (error) {
    // For optional auth, continue even if token validation fails
    next();
  }
};

/**
 * Authorization middleware - ensures user has required subscription tier
 */
export const requireSubscription = (requiredTier: SubscriptionTier) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      // Check subscription tier hierarchy
      const tierHierarchy = {
        [SubscriptionTier.FREE]: 0,
        [SubscriptionTier.PAID]: 1
      };

      const userTierLevel = tierHierarchy[req.user.subscriptionTier];
      const requiredTierLevel = tierHierarchy[requiredTier];

      if (userTierLevel < requiredTierLevel) {
        throw new AuthorizationError(
          `${requiredTier} subscription required`,
          { 
            currentTier: req.user.subscriptionTier,
            requiredTier 
          }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Resource ownership middleware - ensures user owns the requested resource
 */
export const requireOwnership = (resourceType: 'session' | 'profile') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const resourceId = req.params.id || req.params.sessionId;
      if (!resourceId) {
        throw new AuthorizationError('Resource ID required');
      }

      let resource: any = null;

      switch (resourceType) {
        case 'session':
          resource = await prisma.audioSession.findUnique({
            where: { id: resourceId },
            select: { userId: true }
          });
          break;
        case 'profile':
          resource = await prisma.userProfile.findUnique({
            where: { userId: resourceId },
            select: { userId: true }
          });
          break;
        default:
          throw new Error(`Unknown resource type: ${resourceType}`);
      }

      if (!resource) {
        throw new AuthorizationError('Resource not found');
      }

      if (resource.userId !== req.user.id) {
        throw new AuthorizationError('Access denied - resource not owned by user');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Admin-only middleware - ensures user has admin privileges
 */
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    // Check if user has admin privileges (could be based on email domain, role, etc.)
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
    const isAdmin = adminEmails.includes(req.user.email);

    if (!isAdmin) {
      throw new AuthorizationError('Admin privileges required');
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Rate limiting middleware for authentication endpoints
 */
export const authRateLimit = (maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();

    // Clean up expired entries
    const keysToDelete: string[] = [];
    attempts.forEach((value, key) => {
      if (now > value.resetTime) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => attempts.delete(key));

    const clientAttempts = attempts.get(clientId);

    if (!clientAttempts) {
      // First attempt
      attempts.set(clientId, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (now > clientAttempts.resetTime) {
      // Window expired, reset
      attempts.set(clientId, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (clientAttempts.count >= maxAttempts) {
      // Rate limit exceeded
      const remainingTime = Math.ceil((clientAttempts.resetTime - now) / 1000);
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many authentication attempts. Try again in ${remainingTime} seconds.`
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    // Increment attempt count
    clientAttempts.count++;
    next();
  };
};

/**
 * Token refresh middleware - handles automatic token refresh
 */
export const handleTokenRefresh = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = jwtUtils.extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      next();
      return;
    }

    // Check if token is close to expiration (within 1 hour)
    const expiration = jwtUtils.getTokenExpiration(token);
    if (expiration) {
      const oneHour = 60 * 60 * 1000;
      const timeUntilExpiry = expiration.getTime() - Date.now();
      
      if (timeUntilExpiry < oneHour && timeUntilExpiry > 0) {
        // Token is close to expiry, generate a new one
        try {
          const newToken = jwtUtils.refreshToken(token);
          res.setHeader('X-New-Token', newToken);
        } catch (error) {
          // If refresh fails, continue with original token
          console.warn('Token refresh failed:', (error as Error).message);
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail the request if token refresh fails
    next();
  }
};

/**
 * Middleware to validate user account status
 */
export const validateAccountStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    // Check if user account is active (could add account status field to User model)
    // For now, just ensure user exists in database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      throw new AuthenticationError('User account not found');
    }

    // Could add additional checks here:
    // - Account suspension
    // - Email verification status
    // - Payment status for paid accounts

    next();
  } catch (error) {
    next(error);
  }
};
// Export types and functions
export { User, AuthenticatedRequest, SubscriptionTier, AuthenticationError, AuthorizationError };