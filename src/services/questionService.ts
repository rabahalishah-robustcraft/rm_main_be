import { PrismaClient, UserProfile } from '@prisma/client';
import OpenAI from 'openai';
import { buildQuestionPrompt } from '../prompts/questionPrompt';
import { config } from '../utils/config';
import {
  DEFAULT_COACHING_MODEL,
  modelSupportsCustomTemperature
} from './analysisService';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const QUESTION_TTL_HOURS = 24;

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
    const profile = userProfile ?? null;

    const cached = await this.prisma.practiceQuestion.findFirst({
      where: { userId },
      orderBy: { generatedAt: 'desc' }
    });

    if (cached && !forceRefresh) {
      const ageHours =
        (Date.now() - new Date(cached.generatedAt).getTime()) / (1000 * 60 * 60);
      const contextChanged =
        cached.industry !== (profile?.targetIndustry ?? null) ||
        cached.jobTitle !== (profile?.targetJobTitle ?? null);

      if (ageHours < QUESTION_TTL_HOURS && !contextChanged) {
        const q = cached.questions as unknown;
        if (Array.isArray(q) && q.length === 3 && q.every((x) => typeof x === 'string')) {
          return q as string[];
        }
      }
    }

    const model = (config.COACHING_MODEL || DEFAULT_COACHING_MODEL).trim();
    if (!model) {
      throw new Error('No coaching model configured (set COACHING_MODEL)');
    }

    const systemPrompt = buildQuestionPrompt(profile);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate the 3 practice interview questions now.' }
      ],
      ...(modelSupportsCustomTemperature(model) ? { temperature: 0.8 } : {}),
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message?.content;
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
    if (!Array.isArray(obj.questions) || obj.questions.length !== 3) {
      throw new Error('Question generation returned wrong format');
    }
    if (!obj.questions.every((t) => typeof t === 'string' && t.trim().length > 0)) {
      throw new Error('Question generation returned invalid question strings');
    }

    const questions = obj.questions as string[];

    if (cached) {
      await this.prisma.practiceQuestion.delete({ where: { id: cached.id } });
    }

    await this.prisma.practiceQuestion.create({
      data: {
        userId,
        questions,
        industry: profile?.targetIndustry ?? null,
        jobTitle: profile?.targetJobTitle ?? null
      }
    });

    return questions;
  }
}
