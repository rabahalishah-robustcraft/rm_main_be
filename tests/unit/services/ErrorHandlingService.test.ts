import { ErrorHandlingService } from '../../../src/services/ErrorHandlingService';
import { 
  CircuitBreaker, 
  GracefulDegradationManager,
  ErrorClassificationManager 
} from '../../../src/middleware/error';

describe('ErrorHandlingService', () => {
  let errorHandlingService: ErrorHandlingService;

  beforeEach(() => {
    errorHandlingService = ErrorHandlingService.getInstance();
  });

  describe('Circuit Breaker Management', () => {
    it('should execute operation with circuit breaker protection', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await errorHandlingService.executeWithCircuitBreaker(
        'openai',
        mockOperation
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should use fallback when circuit breaker is open', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const mockFallback = jest.fn().mockResolvedValue('fallback result');
      
      // Force circuit breaker to open by causing multiple failures
      for (let i = 0; i < 6; i++) {
        try {
          await errorHandlingService.executeWithCircuitBreaker('openai', mockOperation);
        } catch (error) {
          // Expected to fail
        }
      }

      const result = await errorHandlingService.executeWithCircuitBreaker(
        'openai',
        mockOperation,
        mockFallback
      );

      expect(result).toBe('fallback result');
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should reset circuit breaker successfully', () => {
      const success = errorHandlingService.resetCircuitBreaker('openai');
      expect(success).toBe(true);
    });

    it('should return false when resetting non-existent circuit breaker', () => {
      const success = errorHandlingService.resetCircuitBreaker('nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('File Operation Recovery', () => {
    it('should execute file operation successfully', async () => {
      const mockOperation = jest.fn().mockResolvedValue('file uploaded');
      
      const result = await errorHandlingService.executeFileOperation(
        'test_upload',
        mockOperation
      );

      expect(result).toBe('file uploaded');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should execute cleanup on file operation failure', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Upload failed'));
      const mockCleanup = jest.fn().mockResolvedValue(undefined);
      
      try {
        await errorHandlingService.executeFileOperation(
          'test_upload_fail',
          mockOperation,
          { cleanupOnFailure: mockCleanup }
        );
      } catch (error) {
        // Expected to fail
      }

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('External API Operations', () => {
    it('should execute OpenAI operation with retry logic', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce('analysis complete');
      
      const result = await errorHandlingService.executeOpenAIOperation(
        mockOperation,
        'test_analysis'
      );

      expect(result).toBe('analysis complete');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should use fallback for OpenAI operation when service fails', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const mockFallback = jest.fn().mockResolvedValue('fallback analysis');
      
      // Force circuit breaker to open
      for (let i = 0; i < 6; i++) {
        try {
          await errorHandlingService.executeOpenAIOperation(mockOperation, 'test_fail');
        } catch (error) {
          // Expected to fail
        }
      }

      const result = await errorHandlingService.executeOpenAIOperation(
        mockOperation,
        'test_fallback',
        mockFallback
      );

      expect(result).toBe('fallback analysis');
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should execute S3 operation with error handling', async () => {
      const mockOperation = jest.fn().mockResolvedValue('file stored');
      
      const result = await errorHandlingService.executeS3Operation(
        mockOperation,
        'test_s3_upload'
      );

      expect(result).toBe('file stored');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should execute database operation with retry logic', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce('data saved');
      
      const result = await errorHandlingService.executeDatabaseOperation(
        mockOperation,
        'test_db_save'
      );

      expect(result).toBe('data saved');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });
  });

  describe('System Health Monitoring', () => {
    it('should return system health status', () => {
      const health = errorHandlingService.getSystemHealth();
      
      expect(health).toHaveProperty('circuitBreakers');
      expect(health).toHaveProperty('degradations');
      expect(health).toHaveProperty('pendingFileOperations');
      expect(health).toHaveProperty('overallStatus');
      expect(['healthy', 'degraded', 'critical']).toContain(health.overallStatus);
    });

    it('should classify errors correctly', () => {
      const networkError = new Error('ECONNRESET: Connection reset by peer');
      const classification = errorHandlingService.classifyError(networkError);
      
      expect(classification.classification).toBe('network');
      expect(classification.retryable).toBe(true);
    });

    it('should deactivate degradation for service', () => {
      // First activate degradation
      const degradationManager = GracefulDegradationManager.getInstance();
      degradationManager.activateDegradation('test-service', 'Test reason', 'Test strategy');
      
      // Then deactivate it
      errorHandlingService.deactivateDegradation('test-service');
      
      expect(degradationManager.isDegraded('test-service')).toBe(false);
    });
  });

  describe('Error Pattern Management', () => {
    it('should add custom error pattern', () => {
      errorHandlingService.addErrorPattern(
        'custom_test',
        /test error/i,
        'test_classification',
        true,
        'test_strategy'
      );

      const testError = new Error('This is a test error');
      const classification = errorHandlingService.classifyError(testError);
      
      expect(classification.classification).toBe('test_classification');
      expect(classification.retryable).toBe(true);
      expect(classification.degradationStrategy).toBe('test_strategy');
    });
  });

  describe('Retry with Exponential Backoff', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on first attempt without retries', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_operation'
      });

      const result = await promise;

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry with 1s, 2s, 4s delays on retryable errors', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('500 Server Error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_retry',
        onRetry
      });

      // Fast-forward through all timers
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(4);
      expect(onRetry).toHaveBeenCalledTimes(3);
      
      // Verify delays: 1000ms, 2000ms, 4000ms
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 1000);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 2000);
      expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 4000);
    });

    it('should throw error after all retries exhausted', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('500 Server Error'));
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_fail'
      });

      // Fast-forward through all timers
      const runTimers = jest.runAllTimersAsync();

      await expect(promise).rejects.toThrow('500 Server Error');
      await runTimers;
      
      // Should attempt 4 times total (initial + 3 retries)
      expect(mockOperation).toHaveBeenCalledTimes(4);
    });

    it('should not retry on non-retryable errors', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('404 Not Found'));
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_non_retryable'
      });

      await expect(promise).rejects.toThrow('404 Not Found');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should respect Retry-After header from OpenAI rate limits', async () => {
      const rateLimitError: any = new Error('Rate limit exceeded');
      rateLimitError.response = {
        headers: {
          'retry-after': '5'
        }
      };

      const mockOperation = jest.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_retry_after',
        onRetry
      });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(2);
      
      // Should use Retry-After value (5 seconds = 5000ms) instead of default 1000ms
      expect(onRetry).toHaveBeenCalledWith(1, rateLimitError, 5000);
    });

    it('should use custom isRetryable function when provided', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Custom error'));
      
      const customIsRetryable = jest.fn().mockReturnValue(false);
      
      const promise = errorHandlingService.retryWithBackoff(mockOperation, {
        operationName: 'test_custom_retryable',
        isRetryable: customIsRetryable
      });

      await expect(promise).rejects.toThrow('Custom error');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(customIsRetryable).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('S3 Error Classification', () => {
    it('should classify 500 and 503 as retryable', () => {
      const error500: any = new Error('Internal Server Error');
      error500.statusCode = 500;
      
      const error503: any = new Error('Service Unavailable');
      error503.statusCode = 503;

      expect(errorHandlingService.isRetryableS3Error(error500)).toBe(true);
      expect(errorHandlingService.isRetryableS3Error(error503)).toBe(true);
    });

    it('should classify 400, 403, 404 as non-retryable', () => {
      const error400: any = new Error('Bad Request');
      error400.statusCode = 400;
      
      const error403: any = new Error('Access Denied');
      error403.statusCode = 403;
      
      const error404: any = new Error('Not Found');
      error404.statusCode = 404;

      expect(errorHandlingService.isRetryableS3Error(error400)).toBe(false);
      expect(errorHandlingService.isRetryableS3Error(error403)).toBe(false);
      expect(errorHandlingService.isRetryableS3Error(error404)).toBe(false);
    });

    it('should classify throttling errors as retryable', () => {
      const throttleError = new Error('SlowDown: Please reduce your request rate');
      
      expect(errorHandlingService.isRetryableS3Error(throttleError)).toBe(true);
    });

    it('should handle AWS SDK error format with $metadata', () => {
      const awsError: any = new Error('Service error');
      awsError.$metadata = {
        httpStatusCode: 503
      };

      expect(errorHandlingService.isRetryableS3Error(awsError)).toBe(true);
    });
  });
});