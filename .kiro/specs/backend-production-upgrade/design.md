# Design Document: Backend Production Upgrade

## Overview

This design document outlines the technical approach for upgrading backend services from mock implementations to production-ready code with real API integrations. The upgrade focuses on three main areas:

1. **OpenAI Integration**: Implementing real Whisper API for audio transcription and GPT API for text analysis
2. **Resume Processing**: Adding PDF/DOC text extraction and AI-powered data extraction
3. **S3 Pre-signed URLs**: Implementing secure file access and upload capabilities
4. **Production Hardening**: Adding comprehensive error handling, retry logic, logging, and monitoring

The design maintains backward compatibility with existing service interfaces while replacing mock implementations with production code.

## Architecture

### Service Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Layer (Routes)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   Service Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Profile    │  │AudioSession  │  │ Monitoring   │      │
│  │   Service    │  │   Service    │  │   Service    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐      │
│  │   OpenAI     │  │      S3      │  │    Error     │      │
│  │   Service    │  │   Service    │  │   Handling   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              External Services                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ OpenAI API   │  │   AWS S3     │  │  Database    │      │
│  │ (Whisper/GPT)│  │              │  │  (Prisma)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Dual OpenAI API Keys**: Use separate keys for Whisper and GPT to enable independent rate limiting and cost tracking
2. **Retry with Exponential Backoff**: Implement 3 retries with 1s, 2s, 4s delays for all external API calls
3. **Graceful Degradation**: Provide fallback logic when APIs are unavailable to maintain system availability
4. **Pre-signed URLs**: Use S3 pre-signed URLs for both downloads and uploads to reduce backend load
5. **Async Processing**: Keep resume processing asynchronous to avoid blocking API responses

## Components and Interfaces

### 1. OpenAI Service Enhancements

**Current State**: Service has proper structure but needs configuration updates for dual API keys.

**Changes Required**:
- Update configuration to support WHISPER_API_KEY in addition to OPENAI_API_KEY
- Create separate OpenAI client instances for Whisper and GPT operations
- Ensure retry logic and error handling are properly configured

```typescript
interface OpenAIConfig {
  gptApiKey: string;        // For GPT operations
  whisperApiKey: string;    // For Whisper operations
  maxRetries: number;
  timeout: number;
}

class OpenAIService {
  private gptClient: OpenAI;
  private whisperClient: OpenAI;
  
  constructor(config: OpenAIConfig) {
    this.gptClient = new OpenAI({
      apiKey: config.gptApiKey,
      maxRetries: config.maxRetries,
      timeout: config.timeout
    });
    
    this.whisperClient = new OpenAI({
      apiKey: config.whisperApiKey,
      maxRetries: config.maxRetries,
      timeout: config.timeout
    });
  }
  
  async transcribeAudio(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult> {
    // Use whisperClient for transcription
  }
  
  async analyzeResponse(transcript: string, userContext: UserContext): Promise<AIAnalysis> {
    // Use gptClient for analysis
  }
}
```

### 2. Profile Service - Resume Processing

**Current State**: Has TODO comment for text extraction implementation.

**Changes Required**:
- Add PDF text extraction using `pdf-parse` library
- Add DOC/DOCX text extraction using `mammoth` library
- Implement real OpenAI integration for resume data extraction
- Remove mock data generation

```typescript
interface ResumeProcessor {
  extractText(buffer: Buffer, filename: string): Promise<string>;
  extractDataWithAI(text: string): Promise<ResumeData>;
}

class ProfileService {
  private resumeProcessor: ResumeProcessor;
  
  async processResume(userId: string, s3Key: string): Promise<void> {
    // 1. Download file from S3
    const fileBuffer = await this.s3Service.download(s3Key);
    
    // 2. Extract text based on file type
    const text = await this.resumeProcessor.extractText(fileBuffer, s3Key);
    
    // 3. Use OpenAI to extract structured data
    const resumeData = await this.openaiService.extractResumeData(text);
    
    // 4. Update profile with extracted data
    await this.updateProfileWithResumeData(userId, resumeData);
  }
}
```

### 3. S3 Service - Pre-signed URL Support

**Current State**: Has basic upload/download but no pre-signed URL generation for uploads.

**Changes Required**:
- Add method to generate pre-signed URLs for PUT operations
- Add validation for pre-signed URL parameters
- Add method to verify successful uploads

```typescript
interface S3UploadUrlOptions {
  contentType: string;
  maxSizeBytes: number;
  expiresIn: number;
}

interface S3UploadUrlResult {
  url: string;
  key: string;
  fields: Record<string, string>;
}

class S3Service {
  async generateUploadUrl(
    key: string, 
    options: S3UploadUrlOptions
  ): Promise<S3UploadUrlResult> {
    // Generate pre-signed URL for PUT operation
    const url = await this.s3.getSignedUrlPromise('putObject', {
      Bucket: this.bucketName,
      Key: key,
      ContentType: options.contentType,
      Expires: options.expiresIn
    });
    
    return {
      url,
      key,
      fields: {
        'Content-Type': options.contentType
      }
    };
  }
  
  async verifyUpload(key: string): Promise<boolean> {
    // Verify file exists after upload
    return await this.fileExists(key);
  }
}
```

### 4. Monitoring Service - Real Health Checks

**Current State**: Has placeholder health checks that only verify configuration.

**Changes Required**:
- Implement real OpenAI API health check with test call
- Implement real S3 health check with listObjects call
- Add response time tracking
- Add error rate tracking

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  lastChecked: Date;
}

class MonitoringService {
  private async checkOpenAIHealth(): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      
      // Make lightweight test call to OpenAI
      await this.openaiClient.models.list();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 2000 ? 'healthy' : 'degraded',
        responseTime,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date()
      };
    }
  }
  
  private async checkS3Health(): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      
      // List objects with limit 1 to minimize cost
      await this.s3.listObjectsV2({
        Bucket: this.bucketName,
        MaxKeys: 1
      }).promise();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date()
      };
    }
  }
}
```

### 5. Resume Text Extraction Module

**New Component**: Handles text extraction from different file formats.

```typescript
interface TextExtractor {
  canHandle(filename: string): boolean;
  extract(buffer: Buffer): Promise<string>;
}

class PDFTextExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.toLowerCase().endsWith('.pdf');
  }
  
  async extract(buffer: Buffer): Promise<string> {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  }
}

class DOCXTextExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith('.doc') || lower.endsWith('.docx');
  }
  
  async extract(buffer: Buffer): Promise<string> {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}

class ResumeTextExtractor {
  private extractors: TextExtractor[];
  
  constructor() {
    this.extractors = [
      new PDFTextExtractor(),
      new DOCXTextExtractor()
    ];
  }
  
  async extractText(buffer: Buffer, filename: string): Promise<string> {
    const extractor = this.extractors.find(e => e.canHandle(filename));
    
    if (!extractor) {
      throw new ValidationError(
        `Unsupported file type: ${filename}`
      );
    }
    
    return await extractor.extract(buffer);
  }
}
```

## Data Models

### Configuration Models

```typescript
interface APIConfiguration {
  openai: {
    gptApiKey: string;
    whisperApiKey: string;
    maxRetries: number;
    timeout: number;
    model: {
      gpt: string;        // 'gpt-4-turbo-mini'
      whisper: string;    // 'whisper-1'
    };
  };
  aws: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    s3Bucket: string;
  };
  retry: {
    maxAttempts: number;      // 3
    initialDelayMs: number;   // 1000
    maxDelayMs: number;       // 4000
  };
}
```

### Health Check Models

```typescript
interface ServiceHealth {
  openai: {
    gpt: HealthCheckResult;
    whisper: HealthCheckResult;
  };
  s3: HealthCheckResult;
  database: HealthCheckResult;
}

interface SystemMetrics {
  apiCalls: {
    openai: {
      total: number;
      successful: number;
      failed: number;
      averageResponseTime: number;
    };
    s3: {
      total: number;
      successful: number;
      failed: number;
      averageResponseTime: number;
    };
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: API Retry with Exponential Backoff

*For any* external API call (OpenAI or S3) that fails with a retryable error, the system should retry exactly 3 times with delays of 1 second, 2 seconds, and 4 seconds between attempts.

**Validates: Requirements 1.4, 2.5, 7.1, 7.2**

### Property 2: Fallback on Complete Failure

*For any* external API operation (transcription, analysis, or resume extraction) where all retry attempts fail, the system should return a valid fallback result instead of throwing an error.

**Validates: Requirements 1.5, 2.6, 4.5**

### Property 3: API Response Parsing Completeness

*For any* valid API response from OpenAI (Whisper or GPT), the system should successfully extract all required fields without data loss.

**Validates: Requirements 1.3, 2.4**

### Property 4: User Context Inclusion in Prompts

*For any* user context object containing target role, skills, or experience level, the generated GPT prompt should include all non-null context fields.

**Validates: Requirements 2.3**

### Property 5: Resume Text Extraction

*For any* valid resume file buffer (PDF or DOCX) with a matching file extension, the text extraction should succeed and return non-empty text content.

**Validates: Requirements 3.2, 3.3, 3.4**

### Property 6: Resume Data Validation Before Storage

*For any* resume data returned from GPT extraction, the system should validate the JSON structure contains all required fields (skills, experienceLevel, industries, jobTitles, summary) before storing to the database.

**Validates: Requirements 4.3**

### Property 7: Profile Update After Extraction

*For any* successfully extracted resume data, the user profile should be updated with the extracted skills and experience level.

**Validates: Requirements 4.4**

### Property 8: Pre-signed URL Expiration Validation

*For any* pre-signed URL generation request, if the expiration time is less than 1 second or greater than 86400 seconds, the system should reject the request with a ValidationError.

**Validates: Requirements 5.2**

### Property 9: S3 Object Existence Check

*For any* pre-signed URL generation request for a download operation, the system should verify the S3 object exists before generating the URL.

**Validates: Requirements 5.3**

### Property 10: Upload URL Completeness

*For any* generated S3 upload URL, the response should include both the URL string and required headers (including Content-Type).

**Validates: Requirements 6.2, 6.4**

### Property 11: Upload Verification Before Database Update

*For any* file upload via pre-signed URL, the system should verify the file exists in S3 before updating any database records.

**Validates: Requirements 6.5**

### Property 12: Rate Limit Retry-After Respect

*For any* OpenAI API response with a 429 status code and Retry-After header, the system should wait for the specified duration before retrying.

**Validates: Requirements 7.4**

### Property 13: S3 Error Classification

*For any* S3 operation error, the system should correctly classify it as retryable (500, 503) or non-retryable (404, 403, 400) based on the status code.

**Validates: Requirements 7.5**

### Property 14: Comprehensive API Call Logging

*For any* external API call (success or failure), the system should log the operation type, timestamp, request identifier, and either response time (success) or error details (failure).

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 15: Fallback Logging

*For any* operation that triggers fallback logic, the system should log that fallback was used and the reason why.

**Validates: Requirements 8.4**

### Property 16: Input Validation Before API Calls

*For any* API operation (transcription, analysis, file upload), the system should validate inputs (non-empty, within size/token limits, correct format) before making the external API call.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 17: Filename Sanitization

*For any* filename containing special characters (excluding alphanumeric, dots, hyphens, underscores), the system should sanitize it by replacing special characters with underscores.

**Validates: Requirements 9.4**

### Property 18: Validation Error Messages

*For any* validation failure, the system should throw a ValidationError with a descriptive message explaining what validation failed.

**Validates: Requirements 9.5**

### Property 19: Missing Configuration Startup Failure

*For any* required environment variable (OPENAI_API_KEY, WHISPER_API_KEY, AWS credentials) that is missing at startup, the system should log a clear error message and fail to start the service.

**Validates: Requirements 10.2, 10.5**

### Property 20: Health Check Result Recording

*For any* health check operation (OpenAI or S3), the system should record the result status (healthy/degraded/unhealthy), response time (if successful), and error details (if failed).

**Validates: Requirements 11.3, 11.4**

## Error Handling

### Error Classification

The system classifies errors into three categories:

1. **Retryable Errors**: Temporary failures that may succeed on retry
   - Network timeouts
   - 500, 502, 503, 504 HTTP status codes
   - OpenAI rate limits (429) with Retry-After header
   - S3 throttling errors

2. **Non-Retryable Errors**: Permanent failures that won't succeed on retry
   - 400, 401, 403, 404 HTTP status codes
   - Invalid API keys
   - Malformed requests
   - File not found errors

3. **Validation Errors**: Input validation failures caught before API calls
   - Empty or oversized files
   - Invalid file types
   - Missing required fields
   - Out-of-range parameters

### Retry Strategy

```typescript
interface RetryConfig {
  maxAttempts: 3;
  delays: [1000, 2000, 4000]; // milliseconds
  retryableStatusCodes: [429, 500, 502, 503, 504];
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (!isRetryable(error) || attempt === config.maxAttempts - 1) {
        throw error;
      }
      
      const delay = config.delays[attempt];
      await sleep(delay);
    }
  }
  
  throw lastError;
}
```

### Fallback Mechanisms

Each service implements graceful degradation:

1. **Whisper Transcription Fallback**: Return placeholder message indicating transcription unavailable
2. **GPT Analysis Fallback**: Perform basic text analysis (word count, keyword detection) and return simplified scores
3. **Resume Extraction Fallback**: Use keyword matching to extract basic skills and experience level

### Error Logging

All errors are logged with:
- Timestamp
- Service name
- Operation type
- Error type and message
- Request context (user ID, session ID, file name, etc.)
- Stack trace (for unexpected errors)

## Testing Strategy

### Dual Testing Approach

The testing strategy combines unit tests for specific scenarios with property-based tests for comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- Test specific file types (PDF, DOCX)
- Test specific error codes (404, 500, 429)
- Test configuration loading with specific environment variables
- Test health check responses with specific status codes

**Property-Based Tests**: Verify universal properties across all inputs
- Test retry logic with any retryable error
- Test validation with any invalid input
- Test parsing with any valid API response
- Test sanitization with any filename containing special characters

### Property Test Configuration

All property-based tests will:
- Run minimum 100 iterations per test
- Use the appropriate PBT library for TypeScript (fast-check)
- Tag each test with format: **Feature: backend-production-upgrade, Property {number}: {property_text}**
- Generate random but valid test data (API responses, file buffers, user contexts)

### Test Coverage Areas

1. **OpenAI Integration Tests**
   - Unit: Test specific API responses and error codes
   - Property: Test retry logic with any retryable error
   - Property: Test fallback with any complete failure
   - Property: Test parsing with any valid response

2. **Resume Processing Tests**
   - Unit: Test PDF extraction with sample PDF
   - Unit: Test DOCX extraction with sample DOCX
   - Property: Test text extraction with any valid file buffer
   - Property: Test validation with any GPT response

3. **S3 Pre-signed URL Tests**
   - Unit: Test URL generation with specific parameters
   - Property: Test expiration validation with any time value
   - Property: Test upload verification with any S3 key

4. **Error Handling Tests**
   - Unit: Test specific retry scenarios (1st retry succeeds, 2nd retry succeeds, all fail)
   - Property: Test retry delays with any retryable error
   - Property: Test error classification with any HTTP status code

5. **Validation Tests**
   - Unit: Test specific invalid inputs (empty buffer, oversized file)
   - Property: Test validation with any invalid input
   - Property: Test sanitization with any filename

6. **Monitoring Tests**
   - Unit: Test health checks with specific API responses
   - Property: Test metrics collection with any API operation
   - Property: Test health check recording with any result

### Integration Testing

Integration tests will verify:
- End-to-end resume upload and processing flow
- End-to-end audio transcription and analysis flow
- Service health checks with real external services (in staging environment)
- Pre-signed URL generation and usage flow

### Mocking Strategy

For unit and property tests:
- Mock OpenAI API responses using test fixtures
- Mock S3 operations using AWS SDK mocks
- Mock file system operations for resume processing
- Use dependency injection to swap real services with mocks

For integration tests:
- Use real OpenAI API with test API keys (rate-limited)
- Use real S3 with test bucket
- Use test database with isolated data
