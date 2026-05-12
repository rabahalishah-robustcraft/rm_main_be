import { mergeVoiceExtractIntoProfile } from '../../../src/services/OnboardingService';
import type { ResumeData } from '../../../src/services/OpenAIService';
import type { UpdateProfileData } from '../../../src/types/auth';

describe('mergeVoiceExtractIntoProfile', () => {
  const baseCurrent: UpdateProfileData = {
    fullName: 'Jane Doe',
    currentJobTitle: 'Engineer',
    extractedSkills: ['TypeScript']
  };

  it('does not overwrite existing scalar fields', () => {
    const voice: ResumeData = {
      skills: ['Python'],
      experienceLevel: 'senior',
      industries: ['Tech'],
      jobTitles: ['Staff'],
      summary: '',
      fullName: 'Other Name',
      currentJobTitle: 'CEO',
      currentCompany: 'Acme',
      school: 'MIT',
      degreeInfo: 'BS',
      previousJobTitles: ['Intern']
    };

    const merged = mergeVoiceExtractIntoProfile(baseCurrent, voice);
    expect(merged.fullName).toBe('Jane Doe');
    expect(merged.currentJobTitle).toBe('Engineer');
    expect(merged.extractedSkills?.sort()).toEqual(['Python', 'TypeScript'].sort());
    expect(merged.currentCompany).toBe('Acme');
    expect(merged.school).toBe('MIT');
  });

  it('fills empty fields from voice extraction', () => {
    const sparse: UpdateProfileData = {
      fullName: 'Jane Doe',
      extractedSkills: []
    };
    const voice: ResumeData = {
      skills: ['Go'],
      industries: [],
      jobTitles: [],
      summary: '',
      experienceLevel: 'mid',
      currentCompany: 'Corp'
    };
    const merged = mergeVoiceExtractIntoProfile(sparse, voice);
    expect(merged.currentCompany).toBe('Corp');
    expect(merged.experienceLevel).toBe('mid');
    expect(merged.extractedSkills).toEqual(['Go']);
  });

  it('unions previous job titles', () => {
    const current: UpdateProfileData = {
      previousJobTitles: ['A'],
      extractedSkills: []
    };
    const voice: ResumeData = {
      skills: [],
      industries: [],
      jobTitles: [],
      summary: '',
      experienceLevel: 'entry',
      previousJobTitles: ['B', 'A']
    };
    const merged = mergeVoiceExtractIntoProfile(current, voice);
    expect(merged.previousJobTitles?.sort()).toEqual(['A', 'B']);
  });
});
