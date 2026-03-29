/**
 * Comprehensive Validation Middleware
 * Ensures all endpoints have proper input validation and sanitization
 * Requirements: Task 13.1 - Add comprehensive input validation across all endpoints
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../types/auth';

export interface ComprehensiveValidationOptions {
  sanitizeInput?: boolean;
  validateHeaders?: boolean;
  logValidationErrors?: boolean;
  strictMode?: boolean;
  files?: {
    required?: boolean;
    maxCount?: number;
    allowedTypes?: string[];
    maxSize?: number;
  };
}

/**
 * Comprehensive validation middleware factory
 */
export function createComprehensiveValidation(
  schemas: {
    body?: Joi.ObjectSchema;
    query?: Joi.ObjectSchema;
    params?: Joi.ObjectSchema;
    headers?: Joi.ObjectSchema;
    files?: {
      required?: boolean;
      maxCount?: number;
      allowedTypes?: string[];
      maxSize?: number;
    };
  },
  options: ComprehensiveValidationOptions = {}
) {
  const {
    sanitizeInput = true,
    validateHeaders = false,
    logValidationErrors = true,
    strictMode = false
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. Sanitize input if enabled (but preserve password fields)
      if (sanitizeInput) {
        const passwordFields = ['password', 'newPassword', 'currentPassword'];
        const preservedPasswords: Record<string, any> = {};
        
        // Preserve password fields before sanitization
        passwordFields.forEach(field => {
          if (req.body && req.body[field]) {
            preservedPasswords[field] = req.body[field];
          }
        });
        
        req.body = sanitizeObject(req.body);
        req.query = sanitizeObject(req.query);
        
        // Restore password fields after sanitization
        Object.keys(preservedPasswords).forEach(field => {
          req.body[field] = preservedPasswords[field];
        });
      }

      // 2. Validate request body
      if (schemas.body) {
        const { error, value } = schemas.body.validate(req.body, {
          abortEarly: false,
          allowUnknown: !strictMode,
          stripUnknown: true
        });

        if (error) {
          errors.push(...error.details.map(detail => `Body: ${detail.message}`));
        } else {
          req.body = value;
        }
      }

      // 3. Validate query parameters
      if (schemas.query) {
        const { error, value } = schemas.query.validate(req.query, {
          abortEarly: false,
          allowUnknown: !strictMode,
          stripUnknown: true
        });

        if (error) {
          errors.push(...error.details.map(detail => `Query: ${detail.message}`));
        } else {
          req.query = value;
        }
      }

      // 4. Validate route parameters
      if (schemas.params) {
        const { error, value } = schemas.params.validate(req.params, {
          abortEarly: false,
          allowUnknown: !strictMode,
          stripUnknown: true
        });

        if (error) {
          errors.push(...error.details.map(detail => `Params: ${detail.message}`));
        } else {
          req.params = value;
        }
      }

      // 5. Validate headers if required
      if (validateHeaders && schemas.headers) {
        const { error } = schemas.headers.validate(req.headers, {
          abortEarly: false,
          allowUnknown: true
        });

        if (error) {
          errors.push(...error.details.map(detail => `Headers: ${detail.message}`));
        }
      }

      // 6. Validate file uploads if specified
      if (schemas.files) {
        const fileValidationResult = validateFiles(req, schemas.files);
        if (fileValidationResult.errors.length > 0) {
          errors.push(...fileValidationResult.errors);
        }
        if (fileValidationResult.warnings.length > 0) {
          warnings.push(...fileValidationResult.warnings);
        }
      }

      // 7. Check for validation errors
      if (errors.length > 0) {
        if (logValidationErrors) {
          console.warn('Validation errors:', {
            path: req.path,
            method: req.method,
            errors,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
        }

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

      // 8. Log warnings if any
      if (warnings.length > 0 && logValidationErrors) {
        console.warn('Validation warnings:', {
          path: req.path,
          method: req.method,
          warnings
        });
      }

      next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      
      res.status(500).json({
        error: {
          code: 'VALIDATION_MIDDLEWARE_ERROR',
          message: 'Internal validation error'
        },
        timestamp: new Date().toISOString(),
        path: req.path
      });
      return;
    }
  };
}

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Sanitize string input
 */
function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .replace(/[<>]/g, ''); // Remove angle brackets
}

/**
 * Validate file uploads
 */
function validateFiles(
  req: Request,
  fileConfig: {
    required?: boolean;
    maxCount?: number;
    allowedTypes?: string[];
    maxSize?: number;
  }
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const files = (req as any).files || [];
  const file = (req as any).file;
  const allFiles = file ? [file] : files;

  // Check if files are required
  if (fileConfig.required && allFiles.length === 0) {
    errors.push('File upload is required');
    return { errors, warnings };
  }

  // Check file count
  if (fileConfig.maxCount && allFiles.length > fileConfig.maxCount) {
    errors.push(`Too many files. Maximum allowed: ${fileConfig.maxCount}`);
  }

  // Validate each file
  for (const uploadedFile of allFiles) {
    // Check file type
    if (fileConfig.allowedTypes && !fileConfig.allowedTypes.includes(uploadedFile.mimetype)) {
      errors.push(`Invalid file type: ${uploadedFile.mimetype}. Allowed types: ${fileConfig.allowedTypes.join(', ')}`);
    }

    // Check file size
    if (fileConfig.maxSize && uploadedFile.size > fileConfig.maxSize) {
      errors.push(`File too large: ${uploadedFile.originalname}. Maximum size: ${fileConfig.maxSize} bytes`);
    }

    // Check for potentially dangerous file names
    if (uploadedFile.originalname && /[<>:"/\\|?*]/.test(uploadedFile.originalname)) {
      warnings.push(`Potentially unsafe filename: ${uploadedFile.originalname}`);
    }
  }

  return { errors, warnings };
}

/**
 * Create endpoint-specific validation middleware
 */
export const endpointValidation = {
  // Authentication endpoints
  auth: {
    register: createComprehensiveValidation({
      body: Joi.object({
        email: Joi.string().email().required().messages({
          'string.email': 'Must be a valid email address',
          'any.required': 'Email is required'
        }),
        password: Joi.string()
          .min(8)
          .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
          .required()
          .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
            'any.required': 'Password is required'
          })
      })
    }, { strictMode: true, logValidationErrors: true }),

    login: createComprehensiveValidation({
      body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
      })
    }, { strictMode: true }),

    refresh: createComprehensiveValidation({
      body: Joi.object({
        refreshToken: Joi.string().required()
      })
    }, { strictMode: true })
  },

  // Profile endpoints
  profile: {
    update: createComprehensiveValidation({
      body: Joi.object({
        targetIndustry: Joi.string().max(100).optional(),
        targetJobTitle: Joi.string().max(100).optional(),
        experienceLevel: Joi.string().max(50).optional() // Open field - any experience level
      }).min(1).messages({
        'object.min': 'At least one field must be provided for update'
      })
    }),

    targetRole: createComprehensiveValidation({
      body: Joi.object({
        targetIndustry: Joi.string().max(100).required(),
        targetJobTitle: Joi.string().max(100).required()
      })
    }, { strictMode: true }),

    resumeUpload: createComprehensiveValidation({}, {
      files: {
        required: true,
        maxCount: 1,
        allowedTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ],
        maxSize: 10 * 1024 * 1024 // 10MB
      }
    })
  },

  // Session endpoints
  sessions: {
    sessionId: createComprehensiveValidation({
      params: Joi.object({
        id: Joi.string().pattern(/^c[a-z0-9]{24}$/).required().messages({
          'string.pattern.base': 'Session ID must be a valid CUID',
          'any.required': 'Session ID is required'
        })
      })
    }, { strictMode: true }),

    history: createComprehensiveValidation({
      query: Joi.object({
        limit: Joi.number().integer().min(1).max(100).default(20),
        offset: Joi.number().integer().min(0).default(0)
      })
    }),

    audioUpload: createComprehensiveValidation({
      params: Joi.object({
        id: Joi.string().pattern(/^c[a-z0-9]{24}$/).required().messages({
          'string.pattern.base': 'Session ID must be a valid CUID',
          'any.required': 'Session ID is required'
        })
      })
    }, {
      files: {
        required: true,
        maxCount: 1,
        allowedTypes: [
          'audio/mpeg',
          'audio/wav',
          'audio/mp4',
          'audio/webm',
          'audio/aac',
          'audio/ogg'
        ],
        maxSize: 50 * 1024 * 1024 // 50MB
      }
    })
  },

  // Dashboard endpoints
  dashboard: {
    insights: createComprehensiveValidation({
      query: Joi.object({
        limit: Joi.number().integer().min(1).max(50).default(10)
      })
    }),

    trends: createComprehensiveValidation({
      query: Joi.object({
        days: Joi.number().integer().min(1).max(365).default(30)
      })
    })
  },

  // Subscription endpoints
  subscription: {
    upgrade: createComprehensiveValidation({
      body: Joi.object({
        tier: Joi.string().valid('FREE', 'PAID').required()
      })
    }, { strictMode: true })
  },

  // Admin endpoints
  admin: {
    resetUsage: createComprehensiveValidation({
      body: Joi.object({
        month: Joi.number().integer().min(1).max(12).optional(),
        year: Joi.number().integer().min(2020).max(2030).optional(),
        dryRun: Joi.boolean().default(false)
      })
    }),

    users: createComprehensiveValidation({
      query: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(50),
        search: Joi.string().max(100).optional(),
        subscriptionTier: Joi.string().valid('FREE', 'PAID').optional()
      })
    })
  }
};

/**
 * Global validation error handler
 */
export function handleValidationError(error: any, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof ValidationError || error.name === 'ValidationError') {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message || 'Validation failed',
        details: error.details || []
      },
      timestamp: new Date().toISOString(),
      path: req.path
    });
    return;
  }

  next(error);
}

/**
 * Validation metrics collector
 */
export class ValidationMetrics {
  private static instance: ValidationMetrics;
  private validationCounts: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();

  static getInstance(): ValidationMetrics {
    if (!ValidationMetrics.instance) {
      ValidationMetrics.instance = new ValidationMetrics();
    }
    return ValidationMetrics.instance;
  }

  recordValidation(endpoint: string, success: boolean) {
    const key = `${endpoint}:${success ? 'success' : 'error'}`;
    this.validationCounts.set(key, (this.validationCounts.get(key) || 0) + 1);
    
    if (!success) {
      this.errorCounts.set(endpoint, (this.errorCounts.get(endpoint) || 0) + 1);
    }
  }

  getMetrics() {
    return {
      validationCounts: Object.fromEntries(this.validationCounts),
      errorCounts: Object.fromEntries(this.errorCounts),
      totalValidations: Array.from(this.validationCounts.values()).reduce((sum, count) => sum + count, 0),
      totalErrors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0)
    };
  }

  reset() {
    this.validationCounts.clear();
    this.errorCounts.clear();
  }
}