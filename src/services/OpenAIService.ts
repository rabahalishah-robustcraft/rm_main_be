import OpenAI from 'openai';
import { UserProfile } from '@prisma/client';
import { errorHandlingService } from './ErrorHandlingService';
import { ValidationError } from '../types/auth';
import { FILE_SIZE_LIMITS } from '../utils/constants';
import { monitoringService } from './MonitoringService';

/**
 * OpenAI Service for audio transcription and response analysis
 * Requirements: 8.1, 8.2, 8.3
 */

// Token estimation constants
const CHARS_PER_TOKEN = 4; // Approximate: 1 token ≈ 4 characters
const MAX_GPT_TOKENS = 8000; // Conservative limit for GPT-4 context window
const MAX_AUDIO_SIZE = FILE_SIZE_LIMITS.AUDIO; // 50MB

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface AIAnalysis {
  feedback: string;
  scores: {
    clarity: number;
    confidence: number;
    tone: number;
    enthusiasm: number;
    specificity: number;
  };
  insights: string[];
  /** Strength Areas: category labels for strengths (e.g. technical, leadership, communication). */
  strengthAreas?: string[];
  /** Strength Insights: bullet-point insights describing what the candidate did well. */
  strengthInsights?: string[];
  /** Opportunity Areas: category labels for areas to improve (e.g. structure, specificity, examples). */
  opportunityAreas?: string[];
  /** Specific observations explaining what needs improvement and why (actionable details). */
  opportunityInsights?: string[];
  /** Top 2–3 positive traits with bullet-point style descriptions based on the response. */
  topTraits?: string[];
  aiAttributes: Record<string, any>;
}

export interface UserContext {
  profile: UserProfile;
  targetRole?: {
    industry: string;
    jobTitle: string;
  };
  /** Optional summary of past sessions for context-aware analysis (DB retrieval of past events) */
  pastSessionsSummary?: string;
}

export interface ResumeData {
  skills: string[];
  experienceLevel: string;
  industries: string[];
  jobTitles: string[];
  summary: string;
  fullName?: string;
  currentJobTitle?: string;
  currentCompany?: string;
  school?: string;
  degreeInfo?: string;
  previousJobTitles?: string[];
}

/**
 * Configuration for OpenAI API client
 * Requirements: 1.1, 2.1, 10.3
 */
interface OpenAIConfig {
  gptApiKey: string;      // For GPT operations
  whisperApiKey: string;  // For Whisper operations
  maxRetries: number;
  timeout: number;
}

/**
 * Load OpenAI configuration from environment variables
 * Requirements: 1.1, 2.1, 10.1, 10.3
 */
export const loadOpenAIConfig = (): OpenAIConfig => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY');
  }

  if (!process.env.WHISPER_API_KEY) {
    throw new Error('Missing required environment variable: WHISPER_API_KEY');
  }

  return {
    gptApiKey: process.env.OPENAI_API_KEY,
    whisperApiKey: process.env.WHISPER_API_KEY,
    maxRetries: 3,
    timeout: 60000 // 60 seconds
  };
};

/**
 * Validate OpenAI configuration
 * Requirements: 1.1, 2.1, 10.1, 10.3
 */
export const validateOpenAIConfig = (config: OpenAIConfig): void => {
  if (!config.gptApiKey || config.gptApiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY (gptApiKey) cannot be empty');
  }

  if (!config.whisperApiKey || config.whisperApiKey.trim() === '') {
    throw new Error('WHISPER_API_KEY (whisperApiKey) cannot be empty');
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    throw new Error('maxRetries must be between 0 and 10');
  }

  if (config.timeout < 1000 || config.timeout > 300000) {
    throw new Error('timeout must be between 1000ms and 300000ms');
  }
};

/**
 * Custom error class for OpenAI service errors
 */
export class OpenAIServiceError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'OpenAIServiceError';
  }
}

/**
 * OpenAI Service implementation with retry logic and error handling
 * Requirements: 8.1, 8.2, 8.3, 1.1, 1.2, 2.1, 2.2
 */
export class OpenAIService {
  private gptClient: OpenAI;
  private whisperClient: OpenAI;
  private config: OpenAIConfig;

  constructor(config?: Partial<OpenAIConfig>) {
    this.config = { ...loadOpenAIConfig(), ...config };
    
    // Create separate client instances for GPT and Whisper operations
    // Requirements: 1.1, 2.1
    this.gptClient = new OpenAI({
      apiKey: this.config.gptApiKey,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout
    });
    
    this.whisperClient = new OpenAI({
      apiKey: this.config.whisperApiKey,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout
    });
  }

  /**
   * Validate audio buffer before transcription
   * Requirements: 9.1, 9.5
   */
  private validateAudioBuffer(audioBuffer: Buffer): void {
    // Validate buffer is not empty
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new ValidationError('Audio buffer cannot be empty');
    }

    // Validate buffer is within size limits
    if (audioBuffer.length > MAX_AUDIO_SIZE) {
      throw new ValidationError(
        `Audio file size (${audioBuffer.length} bytes) exceeds maximum allowed size of ${MAX_AUDIO_SIZE} bytes (${Math.round(MAX_AUDIO_SIZE / 1024 / 1024)}MB)`
      );
    }

    // Validate minimum size (at least 1KB to be a valid audio file)
    if (audioBuffer.length < 1024) {
      throw new ValidationError(
        'Audio file is too small to be a valid audio file (minimum 1KB required)'
      );
    }
  }

  /**
   * Validate text input before GPT API calls
   * Requirements: 9.2, 9.5
   */
  private validateTextInput(text: string, fieldName: string = 'Text'): void {
    // Validate text is not empty
    if (!text || text.trim().length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`);
    }

    // Estimate token count (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    
    // Validate text is within token limits
    if (estimatedTokens > MAX_GPT_TOKENS) {
      throw new ValidationError(
        `${fieldName} is too long (estimated ${estimatedTokens} tokens). Maximum allowed is ${MAX_GPT_TOKENS} tokens (approximately ${MAX_GPT_TOKENS * CHARS_PER_TOKEN} characters)`
      );
    }

    // Validate minimum length (at least 10 characters for meaningful analysis)
    if (text.trim().length < 10) {
      throw new ValidationError(
        `${fieldName} is too short (minimum 10 characters required for meaningful analysis)`
      );
    }
  }

  /**
   * Transcribe audio using OpenAI Whisper API with comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 1.1, 1.2, 9.1, 9.5
   */
  async transcribeAudio(audioBuffer: Buffer, filename: string = 'audio.wav'): Promise<TranscriptionResult> {
    // Requirement 9.1: Validate audio buffer before API call
    this.validateAudioBuffer(audioBuffer);

    const requestId = `transcribe_audio_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting OpenAI Whisper API call', {
      operationType: 'whisper_transcription',
      timestamp: new Date().toISOString(),
      requestId,
      filename,
      bufferSize: audioBuffer.length
    });

    try {
      const result = await errorHandlingService.executeOpenAIOperation(
        async () => {
          const file = new File([audioBuffer], filename, { type: 'audio/wav' });
          
          // Use whisperClient for transcription operations
          // Requirements: 1.1, 1.2
          const transcription = await this.whisperClient.audio.transcriptions.create({
            file: file,
            model: 'whisper-1',
            response_format: 'verbose_json',
            language: 'en'
          });

          return {
            text: transcription.text,
            language: transcription.language,
            duration: transcription.duration
          };
        },
        requestId,
        // Fallback: return empty transcription to allow manual processing
        async () => {
          // Requirement 8.4: Log when fallback logic is triggered
          console.warn('Whisper API fallback triggered', {
            operationType: 'whisper_transcription',
            requestId,
            reason: 'All retry attempts exhausted',
            fallbackAction: 'Returning placeholder transcription'
          });
          
          return {
            text: '[Transcription temporarily unavailable - please try again later]',
            language: 'en',
            duration: 0
          };
        }
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('OpenAI Whisper API call succeeded', {
        operationType: 'whisper_transcription',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          textLength: result.text.length,
          language: result.language,
          duration: result.duration
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('openai', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('OpenAI Whisper API call failed', {
        operationType: 'whisper_transcription',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          filename,
          bufferSize: audioBuffer.length,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        'openai', 
        false, 
        responseTime, 
        (error as any).code || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Analyze response using OpenAI GPT API with user context and comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 4.1, 4.2, 4.3, 4.4, 2.1, 2.2, 9.2, 9.5
   */
  async analyzeResponse(transcript: string, userContext: UserContext): Promise<AIAnalysis> {
    // Requirement 9.2: Validate text input before API call
    this.validateTextInput(transcript, 'Transcript');

    const requestId = `analyze_response_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting OpenAI GPT API call for response analysis', {
      operationType: 'gpt_analysis',
      timestamp: new Date().toISOString(),
      requestId,
      transcriptLength: transcript.length,
      userId: userContext.profile.id,
      targetRole: userContext.targetRole?.jobTitle || userContext.profile.targetJobTitle
    });

    try {
      const result = await errorHandlingService.executeOpenAIOperation(
        async () => {
          const prompt = this.generateAnalysisPrompt(transcript, userContext);
          
          // Use gptClient for analysis operations
          // Requirements: 2.1, 2.2
          const completion = await this.gptClient.chat.completions.create({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are an expert interview coach and career advisor. For each response you must return: (1) scores 1–5, (2) feedback and general insights, (3) Strength Areas and Strength Insights, (4) Opportunity Areas and Opportunity Insights, and (5) top traits. Strength Areas = category labels for strengths; Strength Insights = bullet insights on what they did well; Opportunity Areas = category labels for improvement; Opportunity Insights = specific observations on what needs improvement and why (actionable details). Always write all feedback, insights, strengthInsights, opportunityInsights, and topTraits in second person ("you", "your") as if talking directly to the candidate. Never use the candidate\'s name or third person (e.g. avoid "Henry should"); use "You should", "Your response", "Consider adding", etc. Use a warm, human-like tone—a supportive coach talking to the person, not a report about them.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 2000
          });

          const responseText = completion.choices[0]?.message?.content;
          if (!responseText) {
            throw new OpenAIServiceError('Empty response from GPT API');
          }

          return this.parseAnalysisResponse(responseText, userContext);
        },
        requestId,
        // Fallback: provide basic analysis based on transcript length and keywords
        async () => {
          // Requirement 8.4: Log when fallback logic is triggered
          console.warn('GPT API fallback triggered for response analysis', {
            operationType: 'gpt_analysis',
            requestId,
            reason: 'All retry attempts exhausted',
            fallbackAction: 'Using basic text analysis'
          });
          
          return this.generateFallbackAnalysis(transcript, userContext);
        }
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('OpenAI GPT API call for response analysis succeeded', {
        operationType: 'gpt_analysis',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          feedbackLength: result.feedback.length,
          insightsCount: result.insights.length,
          averageScore: Object.values(result.scores).reduce((a, b) => a + b, 0) / Object.keys(result.scores).length
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('openai', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('OpenAI GPT API call for response analysis failed', {
        operationType: 'gpt_analysis',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          transcriptLength: transcript.length,
          userId: userContext.profile.id,
          targetRole: userContext.targetRole?.jobTitle || userContext.profile.targetJobTitle,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        'openai', 
        false, 
        responseTime, 
        (error as any).code || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Extract resume data using OpenAI GPT API with comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 2.2, 2.1, 9.2, 9.5
   */
  async extractResumeData(resumeText: string): Promise<ResumeData> {
    // Requirement 9.2: Validate text input before API call
    this.validateTextInput(resumeText, 'Resume text');

    const requestId = `extract_resume_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting OpenAI GPT API call for resume extraction', {
      operationType: 'gpt_resume_extraction',
      timestamp: new Date().toISOString(),
      requestId,
      resumeTextLength: resumeText.length
    });

    try {
      const result = await errorHandlingService.executeOpenAIOperation(
        async () => {
          const prompt = this.generateResumeExtractionPrompt(resumeText);
          
          // Use gptClient for resume extraction operations
          // Requirements: 2.1, 2.2
          const completion = await this.gptClient.chat.completions.create({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are an expert resume parser. Extract structured information from resumes and return it in JSON format.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.1,
            max_tokens: 1500
          });

          const responseText = completion.choices[0]?.message?.content;
          if (!responseText) {
            throw new OpenAIServiceError('Empty response from GPT API');
          }

          return this.parseResumeData(responseText);
        },
        requestId,
        // Fallback: basic keyword extraction from resume text
        async () => {
          // Requirement 8.4: Log when fallback logic is triggered
          console.warn('GPT API fallback triggered for resume extraction', {
            operationType: 'gpt_resume_extraction',
            requestId,
            reason: 'All retry attempts exhausted',
            fallbackAction: 'Using basic keyword extraction'
          });
          
          return this.generateFallbackResumeData(resumeText);
        }
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('OpenAI GPT API call for resume extraction succeeded', {
        operationType: 'gpt_resume_extraction',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          skillsCount: result.skills.length,
          experienceLevel: result.experienceLevel,
          industriesCount: result.industries.length,
          jobTitlesCount: result.jobTitles.length
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('openai', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('OpenAI GPT API call for resume extraction failed', {
        operationType: 'gpt_resume_extraction',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          resumeTextLength: resumeText.length,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        'openai', 
        false, 
        responseTime, 
        (error as any).code || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Generate personalized prompt based on user profile
   * Requirements: 4.5
   */
  generatePersonalizedPrompt(userProfile: UserProfile): string {
    const { targetIndustry, targetJobTitle, aiAttributes, extractedSkills } = userProfile;
    
    let prompt = 'Here\'s a personalized interview question for you:\n\n';
    
    if (targetIndustry && targetJobTitle) {
      prompt += `As someone targeting a ${targetJobTitle} role in ${targetIndustry}, `;
    }
    
    if (extractedSkills && extractedSkills.length > 0) {
      prompt += `with skills in ${extractedSkills.slice(0, 3).join(', ')}, `;
    }
    
    // Use AI attributes to personalize the question
    const attributes = aiAttributes as Record<string, any> || {};
    if (attributes.communicationStyle === 'detailed') {
      prompt += 'provide a comprehensive answer that demonstrates your analytical thinking. ';
    } else if (attributes.communicationStyle === 'concise') {
      prompt += 'give a clear and concise response that highlights your key points. ';
    }
    
    prompt += 'Tell me about a challenging project you worked on and how you overcame obstacles.';
    
    return prompt;
  }

  /**
   * Generate analysis prompt with user context
   * Requirements: 4.1, 4.5
   */
  private generateAnalysisPrompt(transcript: string, userContext: UserContext): string {
    const { profile } = userContext;
    const targetRole = userContext.targetRole || {
      industry: profile.targetIndustry || 'Technology',
      jobTitle: profile.targetJobTitle || 'Software Engineer'
    };

    const pastSessionsBlock = userContext.pastSessionsSummary
      ? `

PAST SESSIONS (for context on this candidate's progress and recurring themes):
${userContext.pastSessionsSummary}

Use this context to note trends, recurring strengths or improvement areas, and progress over time where relevant.
`
      : '';

    return `
Analyze this interview response for a ${targetRole.jobTitle} position in ${targetRole.industry}. Address the candidate directly using "you" and "your" in all feedback, insights, strengthInsights, opportunityInsights, and topTraits. Use a warm, human-like tone as if you are their coach talking to them.

TRANSCRIPT: "${transcript}"

USER CONTEXT:
- Target Role: ${targetRole.jobTitle} in ${targetRole.industry}
- Skills: ${profile.extractedSkills?.join(', ') || 'Not specified'}
- Experience Level: ${profile.experienceLevel || 'Not specified'}
${pastSessionsBlock}

Please provide analysis in this exact JSON format:
{
  "feedback": "Detailed feedback paragraph about the response quality and content, addressing the candidate with you/your",
  "scores": {
    "clarity": 4,
    "confidence": 4,
    "tone": 5,
    "enthusiasm": 4,
    "specificity": 3
  },
  "insights": [
    "You clearly articulated your background and goals",
    "You could add more specific examples to strengthen impact",
    "Consider aligning your examples more closely with the target role"
  ],
  "strengthAreas": ["technical", "leadership", "communication", "problem-solving"],
  "strengthInsights": [
    "You clearly articulated your background and goals",
    "You demonstrated relevant experience with concrete examples",
    "Your delivery was confident and structured"
  ],
  "opportunityAreas": ["structure", "specificity", "examples", "public-speaking"],
  "opportunityInsights": [
    "You could add specific examples of projects or outcomes to strengthen impact",
    "Clarifying constraints or scope before diving into details would improve your structure",
    "More concrete metrics or results would strengthen your response"
  ],
  "topTraits": [
    "Clear communicator – you introduced your background and goals concisely",
    "Technical depth – you demonstrated hands-on experience with relevant systems",
    "Goal-oriented – you stated your target role and linked it to experience"
  ],
  "aiAttributes": {
    "communicationStyle": "detailed|concise|storytelling"
  }
}

Rules:
- Scores: integers 1–5 (inclusive) for each category.
- insights: general bullet-style observations and recommendations.
- Strength Areas (strengthAreas): 3–5 category labels for strengths (e.g. technical, leadership, communication, problem-solving).
- Strength Insights (strengthInsights): 2–4 bullet-point insights describing what the candidate did well; strength-based only.
- Opportunity Areas (opportunityAreas): 3–5 category labels for areas to improve (e.g. structure, specificity, examples, public-speaking).
- Opportunity Insights (opportunityInsights): 2–4 specific observations explaining what needs improvement and why; actionable details (e.g. where a better approach was possible, what was missing, what to refine).
- topTraits: exactly 2–3 top positive traits, each as a short bullet (e.g. "Strong technical communication – you explained concepts clearly").
- Tone: second person only (you/your). Direct address to the candidate; never use their name or third person. Human-like, supportive coach voice.
`;
  }

  /**
   * Generate resume extraction prompt
   * Requirements: 2.2
   */
  private generateResumeExtractionPrompt(resumeText: string): string {
    return `
Extract structured information from this resume text:

RESUME TEXT: "${resumeText}"

Please provide the extracted information in this exact JSON format:
{
  "fullName": "Full name of the candidate",
  "currentJobTitle": "Current or most recent job title",
  "currentCompany": "Current or most recent company",
  "school": "Most recent or highest level educational institution",
  "degreeInfo": "Degree information (e.g., Bachelor of Science in Computer Science)",
  "previousJobTitles": ["Previous job title 1", "Previous job title 2"],
  "skills": ["skill1", "skill2", "skill3"],
  "experienceLevel": "Entry|Mid|Senior|Executive",
  "industries": ["industry1", "industry2"],
  "jobTitles": ["title1", "title2"],
  "summary": "Brief professional summary"
}

Focus on extracting:
- Full name from the top of the resume
- Current job title and company
- Educational background (school and degree)
- Previous job titles (optional, if available)
- Technical skills and relevant experience
- Career progression and experience level
`;
  }

  /**
   * Parse analysis response from GPT
   * Requirements: 8.4
   */
  private parseAnalysisResponse(responseText: string, userContext: UserContext): AIAnalysis {
    try {
      // Extract JSON from response (handle cases where GPT adds extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate required fields
      if (!parsed.feedback || !parsed.scores || !parsed.insights) {
        throw new Error('Missing required fields in analysis response');
      }

      // Normalize scores to 1-5 (clamp if LLM returns 0-100 or out of range)
      const scoreFields = ['clarity', 'confidence', 'tone', 'enthusiasm', 'specificity'] as const;
      const clampScore = (n: unknown): number => {
        const num = typeof n === 'number' && !Number.isNaN(n) ? n : 0;
        return Math.max(1, Math.min(5, Math.round(num)));
      };
      const scores = {
        clarity: clampScore(parsed.scores?.clarity),
        confidence: clampScore(parsed.scores?.confidence),
        tone: clampScore(parsed.scores?.tone),
        enthusiasm: clampScore(parsed.scores?.enthusiasm),
        specificity: clampScore(parsed.scores?.specificity)
      };

      // Normalize strengthAreas: top-level or aiAttributes.strengthAreas
      const strengthAreas: string[] = Array.isArray(parsed.strengthAreas)
        ? parsed.strengthAreas.map((item: unknown) => String(item)).filter(Boolean)
        : Array.isArray(parsed.aiAttributes?.strengthAreas)
          ? parsed.aiAttributes.strengthAreas.map((item: unknown) => String(item)).filter(Boolean)
          : [];

      // Normalize strengthInsights (bullet insights about strengths)
      const strengthInsights: string[] = Array.isArray(parsed.strengthInsights)
        ? parsed.strengthInsights.map((item: unknown) => String(item)).filter(Boolean)
        : [];

      // Normalize opportunityAreas: top-level or aiAttributes.improvementAreas
      const opportunityAreas: string[] = Array.isArray(parsed.opportunityAreas)
        ? parsed.opportunityAreas.map((item: unknown) => String(item)).filter(Boolean)
        : Array.isArray(parsed.aiAttributes?.improvementAreas)
          ? parsed.aiAttributes.improvementAreas.map((item: unknown) => String(item)).filter(Boolean)
          : [];

      // Normalize opportunityInsights (improvement-focused observations): use parsed array or []
      const opportunityInsights: string[] = Array.isArray(parsed.opportunityInsights)
        ? parsed.opportunityInsights.map((item: unknown) => String(item)).filter(Boolean)
        : [];

      // Normalize topTraits (2–3 top positive traits as bullet points)
      const topTraits: string[] = Array.isArray(parsed.topTraits)
        ? parsed.topTraits.map((item: unknown) => String(item)).filter(Boolean)
        : [];

      return {
        feedback: parsed.feedback,
        scores: {
          clarity: scores.clarity,
          confidence: scores.confidence,
          tone: scores.tone,
          enthusiasm: scores.enthusiasm,
          specificity: scores.specificity
        },
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        strengthAreas,
        strengthInsights,
        opportunityAreas,
        opportunityInsights,
        topTraits,
        aiAttributes: (() => {
          const attrs = { ...(parsed.aiAttributes || {}) };
          delete attrs.strengthAreas;
          delete attrs.improvementAreas;
          return attrs;
        })()
      };
    } catch (error) {
      throw new OpenAIServiceError(
        'Failed to parse analysis response',
        error as Error
      );
    }
  }

  /**
   * Parse resume data from GPT response
   * Requirements: 8.4
   */
  private parseResumeData(responseText: string): ResumeData {
    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        fullName: parsed.fullName || undefined,
        currentJobTitle: parsed.currentJobTitle || undefined,
        currentCompany: parsed.currentCompany || undefined,
        school: parsed.school || undefined,
        degreeInfo: parsed.degreeInfo || undefined,
        previousJobTitles: Array.isArray(parsed.previousJobTitles) ? parsed.previousJobTitles : undefined,
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        experienceLevel: parsed.experienceLevel || 'Mid',
        industries: Array.isArray(parsed.industries) ? parsed.industries : [],
        jobTitles: Array.isArray(parsed.jobTitles) ? parsed.jobTitles : [],
        summary: parsed.summary || ''
      };
    } catch (error) {
      throw new OpenAIServiceError(
        'Failed to parse resume data',
        error as Error
      );
    }
  }

  /**
   * Generate fallback analysis when OpenAI API is unavailable
   * Requirements: 8.3
   */
  private generateFallbackAnalysis(transcript: string, userContext: UserContext): AIAnalysis {
    const wordCount = transcript.split(/\s+/).length;
    const hasSpecificExamples = /example|instance|case|situation|time when/i.test(transcript);
    const hasNumbers = /\d+/.test(transcript);
    const hasConfidentLanguage = /confident|sure|definitely|absolutely/i.test(transcript);
    
    // Basic scoring 1-5 based on transcript analysis
    const baseScore = Math.min(5, Math.max(1, Math.floor(wordCount / 50) + 2)); // 1-5 range based on length
    const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
    
    return {
      feedback: `Based on basic analysis: Your response was ${wordCount} words long. ${
        hasSpecificExamples ? 'Good use of specific examples. ' : 'Consider adding more specific examples. '
      }${
        hasNumbers ? 'Nice inclusion of quantifiable details. ' : 'Try to include more quantifiable details. '
      }Note: This is a simplified analysis due to temporary service limitations.`,
      scores: {
        clarity: clamp(baseScore + (hasSpecificExamples ? 1 : -1)),
        confidence: clamp(baseScore + (hasConfidentLanguage ? 1 : -1)),
        tone: clamp(baseScore),
        enthusiasm: clamp(baseScore + (transcript.includes('!') ? 1 : -1)),
        specificity: clamp(baseScore + (hasNumbers ? 1 : -1))
      },
      insights: [
        hasSpecificExamples ? 'You used concrete examples well' : 'Add more specific examples to strengthen your response',
        wordCount > 100 ? 'Your response length was good' : 'Consider providing more detailed responses',
        'Full AI analysis will be available when service is restored'
      ],
      strengthAreas: hasSpecificExamples ? ['examples', 'content'] : ['brevity', 'clarity'],
      strengthInsights: [
        hasSpecificExamples ? 'You used concrete examples to support your points' : 'You kept your response concise and focused',
        wordCount > 50 ? 'You provided substantive content' : 'You delivered a clear, direct answer',
        'Full strength insights will be available when AI analysis is restored'
      ],
      opportunityAreas: ['full-analysis-pending'],
      opportunityInsights: [
        hasSpecificExamples ? 'Consider adding more concrete metrics or outcomes to demonstrate your impact' : 'Consider adding more specific examples or metrics to strengthen your response',
        wordCount > 100 ? 'You could refine your structure (opening, key points, closing) for clarity' : 'Consider expanding with a bit more detail while staying concise',
        'Full opportunity insights will be available when AI analysis is restored'
      ],
      topTraits: [
        hasSpecificExamples ? 'You use concrete examples to support your points' : 'You are concise and direct in communication',
        wordCount > 50 ? 'You demonstrate ability to elaborate on experience' : 'Your response was clear and focused',
        'Full top traits will be available when AI analysis is restored'
      ],
      aiAttributes: {
        communicationStyle: wordCount > 150 ? 'detailed' : 'concise'
      }
    };
  }

  /**
   * Generate fallback resume data when OpenAI API is unavailable
   * Requirements: 8.3
   */
  private generateFallbackResumeData(resumeText: string): ResumeData {
    const text = resumeText.toLowerCase();
    
    // Basic keyword extraction
    const techSkills = ['javascript', 'python', 'java', 'react', 'node', 'sql', 'aws', 'docker']
      .filter(skill => text.includes(skill));
    
    const softSkills = ['leadership', 'communication', 'teamwork', 'management', 'analysis']
      .filter(skill => text.includes(skill));
    
    const skills = [...techSkills, ...softSkills];
    
    // Determine experience level based on keywords
    let experienceLevel = 'Mid';
    if (text.includes('senior') || text.includes('lead') || text.includes('manager')) {
      experienceLevel = 'Senior';
    } else if (text.includes('junior') || text.includes('intern') || text.includes('entry')) {
      experienceLevel = 'Entry';
    }
    
    return {
      skills,
      experienceLevel,
      industries: [], // Would need more sophisticated parsing
      jobTitles: [], // Would need more sophisticated parsing
      summary: 'Resume processed with basic extraction due to temporary service limitations. Full AI analysis will be available when service is restored.'
    };
  }
}