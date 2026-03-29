import { Request, Response, NextFunction } from 'express';
import { 
  AppError, 
  ValidationError, 
  AuthenticationError, 
  NotFoundError,
  ExternalServiceError,
  ErrorCode 
} from '../types/auth';

interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
}

// Additional error classes not in auth types
class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', details?: any) {
    super(ErrorCode.AUTHORIZATION_ERROR, message, 403, details);
  }
}

class UsageLimitError extends AppError {
  constructor(message: string = 'Usage limit exceeded', details?: any) {
    super(ErrorCode.USAGE_LIMIT_ERROR, message, 429, details);
  }
}

/**
 * Handle different error types
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error for debugging (exclude sensitive information)
  logError(error, req);

  // Handle authentication errors first (check by name since they might be from different modules)
  if (error.name === 'AuthenticationError') {
    const errorResponse: ErrorResponse = {
      error: {
        code: ErrorCode.AUTHENTICATION_ERROR,
        message: error.message || 'Authentication failed',
        details: (error as any).details
      },
      timestamp: new Date().toISOString(),
      path: req.path
    };
    res.status(401).json(errorResponse);
    return;
  }

  // Handle authorization errors
  if (error.name === 'AuthorizationError') {
    const errorResponse: ErrorResponse = {
      error: {
        code: ErrorCode.AUTHORIZATION_ERROR,
        message: error.message || 'Insufficient permissions',
        details: (error as any).details
      },
      timestamp: new Date().toISOString(),
      path: req.path
    };
    res.status(403).json(errorResponse);
    return;
  }

  // Handle different error types
  if (error instanceof AppError) {
    handleAppError(error, req, res);
  } else if (error.name === 'ValidationError') {
    // Handle our custom ValidationError
    const validationError = error as any;
    handleValidationError(validationError, req, res);
  } else if (error.name === 'ValidationError' && 'details' in error) {
    // Joi validation error
    handleJoiValidationError(error as any, req, res);
  } else if (error.name === 'PrismaClientKnownRequestError') {
    handlePrismaError(error as any, req, res);
  } else if (error.name === 'MulterError') {
    handleMulterError(error as any, req, res);
  } else {
    // Unknown error
    handleUnknownError(error, req, res);
  }
};

/**
 * Handle application-specific errors
 */
function handleAppError(error: AppError, req: Request, res: Response): void {
  const errorResponse: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(error.statusCode).json(errorResponse);
}

/**
 * Handle our custom ValidationError
 */
function handleValidationError(error: any, req: Request, res: Response): void {
  const errorResponse: ErrorResponse = {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message: error.message || 'Validation failed',
      details: error.details
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(400).json(errorResponse);
}

/**
 * Handle Joi validation errors
 */
function handleJoiValidationError(error: any, req: Request, res: Response): void {
  const details = error.details?.map((detail: any) => ({
    field: detail.path.join('.'),
    message: detail.message,
    value: detail.context?.value
  })) || [];

  const errorResponse: ErrorResponse = {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(400).json(errorResponse);
}

/**
 * Handle Prisma database errors
 */
function handlePrismaError(error: any, req: Request, res: Response): void {
  let statusCode = 500;
  let code = ErrorCode.DATABASE_ERROR;
  let message = 'Database operation failed';

  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      statusCode = 409;
      code = ErrorCode.VALIDATION_ERROR;
      message = 'Resource already exists';
      break;
    case 'P2025':
      // Record not found
      statusCode = 404;
      code = ErrorCode.NOT_FOUND;
      message = 'Resource not found';
      break;
    case 'P2003':
      // Foreign key constraint violation
      statusCode = 400;
      code = ErrorCode.VALIDATION_ERROR;
      message = 'Invalid reference to related resource';
      break;
    case 'P2014':
      // Required relation violation
      statusCode = 400;
      code = ErrorCode.VALIDATION_ERROR;
      message = 'Required relationship missing';
      break;
    default:
      // Generic database error
      console.error('Unhandled Prisma error:', error.code, error.message);
  }

  const errorResponse: ErrorResponse = {
    error: {
      code,
      message,
      details: process.env.NODE_ENV === 'development' ? {
        prismaCode: error.code,
        prismaMessage: error.message
      } : undefined
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(statusCode).json(errorResponse);
}

/**
 * Handle Multer file upload errors
 */
function handleMulterError(error: any, req: Request, res: Response): void {
  let message = 'File upload error';

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      message = 'File size too large';
      break;
    case 'LIMIT_FILE_COUNT':
      message = 'Too many files';
      break;
    case 'LIMIT_UNEXPECTED_FILE':
      message = 'Unexpected file field';
      break;
    case 'LIMIT_PART_COUNT':
      message = 'Too many parts';
      break;
    case 'LIMIT_FIELD_KEY':
      message = 'Field name too long';
      break;
    case 'LIMIT_FIELD_VALUE':
      message = 'Field value too long';
      break;
    case 'LIMIT_FIELD_COUNT':
      message = 'Too many fields';
      break;
    default:
      message = error.message || 'File upload error';
  }

  const errorResponse: ErrorResponse = {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message,
      details: { multerCode: error.code }
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(400).json(errorResponse);
}

/**
 * Handle unknown errors
 */
function handleUnknownError(error: Error, req: Request, res: Response): void {
  const errorResponse: ErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(500).json(errorResponse);
}

/**
 * Log errors for monitoring and debugging
 */
function logError(error: Error, req: Request): void {
  const logData = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    request: {
      method: req.method,
      path: req.path,
      query: req.query,
      params: req.params,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: (req as any).user?.id
    }
  };

  // Don't log sensitive information
  if (req.body) {
    const sanitizedBody = { ...req.body };
    delete sanitizedBody.password;
    delete sanitizedBody.token;
    (logData.request as any)['body'] = sanitizedBody;
  }

  // Log based on error severity
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      console.error('Server Error:', JSON.stringify(logData, null, 2));
    } else if (error.statusCode >= 400) {
      console.warn('Client Error:', JSON.stringify(logData, null, 2));
    }
  } else {
    console.error('Unexpected Error:', JSON.stringify(logData, null, 2));
  }

  // In production, you might want to send errors to a monitoring service
  if (process.env.NODE_ENV === 'production') {
    // Example: Send to monitoring service
    // monitoringService.reportError(error, logData);
  }
}

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const errorResponse: ErrorResponse = {
    error: {
      code: ErrorCode.NOT_FOUND,
      message: 'Endpoint not found'
    },
    timestamp: new Date().toISOString(),
    path: req.path
  };

  res.status(404).json(errorResponse);
};

/**
 * Async error wrapper - catches async errors and passes them to error handler
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation error helper
 */
export const createValidationError = (message: string, details?: any): ValidationError => {
  return new ValidationError(message, details);
};

/**
 * Authentication error helper
 */
export const createAuthError = (message?: string, details?: any): AuthenticationError => {
  return new AuthenticationError(message, details);
};

/**
 * Authorization error helper
 */
export const createAuthzError = (message?: string, details?: any): AuthorizationError => {
  return new AuthorizationError(message, details);
};

/**
 * Not found error helper
 */
export const createNotFoundError = (message?: string, details?: any): NotFoundError => {
  return new NotFoundError(message, details);
};

/**
 * Usage limit error helper
 */
export const createUsageLimitError = (message?: string, details?: any): UsageLimitError => {
  return new UsageLimitError(message, details);
};

/**
 * External service error helper
 */
export const createExternalServiceError = (message?: string, details?: any): ExternalServiceError => {
  return new ExternalServiceError(message, details);
};

/**
 * Circuit breaker for external services with enhanced monitoring
 * Requirements: 8.3
 */
export class CircuitBreaker {
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private halfOpenAttempts: number = 0;

  constructor(
    private name: string,
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000, // 1 minute
    private halfOpenMaxAttempts: number = 3,
    private successThreshold: number = 2
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        console.log(`Circuit breaker ${this.name}: Transitioning to HALF_OPEN`);
      } else {
        throw new ExternalServiceError(`Service ${this.name} temporarily unavailable (circuit breaker OPEN)`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
      throw new ExternalServiceError(`Service ${this.name} temporarily unavailable (circuit breaker HALF_OPEN limit reached)`);
    }

    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      this.onSuccess(duration);
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private onSuccess(duration?: number): void {
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      if (this.successes >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        console.log(`Circuit breaker ${this.name}: Transitioning to CLOSED after successful recovery`);
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on successful operations
      this.failures = Math.max(0, this.failures - 1);
    }

    // Log performance metrics
    if (duration && duration > 5000) { // Log slow operations
      console.warn(`Circuit breaker ${this.name}: Slow operation detected (${duration}ms)`);
    }
  }

  private onFailure(error: Error): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    console.error(`Circuit breaker ${this.name}: Operation failed`, {
      error: error.message,
      failures: this.failures,
      state: this.state
    });

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.log(`Circuit breaker ${this.name}: Transitioning to OPEN from HALF_OPEN after failure`);
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(`Circuit breaker ${this.name}: Transitioning to OPEN after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  getSuccesses(): number {
    return this.successes;
  }

  getMetrics(): {
    name: string;
    state: string;
    failures: number;
    successes: number;
    lastFailureTime: number;
    lastSuccessTime: number;
    uptime: number;
  } {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      uptime: this.state === 'CLOSED' ? Date.now() - this.lastFailureTime : 0
    };
  }

  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.state = 'CLOSED';
    this.halfOpenAttempts = 0;
    console.log(`Circuit breaker ${this.name}: Manual reset to CLOSED state`);
  }
}

/**
 * Enhanced retry wrapper with exponential backoff and jitter
 * Requirements: 8.3
 */
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    jitterMax?: number;
    retryCondition?: (error: Error) => boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> => {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitterMax = 1000,
    retryCondition = () => true,
    onRetry
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!retryCondition(lastError)) {
        break;
      }

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
      const jitter = Math.random() * jitterMax;
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
        error: lastError.message,
        attempt: attempt + 1,
        delay
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
};

/**
 * Graceful degradation manager for handling service failures
 * Requirements: 7.3, 8.3
 */
export class GracefulDegradationManager {
  private static instance: GracefulDegradationManager;
  private degradationStates: Map<string, {
    isActive: boolean;
    startTime: number;
    reason: string;
    fallbackStrategy: string;
  }> = new Map();

  static getInstance(): GracefulDegradationManager {
    if (!GracefulDegradationManager.instance) {
      GracefulDegradationManager.instance = new GracefulDegradationManager();
    }
    return GracefulDegradationManager.instance;
  }

  /**
   * Activate degraded mode for a service
   */
  activateDegradation(serviceName: string, reason: string, fallbackStrategy: string): void {
    this.degradationStates.set(serviceName, {
      isActive: true,
      startTime: Date.now(),
      reason,
      fallbackStrategy
    });

    console.warn(`Graceful degradation activated for ${serviceName}`, {
      reason,
      fallbackStrategy,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Deactivate degraded mode for a service
   */
  deactivateDegradation(serviceName: string): void {
    const state = this.degradationStates.get(serviceName);
    if (state) {
      const duration = Date.now() - state.startTime;
      console.log(`Graceful degradation deactivated for ${serviceName}`, {
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
    }

    this.degradationStates.delete(serviceName);
  }

  /**
   * Check if service is in degraded mode
   */
  isDegraded(serviceName: string): boolean {
    return this.degradationStates.has(serviceName);
  }

  /**
   * Get degradation state for a service
   */
  getDegradationState(serviceName: string) {
    return this.degradationStates.get(serviceName);
  }

  /**
   * Get all active degradations
   */
  getActiveDegradations(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [serviceName, state] of this.degradationStates.entries()) {
      result[serviceName] = {
        ...state,
        duration: Date.now() - state.startTime
      };
    }
    return result;
  }
}

/**
 * File operation error recovery manager
 * Requirements: 7.3, 7.5
 */
export class FileOperationRecovery {
  private static instance: FileOperationRecovery;
  private pendingOperations: Map<string, {
    operation: () => Promise<any>;
    retryCount: number;
    maxRetries: number;
    lastAttempt: number;
  }> = new Map();

  static getInstance(): FileOperationRecovery {
    if (!FileOperationRecovery.instance) {
      FileOperationRecovery.instance = new FileOperationRecovery();
    }
    return FileOperationRecovery.instance;
  }

  /**
   * Execute file operation with automatic recovery
   */
  async executeWithRecovery<T>(
    operationId: string,
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      cleanupOnFailure?: () => Promise<void>;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 2000, cleanupOnFailure } = options;

    try {
      const result = await operation();
      
      // Remove from pending operations on success
      this.pendingOperations.delete(operationId);
      
      return result;
    } catch (error) {
      console.error(`File operation ${operationId} failed`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt: 1
      });

      // Add to pending operations for retry
      this.pendingOperations.set(operationId, {
        operation,
        retryCount: 1,
        maxRetries,
        lastAttempt: Date.now()
      });

      // Attempt cleanup if provided
      if (cleanupOnFailure) {
        try {
          await cleanupOnFailure();
        } catch (cleanupError) {
          console.error(`Cleanup failed for operation ${operationId}`, cleanupError);
        }
      }

      // Schedule retry
      setTimeout(() => this.retryOperation(operationId, retryDelay), retryDelay);

      throw error;
    }
  }

  /**
   * Retry a failed operation
   */
  private async retryOperation(operationId: string, retryDelay: number): Promise<void> {
    const pendingOp = this.pendingOperations.get(operationId);
    if (!pendingOp) {
      return;
    }

    if (pendingOp.retryCount >= pendingOp.maxRetries) {
      console.error(`File operation ${operationId} failed after ${pendingOp.maxRetries} retries`);
      this.pendingOperations.delete(operationId);
      return;
    }

    try {
      await pendingOp.operation();
      
      console.log(`File operation ${operationId} succeeded on retry ${pendingOp.retryCount}`);
      this.pendingOperations.delete(operationId);
    } catch (error) {
      pendingOp.retryCount++;
      pendingOp.lastAttempt = Date.now();

      console.warn(`File operation ${operationId} retry ${pendingOp.retryCount} failed`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (pendingOp.retryCount < pendingOp.maxRetries) {
        // Schedule next retry with exponential backoff
        const nextDelay = retryDelay * Math.pow(2, pendingOp.retryCount - 1);
        setTimeout(() => this.retryOperation(operationId, nextDelay), nextDelay);
      } else {
        this.pendingOperations.delete(operationId);
      }
    }
  }

  /**
   * Get pending operations status
   */
  getPendingOperations(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [operationId, operation] of this.pendingOperations.entries()) {
      result[operationId] = {
        retryCount: operation.retryCount,
        maxRetries: operation.maxRetries,
        lastAttempt: operation.lastAttempt,
        nextRetryIn: this.calculateNextRetryTime(operation)
      };
    }
    return result;
  }

  private calculateNextRetryTime(operation: { retryCount: number; lastAttempt: number }): number {
    const baseDelay = 2000;
    const nextDelay = baseDelay * Math.pow(2, operation.retryCount - 1);
    const elapsed = Date.now() - operation.lastAttempt;
    return Math.max(0, nextDelay - elapsed);
  }
}

/**
 * Error classification and response manager
 * Requirements: 7.3, 8.3, 8.5
 */
export class ErrorClassificationManager {
  private static instance: ErrorClassificationManager;
  private errorPatterns: Map<string, {
    pattern: RegExp;
    classification: string;
    retryable: boolean;
    degradationStrategy?: string;
  }> = new Map();

  static getInstance(): ErrorClassificationManager {
    if (!ErrorClassificationManager.instance) {
      ErrorClassificationManager.instance = new ErrorClassificationManager();
      ErrorClassificationManager.instance.initializePatterns();
    }
    return ErrorClassificationManager.instance;
  }

  private initializePatterns(): void {
    // Network errors
    this.addPattern('network_timeout', /timeout|ETIMEDOUT|ECONNRESET/i, 'network', true, 'retry_with_backoff');
    this.addPattern('network_connection', /ECONNREFUSED|ENOTFOUND|ENETUNREACH/i, 'network', true, 'circuit_breaker');
    
    // OpenAI API errors
    this.addPattern('openai_rate_limit', /rate limit|429/i, 'rate_limit', true, 'exponential_backoff');
    this.addPattern('openai_quota', /quota|billing/i, 'quota', false, 'graceful_degradation');
    this.addPattern('openai_server', /5\d{2}|server error/i, 'server_error', true, 'circuit_breaker');
    
    // S3 errors
    this.addPattern('s3_access', /access denied|403/i, 'access', false, 'alert_admin');
    this.addPattern('s3_not_found', /not found|404/i, 'not_found', false, 'create_if_missing');
    this.addPattern('s3_throttle', /slow down|503/i, 'throttle', true, 'exponential_backoff');
    
    // Database errors
    this.addPattern('db_connection', /connection|ECONNREFUSED/i, 'database', true, 'connection_pool_reset');
    this.addPattern('db_timeout', /timeout|query timeout/i, 'database', true, 'query_optimization');
    this.addPattern('db_constraint', /constraint|unique|foreign key/i, 'validation', false, 'data_validation');
  }

  addPattern(
    name: string, 
    pattern: RegExp, 
    classification: string, 
    retryable: boolean, 
    degradationStrategy?: string
  ): void {
    this.errorPatterns.set(name, {
      pattern,
      classification,
      retryable,
      degradationStrategy
    });
  }

  classifyError(error: Error): {
    classification: string;
    retryable: boolean;
    degradationStrategy?: string;
    matchedPattern?: string;
  } {
    const errorMessage = error.message || error.toString();
    
    for (const [name, config] of this.errorPatterns.entries()) {
      if (config.pattern.test(errorMessage)) {
        return {
          classification: config.classification,
          retryable: config.retryable,
          degradationStrategy: config.degradationStrategy,
          matchedPattern: name
        };
      }
    }

    // Default classification for unknown errors
    return {
      classification: 'unknown',
      retryable: false
    };
  }
}

/**
 * Comprehensive error handler with recovery strategies
 * Requirements: 7.3, 7.5, 8.3, 8.5
 */
export const handleErrorWithRecovery = async (
  error: Error,
  context: {
    operation: string;
    serviceName?: string;
    userId?: string;
    sessionId?: string;
    retryable?: boolean;
  }
): Promise<{
  shouldRetry: boolean;
  degradationActivated: boolean;
  recoveryAction?: string;
}> => {
  const classifier = ErrorClassificationManager.getInstance();
  const degradationManager = GracefulDegradationManager.getInstance();
  
  const classification = classifier.classifyError(error);
  
  console.error(`Error in ${context.operation}`, {
    error: error.message,
    classification: classification.classification,
    retryable: classification.retryable,
    context
  });

  let degradationActivated = false;
  let recoveryAction: string | undefined;

  // Apply degradation strategy if needed
  if (classification.degradationStrategy && context.serviceName) {
    switch (classification.degradationStrategy) {
      case 'circuit_breaker':
        degradationManager.activateDegradation(
          context.serviceName,
          `Circuit breaker activated due to ${classification.classification} error`,
          'Circuit breaker pattern with exponential backoff'
        );
        degradationActivated = true;
        recoveryAction = 'circuit_breaker_activated';
        break;

      case 'graceful_degradation':
        degradationManager.activateDegradation(
          context.serviceName,
          `Service degraded due to ${classification.classification} error`,
          'Limited functionality mode'
        );
        degradationActivated = true;
        recoveryAction = 'service_degraded';
        break;

      case 'exponential_backoff':
        recoveryAction = 'exponential_backoff';
        break;

      case 'alert_admin':
        // In a real system, this would send an alert to administrators
        console.error(`ADMIN ALERT: Critical error in ${context.serviceName}`, {
          error: error.message,
          context
        });
        recoveryAction = 'admin_alerted';
        break;
    }
  }

  return {
    shouldRetry: classification.retryable && (context.retryable !== false),
    degradationActivated,
    recoveryAction
  };
};