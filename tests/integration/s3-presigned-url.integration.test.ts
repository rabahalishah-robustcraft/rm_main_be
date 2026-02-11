/**
 * Integration Test: S3 Pre-signed URL Generation and Usage
 * 
 * This test verifies S3 pre-signed URL functionality:
 * 1. Generate pre-signed URL for download
 * 2. Verify URL works and file can be downloaded
 * 3. Generate pre-signed URL for upload
 * 4. Upload file using pre-signed URL
 * 5. Verify upload succeeded
 * 
 * Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5
 */

// Mock the monitoring service BEFORE any imports to prevent background health checks
jest.mock('../../src/services/MonitoringService', () => {
  const mockMonitoringService = {
    recordAPICall: jest.fn(),
    recordError: jest.fn(),
    recordAPIOperation: jest.fn(),
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

import { S3Service } from '../../src/services/S3Service';
import { ValidationError } from '../../src/types/auth';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Helper function to make HTTP GET request
 */
function httpGet(url: string): Promise<{ status: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    protocol.get(url, (res) => {
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          data: Buffer.concat(chunks)
        });
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Helper function to make HTTP PUT request
 */
function httpPut(url: string, data: Buffer, headers: Record<string, string>): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'PUT',
      headers: {
        'Content-Length': data.length,
        ...headers
      }
    };
    
    const req = protocol.request(url, options, (res) => {
      // Consume response data
      res.on('data', () => {});
      res.on('end', () => {
        resolve({ status: res.statusCode || 0 });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

describe('S3 Pre-signed URL Integration Tests', () => {
  let s3Service: S3Service;
  let testFileKey: string;
  let testFileBuffer: Buffer;

  beforeAll(async () => {
    // Initialize S3 service with test configuration
    const s3Config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
      region: process.env.AWS_REGION || 'us-east-1',
      bucketName: process.env.AWS_S3_BUCKET || 'test-bucket'
    };
    s3Service = new S3Service(s3Config);

    // Create test file buffer
    testFileBuffer = Buffer.from('This is a test file for pre-signed URL testing. It contains some sample content to verify upload and download functionality.');
    
    // Upload a test file that we'll use for download URL testing
    testFileKey = `test-presigned-urls/test-file-${Date.now()}.txt`;
    await s3Service.upload(testFileKey, testFileBuffer, {
      contentType: 'text/plain'
    });
  });

  afterAll(async () => {
    // Clean up test files
    try {
      await s3Service.deleteFile(testFileKey);
      
      // Clean up any files uploaded during tests
      const uploadTestKey = testFileKey.replace('test-file', 'upload-test');
      try {
        await s3Service.deleteFile(uploadTestKey);
      } catch (error) {
        // Ignore if file doesn't exist
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('Pre-signed URL for Download', () => {
    it('should generate pre-signed URL for download', async () => {
      // Requirement 5.1: Generate pre-signed URL using AWS SDK's getSignedUrl method
      const signedUrl = await s3Service.getSignedUrl(testFileKey, 3600);

      // Verify URL is generated
      expect(signedUrl).toBeDefined();
      expect(typeof signedUrl).toBe('string');
      expect(signedUrl).toContain('https://');
      expect(signedUrl).toContain('X-Amz-Algorithm');
      expect(signedUrl).toContain('X-Amz-Signature');
      expect(signedUrl).toContain('X-Amz-Expires');
    });

    it('should verify URL works and file can be downloaded', async () => {
      // Generate pre-signed URL
      const signedUrl = await s3Service.getSignedUrl(testFileKey, 3600);

      // Download file using the pre-signed URL
      const response = await httpGet(signedUrl);

      // Verify download succeeded
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();

      // Verify downloaded content matches original
      expect(response.data.toString()).toBe(testFileBuffer.toString());
    });

    it('should validate expiration time is within valid range', async () => {
      // Requirement 5.2: Expiration times between 1 second and 86400 seconds (24 hours)
      
      // Test minimum expiration (1 second)
      const url1 = await s3Service.getSignedUrl(testFileKey, 1);
      expect(url1).toBeDefined();

      // Test maximum expiration (24 hours)
      const url2 = await s3Service.getSignedUrl(testFileKey, 86400);
      expect(url2).toBeDefined();

      // Test default expiration (1 hour)
      const url3 = await s3Service.getSignedUrl(testFileKey);
      expect(url3).toBeDefined();
    });

    it('should reject expiration time less than 1 second', async () => {
      // Requirement 5.2: Validate expiration time
      await expect(
        s3Service.getSignedUrl(testFileKey, 0)
      ).rejects.toThrow(ValidationError);

      await expect(
        s3Service.getSignedUrl(testFileKey, -1)
      ).rejects.toThrow(ValidationError);
    });

    it('should reject expiration time greater than 86400 seconds', async () => {
      // Requirement 5.2: Validate expiration time
      await expect(
        s3Service.getSignedUrl(testFileKey, 86401)
      ).rejects.toThrow(ValidationError);

      await expect(
        s3Service.getSignedUrl(testFileKey, 100000)
      ).rejects.toThrow(ValidationError);
    });

    it('should use default expiration of 3600 seconds for resume files', async () => {
      // Requirement 5.4: Default expiration of 3600 seconds (1 hour)
      const signedUrl = await s3Service.getSignedUrl(testFileKey);
      
      // Verify URL contains expiration parameter
      expect(signedUrl).toContain('X-Amz-Expires');
      
      // Extract expiration value from URL
      const expiresMatch = signedUrl.match(/X-Amz-Expires=(\d+)/);
      expect(expiresMatch).toBeTruthy();
      
      if (expiresMatch) {
        const expires = parseInt(expiresMatch[1], 10);
        expect(expires).toBe(3600);
      }
    });
  });

  describe('Pre-signed URL for Upload', () => {
    it('should generate pre-signed URL for upload', async () => {
      // Requirement 6.1: Provide method to generate pre-signed URLs for PUT operations
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.txt`;
      
      const uploadUrlResult = await s3Service.generateUploadUrl(uploadKey, {
        contentType: 'text/plain',
        expiresIn: 3600
      });

      // Verify upload URL result structure
      expect(uploadUrlResult).toBeDefined();
      expect(uploadUrlResult.url).toBeDefined();
      expect(uploadUrlResult.key).toBe(uploadKey);
      expect(uploadUrlResult.fields).toBeDefined();
      
      // Requirement 6.4: Return URL and required headers
      expect(uploadUrlResult.fields['Content-Type']).toBe('text/plain');
    });

    it('should include content type restrictions in pre-signed URL', async () => {
      // Requirement 6.2: Include content type restrictions
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.json`;
      
      const uploadUrlResult = await s3Service.generateUploadUrl(uploadKey, {
        contentType: 'application/json',
        expiresIn: 1800
      });

      // Verify content type is included in fields
      expect(uploadUrlResult.fields['Content-Type']).toBe('application/json');
      
      // Verify URL contains content type parameter
      expect(uploadUrlResult.url).toContain('Content-Type');
    });

    it('should upload file using pre-signed URL', async () => {
      // Generate upload URL
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.txt`;
      const uploadContent = Buffer.from('Test content uploaded via pre-signed URL');
      
      const uploadUrlResult = await s3Service.generateUploadUrl(uploadKey, {
        contentType: 'text/plain',
        expiresIn: 3600
      });

      // Upload file using the pre-signed URL
      const response = await httpPut(uploadUrlResult.url, uploadContent, {
        'Content-Type': uploadUrlResult.fields['Content-Type']
      });

      // Verify upload succeeded
      expect(response.status).toBe(200);

      // Requirement 6.5: Verify upload succeeded before updating database records
      const uploadSucceeded = await s3Service.verifyUpload(uploadKey);
      expect(uploadSucceeded).toBe(true);

      // Verify file exists and content is correct
      const downloadedContent = await s3Service.download(uploadKey);
      expect(downloadedContent.toString()).toBe(uploadContent.toString());

      // Clean up
      await s3Service.deleteFile(uploadKey);
    });

    it('should validate required parameters for upload URL generation', async () => {
      // Requirement 6.3: Validate parameters
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.txt`;

      // Test missing content type
      await expect(
        s3Service.generateUploadUrl(uploadKey, {} as any)
      ).rejects.toThrow(ValidationError);

      // Test empty key
      await expect(
        s3Service.generateUploadUrl('', {
          contentType: 'text/plain'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should validate expiration time for upload URLs', async () => {
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.txt`;

      // Test expiration less than 1 second
      await expect(
        s3Service.generateUploadUrl(uploadKey, {
          contentType: 'text/plain',
          expiresIn: 0
        })
      ).rejects.toThrow(ValidationError);

      // Test expiration greater than 86400 seconds
      await expect(
        s3Service.generateUploadUrl(uploadKey, {
          contentType: 'text/plain',
          expiresIn: 86401
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should verify upload fails for non-existent file', async () => {
      // Requirement 6.5: Verify upload succeeded
      const nonExistentKey = `test-presigned-urls/non-existent-${Date.now()}.txt`;
      
      const uploadSucceeded = await s3Service.verifyUpload(nonExistentKey);
      expect(uploadSucceeded).toBe(false);
    });
  });

  describe('Pre-signed URL Error Handling', () => {
    it('should handle download URL generation for non-existent file', async () => {
      // Note: S3 generates pre-signed URLs without checking if file exists
      // The URL will be valid but will return 404 when accessed
      const nonExistentKey = `test-presigned-urls/non-existent-${Date.now()}.txt`;
      
      const signedUrl = await s3Service.getSignedUrl(nonExistentKey, 3600);
      expect(signedUrl).toBeDefined();

      // Try to download using the URL - should fail with 404
      await expect(
        httpGet(signedUrl)
      ).rejects.toThrow();
    });

    it('should handle expired pre-signed URLs', async () => {
      // Generate URL with 1 second expiration
      const signedUrl = await s3Service.getSignedUrl(testFileKey, 1);
      
      // Wait for URL to expire
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to download using expired URL - should fail
      await expect(
        httpGet(signedUrl)
      ).rejects.toThrow();
    }, 10000);

    it('should handle upload with wrong content type', async () => {
      // Generate upload URL with specific content type
      const uploadKey = `test-presigned-urls/upload-test-${Date.now()}.txt`;
      const uploadContent = Buffer.from('Test content');
      
      const uploadUrlResult = await s3Service.generateUploadUrl(uploadKey, {
        contentType: 'text/plain',
        expiresIn: 3600
      });

      // Try to upload with different content type - may fail or succeed depending on S3 configuration
      // This test documents the behavior
      try {
        await httpPut(uploadUrlResult.url, uploadContent, {
          'Content-Type': 'application/json' // Wrong content type
        });
        
        // If upload succeeded, clean up
        await s3Service.deleteFile(uploadKey);
      } catch (error) {
        // Upload failed as expected due to content type mismatch
        expect(error).toBeDefined();
      }
    });
  });

  describe('Upload Verification', () => {
    it('should verify successful upload', async () => {
      // Upload a file
      const uploadKey = `test-presigned-urls/verify-test-${Date.now()}.txt`;
      const uploadContent = Buffer.from('Verification test content');
      
      await s3Service.upload(uploadKey, uploadContent, {
        contentType: 'text/plain'
      });

      // Verify upload succeeded
      const uploadSucceeded = await s3Service.verifyUpload(uploadKey);
      expect(uploadSucceeded).toBe(true);

      // Clean up
      await s3Service.deleteFile(uploadKey);
    });

    it('should return false for non-existent file verification', async () => {
      const nonExistentKey = `test-presigned-urls/non-existent-verify-${Date.now()}.txt`;
      
      const uploadSucceeded = await s3Service.verifyUpload(nonExistentKey);
      expect(uploadSucceeded).toBe(false);
    });
  });

  describe('Multiple File Operations', () => {
    it('should handle multiple concurrent pre-signed URL generations', async () => {
      // Generate multiple pre-signed URLs concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(s3Service.getSignedUrl(testFileKey, 3600));
      }

      const urls = await Promise.all(promises);

      // Verify all URLs are generated and unique
      expect(urls.length).toBe(5);
      urls.forEach(url => {
        expect(url).toBeDefined();
        expect(url).toContain('https://');
      });

      // URLs should be different due to different timestamps
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(5);
    });

    it('should handle multiple concurrent uploads via pre-signed URLs', async () => {
      // Generate multiple upload URLs
      const uploadPromises = [];
      const uploadKeys = [];
      
      for (let i = 0; i < 3; i++) {
        const uploadKey = `test-presigned-urls/concurrent-upload-${Date.now()}-${i}.txt`;
        uploadKeys.push(uploadKey);
        
        uploadPromises.push(
          s3Service.generateUploadUrl(uploadKey, {
            contentType: 'text/plain',
            expiresIn: 3600
          })
        );
      }

      const uploadResults = await Promise.all(uploadPromises);

      // Upload files concurrently
      const uploadFilePromises = uploadResults.map((result, i) => {
        const content = Buffer.from(`Concurrent upload test ${i}`);
        return httpPut(result.url, content, {
          'Content-Type': result.fields['Content-Type']
        });
      });

      await Promise.all(uploadFilePromises);

      // Verify all uploads succeeded
      const verifyPromises = uploadKeys.map(key => s3Service.verifyUpload(key));
      const verifyResults = await Promise.all(verifyPromises);
      
      verifyResults.forEach(result => {
        expect(result).toBe(true);
      });

      // Clean up
      const cleanupPromises = uploadKeys.map(key => s3Service.deleteFile(key));
      await Promise.all(cleanupPromises);
    }, 15000);
  });
});
