import { Prisma, PrismaClient } from '@prisma/client';
import prismaClient from '../lib/prisma';
import { ProfileService } from './ProfileService';
import { OpenAIService, ResumeData } from './OpenAIService';
import { S3Service } from './S3Service';
import {
  ConflictError,
  NotFoundError,
  ProfileUpdateData,
  UpdateProfileData,
  UserProfile,
  ValidationError
} from '../types/auth';
import { ValidationUtils, profileSchemas } from '../utils/validation';

function nonEmpty(s?: string | null): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

function resumeDataToUpdate(data: ResumeData): UpdateProfileData {
  const u: UpdateProfileData = {
    extractedSkills: data.skills,
    experienceLevel: data.experienceLevel
  };
  if (data.fullName) u.fullName = data.fullName;
  if (data.currentJobTitle) u.currentJobTitle = data.currentJobTitle;
  if (data.currentCompany) u.currentCompany = data.currentCompany;
  if (data.school) u.school = data.school;
  if (data.degreeInfo) u.degreeInfo = data.degreeInfo;
  if (data.previousJobTitles?.length) u.previousJobTitles = data.previousJobTitles;
  if (data.industries?.length) u.targetIndustry = data.industries[0];
  if (data.jobTitles?.length) u.targetJobTitle = data.jobTitles[0];
  return u;
}

function uniqStrings(a: string[]): string[] {
  return [...new Set(a.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Merge voice-derived extraction into existing profile scalars without overwriting filled fields.
 * Unions skills and previous job titles. Exported for unit tests.
 */
export function mergeVoiceExtractIntoProfile(
  current: UpdateProfileData,
  voiceData: ResumeData
): UpdateProfileData {
  const v = resumeDataToUpdate(voiceData);
  const out: UpdateProfileData = { ...current };

  const fillScalar = (key: keyof UpdateProfileData) => {
    const incoming = v[key];
    if (incoming === undefined || incoming === null) return;
    if (typeof incoming === 'string' && !nonEmpty(incoming)) return;
    const cur = out[key];
    const curStr = cur == null ? '' : String(cur);
    if (!nonEmpty(curStr)) {
      (out as Record<string, unknown>)[key as string] = incoming;
    }
  };

  for (const key of [
    'fullName',
    'currentJobTitle',
    'currentCompany',
    'school',
    'degreeInfo',
    'experienceLevel'
  ] as const) {
    fillScalar(key);
  }

  if (v.targetIndustry && !nonEmpty(out.targetIndustry)) {
    out.targetIndustry = v.targetIndustry;
  }
  if (v.targetJobTitle && !nonEmpty(out.targetJobTitle)) {
    out.targetJobTitle = v.targetJobTitle;
  }

  if (v.previousJobTitles?.length) {
    out.previousJobTitles = uniqStrings([...(out.previousJobTitles ?? []), ...v.previousJobTitles]);
  }
  if (v.extractedSkills?.length) {
    out.extractedSkills = uniqStrings([...(out.extractedSkills ?? []), ...v.extractedSkills]);
  }

  return out;
}

function buildDeterministicContext(profile: UpdateProfileData, transcript?: string): Record<string, unknown> {
  const lines: string[] = [];
  const entries: Record<string, string> = {};
  const add = (k: string, v?: string | string[] | null) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      if (!v.length) return;
      entries[k] = v.join(', ');
      lines.push(`${k}: ${entries[k]}`);
      return;
    }
    if (!nonEmpty(v)) return;
    entries[k] = v.trim();
    lines.push(`${k}: ${entries[k]}`);
  };
  add('fullName', profile.fullName ?? undefined);
  add('currentJobTitle', profile.currentJobTitle ?? undefined);
  add('currentCompany', profile.currentCompany ?? undefined);
  add('school', profile.school ?? undefined);
  add('degreeInfo', profile.degreeInfo ?? undefined);
  add('previousJobTitles', profile.previousJobTitles);
  add('targetIndustry', profile.targetIndustry ?? undefined);
  add('targetJobTitle', profile.targetJobTitle ?? undefined);
  add('experienceLevel', profile.experienceLevel ?? undefined);
  add('skills', profile.extractedSkills);

  return {
    personalizationSummary: lines.join('\n'),
    fields: entries,
    introductionTranscript: transcript?.trim() || undefined,
    builtAt: new Date().toISOString()
  };
}

function profileRowToUpdate(p: {
  fullName: string | null;
  currentJobTitle: string | null;
  currentCompany: string | null;
  school: string | null;
  degreeInfo: string | null;
  previousJobTitles: string[];
  targetIndustry: string | null;
  targetJobTitle: string | null;
  experienceLevel: string | null;
  extractedSkills: string[];
}): UpdateProfileData {
  return {
    fullName: p.fullName ?? undefined,
    currentJobTitle: p.currentJobTitle ?? undefined,
    currentCompany: p.currentCompany ?? undefined,
    school: p.school ?? undefined,
    degreeInfo: p.degreeInfo ?? undefined,
    previousJobTitles: p.previousJobTitles,
    targetIndustry: p.targetIndustry ?? undefined,
    targetJobTitle: p.targetJobTitle ?? undefined,
    experienceLevel: p.experienceLevel ?? undefined,
    extractedSkills: p.extractedSkills
  };
}

function prismaScalarsFromUpdate(u: UpdateProfileData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (u.fullName !== undefined) out.fullName = u.fullName;
  if (u.currentJobTitle !== undefined) out.currentJobTitle = u.currentJobTitle;
  if (u.currentCompany !== undefined) out.currentCompany = u.currentCompany;
  if (u.school !== undefined) out.school = u.school;
  if (u.degreeInfo !== undefined) out.degreeInfo = u.degreeInfo;
  if (u.previousJobTitles !== undefined) out.previousJobTitles = u.previousJobTitles;
  if (u.targetIndustry !== undefined) out.targetIndustry = u.targetIndustry;
  if (u.targetJobTitle !== undefined) out.targetJobTitle = u.targetJobTitle;
  if (u.experienceLevel !== undefined) out.experienceLevel = u.experienceLevel;
  if (u.extractedSkills !== undefined) out.extractedSkills = u.extractedSkills;
  return out;
}

export interface OnboardingPrimaryInput {
  resumeBuffer?: Buffer;
  resumeFilename?: string;
  /** Same shape as profile manual-entry / PUT /profile */
  manual?: ProfileUpdateData;
}

export class OnboardingService {
  constructor(
    private profileService: ProfileService,
    private openaiService: OpenAIService,
    private _s3Service: S3Service,
    private prismaInstance?: PrismaClient
  ) {}

  private get prisma(): PrismaClient {
    return this.prismaInstance || prismaClient;
  }

  private async assertNotCompleted(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true }
    });
    if (!u) {
      throw new NotFoundError('User not found');
    }
    if (u.onboardingCompletedAt) {
      throw new ConflictError('Onboarding is already complete');
    }
  }

  private hasPrimaryInProfile(p: { resumeS3Key: string | null; fullName: string | null }): boolean {
    return !!(p.resumeS3Key || nonEmpty(p.fullName));
  }

  /**
   * Screen 1: exactly one of resume upload or manual JSON (minimum fullName for manual).
   */
  async primary(userId: string, input: OnboardingPrimaryInput): Promise<UserProfile> {
    if (!ValidationUtils.isValidUUID(userId)) {
      throw new ValidationError('Invalid user ID format');
    }
    await this.assertNotCompleted(userId);

    const hasResume = !!(input.resumeBuffer?.length && input.resumeFilename);
    const hasManual = !!input.manual && Object.keys(input.manual).length > 0;

    if (hasResume === hasManual) {
      throw new ValidationError('Provide exactly one of: resume file or manual profile JSON');
    }

    if (hasResume) {
      await this.profileService.uploadResume(userId, input.resumeBuffer!, input.resumeFilename!);
    } else {
      const manual = ValidationUtils.validate<ProfileUpdateData>(
        input.manual!,
        profileSchemas.updateProfile
      );
      if (!nonEmpty(manual.fullName)) {
        throw new ValidationError('Full name is required for manual entry');
      }
      await this.profileService.updateProfile(userId, manual);
    }

    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (row) {
      await this.prisma.userProfile.update({
        where: { userId },
        data: {
          aiAttributes: {
            ...(row.aiAttributes as object),
            onboardingPrimaryAt: new Date().toISOString()
          }
        }
      });
    }

    return this.profileService.getProfile(userId);
  }

  /**
   * Optional screen: transcribe audio, extract structured fields, merge non-destructively into profile.
   */
  async voice(userId: string, audioBuffer: Buffer, audioFilename: string): Promise<UserProfile> {
    if (!ValidationUtils.isValidUUID(userId)) {
      throw new ValidationError('Invalid user ID format');
    }
    await this.assertNotCompleted(userId);

    if (!audioBuffer?.length || !audioFilename) {
      throw new ValidationError('Audio file is required');
    }

    const profileRow = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profileRow) {
      throw new NotFoundError('Profile not found');
    }

    const introductionTranscript = (
      await this.openaiService.transcribeAudio(audioBuffer, audioFilename)
    ).text;

    const voiceExtract = await this.profileService.extractStructuredResumeData(introductionTranscript);
    const baseline = profileRowToUpdate(profileRow);
    const merged = mergeVoiceExtractIntoProfile(baseline, voiceExtract);

    const nextAttrs: Prisma.InputJsonValue = {
      ...((profileRow.aiAttributes as object) ?? {}),
      introductionTranscript
    };

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...prismaScalarsFromUpdate(merged),
        aiAttributes: nextAttrs
      }
    });

    return this.profileService.getProfile(userId);
  }

  /**
   * Finalize: primary must be satisfied; builds personalizationContext and sets onboardingCompletedAt.
   */
  async complete(userId: string): Promise<UserProfile> {
    if (!ValidationUtils.isValidUUID(userId)) {
      throw new ValidationError('Invalid user ID format');
    }
    await this.assertNotCompleted(userId);

    const profileNow = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profileNow) {
      throw new NotFoundError('Profile not found');
    }

    if (!this.hasPrimaryInProfile(profileNow)) {
      throw new ValidationError(
        'Complete primary onboarding first: upload a resume or save manual profile with full name.'
      );
    }

    const fromDb = profileRowToUpdate(profileNow);
    const attrs = (profileNow.aiAttributes as Record<string, unknown>) ?? {};
    const transcript =
      typeof attrs.introductionTranscript === 'string' ? attrs.introductionTranscript : undefined;
    const context = buildDeterministicContext(fromDb, transcript);

    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { userId },
        data: {
          aiAttributes: {
            ...attrs,
            personalizationContext: context as Prisma.InputJsonValue
          } as Prisma.InputJsonValue
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { onboardingCompletedAt: new Date() }
      });
    });

    return this.profileService.getProfile(userId);
  }
}
