import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import prisma from '../lib/prisma';

/**
 * Data isolation middleware - ensures users can only access their own data
 */
export const enforceDataIsolation = (resourceType: 'profile' | 'session' | 'usage') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required for data access'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }

      const userId = req.user.id;
      let resourceOwnerId: string | null = null;

      switch (resourceType) {
        case 'profile':
          // For profile routes, ensure user can only access their own profile
          const profileUserId = req.params.userId || req.body.userId || userId;
          if (profileUserId !== userId) {
            res.status(403).json({
              error: {
                code: 'DATA_ISOLATION_VIOLATION',
                message: 'Access denied - cannot access other user profiles'
              },
              timestamp: new Date().toISOString(),
              path: req.path
            });
            return;
          }
          break;

        case 'session':
          // For session routes, verify session ownership
          const sessionId = req.params.id || req.params.sessionId;
          if (sessionId) {
            const session = await prisma.audioSession.findUnique({
              where: { id: sessionId },
              select: { userId: true }
            });

            if (!session) {
              res.status(404).json({
                error: {
                  code: 'SESSION_NOT_FOUND',
                  message: 'Session not found'
                },
                timestamp: new Date().toISOString(),
                path: req.path
              });
              return;
            }

            if (session.userId !== userId) {
              res.status(403).json({
                error: {
                  code: 'DATA_ISOLATION_VIOLATION',
                  message: 'Access denied - cannot access other user sessions'
                },
                timestamp: new Date().toISOString(),
                path: req.path
              });
              return;
            }
          }
          break;

        case 'usage':
          // For usage/subscription routes, ensure user can only access their own usage data
          const targetUserId = req.params.userId || req.body.userId || userId;
          if (targetUserId !== userId) {
            res.status(403).json({
              error: {
                code: 'DATA_ISOLATION_VIOLATION',
                message: 'Access denied - cannot access other user usage data'
              },
              timestamp: new Date().toISOString(),
              path: req.path
            });
            return;
          }
          break;

        default:
          res.status(500).json({
            error: {
              code: 'INVALID_RESOURCE_TYPE',
              message: 'Invalid resource type for data isolation'
            },
            timestamp: new Date().toISOString(),
            path: req.path
          });
          return;
      }

      next();
    } catch (error) {
      console.error('Data isolation error:', error);
      res.status(500).json({
        error: {
          code: 'DATA_ISOLATION_ERROR',
          message: 'Error enforcing data isolation'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
  };
};

/**
 * Admin-only endpoint protection
 */
export const requireAdminAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required for admin access'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    // Check multiple admin verification methods
    const isAdmin = await verifyAdminStatus(req.user.id, req.user.email);

    if (!isAdmin) {
      // Log unauthorized admin access attempt
      console.warn('Unauthorized admin access attempt:', {
        userId: req.user.id,
        email: req.user.email,
        path: req.path,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      res.status(403).json({
        error: {
          code: 'ADMIN_ACCESS_DENIED',
          message: 'Admin privileges required'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    // Log admin access for audit trail
    console.log('Admin access granted:', {
      userId: req.user.id,
      email: req.user.email,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({
      error: {
        code: 'ADMIN_VERIFICATION_ERROR',
        message: 'Error verifying admin status'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }
};

/**
 * Verify admin status using multiple methods
 */
async function verifyAdminStatus(userId: string, email: string): Promise<boolean> {
  // Method 1: Check environment variable for admin emails
  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()) || [];
  if (adminEmails.includes(email)) {
    return true;
  }

  // Method 2: Check for admin role in database (if implemented)
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    // Could add admin role field to user model in future
    // if (user?.role === 'ADMIN') return true;

    // Method 3: Check admin domain patterns
    const adminDomains = process.env.ADMIN_DOMAINS?.split(',').map(d => d.trim()) || [];
    const emailDomain = email.split('@')[1];
    if (adminDomains.includes(emailDomain)) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Database admin check failed:', error);
    return false;
  }
}

/**
 * Secure request logging that excludes sensitive information
 */
export const secureLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Create sanitized request log
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: sanitizeQueryParams(req.query),
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length')
  };

  // Log request (excluding sensitive body data)
  console.log('Secure Request Log:', JSON.stringify(logData));

  // Override response methods to log responses securely
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    const responseLog = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: (req as any).user?.id,
      success: res.statusCode < 400
    };

    // Log response (excluding sensitive response data)
    if (res.statusCode >= 400) {
      console.warn('Secure Response Log (Error):', JSON.stringify(responseLog));
    } else {
      console.log('Secure Response Log:', JSON.stringify(responseLog));
    }

    return originalJson(body);
  };

  next();
};

/**
 * Sanitize query parameters for logging
 */
function sanitizeQueryParams(query: any): any {
  const sanitized = { ...query };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];

  for (const key in sanitized) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Content Security Policy middleware
 */
export const contentSecurityPolicy = (req: Request, res: Response, next: NextFunction): void => {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Allow inline scripts for API responses
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com https://*.amazonaws.com",
    "media-src 'self' https://*.amazonaws.com",
    "object-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "manifest-src 'self'"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  next();
};

/**
 * Request validation middleware for security
 */
export const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
  // Check for suspicious headers
  const suspiciousHeaders = ['x-forwarded-host', 'x-original-url', 'x-rewrite-url'];
  for (const header of suspiciousHeaders) {
    if (req.get(header)) {
      console.warn('Suspicious header detected:', {
        header,
        value: req.get(header),
        ip: req.ip,
        path: req.path,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Validate content type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    const allowedTypes = [
      'application/json',
      'multipart/form-data',
      'application/x-www-form-urlencoded'
    ];

    if (contentType && !allowedTypes.some(type => contentType.includes(type))) {
      res.status(400).json({
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Invalid content type'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }
  }

  // Check request size limits
  const contentLength = parseInt(req.get('Content-Length') || '0');
  const maxSize = 50 * 1024 * 1024; // 50MB limit

  if (contentLength > maxSize) {
    res.status(413).json({
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'Request entity too large'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }

  next();
};

/**
 * Session security middleware
 */
export const sessionSecurity = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (req.user) {
    // Add security headers for authenticated requests
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Check for session hijacking indicators
    const userAgent = req.get('User-Agent');
    const storedUserAgent = (req as any).session?.userAgent;

    if (storedUserAgent && userAgent !== storedUserAgent) {
      console.warn('Potential session hijacking detected:', {
        userId: req.user.id,
        currentUserAgent: userAgent,
        storedUserAgent,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      // Could invalidate session here if strict security is needed
    }

    // Store user agent for future comparison
    if ((req as any).session) {
      (req as any).session.userAgent = userAgent;
    }
  }

  next();
};

/**
 * API key validation middleware (for future API key authentication)
 */
export const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.get('X-API-Key');
  
  if (!apiKey) {
    return next(); // API key is optional, continue without it
  }

  // Validate API key format
  const apiKeyPattern = /^[a-zA-Z0-9]{32,64}$/;
  if (!apiKeyPattern.test(apiKey)) {
    res.status(400).json({
      error: {
        code: 'INVALID_API_KEY_FORMAT',
        message: 'Invalid API key format'
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }

  // In production, validate against database or cache
  // For now, just log the API key usage
  console.log('API key used:', {
    keyPrefix: apiKey.substring(0, 8) + '...',
    path: req.path,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  next();
};