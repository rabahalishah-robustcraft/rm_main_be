/**
 * Comprehensive Input Validation Middleware
 * Requirements: All requirements integration - input validation
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../types/auth';

export interface ValidationSchema {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  headers?: Joi.ObjectSchema;
}

/**
 * Create validation middleware for request validation
 */
export function validateRequest(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    // Validate request body
    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) {
        errors.push(`Body: ${error.details[0].message}`);
      }
    }

    // Validate query parameters
    if (schema.query) {
      const { error } = schema.query.validate(req.query);
      if (error) {
        errors.push(`Query: ${error.details[0].message}`);
      }
    }

    // Validate route parameters
    if (schema.params) {
      const { error } = schema.params.validate(req.params);
      if (error) {
        errors.push(`Params: ${error.details[0].message}`);
      }
    }

    // Validate headers
    if (schema.headers) {
      const { error } = schema.headers.validate(req.headers);
      if (error) {
        errors.push(`Headers: ${error.details[0].message}`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }

    next();
  };
}

/**
 * Comprehensive validation schemas for all endpoints
 */
export const validationSchemas = {
  // Auth endpoints
  auth: {
    register: {
      body: Joi.object({
        email: Joi.string().email().required().messages({
          'string.email': 'Must be a valid email address',
          'any.required': 'Email is required'
        }),
        password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
          'string.min': 'Password must be at least 8 characters long',
          'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
          'any.required': 'Password is required'
        })
      })
    },
    login: {
      body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
      })
    },
    refresh: {
      body: Joi.object({
        refreshToken: Joi.string().required()
      })
    },
    google: {
      body: Joi.object({
        idToken: Joi.string().required().messages({
          'any.required': 'Google ID token is required'
        })
      })
    },
    forgotPassword: {
      body: Joi.object({
        email: Joi.string().email().required().messages({
          'string.email': 'Must be a valid email address',
          'any.required': 'Email is required'
        })
      })
    },
    verifyOtp: {
      body: Joi.object({
        email: Joi.string().email().required(),
        otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
          'string.length': 'OTP must be 6 digits',
          'string.pattern.base': 'OTP must contain only numbers'
        })
      })
    },
    resetPassword: {
      body: Joi.object({
        resetToken: Joi.string().required(),
        newPassword: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
          'string.min': 'Password must be at least 8 characters long',
          'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
          'any.required': 'New password is required'
        })
      })
    },
    changePassword: {
      body: Joi.object({
        currentPassword: Joi.string().required().messages({
          'any.required': 'Current password is required'
        }),
        newPassword: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
          'string.min': 'New password must be at least 8 characters long',
          'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
          'any.required': 'New password is required'
        })
      })
    },
    changeEmail: {
      body: Joi.object({
        newEmail: Joi.string().email().required().messages({
          'string.email': 'Must be a valid email address',
          'any.required': 'New email is required'
        }),
        password: Joi.string().required().messages({
          'any.required': 'Password is required to verify your identity'
        })
      })
    }
  },

  // Profile endpoints
  profile: {
    update: {
      body: Joi.object({
        fullName: Joi.string().max(100).trim().optional(),
        currentJobTitle: Joi.string().max(100).trim().optional(),
        currentCompany: Joi.string().max(100).trim().optional(),
        school: Joi.string().max(200).trim().optional(),
        degreeInfo: Joi.string().max(200).trim().optional(),
        previousJobTitles: Joi.array().items(Joi.string().max(100).trim()).optional(),
        targetIndustry: Joi.string().max(100).trim().optional(),
        targetJobTitle: Joi.string().max(100).trim().optional(),
        experienceLevel: Joi.string().max(50).trim().optional()
      }).min(1)
    },
    targetRole: {
      body: Joi.object({
        targetIndustry: Joi.string().required(),
        targetJobTitle: Joi.string().required()
      })
    }
  },

  // Session endpoints
  sessions: {
    sessionId: {
      params: Joi.object({
        id: Joi.string().pattern(/^c[a-z0-9]{24}$/).required().messages({
          'string.pattern.base': 'Session ID must be a valid CUID',
          'any.required': 'Session ID is required'
        })
      })
    },
    updateTranscript: {
      params: Joi.object({
        id: Joi.string().pattern(/^c[a-z0-9]{24}$/).required().messages({
          'string.pattern.base': 'Session ID must be a valid CUID',
          'any.required': 'Session ID is required'
        })
      }),
      body: Joi.object({
        transcript: Joi.string().min(1).max(50000).trim().required().messages({
          'string.min': 'Transcript cannot be empty',
          'any.required': 'Transcript is required'
        })
      })
    },
    updateDisplayName: {
      params: Joi.object({
        id: Joi.string().pattern(/^c[a-z0-9]{24}$/).required().messages({
          'string.pattern.base': 'Session ID must be a valid CUID',
          'any.required': 'Session ID is required'
        })
      }),
      body: Joi.object({
        displayName: Joi.string().max(200).trim().allow('').optional()
      }).min(1)
    },
    history: {
      query: Joi.object({
        limit: Joi.number().integer().min(1).max(100).optional(),
        offset: Joi.number().integer().min(0).optional(),
        status: Joi.string().valid('completed', 'processing', 'failed', 'pending', 'all').optional()
      })
    }
  },

  // Subscription endpoints
  subscription: {
    upgrade: {
      body: Joi.object({
        tier: Joi.string().valid('FREE', 'PAID').required()
      })
    }
  },

  // Dashboard endpoints
  dashboard: {
    insights: {
      query: Joi.object({
        limit: Joi.number().integer().min(1).max(50).optional()
      })
    },
    trends: {
      query: Joi.object({
        days: Joi.number().integer().min(1).max(365).optional()
      })
    }
  },

  // Admin endpoints
  admin: {
    resetUsage: {
      body: Joi.object({
        month: Joi.number().integer().min(1).max(12).optional(),
        year: Joi.number().integer().min(2020).max(2030).optional()
      })
    },
    users: {
      query: Joi.object({
        limit: Joi.number().integer().min(1).max(100).optional(),
        offset: Joi.number().integer().min(0).optional(),
        tier: Joi.string().valid('FREE', 'PAID').optional()
      })
    }
  }
};

/**
 * File upload validation
 */
export const fileValidation = {
  resume: {
    allowedTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxSize: 10 * 1024 * 1024, // 10MB
    validate: (file: Express.Multer.File) => {
      if (!fileValidation.resume.allowedTypes.includes(file.mimetype)) {
        throw new ValidationError('Invalid file type. Only PDF and Word documents are allowed.');
      }
      if (file.size > fileValidation.resume.maxSize) {
        throw new ValidationError('File too large. Maximum size is 10MB.');
      }
    }
  },
  audio: {
    allowedTypes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm'],
    maxSize: 50 * 1024 * 1024, // 50MB
    validate: (file: Express.Multer.File) => {
      if (!fileValidation.audio.allowedTypes.includes(file.mimetype)) {
        throw new ValidationError('Invalid audio file type. Only MP3, WAV, MP4, and WebM are allowed.');
      }
      if (file.size > fileValidation.audio.maxSize) {
        throw new ValidationError('Audio file too large. Maximum size is 50MB.');
      }
    }
  }
};

/**
 * Sanitize request data to prevent XSS and injection attacks
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
  // Sanitize string inputs
  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
}

/**
 * Rate limiting validation
 */
export function validateRateLimit(windowMs: number, maxRequests: number) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [key, value] of requests.entries()) {
      if (value.resetTime < windowStart) {
        requests.delete(key);
      }
    }

    // Check current client
    const clientData = requests.get(clientId);
    if (!clientData) {
      requests.set(clientId, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (clientData.count >= maxRequests) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }

    clientData.count++;
    next();
  };
}