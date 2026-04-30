import { PrismaClient, UserProfile } from '@prisma/client';
import OpenAI from 'openai';
import { buildAiRecommendedQuestionPrompt } from '../prompts/aiRecommendedQuestionPrompt';
import { buildQuestionPrompt } from '../prompts/questionPrompt';
import {
  BEHAVIORAL_QUESTION_POOL,
  pickUniqueRandom
} from '../data/behavioralQuestions';
import { config } from '../utils/config';
import {
  DEFAULT_COACHING_MODEL,
  modelSupportsCustomTemperature
} from './analysisService';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const QUESTION_TTL_HOURS = 24;
const SECTION_QUESTION_COUNT = 3;

export type PracticeQuestionSections = {
  aiRecommended: string[];
  domain: string[];
  behavioral: string[];
};

function isNonEmptyStringArray3(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === SECTION_QUESTION_COUNT &&
    value.every((t) => typeof t === 'string' && t.trim().length > 0)
  );
}

/** Exported for unit tests (cache JSON shapes). */
export function parseCachedQuestions(cachedJson: unknown): {
  aiRecommended?: string[];
  domain?: string[];
  behavioral?: string[];
} | null {
  if (isNonEmptyStringArray3(cachedJson)) {
    // Backward compatibility: old format stored `string[3]` only (domain-like set).
    return { domain: cachedJson };
  }

  if (cachedJson && typeof cachedJson === 'object') {
    const obj = cachedJson as Record<string, unknown>;
    const aiRecommended = obj.aiRecommended;
    const domain = obj.domain;
    const behavioral = obj.behavioral;
    const parsed: {
      aiRecommended?: string[];
      domain?: string[];
      behavioral?: string[];
    } = {};
    if (isNonEmptyStringArray3(aiRecommended)) parsed.aiRecommended = aiRecommended;
    if (isNonEmptyStringArray3(domain)) parsed.domain = domain;
    if (isNonEmptyStringArray3(behavioral)) parsed.behavioral = behavioral;
    return parsed.aiRecommended || parsed.domain || parsed.behavioral ? parsed : null;
  }

  return null;
}

function parseQuestionsJsonContent(raw: string | null): string[] {
  if (!raw) {
    throw new Error('Question generation returned empty content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Question generation returned invalid JSON');
  }

  const obj = parsed as { questions?: unknown };
  if (!Array.isArray(obj.questions) || obj.questions.length !== SECTION_QUESTION_COUNT) {
    throw new Error('Question generation returned wrong format');
  }
  if (!obj.questions.every((t) => typeof t === 'string' && t.trim().length > 0)) {
    throw new Error('Question generation returned invalid question strings');
  }

  return obj.questions as string[];
}

/** Remove model-added labels like "Behavioral (accessible):" from technical/domain questions. */
export function stripLeadingCategoryPrefixFromTechnicalQuestion(text: string): string {
  const re =
    /^(?:Behavioral|Situational|Role-specific|Technical)\s*\([^)]*\)\s*:\s*/i;
  const stripped = text.replace(re, '').trim();
  return stripped.length > 0 ? stripped : text.trim();
}

export class QuestionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Returns cached questions when fresh; otherwise generates and persists a new set.
   */
  async getOrGenerateQuestions(
    userId: string,
    userProfile: UserProfile | null,
    forceRefresh = false
  ): Promise<string[]> {
    // Backward-compat wrapper: return only the domain section.
    const sections = await this.getOrGenerateQuestionSections(
      userId,
      userProfile,
      forceRefresh
    );
    return sections.domain;
  }

  /**
   * Returns cached question sections when fresh; otherwise generates and persists a new set.
   * - aiRecommended: OpenAI, curated practice themes (distinct from technical set)
   * - domain: generated from profile/target role + industry (technical)
   * - behavioral: sampled from a static pool
   */
  async getOrGenerateQuestionSections(
    userId: string,
    userProfile: UserProfile | null,
    forceRefresh = false
  ): Promise<PracticeQuestionSections> {
    const profile = userProfile ?? null;

    const cached = await this.prisma.practiceQuestion.findFirst({
      where: { userId },
      orderBy: { generatedAt: 'desc' }
    });

    const cacheIsFresh = (() => {
      if (!cached) return false;
      const ageHours =
        (Date.now() - new Date(cached.generatedAt).getTime()) / (1000 * 60 * 60);
      const contextChanged =
        cached.industry !== (profile?.targetIndustry ?? null) ||
        cached.jobTitle !== (profile?.targetJobTitle ?? null);
      return ageHours < QUESTION_TTL_HOURS && !contextChanged;
    })();

    if (cached && cacheIsFresh && !forceRefresh) {
      const parsed = parseCachedQuestions(cached.questions as unknown);
      if (parsed?.aiRecommended && parsed?.domain && parsed?.behavioral) {
        return {
          aiRecommended: parsed.aiRecommended,
          domain: parsed.domain.map(stripLeadingCategoryPrefixFromTechnicalQuestion),
          behavioral: parsed.behavioral
        };
      }
    }

    const [aiRecommended, domain, behavioral] = await Promise.all([
      this.generateAiRecommendedQuestions(profile),
      this.generateDomainQuestions(profile),
      Promise.resolve(pickUniqueRandom(BEHAVIORAL_QUESTION_POOL, SECTION_QUESTION_COUNT))
    ]);

    if (cached) {
      await this.prisma.practiceQuestion.delete({ where: { id: cached.id } });
    }

    await this.prisma.practiceQuestion.create({
      data: {
        userId,
        questions: { aiRecommended, domain, behavioral },
        industry: profile?.targetIndustry ?? null,
        jobTitle: profile?.targetJobTitle ?? null
      }
    });

    return { aiRecommended, domain, behavioral };
  }

  private async generateQuestionsViaOpenAI(
    profile: UserProfile | null,
    systemPrompt: string,
    userMessage: string
  ): Promise<string[]> {
    const model = (config.COACHING_MODEL || DEFAULT_COACHING_MODEL).trim();
    if (!model) {
      throw new Error('No coaching model configured (set COACHING_MODEL)');
    }

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      ...(modelSupportsCustomTemperature(model) ? { temperature: 0.8 } : {}),
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message?.content;
    return parseQuestionsJsonContent(raw);
  }

  private async generateAiRecommendedQuestions(profile: UserProfile | null): Promise<string[]> {
    const systemPrompt = buildAiRecommendedQuestionPrompt(profile);
    return this.generateQuestionsViaOpenAI(
      profile,
      systemPrompt,
      `Generate the ${SECTION_QUESTION_COUNT} AI-recommended practice interview questions now.`
    );
  }

  private async generateDomainQuestions(profile: UserProfile | null): Promise<string[]> {
    const systemPrompt = buildQuestionPrompt(profile);
    const raw = await this.generateQuestionsViaOpenAI(
      profile,
      systemPrompt,
      `Generate the ${SECTION_QUESTION_COUNT} domain-oriented practice interview questions now.`
    );
    return raw.map(stripLeadingCategoryPrefixFromTechnicalQuestion);
  }
}
