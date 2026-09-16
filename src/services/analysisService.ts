import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../prompts/coachingPrompt';
import { config } from '../utils/config';

export interface CoachingReport {
  overallScore: number;
  overallLabel?: string;
  summary?: string;
  attributes: {
    clarity: { score: number; feedback?: string; coachTip?: string };
    confidence: { score: number; feedback?: string; coachTip?: string };
    specificity: { score: number; feedback?: string; coachTip?: string };
    tone: { score: number; feedback?: string; coachTip?: string };
    enthusiasm: { score: number; feedback?: string; coachTip?: string };
  };
  insights: {
    strengths: string[];
    focusAreas: string[];
  };
}

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Default coaching model: GPT-5.6 Sol (replacement for retired gpt-5.3-chat-latest).
 * Override with COACHING_MODEL in .env if needed.
 * @see https://developers.openai.com/api/docs/models/gpt-5.6-sol
 * @see https://developers.openai.com/api/docs/deprecations
 */
export const DEFAULT_COACHING_MODEL = 'gpt-5.6-sol';

/**
 * Some models only allow the default temperature (e.g. GPT-5.x: not 0.3).
 * Omit `temperature` in those cases so the API uses its default.
 */
export function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.toLowerCase();
  if (m.startsWith('o') && /^o\d/i.test(model)) return false;
  if (m.startsWith('gpt-5')) return false;
  return true;
}

/**
 * Run coaching analysis on a Markdown-formatted transcript.
 */
export async function generateAIReport(markdownTranscript: string): Promise<CoachingReport> {
  const model = (config.COACHING_MODEL || DEFAULT_COACHING_MODEL).trim();
  if (!model) {
    throw new Error('No coaching model configured (set COACHING_MODEL)');
  }

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analyze this interview transcript and return the JSON coaching report:\n\n${markdownTranscript}`
      }
    ],
    ...(modelSupportsCustomTemperature(model) ? { temperature: 0.3 } : {}),
    // GPT-5.x rejects `max_tokens`; use max_completion_tokens (OpenAI SDK / API).
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
