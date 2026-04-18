import OpenAI from 'openai';
import { buildPracticeCoachingPrompt } from '../prompts/practiceCoachingPrompt';
import { config } from '../utils/config';
import {
  CoachingReport,
  DEFAULT_COACHING_MODEL,
  modelSupportsCustomTemperature
} from './analysisService';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Analyze a single practice answer transcript; same report shape as full interview analysis.
 */
export async function analyzePracticeAnswer(
  transcript: string,
  question: string
): Promise<CoachingReport> {
  const model = (config.COACHING_MODEL || DEFAULT_COACHING_MODEL).trim();
  if (!model) {
    throw new Error('No coaching model configured (set COACHING_MODEL)');
  }

  const systemPrompt = buildPracticeCoachingPrompt(question);

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Here is the candidate's answer transcript:\n\n"${transcript}"`
      }
    ],
    ...(modelSupportsCustomTemperature(model) ? { temperature: 0.3 } : {}),
    max_completion_tokens: 8192,
    response_format: { type: 'json_object' }
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Coaching model returned empty content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Coaching model returned invalid JSON. Preview: ${rawContent.slice(0, 200)}`);
  }

  const p = parsed as Record<string, unknown>;
  const required = ['overallScore', 'attributes', 'insights'] as const;
  for (const field of required) {
    if (p[field] === undefined) {
      throw new Error(`Coaching response missing required field: "${field}"`);
    }
  }

  const attrs = p.attributes as CoachingReport['attributes'];
  if (
    attrs?.clarity?.score == null ||
    attrs?.confidence?.score == null ||
    attrs?.specificity?.score == null ||
    attrs?.tone?.score == null ||
    attrs?.enthusiasm?.score == null
  ) {
    throw new Error('Coaching response missing attribute scores');
  }

  return parsed as CoachingReport;
}
