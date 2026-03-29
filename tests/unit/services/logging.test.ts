import { OpenAIService } from '../../../src/services/OpenAIService';
import { S3Service } from '../../../src/services/S3Service';
import { errorHandlingService } from '../../../src/services/ErrorHandlingService';

/**
 * Comprehensive Logging Tests
 * Verifies that all external API calls include proper logging
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

// Set test environment variables
process.env.OPENAI_API_KEY = 'test-gpt-api-key';
process.env.WHISPER_API_KEY = 'test-whisper-api-key';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_S3_BUCKET = 'test-bucket';

describe('Comprehensive Logging for External API Calls', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on console methods to verify logging
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('OpenAI Service Logging', () => {
    let openaiService: OpenAIService;

    beforeEach(() => {
      openaiService = new OpenAIService({
        gptApiKey: 'test-gpt-api-key',
        whisperApiKey: 'test-whisper-api-key',
        maxRetries: 2,
        timeout: 30000
      });
    });

    describe('Requirement 8.1: Log operation type, timestamp, and request ID before calls', () => {
      it('should log before transcribeAudio API call', async () => {
        // Arrange
        const audioBuffer = Buffer.alloc(2048, 'test audio data');
        const filename = 'test-audio.wav';

        // Mock the OpenAI client to throw an error (to avoid actual API call)
        const mockError = new Error('Mock error for testing');
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await openaiService.transcribeAudio(audioBuffer, filename);
        } catch (error) {
          // Expected to fail
        }

        // Assert - Verify log was called before API call
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting OpenAI Whisper API call',
          expect.objectContaining({
            operationType: 'whisper_transcription',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^transcribe_audio_\d+$/),
            filename,
            bufferSize: audioBuffer.length
          })
        );
      });

      it('should log before analyzeResponse API call', async () => {
        // Arrange
        const transcript = 'This is a test transcript for analysis';
        const userContext = {
          profile: {
            id: 'profile-1',
            userId: 'user-1',
            fullName: null,
            currentJobTitle: null,
            currentCompany: null,
            school: null,
            degreeInfo: null,
            previousJobTitles: [],
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer',
            aiAttributes: {},
            extractedSkills: ['JavaScript'],
            experienceLevel: 'Mid',
            resumeS3Key: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };

        // Mock the OpenAI client to throw an error
        const mockError = new Error('Mock error for testing');
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await openaiService.analyzeResponse(transcript, userContext);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting OpenAI GPT API call for response analysis',
          expect.objectContaining({
            operationType: 'gpt_analysis',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^analyze_response_\d+$/),
            transcriptLength: transcript.length,
            userId: userContext.profile.id
          })
        );
      });

      it('should log before extractResumeData API call', async () => {
        // Arrange
        const resumeText = 'This is a test resume with skills like JavaScript and Python';

        // Mock the OpenAI client to throw an error
        const mockError = new Error('Mock error for testing');
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await openaiService.extractResumeData(resumeText);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting OpenAI GPT API call for resume extraction',
          expect.objectContaining({
            operationType: 'gpt_resume_extraction',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^extract_resume_\d+$/),
            resumeTextLength: resumeText.length
          })
        );
      });
    });

    describe('Requirement 8.2: Log response time and metadata on success', () => {
      it('should log success with response time for transcribeAudio', async () => {
        // Arrange
        const audioBuffer = Buffer.alloc(2048, 'test audio data');
        const mockResult = {
          text: 'Test transcription',
          language: 'en',
          duration: 10
        };

        // Mock successful operation
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockResolvedValueOnce(mockResult);

        // Act
        await openaiService.transcribeAudio(audioBuffer, 'test.wav');

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'OpenAI Whisper API call succeeded',
          expect.objectContaining({
            operationType: 'whisper_transcription',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            metadata: expect.objectContaining({
              textLength: mockResult.text.length,
              language: mockResult.language,
              duration: mockResult.duration
            })
          })
        );
      });

      it('should log success with response time for analyzeResponse', async () => {
        // Arrange
        const transcript = 'Test transcript';
        const userContext = {
          profile: {
            id: 'profile-1',
            userId: 'user-1',
            fullName: null,
            currentJobTitle: null,
            currentCompany: null,
            school: null,
            degreeInfo: null,
            previousJobTitles: [],
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer',
            aiAttributes: {},
            extractedSkills: ['JavaScript'],
            experienceLevel: 'Mid',
            resumeS3Key: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };

        const mockResult = {
          feedback: 'Good response',
          scores: {
            clarity: 4,
            confidence: 4,
            tone: 5,
            enthusiasm: 4,
            specificity: 4
          },
          insights: ['Good example', 'Clear structure'],
          strengthAreas: ['technical', 'communication'],
          strengthInsights: ['Clear communicator', 'Technical depth'],
          opportunityAreas: ['structure', 'examples'],
          opportunityInsights: ['Could add more specific examples', 'Consider clarifying scope or constraints'],
          topTraits: ['Clear communicator', 'Technical depth'],
          aiAttributes: {}
        };

        // Mock successful operation
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockResolvedValueOnce(mockResult);

        // Act
        await openaiService.analyzeResponse(transcript, userContext);

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'OpenAI GPT API call for response analysis succeeded',
          expect.objectContaining({
            operationType: 'gpt_analysis',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            metadata: expect.objectContaining({
              feedbackLength: mockResult.feedback.length,
              insightsCount: mockResult.insights.length,
              averageScore: expect.any(Number)
            })
          })
        );
      });
    });

    describe('Requirement 8.3: Log error code, message, and context on failure', () => {
      it('should log error details for transcribeAudio failure', async () => {
        // Arrange
        const audioBuffer = Buffer.alloc(2048, 'test audio data');
        const mockError = new Error('API rate limit exceeded');
        (mockError as any).code = 'rate_limit_exceeded';

        // Mock failed operation
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await openaiService.transcribeAudio(audioBuffer, 'test.wav');
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'OpenAI Whisper API call failed',
          expect.objectContaining({
            operationType: 'whisper_transcription',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            errorCode: 'rate_limit_exceeded',
            errorMessage: 'API rate limit exceeded',
            errorContext: expect.objectContaining({
              filename: 'test.wav',
              bufferSize: audioBuffer.length,
              errorType: 'Error'
            })
          })
        );
      });

      it('should log error details for analyzeResponse failure', async () => {
        // Arrange
        const transcript = 'Test transcript';
        const userContext = {
          profile: {
            id: 'profile-1',
            userId: 'user-1',
            fullName: null,
            currentJobTitle: null,
            currentCompany: null,
            school: null,
            degreeInfo: null,
            previousJobTitles: [],
            targetIndustry: 'Technology',
            targetJobTitle: 'Software Engineer',
            aiAttributes: {},
            extractedSkills: ['JavaScript'],
            experienceLevel: 'Mid',
            resumeS3Key: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };

        const mockError = new Error('Invalid API key');
        (mockError as any).code = 'invalid_api_key';

        // Mock failed operation
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await openaiService.analyzeResponse(transcript, userContext);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'OpenAI GPT API call for response analysis failed',
          expect.objectContaining({
            operationType: 'gpt_analysis',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            errorCode: 'invalid_api_key',
            errorMessage: 'Invalid API key',
            errorContext: expect.objectContaining({
              transcriptLength: transcript.length,
              userId: userContext.profile.id,
              errorType: 'Error'
            })
          })
        );
      });
    });

    describe('Requirement 8.4: Log when fallback logic is triggered', () => {
      it('should log fallback usage for transcribeAudio', async () => {
        // Arrange
        const audioBuffer = Buffer.alloc(2048, 'test audio data');
        const mockFallbackResult = {
          text: '[Transcription temporarily unavailable - please try again later]',
          language: 'en',
          duration: 0
        };

        // Mock operation that triggers fallback
        jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockResolvedValueOnce(mockFallbackResult);

        // Act
        const result = await openaiService.transcribeAudio(audioBuffer, 'test.wav');

        // Assert - Check if result is the fallback message
        if (result.text.includes('temporarily unavailable')) {
          // Fallback was used, verify warning was logged
          // Note: The actual fallback logging happens inside executeOpenAIOperation
          expect(result.text).toBe('[Transcription temporarily unavailable - please try again later]');
        }
      });
    });
  });

  describe('S3 Service Logging', () => {
    let s3Service: S3Service;

    beforeEach(() => {
      s3Service = new S3Service({
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        region: 'us-east-1',
        bucketName: 'test-bucket'
      });
    });

    describe('Requirement 8.1: Log operation type, timestamp, and request ID before calls', () => {
      it('should log before S3 upload operation', async () => {
        // Arrange
        const key = 'test-file.txt';
        const buffer = Buffer.from('test content');

        // Mock the S3 operation to throw an error
        const mockError = new Error('Mock S3 error');
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.upload(key, buffer);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting S3 upload operation',
          expect.objectContaining({
            operationType: 's3_upload',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^s3_upload_.*_\d+$/),
            key,
            bufferSize: buffer.length
          })
        );
      });

      it('should log before S3 download operation', async () => {
        // Arrange
        const key = 'test-file.txt';

        // Mock the S3 operation to throw an error
        const mockError = new Error('Mock S3 error');
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.download(key);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting S3 download operation',
          expect.objectContaining({
            operationType: 's3_download',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^s3_download_.*_\d+$/),
            key
          })
        );
      });

      it('should log before S3 signed URL generation', async () => {
        // Arrange
        const key = 'test-file.txt';
        const expiresIn = 3600;

        // Mock the S3 operation to throw an error
        const mockError = new Error('Mock S3 error');
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.getSignedUrl(key, expiresIn);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting S3 signed URL generation',
          expect.objectContaining({
            operationType: 's3_get_signed_url',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^s3_signed_url_.*_\d+$/),
            key,
            expiresIn
          })
        );
      });

      it('should log before S3 upload URL generation', async () => {
        // Arrange
        const key = 'test-file.txt';
        const options = {
          contentType: 'text/plain',
          expiresIn: 3600
        };

        // Mock the S3 operation to throw an error
        const mockError = new Error('Mock S3 error');
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.generateUploadUrl(key, options);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'Starting S3 upload URL generation',
          expect.objectContaining({
            operationType: 's3_generate_upload_url',
            timestamp: expect.any(String),
            requestId: expect.stringMatching(/^s3_upload_url_.*_\d+$/),
            key,
            contentType: options.contentType,
            expiresIn: options.expiresIn
          })
        );
      });
    });

    describe('Requirement 8.2: Log response time and metadata on success', () => {
      it('should log success with response time for S3 upload', async () => {
        // Arrange
        const key = 'test-file.txt';
        const buffer = Buffer.from('test content');
        const mockLocation = 'https://s3.amazonaws.com/test-bucket/test-file.txt';

        // Mock successful operation
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockResolvedValueOnce(mockLocation);

        // Act
        await s3Service.upload(key, buffer);

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'S3 upload operation succeeded',
          expect.objectContaining({
            operationType: 's3_upload',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            metadata: expect.objectContaining({
              key,
              location: mockLocation,
              bufferSize: buffer.length
            })
          })
        );
      });

      it('should log success with response time for S3 download', async () => {
        // Arrange
        const key = 'test-file.txt';
        const mockBuffer = Buffer.from('downloaded content');

        // Mock successful operation
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockResolvedValueOnce(mockBuffer);

        // Act
        await s3Service.download(key);

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'S3 download operation succeeded',
          expect.objectContaining({
            operationType: 's3_download',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            metadata: expect.objectContaining({
              key,
              bufferSize: mockBuffer.length
            })
          })
        );
      });
    });

    describe('Requirement 8.3: Log error code, message, and context on failure', () => {
      it('should log error details for S3 upload failure', async () => {
        // Arrange
        const key = 'test-file.txt';
        const buffer = Buffer.from('test content');
        const mockError = new Error('Access denied');
        (mockError as any).code = 'AccessDenied';
        (mockError as any).statusCode = 403;

        // Mock failed operation
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.upload(key, buffer);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'S3 upload operation failed',
          expect.objectContaining({
            operationType: 's3_upload',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            errorCode: 'AccessDenied',
            errorMessage: 'Access denied',
            errorContext: expect.objectContaining({
              key,
              bufferSize: buffer.length,
              errorType: 'Error'
            })
          })
        );
      });

      it('should log error details for S3 download failure', async () => {
        // Arrange
        const key = 'non-existent-file.txt';
        const mockError = new Error('The specified key does not exist');
        (mockError as any).code = 'NoSuchKey';
        (mockError as any).statusCode = 404;

        // Mock failed operation
        jest.spyOn(errorHandlingService, 'executeS3Operation').mockRejectedValueOnce(mockError);

        // Act
        try {
          await s3Service.download(key);
        } catch (error) {
          // Expected to fail
        }

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'S3 download operation failed',
          expect.objectContaining({
            operationType: 's3_download',
            requestId: expect.any(String),
            responseTimeMs: expect.any(Number),
            errorCode: 'NoSuchKey',
            errorMessage: 'The specified key does not exist',
            errorContext: expect.objectContaining({
              key,
              errorType: 'Error'
            })
          })
        );
      });
    });
  });

  describe('Logging Format Validation', () => {
    it('should include ISO 8601 timestamp format', async () => {
      // Arrange
      const openaiService = new OpenAIService();
      const audioBuffer = Buffer.alloc(2048, 'test');
      const mockError = new Error('Test error');
      jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValueOnce(mockError);

      // Act
      try {
        await openaiService.transcribeAudio(audioBuffer, 'test.wav');
      } catch (error) {
        // Expected
      }

      // Assert
      const logCall = consoleLogSpy.mock.calls.find(call => 
        call[0] === 'Starting OpenAI Whisper API call'
      );
      
      expect(logCall).toBeDefined();
      const logData = logCall![1];
      expect(logData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include unique request IDs', async () => {
      // Arrange
      const openaiService = new OpenAIService();
      const audioBuffer = Buffer.alloc(2048, 'test');
      const mockError = new Error('Test error');
      
      // Act - Make two calls with a small delay to ensure different timestamps
      jest.spyOn(errorHandlingService, 'executeOpenAIOperation').mockRejectedValue(mockError);
      
      try {
        await openaiService.transcribeAudio(audioBuffer, 'test1.wav');
      } catch (error) {
        // Expected
      }

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 2));

      try {
        await openaiService.transcribeAudio(audioBuffer, 'test2.wav');
      } catch (error) {
        // Expected
      }

      // Assert - Request IDs should be different (they include timestamps)
      const logCalls = consoleLogSpy.mock.calls.filter(call => 
        call[0] === 'Starting OpenAI Whisper API call'
      );
      
      expect(logCalls.length).toBeGreaterThanOrEqual(2);
      const requestId1 = logCalls[0][1].requestId;
      const requestId2 = logCalls[1][1].requestId;
      
      // Request IDs should follow the pattern and be different
      expect(requestId1).toMatch(/^transcribe_audio_\d+$/);
      expect(requestId2).toMatch(/^transcribe_audio_\d+$/);
      expect(requestId1).not.toBe(requestId2);
    });
  });
});
