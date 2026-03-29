import { Request, Response, NextFunction } from 'express';
import { config } from '../utils/config';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface ClientData {
  count: number;
  resetTime: number;
  firstRequest: number;
}

/**
 * In-memory rate limiting store
 * In production, use Redis or similar distributed cache
 */
class MemoryStore {
  private store = new Map<string, ClientData>();

  get(key: string): ClientData | undefined {
    return this.store.get(key);
  }

  set(key: string, data: ClientData): void {
    this.store.set(key, data);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now > data.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

const store = new MemoryStore();

// Cleanup expired entries every 5 minutes.
// Skip in Jest test environment to avoid keeping test workers alive with open timers.
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  setInterval(() => {
    store.cleanup();
  }, 5 * 60 * 1000).unref();
}

/**
 * Generic rate limiting middleware
 */
export const createRateLimit = (config: RateLimitConfig) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = getClientIdentifier(req);
    const now = Date.now();

    let clientData = store.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      // First request or window expired
      clientData = {
        count: 1,
        resetTime: now + config.windowMs,
        firstRequest: now
      };
      store.set(clientId, clientData);
      next();
      return;
    }

    if (clientData.count >= config.maxRequests) {
      // Rate limit exceeded
      const remainingTime = Math.ceil((clientData.resetTime - now) / 1000);
      
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: config.message || `Too many requests. Try again in ${remainingTime} seconds.`,
          details: {
            limit: config.maxRequests,
            windowMs: config.windowMs,
            retryAfter: remainingTime
          }
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    // Increment counter
    clientData.count++;
    store.set(clientId, clientData);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - clientData.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(clientData.resetTime / 1000));

    next();
  };
};

/**
 * Get client identifier for rate limiting
 */
function getClientIdentifier(req: Request): string {
  // Use user ID if authenticated, otherwise use IP
  const userId = (req as any).user?.id;
  if (userId) {
    return `user:${userId}`;
  }

  // Use IP address with forwarded headers consideration
  const forwarded = req.get('X-Forwarded-For');
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return `ip:${ip}`;
}

/**
 * Strict rate limiting for authentication endpoints
 * Uses config values: AUTH_RATE_LIMIT_WINDOW_MS and AUTH_RATE_LIMIT_MAX_ATTEMPTS
 */
export const authRateLimit = createRateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS, // Default: 15 minutes (900000ms)
  maxRequests: config.AUTH_RATE_LIMIT_MAX_ATTEMPTS, // Default: 10 attempts per window
  message: 'Too many authentication attempts. Please try again later.'
});

/**
 * Stricter rate limiting for password reset (forgot-password, verify-otp)
 */
export const passwordResetRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3, // 3 attempts per hour per IP
  message: 'Too many password reset attempts. Please try again later.'
});

/**
 * General API rate limiting
 */
export const apiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  message: 'Too many API requests. Please slow down.'
});

/**
 * Strict rate limiting for file uploads
 */
export const uploadRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10, // 10 uploads per hour
  message: 'Too many file uploads. Please try again later.'
});

/**
 * Rate limiting for AI processing endpoints
 */
export const aiProcessingRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50, // 50 AI requests per hour
  message: 'Too many AI processing requests. Please try again later.'
});

/**
 * Progressive rate limiting - increases restrictions for repeated violations
 */
export const progressiveRateLimit = (baseConfig: RateLimitConfig) => {
  const violationStore = new Map<string, { count: number; lastViolation: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = getClientIdentifier(req);
    const now = Date.now();

    // Check for recent violations
    const violations = violationStore.get(clientId);
    let multiplier = 1;

    if (violations) {
      // Reset violations after 24 hours
      if (now - violations.lastViolation > 24 * 60 * 60 * 1000) {
        violationStore.delete(clientId);
      } else {
        // Increase restrictions based on violation count
        multiplier = Math.min(violations.count, 10); // Cap at 10x
      }
    }

    const adjustedConfig: RateLimitConfig = {
      ...baseConfig,
      maxRequests: Math.max(1, Math.floor(baseConfig.maxRequests / multiplier)),
      windowMs: baseConfig.windowMs * multiplier
    };

    // Create temporary rate limiter with adjusted config
    const rateLimiter = createRateLimit(adjustedConfig);

    // Wrap the response to detect rate limit violations
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      if (res.statusCode === 429) {
        // Record violation
        const currentViolations = violationStore.get(clientId) || { count: 0, lastViolation: 0 };
        violationStore.set(clientId, {
          count: currentViolations.count + 1,
          lastViolation: now
        });
      }
      return originalJson(body);
    };

    rateLimiter(req, res, next);
  };
};

/**
 * Distributed rate limiting (for production with Redis)
 */
export class RedisRateLimit {
  constructor(private redisClient: any) {}

  createRateLimit(config: RateLimitConfig) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const clientId = getClientIdentifier(req);
      const key = `rate_limit:${clientId}`;
      const now = Date.now();

      try {
        // Use Redis pipeline for atomic operations
        const pipeline = this.redisClient.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, Math.ceil(config.windowMs / 1000));
        
        const results = await pipeline.exec();
        const count = results[0][1];

        if (count > config.maxRequests) {
          const ttl = await this.redisClient.ttl(key);
          
          res.status(429).json({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: config.message || `Too many requests. Try again in ${ttl} seconds.`,
              details: {
                limit: config.maxRequests,
                windowMs: config.windowMs,
                retryAfter: ttl
              }
            },
            timestamp: new Date().toISOString(),
            path: req.path
          });
          return;
        }

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', config.maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - count));
        res.setHeader('X-RateLimit-Reset', Math.ceil((now + config.windowMs) / 1000));

        next();
      } catch (error) {
        // If Redis fails, allow the request but log the error
        console.error('Rate limiting error:', error);
        next();
      }
    };
  }
}

/**
 * Abuse detection middleware
 */
export const abuseDetection = (req: Request, res: Response, next: NextFunction): void => {
  const clientId = getClientIdentifier(req);
  
  // Exclude password fields from abuse detection
  const sanitizedData = { ...req.query, ...req.body };
  if (sanitizedData.password) {
    delete sanitizedData.password;
  }
  if (sanitizedData.newPassword) {
    delete sanitizedData.newPassword;
  }
  if (sanitizedData.currentPassword) {
    delete sanitizedData.currentPassword;
  }
  
  const suspiciousPatterns = [
    // SQL injection patterns
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/i,
    // XSS patterns
    /<script[^>]*>.*?<\/script>/gi,
    // Path traversal
    /\.\.[\/\\]/,
    // Command injection (only check in non-password fields)
    /[;&|`$(){}[\]]/
  ];

  // Check request body and query parameters (excluding passwords)
  const requestData = JSON.stringify(sanitizedData);
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      console.warn('Suspicious request detected:', {
        clientId,
        pattern: pattern.source,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });

      res.status(400).json({
        error: {
          code: 'SUSPICIOUS_REQUEST',
          message: 'Request contains potentially malicious content'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }
  }

  next();
};

/**
 * IP whitelist/blacklist middleware
 */
export const ipFilter = (options: { whitelist?: string[]; blacklist?: string[] }) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

    // Check blacklist first
    if (options.blacklist && options.blacklist.includes(clientIp)) {
      res.status(403).json({
        error: {
          code: 'IP_BLOCKED',
          message: 'Access denied from this IP address'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    // Check whitelist if provided
    if (options.whitelist && options.whitelist.length > 0) {
      if (!options.whitelist.includes(clientIp)) {
        res.status(403).json({
          error: {
            code: 'IP_NOT_WHITELISTED',
            message: 'Access denied - IP not in whitelist'
          },
          timestamp: new Date().toISOString(),
          path: req.path
        });
        return;
      }
    }

    next();
  };
};