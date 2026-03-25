import { ProfileService } from '@/services/ProfileService';
import { S3Service } from '@/services/S3Service';
import { OpenAIService, ResumeData } from '@/services/OpenAIService';
import { ResumeTextExtractor } from '@/services/ResumeTextExtractor';
import { 
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  UserProfile,
  ProfileUpdateData
} from '@/types/auth';

// Mock the dependencies
jest.mock('@/utils/validation', () => ({
  ValidationUtils: {
    isValidUUID: jest.fn(),
    validate: jest.fn(),
  },
  profileSchemas: {
    updateProfile: {},
    targetRole: {},
  },
}));

jest.mock('@/lib/prisma', () => ({
  userProfile: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  industry: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
}));

jest.mock('@/services/ResumeTextExtractor', () => ({
  ResumeTextExtractor: jest.fn().mockImplementation(() => ({
    extractText: jest.fn().mockResolvedValue('Extracted resume text content'),
    isSupported: jest.fn().mockReturnValue(true),
    getSupportedExtensions: jest.fn().mockReturnValue(['.pdf', '.doc', '.docx'])
  }))
}));

// Mock S3Service
const mockS3Service = {
  upload: jest.fn(),
  download: jest.fn(),
  deleteFile: jest.fn(),
  getSignedUrl: jest.fn(),
  generateFileKey: jest.fn((prefix: string, userId: string, filename: string) => {
    return `${prefix}/${userId}/${Date.now()}_${filename}`;
  }),
  validateFile: jest.fn(),
  fileExists: jest.fn(),
  healthCheck: jest.fn(),
} as unknown as jest.Mocked<S3Service>;

// Mock OpenAIService
const mockOpenAIService = {
  extractResumeData: jest.fn(),
  transcribeAudio: jest.fn(),
  analyzeResponse: jest.fn(),
  generatePersonalizedPrompt: jest.fn(),
} as unknown as jest.Mocked<OpenAIService>;

import { ValidationUtils } from '@/utils/validation';
import prisma from '@/lib/prisma';

const mockValidationUtils = ValidationUtils as jest.Mocked<typeof ValidationUtils>;
const mockPrisma = prisma as any;

describe('ProfileService Unit Tests', () => {
  let profileService: ProfileService;

  beforeEach(() => {
    profileService = new ProfileService(mockS3Service, mockOpenAIService);
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should successfully get a user profile', async () => {
      // Arrange
      const userId = 'user-123';
      const mockDbProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: 'resumes/user-123/resume.pdf',
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        aiAttributes: { preference: 'technical' },
        extractedSkills: ['JavaScript', 'TypeScript'],
        experienceLevel: 'mid',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockDbProfile);

      // Act
      const result = await profileService.getProfile(userId);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(result).toEqual({
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: 'resumes/user-123/resume.pdf',
        targetIndustry: 'Technology',
        targetJobTitle: 'Software Engineer',
        aiAttributes: { preference: 'technical' },
        extractedSkills: ['JavaScript', 'TypeScript'],
        experienceLevel: 'mid',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });
    });

    it('should throw ValidationError for invalid user ID', async () => {
      // Arrange
      const userId = 'invalid-id';
      mockValidationUtils.isValidUUID.mockReturnValue(false);

      // Act & Assert
      await expect(profileService.getProfile(userId))
        .rejects.toThrow(ValidationError);
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
    });

    it('should throw NotFoundError when profile does not exist', async () => {
      // Arrange
      const userId = 'user-123';
      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(profileService.getProfile(userId))
        .rejects.toThrow(NotFoundError);
    });

    it('should handle profiles with null optional fields', async () => {
      // Arrange
      const userId = 'user-123';
      const mockDbProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockDbProfile);

      // Act
      const result = await profileService.getProfile(userId);

      // Assert
      expect(result).toEqual({
        id: 'profile-123',
        userId: 'user-123',
        aiAttributes: {},
        extractedSkills: [],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });
      expect(result.resumeS3Key).toBeUndefined();
      expect(result.targetIndustry).toBeUndefined();
      expect(result.targetJobTitle).toBeUndefined();
      expect(result.experienceLevel).toBeUndefined();
    });
  });

  describe('updateProfile', () => {
    it('should successfully update a user profile', async () => {
      // Arrange
      const userId = 'user-123';
      const updateData: ProfileUpdateData = {
        targetIndustry: 'Technology',
        targetJobTitle: 'Senior Software Engineer',
        experienceLevel: 'senior'
      };

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: 'Finance',
        targetJobTitle: 'Analyst',
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: 'mid',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      const updatedProfile = {
        ...existingProfile,
        targetIndustry: 'Technology',
        targetJobTitle: 'Senior Software Engineer',
        experienceLevel: 'senior',
        updatedAt: new Date('2024-01-02'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockValidationUtils.validate.mockReturnValue(updateData);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockPrisma.userProfile.update.mockResolvedValue(updatedProfile);

      // Mock target role validation
      const mockIndustry = {
        id: 'industry-1',
        name: 'Technology',
        jobTitles: ['Software Engineer', 'Senior Software Engineer', 'Tech Lead']
      };
      mockPrisma.industry.findUnique.mockResolvedValue(mockIndustry);

      // Act
      const result = await profileService.updateProfile(userId, updateData);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockValidationUtils.validate).toHaveBeenCalledWith(updateData, {});
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: {
          targetIndustry: 'Technology',
          targetJobTitle: 'Senior Software Engineer',
          experienceLevel: 'senior'
        }
      });
      expect(result.targetIndustry).toBe('Technology');
      expect(result.targetJobTitle).toBe('Senior Software Engineer');
      expect(result.experienceLevel).toBe('senior');
    });

    it('should throw ValidationError for invalid user ID', async () => {
      // Arrange
      const userId = 'invalid-id';
      const updateData: ProfileUpdateData = { targetIndustry: 'Technology' };
      mockValidationUtils.isValidUUID.mockReturnValue(false);

      // Act & Assert
      await expect(profileService.updateProfile(userId, updateData))
        .rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when profile does not exist', async () => {
      // Arrange
      const userId = 'user-123';
      const updateData: ProfileUpdateData = { targetIndustry: 'Technology' };
      
      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockValidationUtils.validate.mockReturnValue(updateData);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(profileService.updateProfile(userId, updateData))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('uploadResume', () => {
    it('should successfully upload a resume file', async () => {
      // Arrange
      const userId = 'user-123';
      const file = Buffer.from('fake pdf content');
      const filename = 'resume.pdf';

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      
      const mockS3Key = `resumes/${userId}/${Date.now()}_resume.pdf`;
      mockS3Service.generateFileKey.mockReturnValue(mockS3Key);
      
      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        resumeS3Key: mockS3Key
      });

      // Act
      const result = await profileService.uploadResume(userId, file, filename);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(result).toBe(mockS3Key);
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: { resumeS3Key: mockS3Key }
      });
    });

    it('should throw ValidationError for invalid file type', async () => {
      // Arrange
      const userId = 'user-123';
      const file = Buffer.from('fake content');
      const filename = 'resume.txt';

      mockValidationUtils.isValidUUID.mockReturnValue(true);

      // Act & Assert
      await expect(profileService.uploadResume(userId, file, filename))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for file size exceeding limit', async () => {
      // Arrange
      const userId = 'user-123';
      const file = Buffer.alloc(51 * 1024 * 1024); // 51MB file (exceeds 50MB limit)
      const filename = 'resume.pdf';

      mockValidationUtils.isValidUUID.mockReturnValue(true);

      // Act & Assert
      await expect(profileService.uploadResume(userId, file, filename))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for empty file', async () => {
      // Arrange
      const userId = 'user-123';
      const file = Buffer.alloc(0);
      const filename = 'resume.pdf';

      mockValidationUtils.isValidUUID.mockReturnValue(true);

      // Act & Assert
      await expect(profileService.uploadResume(userId, file, filename))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('processResume', () => {
    it('should successfully process a PDF resume', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');
      const extractedText = 'John Doe\nSoftware Engineer\nSkills: JavaScript, TypeScript, React';
      const resumeData: ResumeData = {
        skills: ['JavaScript', 'TypeScript', 'React'],
        experienceLevel: 'mid',
        industries: ['Technology'],
        jobTitles: ['Software Engineer'],
        summary: 'Experienced software engineer'
      };

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);
      mockOpenAIService.extractResumeData.mockResolvedValue(resumeData);
      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        extractedSkills: resumeData.skills,
        experienceLevel: resumeData.experienceLevel
      });

      // Act
      await profileService.processResume(userId, s3Key);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(mockS3Service.download).toHaveBeenCalledWith(s3Key);
      expect(mockOpenAIService.extractResumeData).toHaveBeenCalled();
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: {
          extractedSkills: resumeData.skills,
          experienceLevel: resumeData.experienceLevel
        }
      });
    });

    it('should throw ValidationError for invalid user ID', async () => {
      // Arrange
      const userId = 'invalid-id';
      const s3Key = 'resumes/user-123/resume.pdf';

      mockValidationUtils.isValidUUID.mockReturnValue(false);

      // Act & Assert
      await expect(profileService.processResume(userId, s3Key))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing S3 key', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = '';

      mockValidationUtils.isValidUUID.mockReturnValue(true);

      // Act & Assert
      await expect(profileService.processResume(userId, s3Key))
        .rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when profile does not exist', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(profileService.processResume(userId, s3Key))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw ExternalServiceError when OpenAI service is not available', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      // Create service without OpenAI
      const serviceWithoutOpenAI = new ProfileService(mockS3Service);

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);

      // Act & Assert
      await expect(serviceWithoutOpenAI.processResume(userId, s3Key))
        .rejects.toThrow(ExternalServiceError);
    });

    it('should use keyword extraction fallback when resume data validation fails', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');
      const invalidResumeData = {
        skills: 'not an array', // Invalid: should be array
        experienceLevel: 'mid',
        industries: [],
        jobTitles: [],
        summary: ''
      } as any;

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);
      mockOpenAIService.extractResumeData.mockResolvedValue(invalidResumeData);

      // Spy on console.warn to verify fallback logging
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        extractedSkills: ['general'],
        experienceLevel: 'entry'
      });

      // Act
      await profileService.processResume(userId, s3Key);

      // Assert - should use fallback instead of throwing
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls[0];
      expect(warnCall[0]).toContain('GPT extraction failed');
      expect(warnCall[0]).toContain('keyword extraction fallback');

      consoleWarnSpy.mockRestore();
    });

    it('should throw ExternalServiceError with descriptive message when text extraction fails', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      // Mock text extraction to fail
      const mockExtractor = new ResumeTextExtractor();
      (mockExtractor.extractText as jest.Mock).mockRejectedValue(new Error('PDF parsing failed'));
      
      const serviceWithFailingExtractor = new ProfileService(mockS3Service, mockOpenAIService);
      (serviceWithFailingExtractor as any).resumeTextExtractor = mockExtractor;

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);

      // Spy on console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Act & Assert
      await expect(serviceWithFailingExtractor.processResume(userId, s3Key))
        .rejects.toThrow(ExternalServiceError);
      
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[0]).toContain('Failed to extract text from resume file');
      expect(errorCall[0]).toContain('resume.pdf');

      consoleErrorSpy.mockRestore();
    });

    it('should use keyword extraction fallback when GPT extraction fails', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');
      const extractedText = 'Senior Software Engineer with 5 years experience in JavaScript, TypeScript, React, and Node.js';

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);
      
      // Mock text extraction to succeed
      const mockExtractor = new ResumeTextExtractor();
      (mockExtractor.extractText as jest.Mock).mockResolvedValue(extractedText);
      
      const serviceWithExtractor = new ProfileService(mockS3Service, mockOpenAIService);
      (serviceWithExtractor as any).resumeTextExtractor = mockExtractor;

      // Mock GPT extraction to fail
      mockOpenAIService.extractResumeData.mockRejectedValue(new Error('OpenAI API rate limit exceeded'));

      // Spy on console.warn to verify fallback logging
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        extractedSkills: ['javascript', 'typescript', 'react', 'node.js'],
        experienceLevel: 'senior'
      });

      // Act
      await serviceWithExtractor.processResume(userId, s3Key);

      // Assert
      // Verify fallback was logged
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls[0];
      expect(warnCall[0]).toContain('GPT extraction failed');
      expect(warnCall[0]).toContain('keyword extraction fallback');
      expect(warnCall[0]).toContain(userId);

      // Verify profile was updated with fallback data
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: expect.objectContaining({
          extractedSkills: expect.arrayContaining(['javascript', 'typescript', 'react', 'node.js']),
          experienceLevel: 'senior'
        })
      });

      consoleWarnSpy.mockRestore();
    });

    it('should extract skills using keyword matching in fallback', async () => {
      // Arrange
      const userId = 'user-123';
      const s3Key = 'resumes/user-123/resume.pdf';
      const fileBuffer = Buffer.from('fake pdf content');
      const extractedText = 'Python developer with experience in Django, Flask, PostgreSQL, and Docker. Worked in healthcare industry.';

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: s3Key,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockS3Service.download.mockResolvedValue(fileBuffer);
      
      // Mock text extraction to succeed
      const mockExtractor = new ResumeTextExtractor();
      (mockExtractor.extractText as jest.Mock).mockResolvedValue(extractedText);
      
      const serviceWithExtractor = new ProfileService(mockS3Service, mockOpenAIService);
      (serviceWithExtractor as any).resumeTextExtractor = mockExtractor;

      // Mock GPT extraction to fail
      mockOpenAIService.extractResumeData.mockRejectedValue(new Error('API error'));

      // Spy on console.warn
      jest.spyOn(console, 'warn').mockImplementation();

      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        extractedSkills: ['python', 'django', 'flask', 'postgresql', 'docker'],
        experienceLevel: 'entry'
      });

      // Act
      await serviceWithExtractor.processResume(userId, s3Key);

      // Assert
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: expect.objectContaining({
          extractedSkills: expect.arrayContaining(['python', 'django', 'flask', 'postgresql', 'docker']),
          experienceLevel: 'entry'
        })
      });

      jest.restoreAllMocks();
    });
  });

  describe('setTargetRole', () => {
    it('should successfully set target role', async () => {
      // Arrange
      const userId = 'user-123';
      const industry = 'Technology';
      const jobTitle = 'Software Engineer';

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockValidationUtils.validate.mockReturnValue({ industry, jobTitle });
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockPrisma.userProfile.update.mockResolvedValue({
        ...existingProfile,
        targetIndustry: industry,
        targetJobTitle: jobTitle
      });

      // Act
      await profileService.setTargetRole(userId, industry, jobTitle);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockValidationUtils.validate).toHaveBeenCalledWith(
        { industry, jobTitle },
        {}
      );
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: {
          targetIndustry: industry,
          targetJobTitle: jobTitle
        }
      });
    });

    it('should throw ValidationError for invalid industry', async () => {
      // Arrange
      const userId = 'user-123';
      const industry = 'InvalidIndustry';
      const jobTitle = 'Software Engineer';

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockValidationUtils.validate.mockImplementation(() => {
        throw new ValidationError('Invalid industry');
      });

      // Act & Assert
      await expect(profileService.setTargetRole(userId, industry, jobTitle))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid job title for industry', async () => {
      // Arrange
      const userId = 'user-123';
      const industry = 'Technology';
      const jobTitle = 'Invalid Job Title';

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockValidationUtils.validate.mockImplementation(() => {
        throw new ValidationError('Invalid job title');
      });

      // Act & Assert
      await expect(profileService.setTargetRole(userId, industry, jobTitle))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('storeAIAttributes', () => {
    it('should successfully store AI attributes', async () => {
      // Arrange
      const userId = 'user-123';
      const attributes = { preference: 'technical', style: 'detailed' };

      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: { existing: 'data' },
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockPrisma.userProfile.update.mockResolvedValue(existingProfile);

      // Mock Date for consistent lastUpdated
      const mockDate = new Date('2024-01-02T10:00:00Z');
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(mockDate.toISOString());

      // Act
      await profileService.storeAIAttributes(userId, attributes);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId },
        data: {
          aiAttributes: {
            existing: 'data',
            preference: 'technical',
            style: 'detailed',
            lastUpdated: mockDate.toISOString()
          }
        }
      });

      jest.restoreAllMocks();
    });

    it('should throw ValidationError for invalid attributes', async () => {
      // Arrange
      const userId = 'user-123';
      const attributes = null;

      mockValidationUtils.isValidUUID.mockReturnValue(true);

      // Act & Assert
      await expect(profileService.storeAIAttributes(userId, attributes as any))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('getAIAttributes', () => {
    it('should successfully get AI attributes', async () => {
      // Arrange
      const userId = 'user-123';
      const mockProfile = {
        aiAttributes: { preference: 'technical', style: 'detailed' }
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      // Act
      const result = await profileService.getAIAttributes(userId);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId },
        select: { aiAttributes: true }
      });
      expect(result).toEqual({ preference: 'technical', style: 'detailed' });
    });

    it('should throw NotFoundError when profile does not exist', async () => {
      // Arrange
      const userId = 'user-123';
      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(profileService.getAIAttributes(userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getAvailableIndustries', () => {
    it('should successfully get available industries', async () => {
      // Arrange
      const mockIndustries = [
        { name: 'Technology', jobTitles: ['Software Engineer', 'Product Manager'] },
        { name: 'Finance', jobTitles: ['Financial Analyst', 'Investment Banker'] }
      ];

      mockPrisma.industry.findMany.mockResolvedValue(mockIndustries);

      // Act
      const result = await profileService.getAvailableIndustries();

      // Assert
      expect(mockPrisma.industry.findMany).toHaveBeenCalledWith({
        select: {
          name: true,
          jobTitles: true
        }
      });
      expect(result).toEqual(mockIndustries);
    });
  });

  describe('createProfile', () => {
    it('should successfully create a new profile', async () => {
      // Arrange
      const userId = 'user-123';
      const mockCreatedProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userProfile.create.mockResolvedValue(mockCreatedProfile);

      // Act
      const result = await profileService.createProfile(userId);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({
        data: {
          userId,
          aiAttributes: {},
          extractedSkills: []
        }
      });
      expect(result).toEqual({
        id: 'profile-123',
        userId: 'user-123',
        aiAttributes: {},
        extractedSkills: [],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });
    });

    it('should throw ValidationError when profile already exists', async () => {
      // Arrange
      const userId = 'user-123';
      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: null,
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);

      // Act & Assert
      await expect(profileService.createProfile(userId))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('deleteProfile', () => {
    it('should successfully delete a profile', async () => {
      // Arrange
      const userId = 'user-123';
      const existingProfile = {
        id: 'profile-123',
        userId: 'user-123',
        resumeS3Key: 'resumes/user-123/resume.pdf',
        targetIndustry: null,
        targetJobTitle: null,
        aiAttributes: {},
        extractedSkills: [],
        experienceLevel: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(existingProfile);
      mockPrisma.userProfile.delete.mockResolvedValue(existingProfile);

      // Act
      await profileService.deleteProfile(userId);

      // Assert
      expect(mockValidationUtils.isValidUUID).toHaveBeenCalledWith(userId);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId }
      });
      expect(mockPrisma.userProfile.delete).toHaveBeenCalledWith({
        where: { userId }
      });
    });

    it('should throw NotFoundError when profile does not exist', async () => {
      // Arrange
      const userId = 'user-123';
      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(profileService.deleteProfile(userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('error handling', () => {
    it('should wrap database errors in ExternalServiceError', async () => {
      // Arrange
      const userId = 'user-123';
      mockValidationUtils.isValidUUID.mockReturnValue(true);
      mockPrisma.userProfile.findUnique.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(profileService.getProfile(userId))
        .rejects.toThrow(ExternalServiceError);
    });
  });
});