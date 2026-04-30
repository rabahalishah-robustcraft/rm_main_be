import {
  parseCachedQuestions,
  stripLeadingCategoryPrefixFromTechnicalQuestion
} from '../../../src/services/questionService';

const three = (prefix: string) => [`${prefix} 1`, `${prefix} 2`, `${prefix} 3`];

describe('parseCachedQuestions', () => {
  it('parses legacy top-level string[3] as domain only', () => {
    const q = three('D');
    expect(parseCachedQuestions(q)).toEqual({ domain: q });
  });

  it('parses full object with aiRecommended, domain, behavioral', () => {
    const payload = {
      aiRecommended: three('A'),
      domain: three('D'),
      behavioral: three('B')
    };
    expect(parseCachedQuestions(payload)).toEqual(payload);
  });

  it('parses partial object when only domain and behavioral (missing aiRecommended)', () => {
    const payload = {
      domain: three('D'),
      behavioral: three('B')
    };
    expect(parseCachedQuestions(payload)).toEqual(payload);
  });

  it('returns null for empty object', () => {
    expect(parseCachedQuestions({})).toBeNull();
  });

  it('rejects wrong-length arrays', () => {
    expect(
      parseCachedQuestions({
        aiRecommended: ['a', 'b'],
        domain: three('D'),
        behavioral: three('B')
      })
    ).toEqual({
      domain: three('D'),
      behavioral: three('B')
    });
  });
});

describe('stripLeadingCategoryPrefixFromTechnicalQuestion', () => {
  it('strips Behavioral / Situational / Role-specific / Technical tag prefixes', () => {
    expect(
      stripLeadingCategoryPrefixFromTechnicalQuestion(
        'Behavioral (accessible): Tell me about a refactor.'
      )
    ).toBe('Tell me about a refactor.');
    expect(
      stripLeadingCategoryPrefixFromTechnicalQuestion(
        'Situational (mid-level): How would you design X?'
      )
    ).toBe('How would you design X?');
    expect(
      stripLeadingCategoryPrefixFromTechnicalQuestion(
        'Role-specific (challenging): Explain microservices latency.'
      )
    ).toBe('Explain microservices latency.');
  });

  it('leaves untagged questions unchanged', () => {
    const q = 'How would you scale this API?';
    expect(stripLeadingCategoryPrefixFromTechnicalQuestion(q)).toBe(q);
  });
});
