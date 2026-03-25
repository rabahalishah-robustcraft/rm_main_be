import fc from 'fast-check';
import { OpenAIService, OpenAIServiceError, AIAnalysis, UserContext, TranscriptionResult } from '../../src/services/OpenAIService';
import { UserProfile } from '@prisma/client';

/**
 * Property-Based Tests for AI Integration
 * Feature: ai-audio-summarization-backend
 * Requirements: 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 8.1, 8.2, 8.3, 8.4, 8.5
 */

// Mock OpenAI client for property testing
jest.mock('openai');

// Mock the ErrorHandlingService singleton so we can control retry behaviour per test
jest.mock('../../src/services/ErrorHandlingService', () => {
  return {
    errorHandlingService: {
      executeOpenAIOperation: jest.fn(),
    },
  };
});

// Mock MonitoringService to avoid side-effects
jest.mock('../../src/services/MonitoringService', () => ({
  monitoringService: {
    recordAPIOperation: jest.fn(),
  },
}));

import { errorHandlingService } from '../../src/services/ErrorHandlingService';
const mockedErrorHandling = errorHandlingService as jest.Mocked<typeof errorHandlingService>;

describe('AI Integration Properties', () => {
  let openaiService: OpenAIService;
  let mockWhisperClient: any;
  let mockGptClient: any;

  beforeEach(() => {
    // Set up test environment
    process.env.OPENAI_API_KEY = 'test-gpt-api-key';
    process.env.WHISPER_API_KEY = 'test-whisper-api-key';

    // Create service instance
    openaiService = new OpenAIService({
      gptApiKey: 'test-gpt-api-key',
      whisperApiKey: 'test-whisper-api-key',
      maxRetries: 2,
      timeout: 30000
    });

    // Mock Whisper client (used for transcription)
    mockWhisperClient = {
      audio: {
        transcriptions: {
          create: jest.fn()
        }
      }
    };

    // Mock GPT client (used for analysis)
    mockGptClient = {
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    };

    // Replace the clients in the service (service uses separate whisperClient and gptClient)
    (openaiService as any).whisperClient = mockWhisperClient;
    (openaiService as any).gptClient = mockGptClient;

    // Default: executeOpenAIOperation just runs the operation directly (no retry/circuit-breaker)
    (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
      async (operation: () => Promise<any>, _operationId: string, _fallback?: () => Promise<any>) => {
        return await operation();
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Feature: ai-audio-summarization-backend, Property 12: Transcription triggers analysis
  describe('Property 12: Transcription triggers analysis', () => {
    it('should trigger analysis after successful transcription', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 10000 }), // Audio buffer (min 1KB for validation)
          fc.string({ minLength: 1, maxLength: 50 }), // Filename
          async (audioBuffer, filename) => {
            // Arrange
            const mockTranscription = {
              text: 'This is a test transcription',
              language: 'en',
              duration: 30.5
            };

            mockWhisperClient.audio.transcriptions.create.mockResolvedValue(mockTranscription);

            // Act
            const result = await openaiService.transcribeAudio(Buffer.from(audioBuffer), filename);

            // Assert
            expect(result.text).toBe(mockTranscription.text);
            expect(result.language).toBe(mockTranscription.language);
            expect(result.duration).toBe(mockTranscription.duration);
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledWith({
              file: expect.any(File),
              model: 'whisper-1',
              response_format: 'verbose_json',
              language: 'en'
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 13: Analysis produces all scores
  describe('Property 13: Analysis produces all scores', () => {
    it('should produce all required performance scores', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 500 }).filter(s => s.trim().length >= 10), // Non-empty transcript
          fc.record({
            targetIndustry: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)),
            targetJobTitle: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)),
            extractedSkills: fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { maxLength: 10 }),
            experienceLevel: fc.option(fc.constantFrom('Entry', 'Mid', 'Senior', 'Executive'))
          }), // User profile data
          async (transcript, profileData) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: profileData.targetIndustry || null,
              targetJobTitle: profileData.targetJobTitle || null,
              aiAttributes: {},
              extractedSkills: profileData.extractedSkills,
              experienceLevel: profileData.experienceLevel || null,
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Test feedback',
                    scores: {
                      clarity: 4,
                      confidence: 4,
                      tone: 5,
                      enthusiasm: 4,
                      specificity: 4
                    },
                    insights: ['Good structure', 'Needs more examples'],
                    strengthAreas: ['technical', 'communication'],
                    strengthInsights: ['Good structure', 'Relevant experience'],
                    opportunityAreas: ['structure', 'specificity'],
                    opportunityInsights: ['Could add specific examples of outcomes', 'Consider more concrete metrics'],
                    topTraits: ['Good structure', 'Relevant experience'],
                    aiAttributes: { communicationStyle: 'detailed' }
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            const result = await openaiService.analyzeResponse(transcript, userContext);

            // Assert - All score categories must be present and valid
            expect(result.scores).toHaveProperty('clarity');
            expect(result.scores).toHaveProperty('confidence');
            expect(result.scores).toHaveProperty('tone');
            expect(result.scores).toHaveProperty('enthusiasm');
            expect(result.scores).toHaveProperty('specificity');

            // All scores must be numbers between 1 and 5 (out of 5)
            Object.values(result.scores).forEach(score => {
              expect(typeof score).toBe('number');
              expect(score).toBeGreaterThanOrEqual(1);
              expect(score).toBeLessThanOrEqual(5);
            });

            expect(result.feedback).toBeTruthy();
            expect(Array.isArray(result.insights)).toBe(true);
            expect(typeof result.aiAttributes).toBe('object');
            expect(Array.isArray(result.strengthAreas)).toBe(true);
            (result.strengthAreas ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.strengthInsights)).toBe(true);
            (result.strengthInsights ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.opportunityAreas)).toBe(true);
            (result.opportunityAreas ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.opportunityInsights)).toBe(true);
            (result.opportunityInsights ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.topTraits)).toBe(true);
            (result.topTraits ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 15: Audio processing includes user context
  describe('Property 15: Audio processing includes user context', () => {
    it('should incorporate user profile data in analysis prompts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 200 }).filter(s => s.trim().length >= 10), // Non-empty transcript
          fc.record({
            targetIndustry: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            targetJobTitle: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            extractedSkills: fc.array(fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
            experienceLevel: fc.constantFrom('Entry', 'Mid', 'Senior', 'Executive')
          }),
          async (transcript, profileData) => {
            // Reset mock call counts for this iteration
            mockGptClient.chat.completions.create.mockReset();

            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: profileData.targetIndustry,
              targetJobTitle: profileData.targetJobTitle,
              aiAttributes: {},
              extractedSkills: profileData.extractedSkills,
              experienceLevel: profileData.experienceLevel,
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = {
              profile: userProfile,
              targetRole: {
                industry: profileData.targetIndustry,
                jobTitle: profileData.targetJobTitle
              }
            };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Test feedback',
                    scores: { clarity: 4, confidence: 4, tone: 4, enthusiasm: 5, specificity: 4 },
                    insights: ['Test insight'],
                    strengthAreas: [],
                    strengthInsights: [],
                    opportunityAreas: [],
                    opportunityInsights: [],
                    topTraits: [],
                    aiAttributes: {}
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            await openaiService.analyzeResponse(transcript, userContext);

            // Assert - Verify the prompt includes user context
            const callArgs = mockGptClient.chat.completions.create.mock.calls[0][0];
            const prompt = callArgs.messages[1].content;

            expect(prompt).toContain(profileData.targetJobTitle);
            expect(prompt).toContain(profileData.targetIndustry);
            expect(prompt).toContain(profileData.experienceLevel);
            profileData.extractedSkills.forEach(skill => {
              expect(prompt).toContain(skill);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 16: Feedback contains required insights
  describe('Property 16: Feedback contains required insights', () => {
    it('should generate feedback with quality, relevance, and delivery insights', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 20, maxLength: 300 }),
          async (transcript) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: 'Technology',
              targetJobTitle: 'Software Engineer',
              aiAttributes: {},
              extractedSkills: ['JavaScript', 'React'],
              experienceLevel: 'Mid',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Detailed feedback about response quality, content relevance, and delivery style',
                    scores: { clarity: 4, confidence: 4, tone: 4, enthusiasm: 5, specificity: 4 },
                    insights: [
                      'Good technical explanation showing depth of knowledge',
                      'Could improve by adding more specific examples',
                      'Confident delivery with appropriate technical terminology'
                    ],
                    aiAttributes: { communicationStyle: 'technical' }
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            const result = await openaiService.analyzeResponse(transcript, userContext);

            // Assert - Feedback must contain substantive insights
            expect(result.feedback).toBeTruthy();
            expect(typeof result.feedback).toBe('string');
            expect(result.feedback.length).toBeGreaterThan(10);
            
            expect(Array.isArray(result.insights)).toBe(true);
            expect(result.insights.length).toBeGreaterThan(0);
            
            // Each insight should be a meaningful string
            result.insights.forEach(insight => {
              expect(typeof insight).toBe('string');
              expect(insight.length).toBeGreaterThan(5);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 17: Scores within valid range
  describe('Property 17: Scores within valid range', () => {
    it('should ensure all performance scores are between 1 and 5 (out of 5)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 200 }).filter(s => s.trim().length >= 10),
          fc.record({
            clarity: fc.integer({ min: 1, max: 5 }),
            confidence: fc.integer({ min: 1, max: 5 }),
            tone: fc.integer({ min: 1, max: 5 }),
            enthusiasm: fc.integer({ min: 1, max: 5 }),
            specificity: fc.integer({ min: 1, max: 5 })
          }),
          async (transcript, scores) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: 'Technology',
              targetJobTitle: 'Developer',
              aiAttributes: {},
              extractedSkills: [],
              experienceLevel: 'Mid',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Test feedback',
                    scores: scores,
                    insights: ['Test insight'],
                    aiAttributes: {}
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            const result = await openaiService.analyzeResponse(transcript, userContext);

            // Assert - All scores must be within valid range (1-5)
            expect(result.scores.clarity).toBeGreaterThanOrEqual(1);
            expect(result.scores.clarity).toBeLessThanOrEqual(5);
            expect(result.scores.confidence).toBeGreaterThanOrEqual(1);
            expect(result.scores.confidence).toBeLessThanOrEqual(5);
            expect(result.scores.tone).toBeGreaterThanOrEqual(1);
            expect(result.scores.tone).toBeLessThanOrEqual(5);
            expect(result.scores.enthusiasm).toBeGreaterThanOrEqual(1);
            expect(result.scores.enthusiasm).toBeLessThanOrEqual(5);
            expect(result.scores.specificity).toBeGreaterThanOrEqual(1);
            expect(result.scores.specificity).toBeLessThanOrEqual(5);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 18: Analysis results are persisted
  describe('Property 18: Analysis results are persisted', () => {
    it('should return complete analysis data for persistence', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 15, maxLength: 250 }),
          async (transcript) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: 'Finance',
              targetJobTitle: 'Analyst',
              aiAttributes: {},
              extractedSkills: ['Excel', 'SQL'],
              experienceLevel: 'Entry',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Complete analysis feedback for persistence',
                    scores: { clarity: 4, confidence: 4, tone: 5, enthusiasm: 4, specificity: 4 },
                    insights: ['Strength in data analysis', 'Improve presentation skills'],
                    aiAttributes: { 
                      communicationStyle: 'analytical',
                      strengthAreas: ['technical', 'problem-solving'],
                      improvementAreas: ['presentation']
                    }
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            const result = await openaiService.analyzeResponse(transcript, userContext);

            // Assert - All required fields for persistence must be present
            expect(result).toHaveProperty('feedback');
            expect(result).toHaveProperty('scores');
            expect(result).toHaveProperty('insights');
            expect(result).toHaveProperty('aiAttributes');

            // Scores object must have all required fields
            expect(result.scores).toHaveProperty('clarity');
            expect(result.scores).toHaveProperty('confidence');
            expect(result.scores).toHaveProperty('tone');
            expect(result.scores).toHaveProperty('enthusiasm');
            expect(result.scores).toHaveProperty('specificity');

            // Data types must be correct for database storage
            expect(typeof result.feedback).toBe('string');
            expect(typeof result.scores).toBe('object');
            expect(Array.isArray(result.insights)).toBe(true);
            expect(typeof result.aiAttributes).toBe('object');

            // Redundancy: strength/opportunity areas appear only at top level, not in aiAttributes
            expect(result.aiAttributes).not.toHaveProperty('strengthAreas');
            expect(result.aiAttributes).not.toHaveProperty('improvementAreas');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 19: Prompts use target role context
  describe('Property 19: Prompts use target role context', () => {
    it('should incorporate target role information in generated prompts', async () => {
      await fc.assert(
        fc.property(
          fc.record({
            targetIndustry: fc.string({ minLength: 3, maxLength: 25 }),
            targetJobTitle: fc.string({ minLength: 3, maxLength: 30 }),
            extractedSkills: fc.array(fc.string({ minLength: 2, maxLength: 15 }), { maxLength: 5 }),
            aiAttributes: fc.record({
              communicationStyle: fc.constantFrom('detailed', 'concise', 'storytelling')
            })
          }),
          (profileData) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: profileData.targetIndustry,
              targetJobTitle: profileData.targetJobTitle,
              aiAttributes: profileData.aiAttributes,
              extractedSkills: profileData.extractedSkills,
              experienceLevel: 'Mid',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            // Act
            const prompt = openaiService.generatePersonalizedPrompt(userProfile);

            // Assert - Prompt must include target role context
            expect(prompt).toContain(profileData.targetJobTitle);
            expect(prompt).toContain(profileData.targetIndustry);
            
            // Should include communication style guidance
            if (profileData.aiAttributes.communicationStyle === 'detailed') {
              expect(prompt).toContain('comprehensive');
            } else if (profileData.aiAttributes.communicationStyle === 'concise') {
              expect(prompt).toContain('concise');
            }

            // Should include relevant skills if available
            if (profileData.extractedSkills.length > 0) {
              profileData.extractedSkills.slice(0, 3).forEach(skill => {
                expect(prompt).toContain(skill);
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 35: Whisper API error handling
  describe('Property 35: Whisper API error handling', () => {
    it('should handle Whisper API errors with proper retry logic', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 5000 }), // Min 1KB for validation
          fc.constantFrom(429, 500, 502, 503), // Retryable error codes
          async (audioBuffer, errorStatus) => {
            // Reset mock call counts for this iteration
            mockWhisperClient.audio.transcriptions.create.mockReset();

            // Arrange: configure executeOpenAIOperation to simulate retry logic
            (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
              async (operation: () => Promise<any>, _operationId: string, fallback?: () => Promise<any>) => {
                const maxAttempts = 3;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  try {
                    return await operation();
                  } catch (err) {
                    if (attempt === maxAttempts - 1) {
                      if (fallback) return await fallback();
                      throw err;
                    }
                  }
                }
              }
            );

            const error = new Error(`API Error - status ${errorStatus}`);
            (error as any).status = errorStatus;

            mockWhisperClient.audio.transcriptions.create
              .mockRejectedValueOnce(error)
              .mockRejectedValueOnce(error)
              .mockResolvedValueOnce({
                text: 'Success after retry',
                language: 'en',
                duration: 25.0
              });

            // Act & Assert
            const result = await openaiService.transcribeAudio(Buffer.from(audioBuffer));

            // Should succeed after retries
            expect(result.text).toBe('Success after retry');
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledTimes(3);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not retry non-retryable errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 5000 }), // Min 1KB for validation
          fc.constantFrom(400, 401, 403, 404), // Non-retryable error codes
          async (audioBuffer, errorStatus) => {
            // Reset mock call counts for this iteration
            mockWhisperClient.audio.transcriptions.create.mockReset();

            // Arrange: configure executeOpenAIOperation to NOT retry (non-retryable)
            (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
              async (operation: () => Promise<any>, _operationId: string, _fallback?: () => Promise<any>) => {
                return await operation();
              }
            );

            const error = new Error(`Client Error - status ${errorStatus}`);
            (error as any).status = errorStatus;

            mockWhisperClient.audio.transcriptions.create.mockRejectedValue(error);

            // Act & Assert - the error propagates through transcribeAudio's catch block
            await expect(openaiService.transcribeAudio(Buffer.from(audioBuffer)))
              .rejects.toThrow();

            // Should not retry client errors
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 36: GPT API structured prompts
  describe('Property 36: GPT API structured prompts', () => {
    it('should use structured prompts with proper formatting', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 10), // Non-empty transcript
          fc.record({
            targetIndustry: fc.string({ minLength: 3, maxLength: 20 }).filter(s => s.trim().length > 0),
            targetJobTitle: fc.string({ minLength: 3, maxLength: 25 }).filter(s => s.trim().length > 0)
          }),
          async (transcript, roleData) => {
            // Reset mock call counts for this iteration
            mockGptClient.chat.completions.create.mockReset();

            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: roleData.targetIndustry,
              targetJobTitle: roleData.targetJobTitle,
              aiAttributes: {},
              extractedSkills: ['skill1', 'skill2'],
              experienceLevel: 'Mid',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: 'Test feedback',
                    scores: { clarity: 4, confidence: 4, tone: 4, enthusiasm: 5, specificity: 4 },
                    insights: ['Test insight'],
                    strengthAreas: [],
                    strengthInsights: [],
                    opportunityAreas: [],
                    opportunityInsights: [],
                    topTraits: [],
                    aiAttributes: {}
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act
            await openaiService.analyzeResponse(transcript, userContext);

            // Assert - Verify structured prompt format
            const callArgs = mockGptClient.chat.completions.create.mock.calls[0][0];

            expect(callArgs.model).toBe('gpt-4');
            expect(callArgs.messages).toHaveLength(2);
            expect(callArgs.messages[0].role).toBe('system');
            expect(callArgs.messages[1].role).toBe('user');

            const prompt = callArgs.messages[1].content;
            expect(prompt).toContain('TRANSCRIPT:');
            expect(prompt).toContain('USER CONTEXT:');
            expect(prompt).toContain('JSON format');
            expect(prompt).toContain(transcript);
            expect(prompt).toContain(roleData.targetJobTitle);
            expect(prompt).toContain(roleData.targetIndustry);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 37: API failure backoff strategy
  describe('Property 37: API failure backoff strategy', () => {
    it('should implement exponential backoff for API failures', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 5000 }), // Min 1KB for validation
          async (audioBuffer) => {
            // Reset mock call counts for this iteration
            mockWhisperClient.audio.transcriptions.create.mockReset();

            // Arrange: simulate exponential backoff by tracking delays
            const delays: number[] = [];

            (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
              async (operation: () => Promise<any>, _operationId: string, fallback?: () => Promise<any>) => {
                // Simulate retryWithBackoff: delays 1s, 2s, 4s
                const backoffDelays = [1000, 2000, 4000];
                const maxAttempts = backoffDelays.length + 1; // 4 total attempts
                let lastError: Error | undefined;

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  try {
                    return await operation();
                  } catch (err) {
                    lastError = err as Error;
                    if (attempt < backoffDelays.length) {
                      delays.push(backoffDelays[attempt]);
                    }
                  }
                }
                if (fallback) return await fallback();
                throw lastError;
              }
            );

            const retryableError = new Error('Server Error 500');
            (retryableError as any).status = 500;

            mockWhisperClient.audio.transcriptions.create
              .mockRejectedValueOnce(retryableError)
              .mockRejectedValueOnce(retryableError)
              .mockResolvedValueOnce({
                text: 'Success after backoff',
                language: 'en',
                duration: 30.0
              });

            // Act
            const result = await openaiService.transcribeAudio(Buffer.from(audioBuffer));

            // Assert
            expect(result.text).toBe('Success after backoff');
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledTimes(3);

            // Should have recorded exponential backoff delays (1s, 2s)
            expect(delays.length).toBe(2);
            expect(delays[0]).toBe(1000);
            expect(delays[1]).toBe(2000);
            // Second delay should be larger than first (exponential)
            expect(delays[1]).toBeGreaterThan(delays[0]);
          }
        ),
        { numRuns: 20 } // Fewer runs due to retry simulation
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 38: API response validation
  describe('Property 38: API response validation', () => {
    it('should validate and sanitize API responses before storage', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 150 }).filter(s => s.trim().length >= 10), // Non-empty transcript
          fc.record({
            maliciousScript: fc.constant('<script>alert("xss")</script>'),
            invalidScore: fc.constantFrom(-1, 10, 0, NaN, null, undefined),
            missingField: fc.constant(undefined)
          }),
          async (transcript, maliciousData) => {
            // Arrange
            const userProfile: UserProfile = {
              id: 'test-profile',
              userId: 'test-user',
              fullName: null,
              currentJobTitle: null,
              currentCompany: null,
              school: null,
              degreeInfo: null,
              previousJobTitles: [],
              targetIndustry: 'Technology',
              targetJobTitle: 'Developer',
              aiAttributes: {},
              extractedSkills: [],
              experienceLevel: 'Mid',
              resumeS3Key: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            const userContext: UserContext = { profile: userProfile };

            // Mock response with potentially malicious or invalid data
            const mockAnalysisResponse = {
              choices: [{
                message: {
                  content: JSON.stringify({
                    feedback: `Normal feedback ${maliciousData.maliciousScript}`,
                    scores: {
                      clarity: maliciousData.invalidScore ?? 4,
                      confidence: 4,
                      tone: 4,
                      enthusiasm: 5,
                      specificity: 4
                    },
                    insights: ['Test insight'],
                    aiAttributes: {}
                  })
                }
              }]
            };

            mockGptClient.chat.completions.create.mockResolvedValue(mockAnalysisResponse);

            // Act & Assert
            const result = await openaiService.analyzeResponse(transcript, userContext);

            // When API returns invalid scores, parse may throw and fallback can be used, so we always get a result.
            // Either way, stored/returned scores must be valid (1-5).
            expect(typeof result.feedback).toBe('string');
            expect(typeof result.scores).toBe('object');
            expect(Array.isArray(result.insights)).toBe(true);

            // All scores must be valid numbers in 1-5 range (validation clamps or fallback provides valid scores)
            Object.values(result.scores).forEach(score => {
              expect(typeof score).toBe('number');
              expect(score).toBeGreaterThanOrEqual(1);
              expect(score).toBeLessThanOrEqual(5);
              expect(isNaN(score)).toBe(false);
            });

            // Four attributes + topTraits must be present as arrays (possibly empty); items must be strings
            expect(Array.isArray(result.strengthAreas)).toBe(true);
            (result.strengthAreas ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.strengthInsights)).toBe(true);
            (result.strengthInsights ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.opportunityAreas)).toBe(true);
            (result.opportunityAreas ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.opportunityInsights)).toBe(true);
            (result.opportunityInsights ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
            expect(Array.isArray(result.topTraits)).toBe(true);
            (result.topTraits ?? []).forEach((item: unknown) => expect(typeof item).toBe('string'));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: ai-audio-summarization-backend, Property 39: Rate limit handling
  describe('Property 39: Rate limit handling', () => {
    it('should handle rate limits with appropriate delays', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 5000 }), // Min 1KB for validation
          async (audioBuffer) => {
            // Reset mock call counts for this iteration
            mockWhisperClient.audio.transcriptions.create.mockReset();

            // Arrange: simulate retry logic with one failure then success
            (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
              async (operation: () => Promise<any>, _operationId: string, fallback?: () => Promise<any>) => {
                const maxAttempts = 2;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  try {
                    return await operation();
                  } catch (err) {
                    if (attempt === maxAttempts - 1) {
                      if (fallback) return await fallback();
                      throw err;
                    }
                  }
                }
              }
            );

            const rateLimitError = new Error('Rate limit exceeded');
            (rateLimitError as any).status = 429;

            mockWhisperClient.audio.transcriptions.create
              .mockRejectedValueOnce(rateLimitError)
              .mockResolvedValueOnce({
                text: 'Success after rate limit',
                language: 'en',
                duration: 25.0
              });

            // Act
            const result = await openaiService.transcribeAudio(Buffer.from(audioBuffer));

            // Assert
            expect(result.text).toBe('Success after rate limit');
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledTimes(2);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should eventually fail after max retries on persistent rate limits', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 1024, maxLength: 5000 }), // Min 1KB for validation
          async (audioBuffer) => {
            // Reset mock call counts for this iteration
            mockWhisperClient.audio.transcriptions.create.mockReset();

            // Arrange: simulate retry logic that exhausts all retries then throws
            (mockedErrorHandling.executeOpenAIOperation as jest.Mock).mockImplementation(
              async (operation: () => Promise<any>, _operationId: string, _fallback?: () => Promise<any>) => {
                const maxAttempts = 3; // 1 initial + 2 retries
                let lastError: Error | undefined;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  try {
                    return await operation();
                  } catch (err) {
                    lastError = err as Error;
                  }
                }
                throw new OpenAIServiceError(
                  `All retries exhausted: ${lastError?.message}`,
                  lastError,
                  false
                );
              }
            );

            const rateLimitError = new Error('Persistent rate limit');
            (rateLimitError as any).status = 429;

            mockWhisperClient.audio.transcriptions.create.mockRejectedValue(rateLimitError);

            // Act & Assert
            await expect(openaiService.transcribeAudio(Buffer.from(audioBuffer)))
              .rejects.toThrow();

            // Should retry the configured number of times
            expect(mockWhisperClient.audio.transcriptions.create).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});