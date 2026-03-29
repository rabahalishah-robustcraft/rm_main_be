# Implementation Plan: Backend Production Upgrade

## Overview

This implementation plan upgrades backend services from mock implementations to production-ready code with real API integrations. The work is organized into discrete tasks that build incrementally, with testing integrated throughout to catch errors early.

## Tasks

- [x] 1. Install required dependencies for resume text extraction
  - Install `pdf-parse` library for PDF text extraction
  - Install `mammoth` library for DOC/DOCX text extraction
  - Update package.json and package-lock.json
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Create resume text extraction module
  - [x] 2.1 Implement TextExtractor interface and base classes
    - Create `src/services/ResumeTextExtractor.ts` file
    - Define TextExtractor interface with canHandle() and extract() methods
    - Implement PDFTextExtractor class using pdf-parse
    - Implement DOCXTextExtractor class using mammoth
    - _Requirements: 3.1, 3.2, 3.3_


- [x] 3. Update OpenAI Service for dual API keys
  - [x] 3.1 Modify OpenAI configuration to support dual API keys
    - Update OpenAIConfig interface to include gptApiKey and whisperApiKey
    - Update loadOpenAIConfig() to load both OPENAI_API_KEY and WHISPER_API_KEY
    - Update validateOpenAIConfig() to validate both keys
    - _Requirements: 1.1, 2.1, 10.3_

  - [x] 3.2 Create separate OpenAI client instances
    - Modify OpenAIService constructor to create gptClient and whisperClient
    - Update transcribeAudio() to use whisperClient
    - Update analyzeResponse() and extractResumeData() to use gptClient
    - _Requirements: 1.1, 1.2, 2.1, 2.2_


- [x] 4. Checkpoint - Ensure configuration and text extraction tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement resume processing in ProfileService
  - [x] 5.1 Replace mock resume processing with real implementation
    - Remove TODO comment and mock data generation
    - Integrate ResumeTextExtractor to extract text from file buffer
    - Call OpenAIService.extractResumeData() with extracted text
    - Validate extracted data structure before storing
    - Update profile with extracted skills and experience level
    - _Requirements: 3.4, 4.1, 4.2, 4.3, 4.4_

  - [x] 5.2 Add error handling and fallback logic
    - Wrap text extraction in try-catch with descriptive errors
    - Implement basic keyword extraction as fallback for GPT failures
    - Log errors and fallback usage
    - _Requirements: 3.5, 4.5, 8.4_


- [x] 6. Implement S3 pre-signed URL generation for uploads
  - [x] 6.1 Add generateUploadUrl method to S3Service
    - Create method signature with S3UploadUrlOptions parameter
    - Use AWS SDK's getSignedUrl with 'putObject' operation
    - Include content type and expiration in URL parameters
    - Return S3UploadUrlResult with URL, key, and required headers
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 6.2 Add upload verification method
    - Create verifyUpload() method that checks file existence
    - Use existing fileExists() method internally
    - _Requirements: 6.5_

  - [x] 6.3 Add validation for pre-signed URL parameters
    - Validate expiration time is between 1 and 86400 seconds
    - Validate content type is provided
    - Validate key is not empty
    - _Requirements: 5.2_

  -

- [x] 7. Checkpoint - Ensure resume processing and S3 tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Enhance error handling and retry logic
  - [x] 8.1 Implement retry with exponential backoff utility
    - Create retryWithBackoff() function in ErrorHandlingService
    - Implement retry logic with 1s, 2s, 4s delays
    - Add error classification (retryable vs non-retryable)
    - Handle OpenAI rate limits with Retry-After header
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 8.2 Implement S3 error classification
    - Add isRetryableS3Error() function
    - Classify 500, 503 as retryable
    - Classify 400, 403, 404 as non-retryable
    - _Requirements: 7.5_

  - [x] 8.3 Update services to use retry logic
    - Wrap OpenAI API calls with retryWithBackoff()
    - Wrap S3 operations with retryWithBackoff()
    - Ensure fallback logic triggers after all retries fail
    - _Requirements: 1.4, 1.5, 2.5, 2.6_

 

- [x] 9. Implement comprehensive logging
  - [x] 9.1 Add logging to all external API calls
    - Log operation type, timestamp, and request ID before calls
    - Log response time and metadata on success
    - Log error code, message, and context on failure
    - Log when fallback logic is triggered
    - _Requirements: 8.1, 8.2, 8.3, 8.4_


- [x] 10. Implement input validation
  - [x] 10.1 Add validation before API calls
    - Validate audio buffer is non-empty and within size limits
    - Validate text input is non-empty and within token limits
    - Validate file uploads for type, size, and format
    - Throw ValidationError with descriptive messages
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 10.2 Implement filename sanitization
    - Create sanitizeFilename() utility function
    - Replace special characters with underscores
    - Preserve alphanumeric, dots, hyphens, underscores
    - _Requirements: 9.4_

 

- [x] 11. Checkpoint - Ensure error handling and validation tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement real health checks in MonitoringService
  - [x] 12.1 Replace mock OpenAI health check with real API call
    - Remove placeholder implementation
    - Make lightweight API call to OpenAI (models.list())
    - Record response time
    - Mark as healthy if response time < 2000ms, degraded if < 5000ms, unhealthy otherwise
    - Catch and log errors, mark as unhealthy
    - _Requirements: 11.1, 11.3, 11.4_

  - [x] 12.2 Replace mock S3 health check with real API call
    - Remove placeholder implementation
    - Call S3 listObjectsV2 with MaxKeys=1
    - Record response time
    - Mark as healthy if response time < 1000ms, degraded if < 3000ms, unhealthy otherwise
    - Catch and log errors, mark as unhealthy
    - _Requirements: 11.2, 11.3, 11.4_

  - [x] 12.3 Update health check to run every 60 seconds
    - Verify interval is set to 60000ms
    - Ensure results are exposed via health endpoint
    - _Requirements: 11.5_



- [x] 13. Update configuration management
  - [x] 13.1 Validate required environment variables at startup
    - Check for OPENAI_API_KEY, WHISPER_API_KEY
    - Check for AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET
    - Log clear error messages for missing variables
    - Fail to start if required variables are missing
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 13.2 Create configuration constants
    - Define retry counts, timeouts, and delays as constants
    - Define default expiration times for pre-signed URLs
    - Define validation limits (file sizes, token limits)
    - _Requirements: 10.4_

 

- [x] 14. Add metrics collection for API operations
  - [x] 14.1 Implement API metrics tracking in MonitoringService
    - Track total API calls, successful calls, failed calls
    - Track average response times for OpenAI and S3
    - Track error rates by error type
    - Expose metrics via monitoring endpoint
    - _Requirements: 8.5_

 

- [x] 15. Final checkpoint - Run full test suite
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Integration testing and verification
  - [x] 16.1 Test end-to-end resume upload and processing
    - Upload a real PDF resume
    - Verify text extraction succeeds
    - Verify GPT extraction returns structured data
    - Verify profile is updated with extracted data
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

  - [x] 16.2 Test end-to-end audio transcription and analysis
    - Upload audio file to S3
    - Verify Whisper transcription succeeds
    - Verify GPT analysis returns scores and feedback
    - Verify session is updated with results
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [x] 16.3 Test S3 pre-signed URL generation and usage
    - Generate pre-signed URL for download
    - Verify URL works and file can be downloaded
    - Generate pre-signed URL for upload
    - Upload file using pre-signed URL
    - Verify upload succeeded
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 16.4 Test health checks with real services
    - Verify OpenAI health check makes real API call
    - Verify S3 health check makes real API call
    - Verify health status is correctly reported
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 16.5 Test error handling and retry logic
    - Simulate API failures and verify retries occur
    - Verify fallback logic triggers after retries exhausted
    - Verify errors are logged correctly
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flows with real services
