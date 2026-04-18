import type { UserProfile } from '@prisma/client';

/**
 * Build a system prompt for generating 3 contextual practice interview questions.
 */
export function buildQuestionPrompt(userProfile: UserProfile | null): string {
  const {
    targetIndustry,
    targetJobTitle,
    extractedSkills = [],
    experienceLevel,
    currentJobTitle
  } = userProfile ?? {};

  const context = [
    targetIndustry && `Target industry: ${targetIndustry}`,
    targetJobTitle && `Target role: ${targetJobTitle}`,
    currentJobTitle && `Current role: ${currentJobTitle}`,
    experienceLevel && `Experience level: ${experienceLevel}`,
    extractedSkills.length > 0 &&
      `Key skills: ${extractedSkills.slice(0, 8).join(', ')}`
  ]
    .filter(Boolean)
    .join('\n');

  const fallback =
    !targetIndustry && !targetJobTitle
      ? 'No specific target role provided — generate well-rounded behavioral and situational questions suitable for a general professional audience.'
      : '';

  return `
You are an expert technical recruiter and interview coach.
Generate exactly 3 interview practice questions for a candidate with the following profile:

${context || 'General professional profile'}
${fallback}

Rules:
- Return ONLY a valid JSON object. No markdown, no explanation, no preamble.
- Mix question types: at least one behavioral, one situational, one role/skill-specific.
- Questions must be specific and meaningful — no generic fillers like "Tell me about yourself."
- Each question should be answerable in 1–3 minutes by a candidate speaking aloud.
- Vary difficulty: one accessible, one mid-level, one challenging.

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
