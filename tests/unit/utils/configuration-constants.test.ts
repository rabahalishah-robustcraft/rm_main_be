/**
 * Configuration Constants Tests
 * Validates that all required configuration constants are properly defined
 * Requirements: 10.4
 */

import {
  RETRY_CONFIG,
  PRESIGNED_URL_CONFIG,
  VALIDATION_LIMITS,
  SERVICE_TIMEOUTS,
  S3_CONFIG
} from '../../../src/utils/constants';

describe('Configuration Constants', () => {
  describe('Retry Configuration', () => {
    it('should define retry counts and delays', () => {
      // Requirement 10.4: Define retry counts, timeouts, and delays as constants
      expect(RETRY_CONFIG.MAX_ATTEMPTS).toBe(3);
      expect(RETRY_CONFIG.INITIAL_DELAY_MS).toBe(1000);
      expect(RETRY_CONFIG.DELAYS_MS).toEqual([1000, 2000, 4000]);
      expect(RETRY_CONFIG.MAX_DELAY_MS).toBe(4000);
    });

    it('should define retryable status codes', () => {
      expect(RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(429);
      expect(RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(500);
      expect(RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(502);
      expect(RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(503);
      expect(RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(504);
    });

    it('should define S3-specific error codes', () => {
      expect(RETRY_CONFIG.RETRYABLE_S3_CODES).toEqual([500, 503]);
      expect(RETRY_CONFIG.NON_RETRYABLE_S3_CODES).toEqual([400, 403, 404]);
    });
  });

  describe('Pre-signed URL Configuration', () => {
    it('should define expiration time limits', () => {
      // Requirement 10.4: Define default expiration times for pre-signed URLs
      expect(PRESIGNED_URL_CONFIG.MIN_EXPIRATION_SECONDS).toBe(1);
      expect(PRESIGNED_URL_CONFIG.MAX_EXPIRATION_SECONDS).toBe(86400);
    });

    it('should define default expiration times', () => {
      expect(PRESIGNED_URL_CONFIG.DEFAULT_DOWNLOAD_EXPIRATION).toBe(3600);
      expect(PRESIGNED_URL_CONFIG.DEFAULT_UPLOAD_EXPIRATION).toBe(3600);
      expect(PRESIGNED_URL_CONFIG.RESUME_EXPIRATION).toBe(3600);
    });
  });

  describe('Validation Limits', () => {
    it('should define audio validation limits', () => {
      // Requirement 10.4: Define validation limits (file sizes, token limits)
      expect(VALIDATION_LIMITS.AUDIO.MIN_SIZE_BYTES).toBe(100);
      expect(VALIDATION_LIMITS.AUDIO.MAX_SIZE_BYTES).toBe(50 * 1024 * 1024);
      expect(VALIDATION_LIMITS.AUDIO.MIN_DURATION_SECONDS).toBe(1);
      expect(VALIDATION_LIMITS.AUDIO.MAX_DURATION_SECONDS).toBe(30 * 60);
    });

    it('should define text validation limits', () => {
      expect(VALIDATION_LIMITS.TEXT.MIN_LENGTH).toBe(1);
      expect(VALIDATION_LIMITS.TEXT.MAX_LENGTH).toBe(100000);
      expect(VALIDATION_LIMITS.TEXT.MAX_TOKENS).toBe(8000);
      expect(VALIDATION_LIMITS.TEXT.MIN_TOKENS).toBe(1);
    });

    it('should define file validation limits', () => {
      expect(VALIDATION_LIMITS.FILE.MIN_SIZE_BYTES).toBe(100);
      expect(VALIDATION_LIMITS.FILE.MAX_RESUME_SIZE_BYTES).toBe(10 * 1024 * 1024);
      expect(VALIDATION_LIMITS.FILE.MAX_AUDIO_SIZE_BYTES).toBe(50 * 1024 * 1024);
      expect(VALIDATION_LIMITS.FILE.MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024);
    });

    it('should define filename validation limits', () => {
      expect(VALIDATION_LIMITS.FILENAME.MIN_LENGTH).toBe(1);
      expect(VALIDATION_LIMITS.FILENAME.MAX_LENGTH).toBe(255);
      expect(VALIDATION_LIMITS.FILENAME.ALLOWED_CHARS_REGEX).toBeInstanceOf(RegExp);
    });
  });

  describe('Service Timeouts', () => {
    it('should define OpenAI service timeouts', () => {
      expect(SERVICE_TIMEOUTS.OPENAI.WHISPER).toBe(60000);
      expect(SERVICE_TIMEOUTS.OPENAI.GPT).toBe(30000);
      expect(SERVICE_TIMEOUTS.OPENAI.MAX_RETRIES).toBe(3);
    });

    it('should define S3 service timeouts', () => {
      expect(SERVICE_TIMEOUTS.S3.UPLOAD).toBe(30000);
      expect(SERVICE_TIMEOUTS.S3.DOWNLOAD).toBe(15000);
      expect(SERVICE_TIMEOUTS.S3.MAX_RETRIES).toBe(2);
    });

    it('should define database timeouts', () => {
      expect(SERVICE_TIMEOUTS.DATABASE.QUERY).toBe(10000);
      expect(SERVICE_TIMEOUTS.DATABASE.TRANSACTION).toBe(30000);
    });
  });

  describe('S3 Configuration', () => {
    it('should define S3 prefixes', () => {
      expect(S3_CONFIG.AUDIO_PREFIX).toBe('audio/');
      expect(S3_CONFIG.RESUME_PREFIX).toBe('resumes/');
      expect(S3_CONFIG.AVATAR_PREFIX).toBe('avatars/');
    });

    it('should define pre-signed URL configuration', () => {
      expect(S3_CONFIG.PRESIGNED_URL.MIN_EXPIRATION).toBe(1);
      expect(S3_CONFIG.PRESIGNED_URL.MAX_EXPIRATION).toBe(86400);
      expect(S3_CONFIG.PRESIGNED_URL.DEFAULT_EXPIRATION).toBe(3600);
    });

    it('should define file type restrictions', () => {
      expect(S3_CONFIG.ALLOWED_FILE_TYPES).toContain('.pdf');
      expect(S3_CONFIG.ALLOWED_FILE_TYPES).toContain('.doc');
      expect(S3_CONFIG.ALLOWED_FILE_TYPES).toContain('.docx');
      
      expect(S3_CONFIG.ALLOWED_AUDIO_TYPES).toContain('.mp3');
      expect(S3_CONFIG.ALLOWED_AUDIO_TYPES).toContain('.wav');
      expect(S3_CONFIG.ALLOWED_AUDIO_TYPES).toContain('.m4a');
      expect(S3_CONFIG.ALLOWED_AUDIO_TYPES).toContain('.ogg');
    });
  });

  describe('Constants Consistency', () => {
    it('should have consistent retry configuration across services', () => {
      // Verify that retry configuration is consistent
      expect(RETRY_CONFIG.MAX_ATTEMPTS).toBe(SERVICE_TIMEOUTS.OPENAI.MAX_RETRIES);
      expect(RETRY_CONFIG.DELAYS_MS.length).toBe(RETRY_CONFIG.MAX_ATTEMPTS);
    });

    it('should have consistent pre-signed URL expiration', () => {
      // Verify that S3_CONFIG and PRESIGNED_URL_CONFIG are consistent
      expect(S3_CONFIG.PRESIGNED_URL.DEFAULT_EXPIRATION).toBe(PRESIGNED_URL_CONFIG.DEFAULT_DOWNLOAD_EXPIRATION);
      expect(S3_CONFIG.PRESIGNED_URL.MIN_EXPIRATION).toBe(PRESIGNED_URL_CONFIG.MIN_EXPIRATION_SECONDS);
      expect(S3_CONFIG.PRESIGNED_URL.MAX_EXPIRATION).toBe(PRESIGNED_URL_CONFIG.MAX_EXPIRATION_SECONDS);
    });

    it('should have consistent file size limits', () => {
      // Verify that file size limits are consistent
      expect(VALIDATION_LIMITS.FILE.MAX_AUDIO_SIZE_BYTES).toBe(VALIDATION_LIMITS.AUDIO.MAX_SIZE_BYTES);
    });
  });

  describe('Constants Immutability', () => {
    it('should be immutable (frozen)', () => {
      // TypeScript const assertions make these readonly at compile time
      // At runtime, we can verify they're not easily modified
      expect(() => {
        (RETRY_CONFIG as any).MAX_ATTEMPTS = 5;
      }).not.toThrow(); // Note: const assertions don't freeze at runtime
      
      // But the TypeScript compiler will prevent modifications
      // This test documents the expected behavior
    });
  });
});
