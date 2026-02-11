import { OpenAIService } from '../../../src/services/OpenAIService';
import { S3Service } from '../../../src/services/S3Service';
import { ValidationError } from '../../../src/types/auth';

/**
 * Unit tests for input validation before API calls
 * Requirements: 9.1, 9.2, 9.3, 9.5
 */

describe('Input Validation', () => {
  describe('OpenAIService - Audio Buffer Validation', () => {
    let openaiService: OpenAIService;

    beforeEach(() => {
      // Mock environment variables
      process.env.OPENAI_API_KEY = 'test-gpt-key';
      process.env.WHISPER_API_KEY = 'test-whisper-key';
      
      openaiService = new OpenAIService();
    });

    afterEach(() => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.WHISPER_API_KEY;
    });

    it('should throw ValidationError when audio buffer is empty', async () => {
      // Requirement 9.1: Validate audio buffer is non-empty
      const emptyBuffer = Buffer.from([]);

      await expect(
        openaiService.transcribeAudio(emptyBuffer, 'test.wav')
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.transcribeAudio(emptyBuffer, 'test.wav')
      ).rejects.toThrow('Audio buffer cannot be empty');
    });

    it('should throw ValidationError when audio buffer is null or undefined', async () => {
      // Requirement 9.1: Validate audio buffer is non-empty
      await expect(
        openaiService.transcribeAudio(null as any, 'test.wav')
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.transcribeAudio(undefined as any, 'test.wav')
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when audio buffer exceeds size limit', async () => {
      // Requirement 9.1: Validate audio buffer is within size limits
      const maxSize = 50 * 1024 * 1024; // 50MB
      const oversizedBuffer = Buffer.alloc(maxSize + 1);

      await expect(
        openaiService.transcribeAudio(oversizedBuffer, 'test.wav')
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.transcribeAudio(oversizedBuffer, 'test.wav')
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });

    it('should throw ValidationError when audio buffer is too small', async () => {
      // Requirement 9.1: Validate audio buffer has minimum size
      const tinyBuffer = Buffer.from([1, 2, 3]); // Less than 1KB

      await expect(
        openaiService.transcribeAudio(tinyBuffer, 'test.wav')
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.transcribeAudio(tinyBuffer, 'test.wav')
      ).rejects.toThrow(/too small to be a valid audio file/);
    });

    it('should accept valid audio buffer within size limits', async () => {
      // Create a valid buffer (2KB)
      const validBuffer = Buffer.alloc(2048);
      
      // Mock the whisperClient to avoid actual API call
      const mockTranscribe = jest.fn().mockResolvedValue({
        text: 'Test transcription',
        language: 'en',
        duration: 10
      });
      
      (openaiService as any).whisperClient = {
        audio: {
          transcriptions: {
            create: mockTranscribe
          }
        }
      };

      // Should not throw validation error
      await expect(
        openaiService.transcribeAudio(validBuffer, 'test.wav')
      ).resolves.toBeDefined();
    });
  });

  describe('OpenAIService - Text Input Validation', () => {
    let openaiService: OpenAIService;

    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-gpt-key';
      process.env.WHISPER_API_KEY = 'test-whisper-key';
      
      openaiService = new OpenAIService();
    });

    afterEach(() => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.WHISPER_API_KEY;
    });

    it('should throw ValidationError when text is empty', async () => {
      // Requirement 9.2: Validate text input is non-empty
      const userContext = {
        profile: {
          id: 'test-user-id',
          targetJobTitle: 'Software Engineer',
          targetIndustry: 'Technology',
          extractedSkills: ['JavaScript', 'TypeScript'],
          experienceLevel: 'Mid'
        } as any
      };

      await expect(
        openaiService.analyzeResponse('', userContext)
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.analyzeResponse('   ', userContext)
      ).rejects.toThrow('Transcript cannot be empty');
    });

    it('should throw ValidationError when text is too short', async () => {
      // Requirement 9.2: Validate text has minimum length
      const userContext = {
        profile: {
          id: 'test-user-id',
          targetJobTitle: 'Software Engineer'
        } as any
      };

      await expect(
        openaiService.analyzeResponse('Hi', userContext)
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.analyzeResponse('Hi', userContext)
      ).rejects.toThrow(/too short/);
    });

    it('should throw ValidationError when text exceeds token limit', async () => {
      // Requirement 9.2: Validate text is within token limits
      const maxTokens = 8000;
      const charsPerToken = 4;
      const maxChars = maxTokens * charsPerToken;
      const oversizedText = 'a'.repeat(maxChars + 1000);

      const userContext = {
        profile: {
          id: 'test-user-id',
          targetJobTitle: 'Software Engineer'
        } as any
      };

      await expect(
        openaiService.analyzeResponse(oversizedText, userContext)
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.analyzeResponse(oversizedText, userContext)
      ).rejects.toThrow(/too long/);
    });

    it('should throw ValidationError when resume text is empty', async () => {
      // Requirement 9.2: Validate resume text is non-empty
      await expect(
        openaiService.extractResumeData('')
      ).rejects.toThrow(ValidationError);

      await expect(
        openaiService.extractResumeData('   ')
      ).rejects.toThrow('Resume text cannot be empty');
    });

    it('should accept valid text within token limits', async () => {
      const validText = 'This is a valid response with sufficient length for analysis.';
      const userContext = {
        profile: {
          id: 'test-user-id',
          targetJobTitle: 'Software Engineer',
          targetIndustry: 'Technology',
          extractedSkills: ['JavaScript'],
          experienceLevel: 'Mid'
        } as any
      };

      // Mock the gptClient to avoid actual API call
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              feedback: 'Good response',
              scores: {
                clarity: 85,
                confidence: 80,
                tone: 90,
                enthusiasm: 85,
                specificity: 75
              },
              insights: ['Good detail', 'Clear communication'],
              aiAttributes: {}
            })
          }
        }]
      });

      (openaiService as any).gptClient = {
        chat: {
          completions: {
            create: mockCreate
          }
        }
      };

      // Should not throw validation error
      await expect(
        openaiService.analyzeResponse(validText, userContext)
      ).resolves.toBeDefined();
    });
  });

  describe('S3Service - File Upload Validation', () => {
    let s3Service: S3Service;

    beforeEach(() => {
      s3Service = new S3Service({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1',
        bucketName: 'test-bucket'
      });
    });

    it('should throw ValidationError when file buffer is empty', () => {
      // Requirement 9.3: Validate file is non-empty
      const emptyBuffer = Buffer.from([]);

      expect(() => {
        s3Service.validateFile(emptyBuffer, 'test.pdf');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(emptyBuffer, 'test.pdf');
      }).toThrow('File cannot be empty');
    });

    it('should throw ValidationError when filename is missing', () => {
      // Requirement 9.3: Validate filename is provided
      const buffer = Buffer.from('test content');

      expect(() => {
        s3Service.validateFile(buffer, '');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(buffer, '   ');
      }).toThrow('Filename is required');
    });

    it('should throw ValidationError when file exceeds size limit', () => {
      // Requirement 9.3: Validate file size
      const maxSize = 50 * 1024 * 1024; // 50MB
      const oversizedBuffer = Buffer.alloc(maxSize + 1);

      expect(() => {
        s3Service.validateFile(oversizedBuffer, 'test.pdf');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(oversizedBuffer, 'test.pdf');
      }).toThrow(/exceeds maximum allowed size/);
    });

    it('should throw ValidationError when file type is not allowed', () => {
      // Requirement 9.3: Validate file type
      const buffer = Buffer.from('test content');

      expect(() => {
        s3Service.validateFile(buffer, 'test.exe');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(buffer, 'test.exe');
      }).toThrow(/not allowed/);
    });

    it('should throw ValidationError when file has no extension', () => {
      // Requirement 9.3: Validate file format
      const buffer = Buffer.from('test content');

      expect(() => {
        s3Service.validateFile(buffer, 'testfile');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(buffer, 'testfile');
      }).toThrow('File must have a valid extension');
    });

    it('should throw ValidationError when file is too small', () => {
      // Requirement 9.3: Validate minimum file size
      const tinyBuffer = Buffer.from([1, 2, 3]); // Less than 100 bytes

      expect(() => {
        s3Service.validateFile(tinyBuffer, 'test.pdf');
      }).toThrow(ValidationError);

      expect(() => {
        s3Service.validateFile(tinyBuffer, 'test.pdf');
      }).toThrow(/too small to be valid/);
    });

    it('should accept valid PDF file', () => {
      // Create a valid buffer (1KB)
      const validBuffer = Buffer.alloc(1024);

      expect(() => {
        s3Service.validateFile(validBuffer, 'resume.pdf');
      }).not.toThrow();
    });

    it('should accept valid DOCX file', () => {
      // Create a valid buffer (1KB)
      const validBuffer = Buffer.alloc(1024);

      expect(() => {
        s3Service.validateFile(validBuffer, 'resume.docx');
      }).not.toThrow();
    });

    it('should accept valid DOC file', () => {
      // Create a valid buffer (1KB)
      const validBuffer = Buffer.alloc(1024);

      expect(() => {
        s3Service.validateFile(validBuffer, 'resume.doc');
      }).not.toThrow();
    });

    it('should respect custom allowed types', () => {
      const buffer = Buffer.alloc(1024);

      // Should reject PDF when only allowing images
      expect(() => {
        s3Service.validateFile(buffer, 'test.pdf', {
          allowedTypes: ['.jpg', '.png']
        });
      }).toThrow(ValidationError);

      // Should accept JPG when allowing images
      expect(() => {
        s3Service.validateFile(buffer, 'test.jpg', {
          allowedTypes: ['.jpg', '.png']
        });
      }).not.toThrow();
    });

    it('should respect custom max size', () => {
      const buffer = Buffer.alloc(2048); // 2KB

      // Should reject when max size is 1KB
      expect(() => {
        s3Service.validateFile(buffer, 'test.pdf', {
          maxSizeBytes: 1024
        });
      }).toThrow(ValidationError);

      // Should accept when max size is 3KB
      expect(() => {
        s3Service.validateFile(buffer, 'test.pdf', {
          maxSizeBytes: 3072
        });
      }).not.toThrow();
    });
  });

  describe('S3Service - Upload Method Validation', () => {
    let s3Service: S3Service;

    beforeEach(() => {
      s3Service = new S3Service({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1',
        bucketName: 'test-bucket'
      });
    });

    it('should throw ValidationError when key is empty', async () => {
      // Requirement 9.3: Validate key is provided
      const buffer = Buffer.from('test content');

      await expect(
        s3Service.upload('', buffer)
      ).rejects.toThrow(ValidationError);

      await expect(
        s3Service.upload('   ', buffer)
      ).rejects.toThrow('Key is required for upload');
    });

    it('should throw ValidationError when buffer is null', async () => {
      // Requirement 9.3: Validate buffer is provided
      await expect(
        s3Service.upload('test-key', null as any)
      ).rejects.toThrow(ValidationError);

      await expect(
        s3Service.upload('test-key', null as any)
      ).rejects.toThrow('Buffer is required for upload');
    });

    it('should throw ValidationError when buffer is empty', async () => {
      // Requirement 9.3: Validate buffer is non-empty
      const emptyBuffer = Buffer.from([]);

      await expect(
        s3Service.upload('test-key', emptyBuffer)
      ).rejects.toThrow(ValidationError);

      await expect(
        s3Service.upload('test-key', emptyBuffer)
      ).rejects.toThrow('Buffer cannot be empty');
    });
  });

  describe('Validation Error Messages', () => {
    it('should provide descriptive error messages for audio validation', async () => {
      // Requirement 9.5: Throw ValidationError with descriptive messages
      process.env.OPENAI_API_KEY = 'test-gpt-key';
      process.env.WHISPER_API_KEY = 'test-whisper-key';
      
      const openaiService = new OpenAIService();
      const emptyBuffer = Buffer.from([]);

      try {
        await openaiService.transcribeAudio(emptyBuffer, 'test.wav');
        fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('Audio buffer cannot be empty');
      }

      delete process.env.OPENAI_API_KEY;
      delete process.env.WHISPER_API_KEY;
    });

    it('should provide descriptive error messages for text validation', async () => {
      // Requirement 9.5: Throw ValidationError with descriptive messages
      process.env.OPENAI_API_KEY = 'test-gpt-key';
      process.env.WHISPER_API_KEY = 'test-whisper-key';
      
      const openaiService = new OpenAIService();
      const userContext = {
        profile: { id: 'test-user-id' } as any
      };

      try {
        await openaiService.analyzeResponse('', userContext);
        fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('Transcript cannot be empty');
      }

      delete process.env.OPENAI_API_KEY;
      delete process.env.WHISPER_API_KEY;
    });

    it('should provide descriptive error messages for file validation', () => {
      // Requirement 9.5: Throw ValidationError with descriptive messages
      const s3Service = new S3Service({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1',
        bucketName: 'test-bucket'
      });

      const buffer = Buffer.from('test');

      try {
        s3Service.validateFile(buffer, 'test.exe');
        fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('not allowed');
        expect((error as ValidationError).message).toContain('.exe');
      }
    });
  });
});
