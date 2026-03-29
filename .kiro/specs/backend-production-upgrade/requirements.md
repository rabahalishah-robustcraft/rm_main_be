# Requirements Document

## Introduction

This specification defines the requirements for upgrading backend services from mock/placeholder implementations to production-ready code with real API integrations. The system currently has mock implementations in several services marked with "In a real implementation" comments. With API keys now configured in the environment, these services need to be upgraded to use actual OpenAI (GPT and Whisper), AWS S3, and other production integrations.

## Glossary

- **OpenAI_Service**: Service responsible for AI operations including audio transcription (Whisper) and text analysis (GPT)
- **S3_Service**: Service responsible for AWS S3 file storage operations including uploads, downloads, and pre-signed URL generation
- **Profile_Service**: Service responsible for user profile management including resume processing
- **Monitoring_Service**: Service responsible for system health monitoring and metrics collection
- **Whisper_API**: OpenAI's audio transcription API using the whisper-1 model
- **GPT_API**: OpenAI's chat completion API using the gpt-4-turbo-mini model
- **Pre-signed_URL**: Time-limited secure URL for accessing S3 objects without exposing credentials
- **Production_Ready**: Code that includes proper error handling, retry logic, logging, input validation, and uses real API integrations

## Requirements

### Requirement 1: OpenAI Whisper Integration

**User Story:** As a developer, I want to use the real Whisper API for audio transcription, so that the system can accurately transcribe user audio recordings.

#### Acceptance Criteria

1. WHEN the OpenAI_Service transcribes audio, THE System SHALL use the WHISPER_API_KEY environment variable for authentication
2. WHEN calling the Whisper API, THE System SHALL use the whisper-1 model with verbose_json response format
3. WHEN the Whisper API returns a transcription, THE System SHALL extract text, language, and duration from the response
4. IF the Whisper API call fails, THEN THE System SHALL retry up to 2 times with exponential backoff
5. IF all retry attempts fail, THEN THE System SHALL log the error and return a fallback transcription message

### Requirement 2: OpenAI GPT Integration

**User Story:** As a developer, I want to use the real GPT API for response analysis, so that the system can provide intelligent feedback on interview responses.

#### Acceptance Criteria

1. WHEN the OpenAI_Service analyzes responses, THE System SHALL use the OPENAI_API_KEY environment variable for authentication
2. WHEN calling the GPT API, THE System SHALL use the gpt-4-turbo-mini model via the chat completions endpoint
3. WHEN constructing GPT prompts, THE System SHALL include user context (target role, skills, experience level)
4. WHEN the GPT API returns analysis, THE System SHALL parse JSON responses containing feedback, scores, insights, and AI attributes
5. IF the GPT API call fails, THEN THE System SHALL retry up to 2 times with exponential backoff
6. IF all retry attempts fail, THEN THE System SHALL return a fallback analysis based on basic text analysis

### Requirement 3: Resume Text Extraction

**User Story:** As a developer, I want to extract text from PDF and DOC resume files, so that the system can process resume content with AI.

#### Acceptance Criteria

1. WHEN a resume file is uploaded, THE Profile_Service SHALL determine the file type from the file extension
2. WHEN processing a PDF file, THE System SHALL use a PDF parsing library to extract text content
3. WHEN processing a DOC/DOCX file, THE System SHALL use a document parsing library to extract text content
4. WHEN text extraction succeeds, THE System SHALL pass the extracted text to the OpenAI_Service for structured data extraction
5. IF text extraction fails, THEN THE System SHALL log the error and return a descriptive error message

### Requirement 4: Resume AI Processing

**User Story:** As a developer, I want to use GPT to extract structured data from resume text, so that user profiles can be automatically populated with skills and experience.

#### Acceptance Criteria

1. WHEN the Profile_Service processes a resume, THE System SHALL call the OpenAI_Service to extract structured data
2. WHEN calling GPT for resume extraction, THE System SHALL request JSON output containing skills, experience level, industries, job titles, and summary
3. WHEN GPT returns resume data, THE System SHALL validate the JSON structure before storing
4. WHEN resume data is extracted, THE System SHALL update the user profile with extracted skills and experience level
5. IF GPT extraction fails, THEN THE System SHALL use basic keyword extraction as a fallback

### Requirement 5: S3 Pre-signed URL Generation

**User Story:** As a developer, I want to generate pre-signed URLs for S3 objects, so that users can securely access files without exposing AWS credentials.

#### Acceptance Criteria

1. WHEN generating a pre-signed URL, THE S3_Service SHALL use the AWS SDK's getSignedUrl method
2. WHEN creating pre-signed URLs, THE System SHALL set expiration times between 1 second and 86400 seconds (24 hours)
3. WHEN a pre-signed URL is requested, THE System SHALL validate that the S3 object exists before generating the URL
4. WHEN generating URLs for resume files, THE System SHALL use a default expiration of 3600 seconds (1 hour)
5. IF URL generation fails, THEN THE System SHALL log the error and throw an ExternalServiceError

### Requirement 6: S3 Upload with Pre-signed URLs

**User Story:** As a developer, I want to support file uploads using pre-signed URLs, so that clients can upload files directly to S3 without routing through the backend.

#### Acceptance Criteria

1. THE S3_Service SHALL provide a method to generate pre-signed URLs for PUT operations
2. WHEN generating upload URLs, THE System SHALL include content type restrictions in the pre-signed URL
3. WHEN generating upload URLs, THE System SHALL include file size restrictions in the pre-signed URL
4. WHEN an upload URL is generated, THE System SHALL return the URL and required headers to the client
5. WHEN a file is uploaded via pre-signed URL, THE System SHALL verify the upload succeeded before updating database records

### Requirement 7: Error Handling and Retry Logic

**User Story:** As a developer, I want comprehensive error handling with retry logic, so that the system is resilient to temporary API failures.

#### Acceptance Criteria

1. WHEN any external API call fails with a retryable error, THE System SHALL retry with exponential backoff
2. WHEN retrying API calls, THE System SHALL wait 1 second, then 2 seconds, then 4 seconds between attempts
3. WHEN an API call fails after all retries, THE System SHALL log the complete error details including request context
4. WHEN OpenAI rate limits are encountered, THE System SHALL respect the Retry-After header if present
5. WHEN S3 operations fail, THE System SHALL distinguish between retryable errors (500, 503) and non-retryable errors (404, 403)

### Requirement 8: Logging and Monitoring

**User Story:** As a developer, I want comprehensive logging for all API operations, so that I can debug issues and monitor system health.

#### Acceptance Criteria

1. WHEN any external API call is made, THE System SHALL log the operation type, timestamp, and request identifier
2. WHEN API calls succeed, THE System SHALL log response times and key response metadata
3. WHEN API calls fail, THE System SHALL log error codes, error messages, and full error context
4. WHEN fallback logic is triggered, THE System SHALL log that fallback was used and why
5. THE Monitoring_Service SHALL collect metrics on API success rates, response times, and error rates

### Requirement 9: Input Validation

**User Story:** As a developer, I want thorough input validation before making API calls, so that invalid requests are caught early and API costs are minimized.

#### Acceptance Criteria

1. WHEN transcribing audio, THE System SHALL validate that the audio buffer is not empty and is within size limits
2. WHEN analyzing text with GPT, THE System SHALL validate that the input text is not empty and is within token limits
3. WHEN uploading files to S3, THE System SHALL validate file type, file size, and filename format
4. WHEN generating S3 keys, THE System SHALL sanitize filenames to remove special characters
5. IF validation fails, THEN THE System SHALL throw a ValidationError with a descriptive message

### Requirement 10: Configuration Management

**User Story:** As a developer, I want centralized configuration for API keys and settings, so that production settings can be easily managed.

#### Acceptance Criteria

1. THE System SHALL load all API keys from environment variables at startup
2. THE System SHALL validate that required environment variables are present before starting services
3. THE System SHALL support separate API keys for Whisper (WHISPER_API_KEY) and GPT (OPENAI_API_KEY)
4. THE System SHALL use configuration constants for retry counts, timeouts, and other operational parameters
5. IF required configuration is missing, THEN THE System SHALL log a clear error message and fail to start

### Requirement 11: Monitoring Service Health Checks

**User Story:** As a developer, I want real health checks for external services, so that monitoring can detect when APIs are unavailable.

#### Acceptance Criteria

1. WHEN checking OpenAI health, THE Monitoring_Service SHALL make a lightweight test API call
2. WHEN checking S3 health, THE Monitoring_Service SHALL attempt to list objects in the configured bucket
3. WHEN health checks succeed, THE System SHALL record response times and mark services as healthy
4. WHEN health checks fail, THE System SHALL mark services as unhealthy and log error details
5. THE Monitoring_Service SHALL perform health checks every 60 seconds and expose results via the health endpoint
