import { S3Service } from '../../../src/services/S3Service';
import { ValidationError } from '../../../src/types/auth';
import AWS from 'aws-sdk';

// Mock AWS SDK
jest.mock('aws-sdk');

describe('S3Service', () => {
  let s3Service: S3Service;
  let mockS3: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock S3 instance
    mockS3 = {
      upload: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Location: 'https://s3.amazonaws.com/bucket/key' })
      }),
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Body: Buffer.from('test data') })
      }),
      deleteObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      headObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      listObjectsV2: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Contents: [] })
      }),
      getSignedUrl: jest.fn().mockReturnValue('https://s3.amazonaws.com/signed-url')
    };

    // Mock AWS.S3 constructor
    (AWS.S3 as jest.MockedClass<typeof AWS.S3>).mockImplementation(() => mockS3);

    // Create S3Service instance
    s3Service = new S3Service({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
      bucketName: 'test-bucket'
    });
  });

  describe('generateUploadUrl', () => {
    it('should generate pre-signed URL for file upload with required parameters', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf'
      };

      const result = await s3Service.generateUploadUrl(key, options);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('fields');
      expect(result.url).toBe('https://s3.amazonaws.com/signed-url');
      expect(result.key).toBe(key);
      expect(result.fields['Content-Type']).toBe('application/pdf');
      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Bucket: 'test-bucket',
        Key: key,
        ContentType: 'application/pdf'
      }));
    });

    it('should use default expiration of 3600 seconds when not specified', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf'
      };

      await s3Service.generateUploadUrl(key, options);

      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Expires: 3600
      }));
    });

    it('should use custom expiration when specified', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        expiresIn: 7200
      };

      await s3Service.generateUploadUrl(key, options);

      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Expires: 7200
      }));
    });

    it('should include content type in returned fields', async () => {
      const key = 'uploads/test-file.jpg';
      const options = {
        contentType: 'image/jpeg'
      };

      const result = await s3Service.generateUploadUrl(key, options);

      expect(result.fields).toEqual({
        'Content-Type': 'image/jpeg'
      });
    });

    it('should throw ValidationError when key is empty', async () => {
      const options = {
        contentType: 'application/pdf'
      };

      await expect(s3Service.generateUploadUrl('', options)).rejects.toThrow(ValidationError);
      await expect(s3Service.generateUploadUrl('', options)).rejects.toThrow('Key is required');
    });

    it('should throw ValidationError when content type is missing', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: ''
      };

      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow(ValidationError);
      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow('Content type is required');
    });

    it('should throw ValidationError when expiration is less than 1 second', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        expiresIn: 0
      };

      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow(ValidationError);
      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow('Expires in must be between 1 and 86400 seconds');
    });

    it('should throw ValidationError when expiration is greater than 86400 seconds', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        expiresIn: 86401
      };

      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow(ValidationError);
      await expect(s3Service.generateUploadUrl(key, options)).rejects.toThrow('Expires in must be between 1 and 86400 seconds');
    });

    it('should accept expiration of exactly 1 second', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        expiresIn: 1
      };

      const result = await s3Service.generateUploadUrl(key, options);

      expect(result).toHaveProperty('url');
      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Expires: 1
      }));
    });

    it('should accept expiration of exactly 86400 seconds', async () => {
      const key = 'uploads/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        expiresIn: 86400
      };

      const result = await s3Service.generateUploadUrl(key, options);

      expect(result).toHaveProperty('url');
      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
        Expires: 86400
      }));
    });

    it('should handle different content types correctly', async () => {
      const testCases = [
        { contentType: 'application/pdf', key: 'file.pdf' },
        { contentType: 'image/jpeg', key: 'image.jpg' },
        { contentType: 'image/png', key: 'image.png' },
        { contentType: 'application/msword', key: 'doc.doc' },
        { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', key: 'doc.docx' }
      ];

      for (const testCase of testCases) {
        const result = await s3Service.generateUploadUrl(testCase.key, {
          contentType: testCase.contentType
        });

        expect(result.fields['Content-Type']).toBe(testCase.contentType);
        expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
          ContentType: testCase.contentType
        }));
      }
    });
  });

  describe('getSignedUrl (existing method)', () => {
    it('should generate pre-signed URL for file download', async () => {
      const key = 'downloads/test-file.pdf';

      const result = await s3Service.getSignedUrl(key);

      expect(result).toBe('https://s3.amazonaws.com/signed-url');
      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('getObject', expect.objectContaining({
        Bucket: 'test-bucket',
        Key: key,
        Expires: 3600
      }));
    });

    it('should use custom expiration for download URL', async () => {
      const key = 'downloads/test-file.pdf';
      const expiresIn = 1800;

      await s3Service.getSignedUrl(key, expiresIn);

      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('getObject', expect.objectContaining({
        Expires: 1800
      }));
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      const key = 'existing-file.pdf';

      const result = await s3Service.fileExists(key);

      expect(result).toBe(true);
      expect(mockS3.headObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key
      });
    });

    it('should return false when file does not exist', async () => {
      const key = 'non-existent-file.pdf';
      mockS3.headObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NotFound', statusCode: 404 })
      });

      const result = await s3Service.fileExists(key);

      expect(result).toBe(false);
    });
  });

  describe('verifyUpload', () => {
    it('should return true when uploaded file exists', async () => {
      const key = 'uploads/verified-file.pdf';

      const result = await s3Service.verifyUpload(key);

      expect(result).toBe(true);
      expect(mockS3.headObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key
      });
    });

    it('should return false when uploaded file does not exist', async () => {
      const key = 'uploads/missing-file.pdf';
      mockS3.headObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue({ code: 'NotFound', statusCode: 404 })
      });

      const result = await s3Service.verifyUpload(key);

      expect(result).toBe(false);
    });

    it('should use fileExists method internally', async () => {
      const key = 'uploads/test-file.pdf';
      const fileExistsSpy = jest.spyOn(s3Service, 'fileExists');

      await s3Service.verifyUpload(key);

      expect(fileExistsSpy).toHaveBeenCalledWith(key);
    });

    it('should throw ValidationError when key is empty', async () => {
      await expect(s3Service.verifyUpload('')).rejects.toThrow(ValidationError);
      await expect(s3Service.verifyUpload('')).rejects.toThrow('Key is required');
    });

    it('should verify upload after generateUploadUrl workflow', async () => {
      // Simulate the workflow: generate upload URL, then verify upload
      const key = 'uploads/workflow-test.pdf';
      
      // Step 1: Generate upload URL
      const uploadUrlResult = await s3Service.generateUploadUrl(key, {
        contentType: 'application/pdf'
      });
      
      expect(uploadUrlResult.key).toBe(key);
      
      // Step 2: Simulate file upload (in real scenario, client uploads to pre-signed URL)
      // Mock that file now exists
      mockS3.headObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      });
      
      // Step 3: Verify upload succeeded
      const verified = await s3Service.verifyUpload(key);
      
      expect(verified).toBe(true);
    });
  });

  describe('upload', () => {
    it('should upload file successfully', async () => {
      const key = 'uploads/test-file.pdf';
      const buffer = Buffer.from('test content');

      const result = await s3Service.upload(key, buffer, {
        contentType: 'application/pdf'
      });

      expect(result).toBe('https://s3.amazonaws.com/bucket/key');
      expect(mockS3.upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf'
      }));
    });

    it('should throw ValidationError when buffer is empty', async () => {
      const key = 'uploads/test-file.pdf';
      const buffer = Buffer.from('');

      await expect(s3Service.upload(key, buffer)).rejects.toThrow(ValidationError);
      await expect(s3Service.upload(key, buffer)).rejects.toThrow('Buffer cannot be empty');
    });
  });

  describe('download', () => {
    it('should download file successfully', async () => {
      const key = 'downloads/test-file.pdf';

      const result = await s3Service.download(key);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test data');
      expect(mockS3.getObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key
      });
    });
  });

  describe('healthCheck', () => {
    it('should return true when S3 is accessible', async () => {
      const result = await s3Service.healthCheck();

      expect(result).toBe(true);
      expect(mockS3.listObjectsV2).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        MaxKeys: 1
      });
    });

    it('should return false when S3 is not accessible', async () => {
      mockS3.listObjectsV2.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Service unavailable'))
      });

      const result = await s3Service.healthCheck();

      expect(result).toBe(false);
    });
  });
});
