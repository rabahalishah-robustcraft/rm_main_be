import { 
  UserProfile, 
  ProfileService as IProfileService, 
  ProfileUpdateData,
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  DatabaseUserProfile,
  UpdateProfileData
} from '../types/auth';
import { ValidationUtils, profileSchemas } from '../utils/validation';
import { S3Service } from './S3Service';
import { OpenAIService, ResumeData } from './OpenAIService';
import { ResumeTextExtractor } from './ResumeTextExtractor';
import { S3_CONFIG } from '../utils/constants';
import { validateFileBuffer, sanitizeFilename, getContentTypeFromExtension } from '../utils/fileUpload';
import { PrismaClient } from '@prisma/client';
import prismaClient from '../lib/prisma';

export class ProfileService implements IProfileService {
  private resumeTextExtractor: ResumeTextExtractor;

  constructor(
    private s3Service: S3Service,
    private openaiService?: OpenAIService,
    private prismaInstance?: PrismaClient
  ) {
    this.resumeTextExtractor = new ResumeTextExtractor();
  }

  private get prisma(): PrismaClient {
    return this.prismaInstance || prismaClient;
  }

  /**
   * Get user profile by user ID
   * Requirements: 2.3, 2.4, 2.5
   */
  async getProfile(userId: string): Promise<UserProfile> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Find profile in database
      const dbProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!dbProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Convert database profile to application profile type
      return this.convertDbProfileToProfile(dbProfile);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to get profile', { error: (error as Error).message });
    }
  }

  /**
   * Update user profile with validation
   * Requirements: 2.3, 2.5
   */
  async updateProfile(userId: string, data: ProfileUpdateData): Promise<UserProfile> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Validate update data
      const validatedData = ValidationUtils.validate<ProfileUpdateData>(
        data,
        profileSchemas.updateProfile
      );

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Validate target role if provided
      if (validatedData.targetIndustry || validatedData.targetJobTitle) {
        await this.validateTargetRole(
          validatedData.targetIndustry || existingProfile.targetIndustry,
          validatedData.targetJobTitle || existingProfile.targetJobTitle
        );
      }

      // Prepare update data
      const updateData: UpdateProfileData = {};
      
      if (validatedData.fullName !== undefined) {
        updateData.fullName = validatedData.fullName;
      }
      
      if (validatedData.currentJobTitle !== undefined) {
        updateData.currentJobTitle = validatedData.currentJobTitle;
      }
      
      if (validatedData.currentCompany !== undefined) {
        updateData.currentCompany = validatedData.currentCompany;
      }
      
      if (validatedData.school !== undefined) {
        updateData.school = validatedData.school;
      }
      
      if (validatedData.degreeInfo !== undefined) {
        updateData.degreeInfo = validatedData.degreeInfo;
      }
      
      if (validatedData.previousJobTitles !== undefined) {
        updateData.previousJobTitles = validatedData.previousJobTitles;
      }
      
      if (validatedData.targetIndustry !== undefined) {
        updateData.targetIndustry = validatedData.targetIndustry;
      }
      
      if (validatedData.targetJobTitle !== undefined) {
        updateData.targetJobTitle = validatedData.targetJobTitle;
      }
      
      if (validatedData.experienceLevel !== undefined) {
        updateData.experienceLevel = validatedData.experienceLevel;
      }

      // Update profile in database
      const updatedProfile = await this.prisma.userProfile.update({
        where: { userId },
        data: updateData
      });

      return this.convertDbProfileToProfile(updatedProfile);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to update profile', { error: (error as Error).message });
    }
  }

  /**
   * Upload resume file and store S3 key
   * Requirements: 2.1, 7.1, 7.2
   */
  async uploadResume(userId: string, file: Buffer, filename: string): Promise<string> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Validate file
      if (!file || file.length === 0) {
        throw new ValidationError('File is required');
      }

      if (!filename) {
        throw new ValidationError('Filename is required');
      }

      // Validate file using utility function
      validateFileBuffer(file, filename, {
        allowedTypes: S3_CONFIG.ALLOWED_FILE_TYPES,
        maxSizeBytes: S3_CONFIG.MAX_FILE_SIZE
      });

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Extract text from PDF/DOC BEFORE uploading to S3
      // Requirements 3.2, 3.3: Use PDF/DOC parsing libraries
      // Requirement 3.5: Wrap text extraction in try-catch with descriptive errors
      let extractedText: string;
      try {
        extractedText = await this.resumeTextExtractor.extractText(file, filename);
      } catch (error) {
        const errorMessage = `Failed to extract text from resume file ${filename}: ${(error as Error).message}`;
        console.error(errorMessage, error);
        throw new ExternalServiceError(errorMessage);
      }

      // Generate unique S3 key
      const sanitizedFilename = sanitizeFilename(filename);
      const s3Key = this.s3Service.generateFileKey(S3_CONFIG.RESUME_PREFIX, userId, sanitizedFilename);

      // Get content type from file extension
      const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
      const contentType = getContentTypeFromExtension(fileExtension);

      // Upload file to S3
      await this.s3Service.upload(s3Key, file, {
        contentType,
        metadata: {
          userId,
          originalFilename: filename,
          uploadedAt: new Date().toISOString()
        }
      });

      // Delete old resume file if exists
      if (existingProfile.resumeS3Key) {
        try {
          await this.s3Service.deleteFile(existingProfile.resumeS3Key);
        } catch (error) {
          // Log error but don't fail the upload if old file deletion fails
          console.warn(`Failed to delete old resume file: ${existingProfile.resumeS3Key}`, error);
        }
      }

      // Process resume with extracted text (synchronously to ensure skills are updated)
      // This updates the profile with skills and experience level
      try {
        await this.processResumeFromText(userId, extractedText);
      } catch (error) {
        console.error(`Failed to process resume for user ${userId}:`, error);
        // Don't fail the upload if processing fails, but log the error
      }

      // Update profile with resume S3 key
      await this.prisma.userProfile.update({
        where: { userId },
        data: { resumeS3Key: s3Key }
      });

      return s3Key;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to upload resume', { error: (error as Error).message });
    }
  }

  /**
   * Process resume from extracted text using AI
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.4
   */
  async processResumeFromText(userId: string, extractedText: string): Promise<void> {
    try {
      // Validate inputs
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      if (!extractedText || extractedText.trim().length === 0) {
        throw new ValidationError('Extracted text is required');
      }

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Use OpenAI to extract structured data from the text
      // Requirement 4.1: Call OpenAIService.extractResumeData()
      if (!this.openaiService) {
        throw new ExternalServiceError('OpenAI service not available');
      }

      let resumeData: ResumeData;
      try {
        resumeData = await this.openaiService.extractResumeData(extractedText);
        
        // Validate extracted data structure before storing
        // Requirement 4.3: Validate JSON structure contains required fields
        this.validateResumeData(resumeData);
      } catch (error) {
        // Requirement 4.5: Use basic keyword extraction as fallback for GPT failures
        // Requirement 8.4: Log that fallback was used and why
        console.warn(
          `GPT extraction failed for user ${userId}, using keyword extraction fallback. ` +
          `Reason: ${(error as Error).message}`,
          error
        );
        
        resumeData = this.extractResumeDataWithKeywords(extractedText);
      }

      // Prepare update data with extracted information
      const updateData: UpdateProfileData = {
        extractedSkills: resumeData.skills,
        experienceLevel: resumeData.experienceLevel
      };

      // Add profile fields if extracted
      if (resumeData.fullName) {
        updateData.fullName = resumeData.fullName;
      }
      if (resumeData.currentJobTitle) {
        updateData.currentJobTitle = resumeData.currentJobTitle;
      }
      if (resumeData.currentCompany) {
        updateData.currentCompany = resumeData.currentCompany;
      }
      if (resumeData.school) {
        updateData.school = resumeData.school;
      }
      if (resumeData.degreeInfo) {
        updateData.degreeInfo = resumeData.degreeInfo;
      }
      if (resumeData.previousJobTitles && resumeData.previousJobTitles.length > 0) {
        updateData.previousJobTitles = resumeData.previousJobTitles;
      }

      // Update profile with extracted data
      // Requirement 4.4: Update profile with extracted data
      await this.prisma.userProfile.update({
        where: { userId },
        data: updateData
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to process resume', { error: (error as Error).message });
    }
  }

  /**
   * Process resume and extract data using AI (downloads from S3)
   * Requirements: 2.1, 2.2, 3.4, 4.1, 4.2, 4.3, 4.4, 3.5, 4.5, 8.4
   * @deprecated Use processResumeFromText during upload instead to avoid extra S3 download
   */
  async processResume(userId: string, s3Key: string): Promise<void> {
    try {
      // Validate inputs
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      if (!s3Key) {
        throw new ValidationError('S3 key is required');
      }

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Download file from S3
      // Requirement 3.4: Extract text from file buffer
      const fileBuffer = await this.s3Service.download(s3Key);

      // Extract filename from S3 key (format: resumes/{userId}/{filename})
      const filename = s3Key.split('/').pop() || s3Key;

      // Extract text from PDF/DOC using ResumeTextExtractor
      // Requirements 3.2, 3.3: Use PDF/DOC parsing libraries
      // Requirement 3.5: Wrap text extraction in try-catch with descriptive errors
      let extractedText: string;
      try {
        extractedText = await this.resumeTextExtractor.extractText(fileBuffer, filename);
      } catch (error) {
        const errorMessage = `Failed to extract text from resume file ${filename}: ${(error as Error).message}`;
        console.error(errorMessage, error);
        throw new ExternalServiceError(errorMessage);
      }

      // Use OpenAI to extract structured data from the text
      // Requirement 4.1: Call OpenAIService.extractResumeData()
      if (!this.openaiService) {
        throw new ExternalServiceError('OpenAI service not available');
      }

      let resumeData: ResumeData;
      try {
        resumeData = await this.openaiService.extractResumeData(extractedText);
        
        // Validate extracted data structure before storing
        // Requirement 4.3: Validate JSON structure contains required fields
        this.validateResumeData(resumeData);
      } catch (error) {
        // Requirement 4.5: Use basic keyword extraction as fallback for GPT failures
        // Requirement 8.4: Log that fallback was used and why
        console.warn(
          `GPT extraction failed for user ${userId}, using keyword extraction fallback. ` +
          `Reason: ${(error as Error).message}`,
          error
        );
        
        resumeData = this.extractResumeDataWithKeywords(extractedText);
      }

      // Update profile with extracted skills and experience level
      // Requirement 4.4: Update profile with extracted data
      await this.prisma.userProfile.update({
        where: { userId },
        data: {
          extractedSkills: resumeData.skills,
          experienceLevel: resumeData.experienceLevel
        }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to process resume', { error: (error as Error).message });
    }
  }

  /**
   * Set target role with validation
   * Requirements: 2.3
   */
  async setTargetRole(userId: string, industry: string, jobTitle: string): Promise<void> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Validate target role data
      const validatedData = ValidationUtils.validate<{ industry: string; jobTitle: string }>(
        { industry, jobTitle },
        profileSchemas.targetRole
      );

      // Validate target role against available options
      await this.validateTargetRole(validatedData.industry, validatedData.jobTitle);

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Update profile with target role
      await this.prisma.userProfile.update({
        where: { userId },
        data: {
          targetIndustry: validatedData.industry,
          targetJobTitle: validatedData.jobTitle
        }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to set target role', { error: (error as Error).message });
    }
  }

  /**
   * Delete user profile
   * Requirements: 9.5
   */
  async deleteProfile(userId: string): Promise<void> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Delete resume file from S3 if exists
      if (existingProfile.resumeS3Key) {
        try {
          await this.s3Service.deleteFile(existingProfile.resumeS3Key);
        } catch (error) {
          // Log error but don't fail the profile deletion if S3 cleanup fails
          console.warn(`Failed to delete resume file from S3: ${existingProfile.resumeS3Key}`, error);
        }
      }

      // Delete profile from database
      await this.prisma.userProfile.delete({
        where: { userId }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to delete profile', { error: (error as Error).message });
    }
  }

  /**
   * Store AI attributes for personalized prompt generation
   * Requirements: 2.4
   */
  async storeAIAttributes(userId: string, attributes: Record<string, any>): Promise<void> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Validate attributes
      if (!attributes || typeof attributes !== 'object') {
        throw new ValidationError('AI attributes must be a valid object');
      }

      // Check if profile exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!existingProfile) {
        throw new NotFoundError('Profile not found');
      }

      // Merge new attributes with existing ones
      const updatedAttributes = {
        ...existingProfile.aiAttributes as Record<string, any>,
        ...attributes,
        lastUpdated: new Date().toISOString()
      };

      // Update profile with AI attributes
      await this.prisma.userProfile.update({
        where: { userId },
        data: { aiAttributes: updatedAttributes }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to store AI attributes', { error: (error as Error).message });
    }
  }

  /**
   * Retrieve AI attributes for personalized prompt generation
   * Requirements: 2.4
   */
  async getAIAttributes(userId: string): Promise<Record<string, any>> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Find profile in database
      const dbProfile = await this.prisma.userProfile.findUnique({
        where: { userId },
        select: { aiAttributes: true }
      });

      if (!dbProfile) {
        throw new NotFoundError('Profile not found');
      }

      return dbProfile.aiAttributes as Record<string, any>;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to get AI attributes', { error: (error as Error).message });
    }
  }

  /**
   * Generate secure URL for resume file access
   * Requirements: 7.4
   */
  async getResumeUrl(userId: string, expiresIn: number = S3_CONFIG.SIGNED_URL_EXPIRES): Promise<string> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Get user profile
      const profile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (!profile) {
        throw new NotFoundError('Profile not found');
      }

      if (!profile.resumeS3Key) {
        throw new NotFoundError('No resume file found for this user');
      }

      // Generate signed URL
      return await this.s3Service.getSignedUrl(profile.resumeS3Key, expiresIn);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to generate resume URL', { error: (error as Error).message });
    }
  }

  /**
   * Extract resume data using basic keyword matching as fallback
   * Requirement 4.5: Use basic keyword extraction as fallback for GPT failures
   */
  private extractResumeDataWithKeywords(text: string): ResumeData {
    const lowerText = text.toLowerCase();
    
    // Common technical skills keywords
    const skillKeywords = [
      'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'ruby', 'php', 'swift', 'kotlin',
      'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring', 'laravel',
      'sql', 'mongodb', 'postgresql', 'mysql', 'redis', 'elasticsearch',
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'git', 'ci/cd',
      'html', 'css', 'rest', 'api', 'graphql', 'microservices', 'agile', 'scrum',
      'machine learning', 'ai', 'data science', 'analytics', 'testing', 'security'
    ];
    
    // Extract skills by finding keyword matches
    const extractedSkills = skillKeywords.filter(skill => 
      lowerText.includes(skill.toLowerCase())
    );
    
    // Determine experience level based on keywords
    let experienceLevel = 'entry';
    if (lowerText.includes('senior') || lowerText.includes('lead') || lowerText.includes('principal')) {
      experienceLevel = 'senior';
    } else if (lowerText.includes('mid-level') || lowerText.includes('intermediate') || 
               (lowerText.match(/\d+\s*years?/g) && parseInt(lowerText.match(/\d+/)?.[0] || '0') >= 3)) {
      experienceLevel = 'mid';
    }
    
    // Extract industries based on common keywords
    const industryKeywords = [
      'technology', 'finance', 'healthcare', 'education', 'retail', 'manufacturing',
      'consulting', 'media', 'telecommunications', 'energy', 'transportation'
    ];
    const extractedIndustries = industryKeywords.filter(industry =>
      lowerText.includes(industry.toLowerCase())
    );
    
    // Extract job titles based on common patterns
    const jobTitleKeywords = [
      'software engineer', 'developer', 'programmer', 'architect', 'manager',
      'analyst', 'designer', 'consultant', 'specialist', 'administrator',
      'data scientist', 'devops', 'qa engineer', 'product manager', 'project manager'
    ];
    const extractedJobTitles = jobTitleKeywords.filter(title =>
      lowerText.includes(title.toLowerCase())
    );
    
    // Generate a basic summary
    const summary = `Resume processed with keyword extraction. Found ${extractedSkills.length} skills. ` +
                   `Experience level: ${experienceLevel}.`;
    
    return {
      skills: extractedSkills.length > 0 ? extractedSkills : ['general'],
      experienceLevel,
      industries: extractedIndustries.length > 0 ? extractedIndustries : ['technology'],
      jobTitles: extractedJobTitles.length > 0 ? extractedJobTitles : ['professional'],
      summary
    };
  }

  /**
   * Validate target role against available industry and job title combinations
   * Requirements: 2.3
   * 
   * Note: No validation needed - allow any industry and job title combination.
   * This provides maximum flexibility for users with unique career paths,
   * emerging industries, or career switchers.
   * Industry and job title are stored as free-form text fields.
   */
  private async validateTargetRole(industry?: string | null, jobTitle?: string | null): Promise<void> {
    // No validation needed - allow any industry and job title combination
    // This provides maximum flexibility for users with unique career paths,
    // emerging industries, or career switchers
    // Industry and job title are stored as free-form text fields
    return;
  }

  /**
   * Validate resume data structure before storing
   * Requirement 4.3: Validate JSON structure contains required fields
   */
  private validateResumeData(resumeData: ResumeData): void {
    if (!resumeData) {
      throw new ValidationError('Resume data is required');
    }

    // Validate required fields exist
    if (!Array.isArray(resumeData.skills)) {
      throw new ValidationError('Resume data must contain skills array');
    }

    if (typeof resumeData.experienceLevel !== 'string' || !resumeData.experienceLevel) {
      throw new ValidationError('Resume data must contain experienceLevel string');
    }

    if (!Array.isArray(resumeData.industries)) {
      throw new ValidationError('Resume data must contain industries array');
    }

    if (!Array.isArray(resumeData.jobTitles)) {
      throw new ValidationError('Resume data must contain jobTitles array');
    }

    if (typeof resumeData.summary !== 'string') {
      throw new ValidationError('Resume data must contain summary string');
    }
  }

  /**
   * Convert database profile to application profile type
   */
  private convertDbProfileToProfile(dbProfile: DatabaseUserProfile): UserProfile {
    const profile: UserProfile = {
      id: dbProfile.id,
      userId: dbProfile.userId,
      aiAttributes: dbProfile.aiAttributes as Record<string, any>,
      extractedSkills: dbProfile.extractedSkills,
      previousJobTitles: dbProfile.previousJobTitles,
      createdAt: dbProfile.createdAt,
      updatedAt: dbProfile.updatedAt
    };

    // Only add optional properties if they have values
    if (dbProfile.fullName) {
      profile.fullName = dbProfile.fullName;
    }
    
    if (dbProfile.currentJobTitle) {
      profile.currentJobTitle = dbProfile.currentJobTitle;
    }
    
    if (dbProfile.currentCompany) {
      profile.currentCompany = dbProfile.currentCompany;
    }
    
    if (dbProfile.school) {
      profile.school = dbProfile.school;
    }
    
    if (dbProfile.degreeInfo) {
      profile.degreeInfo = dbProfile.degreeInfo;
    }
    
    if (dbProfile.resumeS3Key) {
      profile.resumeS3Key = dbProfile.resumeS3Key;
    }
    
    if (dbProfile.targetIndustry) {
      profile.targetIndustry = dbProfile.targetIndustry;
    }
    
    if (dbProfile.targetJobTitle) {
      profile.targetJobTitle = dbProfile.targetJobTitle;
    }
    
    if (dbProfile.experienceLevel) {
      profile.experienceLevel = dbProfile.experienceLevel;
    }

    return profile;
  }

  /**
   * Get available industries and job titles
   * Requirements: 2.3
   */
  async getAvailableIndustries(): Promise<Array<{ name: string; jobTitles: string[] }>> {
    try {
      const industries = await this.prisma.industry.findMany({
        select: {
          name: true,
          jobTitles: true
        }
      });

      return industries.map(industry => ({
        name: industry.name,
        jobTitles: industry.jobTitles
      }));
    } catch (error) {
      throw new ExternalServiceError('Failed to get available industries', { error: (error as Error).message });
    }
  }

  /**
   * Create a new profile for a user (used during registration)
   * Requirements: 2.3, 2.4
   */
  async createProfile(userId: string): Promise<UserProfile> {
    try {
      // Validate user ID
      if (!ValidationUtils.isValidUUID(userId)) {
        throw new ValidationError('Invalid user ID format');
      }

      // Check if profile already exists
      const existingProfile = await this.prisma.userProfile.findUnique({
        where: { userId }
      });

      if (existingProfile) {
        throw new ValidationError('Profile already exists for this user');
      }

      // Create new profile with default values
      const dbProfile = await this.prisma.userProfile.create({
        data: {
          userId,
          aiAttributes: {},
          extractedSkills: []
        }
      });

      return this.convertDbProfileToProfile(dbProfile);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ExternalServiceError('Failed to create profile', { error: (error as Error).message });
    }
  }
}