import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Generate UUID v4 using crypto
function generateUUID(): string {
  return crypto.randomUUID();
}

interface RequestContext {
  requestId: string;
  userId?: string;
  startTime: number;
  path: string;
  method: string;
}

/**
 * Request logging middleware with correlation IDs
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = generateUUID();

  // Add request ID to headers for client reference
  res.setHeader('X-Request-ID', requestId);

  // Create request context
  const context: RequestContext = {
    requestId,
    userId: (req as any).user?.id,
    startTime,
    path: req.path,
    method: req.method
  };

  // Attach context to request
  (req as any).context = context;

  // Log request start
  logRequest(req, context);

  // Override res.end to log response
  const originalEnd = res.end.bind(res);
  res.end = function(chunk?: any, encoding?: any): Response {
    const duration = Date.now() - startTime;
    logResponse(req, res, context, duration);
    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

/**
 * Log incoming request
 */
function logRequest(req: Request, context: RequestContext): void {
  const logData = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: context.userId,
    contentLength: req.get('Content-Length'),
    contentType: req.get('Content-Type')
  };

  console.log('Request:', JSON.stringify(logData));
}

/**
 * Log outgoing response
 */
function logResponse(
  req: Request, 
  res: Response, 
  context: RequestContext, 
  duration: number
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    userId: context.userId,
    contentLength: res.get('Content-Length')
  };

  // Log level based on status code
  if (res.statusCode >= 500) {
    console.error('Response:', JSON.stringify(logData));
  } else if (res.statusCode >= 400) {
    console.warn('Response:', JSON.stringify(logData));
  } else {
    console.log('Response:', JSON.stringify(logData));
  }
}

/**
 * Performance monitoring middleware
 */
export const performanceMonitor = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    // Log slow requests (> 1 second)
    if (duration > 1000) {
      console.warn('Slow Request:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        duration: `${duration.toFixed(2)}ms`,
        statusCode: res.statusCode,
        userId: (req as any).user?.id
      });
    }

    // Track metrics (in production, send to monitoring service)
    if (process.env.NODE_ENV === 'production') {
      // Example: Send metrics to monitoring service
      // metricsService.recordRequestDuration(req.method, req.path, duration);
      // metricsService.recordStatusCode(res.statusCode);
    }
  });

  next();
};

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Remove server information
  res.removeHeader('X-Powered-By');

  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "manifest-src 'self'"
  ].join('; '));

  next();
};

/**
 * Request sanitization middleware
 */
export const sanitizeRequest = (req: Request, res: Response, next: NextFunction): void => {
  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key] as string);
      }
    }
  }

  // Sanitize body (for string fields only)
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  next();
};

/**
 * Sanitize string input
 */
function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

/**
 * Recursively sanitize object properties
 */
function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
}

/**
 * API versioning middleware
 */
export const apiVersioning = (req: Request, res: Response, next: NextFunction): void => {
  // Extract version from header or URL
  const versionHeader = req.get('API-Version');
  const versionFromUrl = req.path.match(/^\/api\/v(\d+)/)?.[1];
  
  const version = versionHeader || versionFromUrl || '1';
  
  // Attach version to request
  (req as any).apiVersion = version;
  
  // Set response header
  res.setHeader('API-Version', version);
  
  next();
};

/**
 * Request timeout middleware
 */
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timeout'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timeout);
    });

    res.on('close', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

/**
 * Health check middleware
 */
export const healthCheck = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.path === '/health' || req.path === '/api/health') {
    try {
      // Basic health check
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      };

      res.status(200).json(health);
      return;
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: (error as Error).message
      });
      return;
    }
  }

  next();
};