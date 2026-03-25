/**
 * Integration Test: End-to-End Resume Upload and Processing
 * 
 * This test verifies the complete resume upload and processing flow:
 * 1. Upload a real PDF resume
 * 2. Verify text extraction succeeds
 * 3. Verify GPT extraction returns structured data
 * 4. Verify profile is updated with extracted data
 * 
 * Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4
 */

import { ProfileService } from '../../src/services/ProfileService';
import { S3Service } from '../../src/services/S3Service';
import { OpenAIService } from '../../src/services/OpenAIService';
import { AuthService } from '../../src/services/AuthService';
import prisma from '../../src/lib/prisma';
import { ValidationError, NotFoundError } from '../../src/types/auth';

// Mock the monitoring service to prevent background health checks
jest.mock('../../src/services/MonitoringService', () => {
  const mockMonitoringService = {
    recordAPICall: jest.fn(),
    recordError: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
    getHealthStatus: jest.fn().mockReturnValue({ status: 'healthy' }),
    collectSystemMetrics: jest.fn(),
    performHealthChecks: jest.fn(),
    cleanupOldMetrics: jest.fn(),
    cleanupOldAlerts: jest.fn(),
    addAlert: jest.fn(),
    checkForAlerts: jest.fn()
  };
  
  return {
    monitoringService: mockMonitoringService,
    MonitoringService: jest.fn().mockImplementation(() => mockMonitoringService)
  };
});
describe('Resume Processing Integration Tests', () => {
  let profileService: ProfileService;
  let s3Service: S3Service;
  let openaiService: OpenAIService;
  let authService: AuthService;
  let testUserId: string;
  let testPdfBuffer: Buffer;

  beforeAll(async () => {
    // Initialize services with test configuration
    const s3Config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
      region: process.env.AWS_REGION || 'us-east-1',
      bucketName: process.env.AWS_S3_BUCKET || 'test-bucket'
    };
    s3Service = new S3Service(s3Config);

    const openaiConfig = {
      gptApiKey: process.env.OPENAI_API_KEY || 'test-gpt-key',
      whisperApiKey: process.env.WHISPER_API_KEY || 'test-whisper-key',
      maxRetries: 3,
      timeout: 60000
    };
    openaiService = new OpenAIService(openaiConfig);

    authService = new AuthService(prisma);
    profileService = new ProfileService(s3Service, openaiService, prisma);

    // Create test user
    const testUser = await authService.register('resume-test@example.com', 'Password123!');
    testUserId = testUser.user.id;

    // Create test PDF resume
    testPdfBuffer = createTestPdfResume();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      // Get profile to find resume S3 key
      const profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });

      // Delete resume from S3 if exists
      if (profile?.resumeS3Key) {
        try {
          await s3Service.deleteFile(profile.resumeS3Key);
        } catch (error) {
          console.warn('Failed to delete test resume from S3:', error);
        }
      }

      // Delete profile
      await prisma.userProfile.deleteMany({
        where: { userId: testUserId }
      });

      // Delete user
      await prisma.user.deleteMany({
        where: { email: 'resume-test@example.com' }
      });
    } catch (error) {
      console.error('Cleanup error:', error);
    }

    await prisma.$disconnect();
  });

  describe('End-to-End Resume Upload and Processing', () => {
    it('should successfully upload and process a PDF resume', async () => {
      // Step 1: Upload resume
      // Requirement 2.1: Upload resume file and store S3 key
      const s3Key = await profileService.uploadResume(
        testUserId,
        testPdfBuffer,
        'test-resume.pdf'
      );

      // Verify S3 key was returned
      expect(s3Key).toBeDefined();
      expect(s3Key).toContain('resumes/');
      expect(s3Key).toContain(testUserId);
      expect(s3Key).toContain('test-resume.pdf');

      // Verify file was uploaded to S3
      const fileExists = await s3Service.fileExists(s3Key);
      expect(fileExists).toBe(true);

      // Verify profile was updated with S3 key
      let profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });
      expect(profile?.resumeS3Key).toBe(s3Key);

      // Step 2: Wait for async processing to complete
      // The processResume method is called asynchronously in uploadResume
      // We need to wait for it to complete
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      // Step 3: Verify text extraction succeeded
      // Requirement 3.2, 3.3, 3.4: Text extraction from PDF
      // We can verify this by checking if the profile was updated with extracted data
      profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });

      // Step 4: Verify GPT extraction returned structured data
      // Requirement 4.1, 4.2, 4.3: GPT extraction returns structured data
      expect(profile?.extractedSkills).toBeDefined();
      expect(Array.isArray(profile?.extractedSkills)).toBe(true);
      expect(profile?.extractedSkills.length).toBeGreaterThan(0);

      // Step 5: Verify profile was updated with extracted data
      // Requirement 4.4: Profile is updated with extracted skills and experience level
      expect(profile?.experienceLevel).toBeDefined();
      expect(['entry', 'mid', 'senior']).toContain(profile?.experienceLevel);

      // Verify skills contain expected values from our test resume
      const skills = profile?.extractedSkills || [];
      expect(skills.some(skill => 
        skill.toLowerCase().includes('javascript') ||
        skill.toLowerCase().includes('python') ||
        skill.toLowerCase().includes('react')
      )).toBe(true);
    }, 30000); // 30 second timeout for this test

    it('should handle resume processing with fallback when GPT fails', async () => {
      // Create a service with a mock OpenAI service that fails
      const failingOpenAIService = {
        extractResumeData: jest.fn().mockRejectedValue(new Error('GPT API failed'))
      } as any;

      const testProfileService = new ProfileService(
        s3Service,
        failingOpenAIService,
        prisma
      );

      // Create another test user for this test
      const testUser2 = await authService.register('resume-test2@example.com', 'Password123!');
      const testUserId2 = testUser2.user.id;

      try {
        // Upload resume
        const s3Key = await testProfileService.uploadResume(
          testUserId2,
          testPdfBuffer,
          'test-resume-fallback.pdf'
        );

        // Wait for async processing
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify profile was still updated using fallback keyword extraction
        // Requirement 4.5: Use basic keyword extraction as fallback
        const profile = await prisma.userProfile.findUnique({
          where: { userId: testUserId2 }
        });

        expect(profile?.extractedSkills).toBeDefined();
        expect(Array.isArray(profile?.extractedSkills)).toBe(true);
        expect(profile?.extractedSkills.length).toBeGreaterThan(0);
        expect(profile?.experienceLevel).toBeDefined();

        // Clean up
        if (profile?.resumeS3Key) {
          await s3Service.deleteFile(profile.resumeS3Key);
        }
        await prisma.userProfile.deleteMany({ where: { userId: testUserId2 } });
        await prisma.user.deleteMany({ where: { email: 'resume-test2@example.com' } });
      } catch (error) {
        // Clean up on error
        await prisma.userProfile.deleteMany({ where: { userId: testUserId2 } });
        await prisma.user.deleteMany({ where: { email: 'resume-test2@example.com' } });
        throw error;
      }
    }, 30000);

    it('should validate file type and reject invalid files', async () => {
      // Create an invalid file (text file with .txt extension)
      const invalidBuffer = Buffer.from('This is not a valid resume file');

      // Attempt to upload invalid file
      await expect(
        profileService.uploadResume(testUserId, invalidBuffer, 'invalid.txt')
      ).rejects.toThrow(ValidationError);
    });

    it('should validate file size and reject oversized files', async () => {
      // Create a buffer larger than the max size (10MB)
      const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

      // Attempt to upload oversized file
      await expect(
        profileService.uploadResume(testUserId, oversizedBuffer, 'oversized.pdf')
      ).rejects.toThrow(ValidationError);
    });

    it('should handle missing file gracefully', async () => {
      // Attempt to upload with empty buffer
      await expect(
        profileService.uploadResume(testUserId, Buffer.alloc(0), 'empty.pdf')
      ).rejects.toThrow(ValidationError);
    });

    it('should handle non-existent user gracefully', async () => {
      const nonExistentUserId = '00000000-0000-0000-0000-000000000000';

      // Attempt to upload for non-existent user
      await expect(
        profileService.uploadResume(nonExistentUserId, testPdfBuffer, 'test.pdf')
      ).rejects.toThrow(NotFoundError);
    });

    it('should replace old resume when uploading new one', async () => {
      // Upload first resume
      const firstS3Key = await profileService.uploadResume(
        testUserId,
        testPdfBuffer,
        'first-resume.pdf'
      );

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Upload second resume
      const secondS3Key = await profileService.uploadResume(
        testUserId,
        testPdfBuffer,
        'second-resume.pdf'
      );

      // Verify keys are different
      expect(firstS3Key).not.toBe(secondS3Key);

      // Verify profile has the new key
      const profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });
      expect(profile?.resumeS3Key).toBe(secondS3Key);

      // Verify old file was deleted (or at least attempted)
      // Note: The old file might still exist briefly due to async deletion
      // but the profile should only reference the new file
    });

    it('should generate valid signed URL for resume download', async () => {
      // Upload a resume first
      await profileService.uploadResume(
        testUserId,
        testPdfBuffer,
        'download-test.pdf'
      );

      // Generate signed URL
      const signedUrl = await profileService.getResumeUrl(testUserId);

      // Verify URL is valid
      expect(signedUrl).toBeDefined();
      expect(signedUrl).toContain('https://');
      expect(signedUrl).toContain('X-Amz-Algorithm');
      expect(signedUrl).toContain('X-Amz-Signature');
    });

    it('should handle resume download for user without resume', async () => {
      // Create a new user without a resume
      const testUser3 = await authService.register('no-resume@example.com', 'Password123!');
      const testUserId3 = testUser3.user.id;

      try {
        // Attempt to get resume URL
        await expect(
          profileService.getResumeUrl(testUserId3)
        ).rejects.toThrow(NotFoundError);

        // Clean up
        await prisma.userProfile.deleteMany({ where: { userId: testUserId3 } });
        await prisma.user.deleteMany({ where: { email: 'no-resume@example.com' } });
      } catch (error) {
        // Clean up on error
        await prisma.userProfile.deleteMany({ where: { userId: testUserId3 } });
        await prisma.user.deleteMany({ where: { email: 'no-resume@example.com' } });
        throw error;
      }
    });
  });

  describe('Resume Text Extraction', () => {
    it('should extract text from PDF with technical skills', async () => {
      // This is tested indirectly through the full upload flow
      // The text extraction happens inside processResume
      // We verify it worked by checking the extracted skills
      
      const s3Key = await profileService.uploadResume(
        testUserId,
        testPdfBuffer,
        'skills-test.pdf'
      );

      await new Promise(resolve => setTimeout(resolve, 5000));

      const profile = await prisma.userProfile.findUnique({
        where: { userId: testUserId }
      });

      // Verify skills were extracted
      expect(profile?.extractedSkills).toBeDefined();
      expect(profile?.extractedSkills.length).toBeGreaterThan(0);
    }, 30000);
  });
});

/**
 * Helper function to create a test PDF resume with realistic content
 * This creates a minimal valid PDF structure that can be parsed by pdf-parse
 */
function createTestPdfResume(): Buffer {
  // Create a minimal valid PDF with resume content
  // PDF structure: header, catalog, pages, page content, and cross-reference table
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 1200
>>
stream
BT
/F1 18 Tf
250 750 Td
(John Doe) Tj
0 -30 Td
/F1 14 Tf
(Software Engineer) Tj
0 -30 Td
/F1 10 Tf
(Email: john.doe@example.com | Phone: 555-123-4567) Tj
0 -40 Td
/F1 12 Tf
(PROFESSIONAL SUMMARY) Tj
0 -20 Td
/F1 10 Tf
(Experienced software engineer with 5 years of experience in full-stack development.) Tj
0 -15 Td
(Proficient in JavaScript, TypeScript, Python, and React. Strong background in building) Tj
0 -15 Td
(scalable web applications and RESTful APIs.) Tj
0 -30 Td
/F1 12 Tf
(TECHNICAL SKILLS) Tj
0 -20 Td
/F1 10 Tf
(Programming Languages: JavaScript, TypeScript, Python, Java) Tj
0 -15 Td
(Frontend: React, Vue.js, HTML5, CSS3, Redux) Tj
0 -15 Td
(Backend: Node.js, Express, Django, Flask, Spring Boot) Tj
0 -15 Td
(Databases: PostgreSQL, MongoDB, MySQL, Redis) Tj
0 -15 Td
(Cloud & DevOps: AWS, Docker, Kubernetes, Jenkins, CI/CD) Tj
0 -15 Td
(Tools: Git, Jest, Webpack, Babel, ESLint) Tj
0 -30 Td
/F1 12 Tf
(WORK EXPERIENCE) Tj
0 -20 Td
/F1 11 Tf
(Senior Software Engineer - Tech Corp) Tj
0 -15 Td
/F1 10 Tf
(January 2021 - Present) Tj
0 -15 Td
(Led development of microservices architecture using Node.js and Docker) Tj
0 -15 Td
(Implemented CI/CD pipelines reducing deployment time by 50%) Tj
0 -30 Td
/F1 11 Tf
(Software Engineer - StartupXYZ) Tj
0 -15 Td
/F1 10 Tf
(June 2019 - December 2020) Tj
0 -15 Td
(Built RESTful APIs using Express and PostgreSQL) Tj
0 -15 Td
(Developed responsive web applications with React and Redux) Tj
0 -30 Td
/F1 12 Tf
(EDUCATION) Tj
0 -20 Td
/F1 10 Tf
(Bachelor of Science in Computer Science) Tj
0 -15 Td
(University of Technology, 2019) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
1569
%%EOF`;

  return Buffer.from(pdfContent, 'utf-8');
}
