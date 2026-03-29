import Joi from 'joi';

class ValidationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// CUSTOM VALIDATION RULES
// ============================================================================

// Custom password validation
const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
  .messages({
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    'string.min': 'Password must be at least 8 characters long',
    'string.max': 'Password must not exceed 128 characters'
  });

// Custom email validation
const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .max(254)
  .lowercase()
  .trim()
  .messages({
    'string.email': 'Please provide a valid email address',
    'string.max': 'Email address is too long'
  });

// Custom UUID/CUID validation
// CUID format: starts with 'c', followed by timestamp and random characters (25 chars total)
// UUID format: standard UUIDv4
const uuidSchema = Joi.string()
  .pattern(/^(c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  .messages({
    'string.pattern.base': 'Invalid ID format'
  });

// File validation schemas
const audioFileSchema = Joi.object({
  mimetype: Joi.string().valid(
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/m4a',
    'audio/aac',
    'audio/ogg'
  ).required(),
  size: Joi.number().max(50 * 1024 * 1024).required(), // 50MB max
  originalname: Joi.string().required()
});

const resumeFileSchema = Joi.object({
  mimetype: Joi.string().valid(
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ).required(),
  size: Joi.number().max(10 * 1024 * 1024).required(), // 10MB max
  originalname: Joi.string().required()
});

// ============================================================================
// AUTHENTICATION SCHEMAS
// ============================================================================

export const authSchemas = {
  register: Joi.object({
    email: emailSchema.required(),
    password: passwordSchema.required()
  }),

  login: Joi.object({
    email: emailSchema.required(),
    password: Joi.string().required().messages({
      'any.required': 'Password is required'
    })
  }),

  refreshToken: Joi.object({
    token: Joi.string().required().messages({
      'any.required': 'Refresh token is required'
    })
  })
};

// ============================================================================
// PROFILE SCHEMAS
// ============================================================================

export const profileSchemas = {
  updateProfile: Joi.object({
    fullName: Joi.string().max(100).trim().optional(),
    currentJobTitle: Joi.string().max(100).trim().optional(),
    currentCompany: Joi.string().max(100).trim().optional(),
    school: Joi.string().max(200).trim().optional(),
    degreeInfo: Joi.string().max(200).trim().optional(),
    previousJobTitles: Joi.array().items(Joi.string().max(100).trim()).optional(),
    targetIndustry: Joi.string().max(100).trim().optional(),
    targetJobTitle: Joi.string().max(100).trim().optional(),
    experienceLevel: Joi.string().max(50).trim().optional()
  }).min(1).messages({
    'object.min': 'At least one field must be provided for update'
  }),

  targetRole: Joi.object({
    industry: Joi.string().max(100).trim().required(),
    jobTitle: Joi.string().max(100).trim().required()
  }),

  resumeUpload: resumeFileSchema
};

// ============================================================================
// SESSION SCHEMAS
// ============================================================================

export const sessionSchemas = {
  startSession: Joi.object({
    // No additional fields needed - user ID comes from auth
  }),

  audioUpload: Joi.object({
    sessionId: uuidSchema.required()
  }),

  sessionHistory: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0)
  }),

  getSession: Joi.object({
    sessionId: uuidSchema.required()
  }),

  audioFile: audioFileSchema
};

// ============================================================================
// DASHBOARD SCHEMAS
// ============================================================================

export const dashboardSchemas = {
  getStats: Joi.object({
    // No query parameters needed
  }),

  getInsights: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(10)
  }),

  getTrends: Joi.object({
    days: Joi.number().integer().min(7).max(365).default(30)
  })
};

// ============================================================================
// ADMIN SCHEMAS
// ============================================================================

export const adminSchemas = {
  healthCheck: Joi.object({
    // No parameters needed
  }),

  resetUsage: Joi.object({
    month: Joi.number().integer().min(1).max(12).optional(),
    year: Joi.number().integer().min(2020).max(2030).optional(),
    dryRun: Joi.boolean().optional().default(false)
  }),

  userManagement: Joi.object({
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(50),
    search: Joi.string().max(100).optional(),
    subscriptionTier: Joi.string().valid('free', 'paid').optional()
  }),

  systemConfig: Joi.object({
    // No parameters needed for GET
  })
};

// ============================================================================
// COMMON PARAMETER SCHEMAS
// ============================================================================

export const paramSchemas = {
  userId: Joi.object({
    userId: uuidSchema.required()
  }),

  sessionId: Joi.object({
    sessionId: uuidSchema.required()
  }),

  id: Joi.object({
    id: uuidSchema.required()
  })
};

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

export interface ValidationOptions {
  abortEarly?: boolean;
  allowUnknown?: boolean;
  stripUnknown?: boolean;
}

export class ValidationUtils {
  /**
   * Validate data against a Joi schema
   */
  static validate<T>(
    data: any,
    schema: Joi.Schema,
    options: ValidationOptions = {}
  ): T {
    const defaultOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      ...options
    };

    const { error, value } = schema.validate(data, defaultOptions);

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      throw new ValidationError('Validation failed', { details });
    }

    return value as T;
  }

  /**
   * Validate request body
   */
  static validateBody<T>(body: any, schema: Joi.Schema): T {
    return this.validate<T>(body, schema);
  }

  /**
   * Validate request query parameters
   */
  static validateQuery<T>(query: any, schema: Joi.Schema): T {
    return this.validate<T>(query, schema);
  }

  /**
   * Validate request parameters
   */
  static validateParams<T>(params: any, schema: Joi.Schema): T {
    return this.validate<T>(params, schema);
  }

  /**
   * Validate file upload
   */
  static validateFile(file: any, schema: Joi.Schema): any {
    if (!file) {
      throw new ValidationError('File is required');
    }

    return this.validate(file, schema);
  }

  /**
   * Create a validation middleware for Express
   */
  static createValidationMiddleware(schemas: {
    body?: Joi.Schema;
    query?: Joi.Schema;
    params?: Joi.Schema;
    file?: Joi.Schema;
  }) {
    return (req: any, res: any, next: any) => {
      try {
        if (schemas.body) {
          req.body = this.validateBody(req.body, schemas.body);
        }

        if (schemas.query) {
          req.query = this.validateQuery(req.query, schemas.query);
        }

        if (schemas.params) {
          req.params = this.validateParams(req.params, schemas.params);
        }

        if (schemas.file && req.file) {
          this.validateFile(req.file, schemas.file);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers
  }

  /**
   * Validate and sanitize email
   */
  static sanitizeEmail(email: string): string {
    const sanitized = this.sanitizeString(email).toLowerCase();
    this.validate(sanitized, emailSchema);
    return sanitized;
  }

  /**
   * Check if string is a valid UUID or CUID
   */
  static isValidUUID(uuid: string): boolean {
    if (!uuid || typeof uuid !== 'string') {
      return false;
    }
    try {
      this.validate(uuid, uuidSchema);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate pagination parameters
   */
  static validatePagination(query: any): { limit: number; offset: number } {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(100).default(20),
      offset: Joi.number().integer().min(0).default(0),
      page: Joi.number().integer().min(1).optional()
    });

    const validated = this.validate(query, schema) as any;

    // Convert page to offset if provided
    if (validated.page) {
      validated.offset = (validated.page - 1) * validated.limit;
    }

    return {
      limit: validated.limit,
      offset: validated.offset
    };
  }
}

// Export validation utilities
export const {
  validate,
  validateBody,
  validateQuery,
  validateParams,
  validateFile,
  createValidationMiddleware,
  sanitizeString,
  sanitizeEmail,
  isValidUUID,
  validatePagination
} = ValidationUtils;