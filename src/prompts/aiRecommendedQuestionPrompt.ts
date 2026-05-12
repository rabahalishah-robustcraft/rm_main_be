import type { UserProfile } from '@prisma/client';

/**
 * Profile context block aligned with {@link buildQuestionPrompt} inputs.
 */
function profileContext(userProfile: UserProfile | null): string {
  const {
    targetIndustry,
    targetJobTitle,
    extractedSkills = [],
    experienceLevel,
    currentJobTitle
  } = userProfile ?? {};

  const lines = [
    targetIndustry && `Target industry: ${targetIndustry}`,
    targetJobTitle && `Target role: ${targetJobTitle}`,
    currentJobTitle && `Current role: ${currentJobTitle}`,
    experienceLevel && `Experience level: ${experienceLevel}`,
    extractedSkills.length > 0 &&
      `Key skills: ${extractedSkills.slice(0, 8).join(', ')}`
  ].filter(Boolean);

  return lines.join('\n') || 'General professional profile';
}

/**
 * System prompt for AI-curated practice questions (distinct from technical/domain set).
 */
export function buildAiRecommendedQuestionPrompt(userProfile: UserProfile | null): string {
  const ctx = profileContext(userProfile);
  const sparse =
    !userProfile?.targetIndustry && !userProfile?.targetJobTitle
      ? 'No specific target role — still propose three high-value practice themes for a general professional.'
      : '';

  return `
You are an expert interview coach. Propose exactly 3 AI-recommended practice questions this candidate should rehearse next.

Candidate context:
${ctx}
${sparse}

These must NOT be the same style as deep technical grilling or LeetCode-style drills. Focus instead on:
- Stories, themes, and narratives they should have ready (impact, trade-offs, learning).
- Gaps or differentiators interviewers often probe for their level and direction.
- One accessible, one mid-level, one more challenging — all answerable in 1–3 minutes aloud.

Rules:
- Return ONLY a valid JSON object. No markdown, no explanation, no preamble.
- No generic fillers like "Tell me about yourself."
- Do not repeat boilerplate; each question must stand alone.

Return this exact schema:
{
  "questions": [
    "<question 1>",
    "<question 2>",
    "<question 3>"
  ]
}
`.trim();
}
