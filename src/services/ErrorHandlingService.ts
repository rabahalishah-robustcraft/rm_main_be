import { 
  CircuitBreaker, 
  GracefulDegradationManager, 
  FileOperationRecovery,
  ErrorClassificationManager,
  handleErrorWithRecovery,
  withRetry
} from '../middleware/error';

/**
 * Comprehensive Error Handling Service
 * Provides centralized error management with circuit breakers, graceful degradation,
 * and file operation recovery
 * Requirements: 7.3, 7.5, 8.3, 8.5
 */
export class ErrorHandlingService {
  private static instance: ErrorHandlingService;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private degradationManager: GracefulDegradationManager;
  private fileRecovery: FileOperationRecovery;
  private errorClassifier: ErrorClassificationManager;

  private constructor() {
    this.degradationManager = GracefulDegradationManager.getInstance();
    this.fileRecovery = FileOperationRecovery.getInstance();
    this.errorClassifier = ErrorClassificationManager.getInstance();
    this.initializeCircuitBreakers();
  }

  static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  /**
   * Initialize circuit breakers for external services
   */
  private initializeCircuitBreakers(): void {
    // OpenAI API circuit breaker
    this.circuitBreakers.set('openai', new CircuitBreaker(
      'OpenAI API',
      5, // failure threshold
      60000, // recovery timeout (1 minute)
      3, // half-open max attempts
      2 // success threshold
    ));

    // S3 service circuit breaker
    this.circuitBreakers.set('s3', new CircuitBreaker(
      'AWS S3',
      3, // failure threshold (lower for file operations)
      30000, // recovery timeout (30 seconds)
      2, // half-open max attempts
      1 // success threshold
    ));

    // Database circuit breaker
    this.circuitBreakers.set('database', new CircuitBreaker(
      'Database',
      10, // failure threshold (higher for database)
      120000, // recovery timeout (2 minutes)
      5, // half-open max attempts
      3 // success threshold
    ));
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async executeWithCircuitBreaker<T>(
    serviceName: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    
    if (!circuitBreaker) {
      throw new Error(`No circuit breaker configured for service: ${serviceName}`);
    }

    try {
      return await circuitBreaker.execute(operation);
    } catch (error) {
      // If circuit breaker is open and fallback is available, use fallback
      if (circuitBreaker.getState() === 'OPEN' && fallback) {
        console.warn(`Using fallback for ${serviceName} due to circuit breaker OPEN state`);
        
        this.degradationManager.activateDegradation(
          serviceName,
          'Circuit breaker open, using fallback',
          'Fallback operation'
        );

        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Execute file operation with comprehensive error recovery
   */
  async executeFileOperation<T>(
    operationId: string,
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      cleanupOnFailure?: () => Promise<void>;
      fallback?: () => Promise<T>;
    } = {}
  ): Promise<T> {
    try {
      return await this.fileRecovery.executeWithRecovery(
        operationId,
        operation,
        options
      );
    } catch (error) {
      const recovery = await handleErrorWithRecovery(error as Error, {
        operation: 'file_operation',
        serviceName: 's3'
      });

      if (recovery.degradationActivated && options.fallback) {
        console.warn(`Using fallback for file operation ${operationId}`);
        return await options.fallback();
      }

      throw error;
    }
  }

  /**
   * Execute external API call with comprehensive error handling
   */
  async executeExternalApiCall<T>(
    serviceName: string,
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryCondition?: (error: Error) => boolean;
      fallback?: () => Promise<T>;
      operationId?: string;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, retryCondition, fallback, operationId } = options;

    return await withRetry(
      async () => {
        return await this.executeWithCircuitBreaker(
          serviceName,
          operation,
          fallback
        );
      },
      {
        maxRetries,
        retryCondition: retryCondition || ((error: Error) => {
          const classification = this.errorClassifier.classifyError(error);
          return classification.retryable;
        }),
        onRetry: (attempt: number, error: Error) => {
          console.warn(`Retrying ${serviceName} operation`, {
            attempt,
            error: error.message,
            operationId
          });
        }
      }
    );
  }

  /**
   * Handle OpenAI API operations with specialized error handling
   * Requirements: 1.4, 1.5, 2.5, 2.6
   */
  async executeOpenAIOperation<T>(
    operation: () => Promise<T>,
    operationId: string,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      // Use retryWithBackoff for OpenAI operations with 1s, 2s, 4s delays
      return await this.retryWithBackoff(
        () => this.executeWithCircuitBreaker('openai', operation),
        {
          operationName: operationId,
          isRetryable: (error: Error) => {
            // Retry on rate limits and server errors, but not on quota/auth errors
            const message = error.message.toLowerCase();
            return message.includes('rate limit') || 
                   message.includes('timeout') ||
                   message.includes('server error') ||
                   /5\d{2}/.test(message);
          },
          onRetry: (attempt: number, error: Error, delay: number) => {
            console.warn(`Retrying OpenAI operation ${operationId}`, {
              attempt,
              error: error.message,
              delayMs: delay
            });
          }
        }
      );
    } catch (error) {
      // If all retries fail and fallback is provided, use fallback
      if (fallback) {
        console.warn(`All retries failed for OpenAI operation ${operationId}, using fallback`);
        
        this.degradationManager.activateDegradation(
          'openai',
          `All retries exhausted for ${operationId}`,
          'Fallback operation'
        );

        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Handle S3 operations with specialized error handling
   * Requirements: 2.5, 2.6
   */
  async executeS3Operation<T>(
    operation: () => Promise<T>,
    operationId: string,
    cleanupOnFailure?: () => Promise<void>
  ): Promise<T> {
    try {
      // Use retryWithBackoff for S3 operations with 1s, 2s, 4s delays
      return await this.retryWithBackoff(
        () => this.executeWithCircuitBreaker('s3', operation),
        {
          operationName: operationId,
          isRetryable: (error: Error) => this.isRetryableS3Error(error),
          onRetry: (attempt: number, error: Error, delay: number) => {
            console.warn(`Retrying S3 operation ${operationId}`, {
              attempt,
              error: error.message,
              delayMs: delay
            });
          }
        }
      );
    } catch (error) {
      // If all retries fail and cleanup is provided, attempt cleanup
      if (cleanupOnFailure) {
        try {
          await cleanupOnFailure();
          console.log(`Cleanup completed for failed S3 operation ${operationId}`);
        } catch (cleanupError) {
          console.error(`Cleanup failed for S3 operation ${operationId}`, cleanupError);
        }
      }

      throw error;
    }
  }

  /**
   * Handle database operations with specialized error handling
   */
  async executeDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationId: string
  ): Promise<T> {
    return await this.executeExternalApiCall(
      'database',
      operation,
      {
        maxRetries: 2,
        retryCondition: (error: Error) => {
          const message = error.message.toLowerCase();
          // Retry on connection and timeout errors, but not on constraint violations
          return message.includes('connection') || 
                 message.includes('timeout') ||
                 message.includes('deadlock');
        },
        operationId
      }
    );
  }

  /**
   * Get comprehensive system health status
   */
  getSystemHealth(): {
    circuitBreakers: Record<string, any>;
    degradations: Record<string, any>;
    pendingFileOperations: Record<string, any>;
    overallStatus: 'healthy' | 'degraded' | 'critical';
  } {
    const circuitBreakers: Record<string, any> = {};
    let openCircuitBreakers = 0;

    for (const [name, breaker] of this.circuitBreakers.entries()) {
      const metrics = breaker.getMetrics();
      circuitBreakers[name] = metrics;
      
      if (metrics.state === 'OPEN') {
        openCircuitBreakers++;
      }
    }

    const degradations = this.degradationManager.getActiveDegradations();
    const pendingFileOperations = this.fileRecovery.getPendingOperations();

    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    if (openCircuitBreakers > 0 || Object.keys(degradations).length > 0) {
      overallStatus = 'degraded';
    }
    
    if (openCircuitBreakers >= 2 || Object.keys(pendingFileOperations).length > 5) {
      overallStatus = 'critical';
    }

    return {
      circuitBreakers,
      degradations,
      pendingFileOperations,
      overallStatus
    };
  }

  /**
   * Reset circuit breaker for a service
   */
  resetCircuitBreaker(serviceName: string): boolean {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (circuitBreaker) {
      circuitBreaker.reset();
      return true;
    }
    return false;
  }

  /**
   * Deactivate degradation for a service
   */
  deactivateDegradation(serviceName: string): void {
    this.degradationManager.deactivateDegradation(serviceName);
  }

  /**
   * Add custom error pattern for classification
   */
  addErrorPattern(
    name: string,
    pattern: RegExp,
    classification: string,
    retryable: boolean,
    degradationStrategy?: string
  ): void {
    this.errorClassifier.addPattern(name, pattern, classification, retryable, degradationStrategy);
  }

  /**
   * Classify an error
   */
  classifyError(error: Error) {
    return this.errorClassifier.classifyError(error);
  }

  /**
   * Retry operation with exponential backoff (1s, 2s, 4s)
   * Requirements: 7.1, 7.2, 7.4
   * 
   * @param operation - The async operation to retry
   * @param options - Retry configuration options
   * @returns The result of the operation
   * @throws The last error if all retries fail
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    options: {
      operationName?: string;
      isRetryable?: (error: Error) => boolean;
      onRetry?: (attempt: number, error: Error, delay: number) => void;
    } = {}
  ): Promise<T> {
    const delays = [1000, 2000, 4000]; // 1s, 2s, 4s as per requirement 7.2
    const maxAttempts = delays.length + 1; // 3 retries = 4 total attempts
    let lastError: Error;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // If this is the last attempt, throw the error
        if (attempt === maxAttempts - 1) {
          console.error(`Operation ${options.operationName || 'unknown'} failed after ${maxAttempts} attempts`, {
            error: lastError.message
          });
          throw lastError;
        }

        // Check if error is retryable
        const isRetryable = options.isRetryable 
          ? options.isRetryable(lastError)
          : this.isRetryableError(lastError);

        if (!isRetryable) {
          console.warn(`Operation ${options.operationName || 'unknown'} failed with non-retryable error`, {
            error: lastError.message
          });
          throw lastError;
        }

        // Calculate delay for this retry attempt
        let delay = delays[attempt];

        // Handle OpenAI rate limits with Retry-After header (requirement 7.4)
        const retryAfter = this.extractRetryAfter(lastError);
        if (retryAfter !== null) {
          delay = retryAfter * 1000; // Convert seconds to milliseconds
          console.log(`Respecting Retry-After header: ${retryAfter}s`);
        }

        // Log retry attempt
        console.warn(`Retrying operation ${options.operationName || 'unknown'} (attempt ${attempt + 1}/${maxAttempts - 1})`, {
          error: lastError.message,
          delayMs: delay,
          nextAttempt: attempt + 2
        });

        // Call retry callback if provided
        if (options.onRetry) {
          options.onRetry(attempt + 1, lastError, delay);
        }

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if an error is retryable based on error classification
   * Requirements: 7.1, 7.5
   */
  private isRetryableError(error: Error): boolean {
    const classification = this.errorClassifier.classifyError(error);
    
    // Use the classifier's retryable flag
    if (classification.retryable) {
      return true;
    }

    // Additional checks for specific error types
    const errorMessage = error.message.toLowerCase();
    
    // Retryable: Network errors, timeouts, server errors
    if (errorMessage.includes('timeout') ||
        errorMessage.includes('econnreset') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('etimedout')) {
      return true;
    }

    // Retryable: HTTP 5xx errors and 429 (rate limit)
    if (/5\d{2}/.test(errorMessage) || errorMessage.includes('429')) {
      return true;
    }

    // Retryable: OpenAI rate limits
    if (errorMessage.includes('rate limit') || errorMessage.includes('rate_limit')) {
      return true;
    }

    // Non-retryable: HTTP 4xx errors (except 429)
    if (/4[0-8]\d/.test(errorMessage) || errorMessage.includes('400') || 
        errorMessage.includes('401') || errorMessage.includes('403') || 
        errorMessage.includes('404')) {
      return false;
    }

    return false;
  }

  /**
   * Extract Retry-After header value from OpenAI rate limit errors
   * Requirements: 7.4
   */
  private extractRetryAfter(error: Error): number | null {
    // Check if error has a response object (common in API errors)
    const errorAny = error as any;
    
    // Try to extract from error response headers
    if (errorAny.response?.headers?.['retry-after']) {
      const retryAfter = errorAny.response.headers['retry-after'];
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return seconds;
      }
    }

    // Try to extract from error message
    const retryAfterMatch = error.message.match(/retry[_\s-]?after[:\s]+(\d+)/i);
    if (retryAfterMatch) {
      const seconds = parseInt(retryAfterMatch[1], 10);
      if (!isNaN(seconds) && seconds > 0) {
        return seconds;
      }
    }

    return null;
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if an S3 error is retryable
   * Requirements: 7.5
   */
  isRetryableS3Error(error: Error): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorAny = error as any;
    
    // Check status code if available
    const statusCode = errorAny.statusCode || errorAny.$metadata?.httpStatusCode;
    
    if (statusCode) {
      // Retryable: 500, 503
      if (statusCode === 500 || statusCode === 503) {
        return true;
      }
      
      // Non-retryable: 400, 403, 404
      if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
        return false;
      }
    }

    // Check error message for status codes
    if (errorMessage.includes('500') || errorMessage.includes('503')) {
      return true;
    }

    if (errorMessage.includes('400') || errorMessage.includes('403') || 
        errorMessage.includes('404') || errorMessage.includes('not found') ||
        errorMessage.includes('access denied')) {
      return false;
    }

    // Check for S3-specific retryable errors
    if (errorMessage.includes('slowdown') || errorMessage.includes('throttl')) {
      return true;
    }

    // Default to non-retryable for S3 errors to avoid unnecessary retries
    return false;
  }
}

// Export singleton instance
export const errorHandlingService = ErrorHandlingService.getInstance();