import { OpenAIService, OpenAIServiceError, loadOpenAIConfig, validateOpenAIConfig } from '../../../src/services/OpenAIService';

/**
 * OpenAI Service Unit Tests
 * Tests the OpenAI service functionality with mocked dependencies
 */

// Set test environment variables for dual API keys
process.env.OPENAI_API_KEY = 'test-gpt-api-key';
process.env.WHISPER_API_KEY = 'test-whisper-api-key';

describe('OpenAI Service Configuration', () => {
  describe('loadOpenAIConfig', () => {
    it('should load configuration from environment variables', () => {
      // Act
      const config = loadOpenAIConfig();

      // Assert
      expect(config.gptApiKey).toBe('test-gpt-api-key');
      expect(config.whisperApiKey).toBe('test-whisper-api-key');
      expect(config.maxRetries).toBe(3);
      expect(config.timeout).toBe(60000);
    });

    it('should throw error when GPT API key is missing', () => {
      // Arrange
      const originalApiKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Act & Assert
      expect(() => loadOpenAIConfig()).toThrow('Missing required environment variable: OPENAI_API_KEY');

      // Cleanup
      process.env.OPENAI_API_KEY = originalApiKey;
    });

    it('should throw error when Whisper API key is missing', () => {
      // Arrange
      const originalWhisperKey = process.env.WHISPER_API_KEY;
      delete process.env.WHISPER_API_KEY;

      // Act & Assert
      expect(() => loadOpenAIConfig()).toThrow('Missing required environment variable: WHISPER_API_KEY');

      // Cleanup
      process.env.WHISPER_API_KEY = originalWhisperKey;
    });
  });

  describe('validateOpenAIConfig', () => {
    it('should validate valid configuration', () => {
      // Arrange
      const config = {
        gptApiKey: 'test-gpt-key',
        whisperApiKey: 'test-whisper-key',
        maxRetries: 3,
        timeout: 60000
      };

      // Act & Assert
      expect(() => validateOpenAIConfig(config)).not.toThrow();
    });

    it('should throw error for empty GPT API key', () => {
      // Arrange
      const config = {
        gptApiKey: '',
        whisperApiKey: 'test-whisper-key',
        maxRetries: 3,
        timeout: 60000
      };

      // Act & Assert
      expect(() => validateOpenAIConfig(config)).toThrow('OPENAI_API_KEY (gptApiKey) cannot be empty');
    });

    it('should throw error for empty Whisper API key', () => {
      // Arrange
      const config = {
        gptApiKey: 'test-gpt-key',
        whisperApiKey: '',
        maxRetries: 3,
        timeout: 60000
      };

      // Act & Assert
      expect(() => validateOpenAIConfig(config)).toThrow('WHISPER_API_KEY (whisperApiKey) cannot be empty');
    });

    it('should throw error for invalid retry count', () => {
      // Arrange
      const config = {
        gptApiKey: 'test-gpt-key',
        whisperApiKey: 'test-whisper-key',
        maxRetries: -1,
        timeout: 60000
      };

      // Act & Assert
      expect(() => validateOpenAIConfig(config)).toThrow('maxRetries must be between 0 and 10');
    });

    it('should throw error for invalid timeout', () => {
      // Arrange
      const config = {
        gptApiKey: 'test-gpt-key',
        whisperApiKey: 'test-whisper-key',
        maxRetries: 3,
        timeout: 500
      };

      // Act & Assert
      expect(() => validateOpenAIConfig(config)).toThrow('timeout must be between 1000ms and 300000ms');
    });
  });

  describe('OpenAIService instantiation', () => {
    it('should create service with custom config', () => {
      // Arrange
      const customConfig = {
        gptApiKey: 'custom-gpt-key',
        whisperApiKey: 'custom-whisper-key',
        maxRetries: 2,
        timeout: 30000
      };

      // Act
      const service = new OpenAIService(customConfig);

      // Assert
      expect(service).toBeInstanceOf(OpenAIService);
    });

    it('should create service with default config', () => {
      // Act
      const service = new OpenAIService();

      // Assert
      expect(service).toBeInstanceOf(OpenAIService);
    });
  });

  describe('generatePersonalizedPrompt', () => {
    let openaiService: OpenAIService;

    beforeEach(() => {
      openaiService = new OpenAIService({
        gptApiKey: 'test-gpt-api-key',
        whisperApiKey: 'test-whisper-api-key',
        maxRetries: 2,
        timeout: 30000
      });
    });

    it('should generate personalized prompt with full profile', () => {
      // Arrange
      const userProfile = {
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
        aiAttributes: { communicationStyle: 'detailed' },
        extractedSkills: ['JavaScript', 'React', 'Node.js'],
        experienceLevel: 'Mid',
        resumeS3Key: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Act
      const result = openaiService.generatePersonalizedPrompt(userProfile);

      // Assert
      expect(result).toContain('Software Engineer');
      expect(result).toContain('Technology');
      expect(result).toContain('JavaScript');
      expect(result).toContain('comprehensive answer');
    });

    it('should generate basic prompt with minimal profile', () => {
      // Arrange
      const userProfile = {
        id: 'profile-1',
        userId: 'user-1',
        fullName: null,
        currentJobTitle: null,
        currentCompany: null,
        school: null,
        degreeInfo: null,
        previousJobTitles: [],
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        resumeS3Key: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Act
      const result = openaiService.generatePersonalizedPrompt(userProfile);

      // Assert
      expect(result).toContain('challenging project');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle concise communication style', () => {
      // Arrange
      const userProfile = {
        id: 'profile-1',
        userId: 'user-1',
        fullName: null,
        currentJobTitle: null,
        currentCompany: null,
        school: null,
        degreeInfo: null,
        previousJobTitles: [],
        targetIndustry: 'Finance',
        targetJobTitle: 'Analyst',
        aiAttributes: { communicationStyle: 'concise' },
        extractedSkills: ['Excel', 'SQL'],
        experienceLevel: 'Entry',
        resumeS3Key: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Act
      const result = openaiService.generatePersonalizedPrompt(userProfile);

      // Assert
      expect(result).toContain('Analyst');
      expect(result).toContain('Finance');
      expect(result).toContain('clear and concise');
    });
  });

  describe('OpenAIServiceError', () => {
    it('should create error with message and retryable flag', () => {
      // Act
      const error = new OpenAIServiceError('Test error', undefined, true);

      // Assert
      expect(error.message).toBe('Test error');
      expect(error.retryable).toBe(true);
      expect(error.name).toBe('OpenAIServiceError');
    });

    it('should create error with original error', () => {
      // Arrange
      const originalError = new Error('Original error');

      // Act
      const error = new OpenAIServiceError('Wrapper error', originalError, false);

      // Assert
      expect(error.message).toBe('Wrapper error');
      expect(error.originalError).toBe(originalError);
      expect(error.retryable).toBe(false);
    });
  });
});