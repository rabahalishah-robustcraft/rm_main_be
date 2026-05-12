export const BEHAVIORAL_QUESTION_POOL: string[] = [
  'Tell me about a time you had to manage conflicting priorities. How did you decide what to do first?',
  'Describe a time you received difficult feedback. What did you do with it?',
  'Tell me about a time you made a mistake at work. How did you handle it and what did you learn?',
  'Describe a time you had to influence a decision without having authority. What was your approach?',
  'Tell me about a time you disagreed with a teammate or stakeholder. How did you resolve it?',
  'Describe a time you took ownership of a problem outside your formal responsibilities.',
  'Tell me about a time you had to learn something quickly to deliver a result. How did you ramp up?',
  'Describe a time you dealt with ambiguity. What did you do to move forward?',
  'Tell me about a time you had to communicate a complex idea to a non-technical audience.',
  'Describe a time you improved a process or system. What was the impact?',
  'Tell me about a time you faced a tight deadline. How did you plan and execute?',
  'Describe a time you had to balance quality and speed. How did you make the trade-off?',
  'Tell me about a time you had to collaborate with someone with a very different working style.',
  'Describe a time you handled a stressful situation at work. What did you do?',
  'Tell me about a time you led a project or initiative. How did you keep it on track?',
  'Describe a time you had to say no or push back. How did you communicate it?',
  'Tell me about a time you had to handle a customer or stakeholder who was unhappy.',
  'Describe a time you identified a risk early. What actions did you take?',
  'Tell me about a time you went above and beyond to help a teammate succeed.',
  'Describe a time you had to make a decision with incomplete information. What did you do?',
  'Tell me about a time you changed your mind after learning new information. What changed?',
  'Describe a time you improved your communication or collaboration based on past experience.',
  'Tell me about a time you had to handle multiple stakeholders with different goals.',
  'Describe a time you delivered a difficult message. How did you approach it?',
  'Tell me about a time you proactively identified an opportunity and acted on it.'
];

export function pickUniqueRandom<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (pool.length < count) {
    throw new Error(`Pool size (${pool.length}) must be >= count (${count})`);
  }

  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

