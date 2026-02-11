import AWS from 'aws-sdk';
import { 
  ValidationError,
  ExternalServiceError
} from '../types/auth';
import { S3_CONFIG } from '../utils/constants';
import { errorHandlingService } from './ErrorHandlingService';
import { sanitizeFilename } from '../utils/fileUpload';
import { monitoringService } from './MonitoringService';

// Define S3 types locally to avoid import issues
export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
}

export interface S3UploadUrlOptions {
  contentType: string;
  maxSizeBytes?: number;
  expiresIn?: number;
}

export interface S3UploadUrlResult {
  url: string;
  key: string;
  fields: Record<string, string>;
}

interface S3Client {
  upload(key: string, buffer: Buffer, options?: any): Promise<string>;
  download(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  generateUploadUrl(key: string, options: S3UploadUrlOptions): Promise<S3UploadUrlResult>;
  verifyUpload(key: string): Promise<boolean>;
}

/**
 * AWS S3 Service for file storage operations
 * Handles secure file uploads, downloads, and URL generation
 * Requirements: 2.1, 7.1, 7.2, 7.4
 */
export class S3Service implements S3Client {
  private s3: AWS.S3;
  private bucketName: string;

  constructor(config: S3Config) {
    // Configure AWS SDK
    AWS.config.update({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region
    });

    this.s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      signatureVersion: 'v4'
    });
    
    this.bucketName = config.bucketName;
  }

  /**
   * Upload file to S3 with proper access controls and comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 7.1, 7.2, 7.3, 7.5, 9.3, 9.5
   */
  async upload(key: string, buffer: Buffer, options: {
    contentType?: string;
    metadata?: Record<string, string>;
  } = {}): Promise<string> {
    // Requirement 9.3: Validate inputs before API call
    if (!key || key.trim().length === 0) {
      throw new ValidationError('Key is required for upload');
    }

    if (!buffer) {
      throw new ValidationError('Buffer is required for upload');
    }

    if (buffer.length === 0) {
      throw new ValidationError('Buffer cannot be empty');
    }

    const requestId = `s3_upload_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 upload operation', {
      operationType: 's3_upload',
      timestamp: new Date().toISOString(),
      requestId,
      key,
      bufferSize: buffer.length,
      contentType: options.contentType || 'application/octet-stream'
    });

    try {
      const result = await errorHandlingService.executeS3Operation(
        async () => {
          const uploadParams: AWS.S3.PutObjectRequest = {
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType: options.contentType || 'application/octet-stream',
            ServerSideEncryption: 'AES256',
            Metadata: options.metadata || {}
          };

          const uploadResult = await this.s3.upload(uploadParams).promise();
          return uploadResult.Location;
        },
        requestId,
        // Cleanup function to remove partial uploads
        async () => {
          try {
            await this.s3.deleteObject({
              Bucket: this.bucketName,
              Key: key
            }).promise();
          } catch (cleanupError) {
            console.warn(`Failed to cleanup partial upload for key: ${key}`, cleanupError);
          }
        }
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 upload operation succeeded', {
        operationType: 's3_upload',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key,
          location: result,
          bufferSize: buffer.length,
          contentType: options.contentType || 'application/octet-stream'
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('s3', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 upload operation failed', {
        operationType: 's3_upload',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          key,
          bufferSize: buffer.length,
          contentType: options.contentType,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        's3', 
        false, 
        responseTime, 
        (error as any).code || (error as any).statusCode?.toString() || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Download file from S3 with comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 7.1, 7.3, 7.5
   */
  async download(key: string): Promise<Buffer> {
    if (!key) {
      throw new ValidationError('Key is required for download');
    }

    const requestId = `s3_download_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 download operation', {
      operationType: 's3_download',
      timestamp: new Date().toISOString(),
      requestId,
      key
    });

    try {
      const result = await errorHandlingService.executeS3Operation(
        async () => {
          const downloadParams: AWS.S3.GetObjectRequest = {
            Bucket: this.bucketName,
            Key: key
          };

          const downloadResult = await this.s3.getObject(downloadParams).promise();
          
          if (!downloadResult.Body) {
            throw new ExternalServiceError(
              'File not found or empty',
              { key }
            );
          }

          return downloadResult.Body as Buffer;
        },
        requestId
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 download operation succeeded', {
        operationType: 's3_download',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key,
          bufferSize: result.length
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('s3', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 download operation failed', {
        operationType: 's3_download',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          key,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        's3', 
        false, 
        responseTime, 
        (error as any).code || (error as any).statusCode?.toString() || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Generate secure, time-limited URL for file access with error handling
   * Requirements: 8.1, 8.2, 8.3, 8.5, 7.4, 7.5
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (!key) {
      throw new ValidationError('Key is required for signed URL generation');
    }

    if (expiresIn < 1 || expiresIn > 86400) { // Max 24 hours
      throw new ValidationError('Expires in must be between 1 and 86400 seconds');
    }

    const requestId = `s3_signed_url_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 signed URL generation', {
      operationType: 's3_get_signed_url',
      timestamp: new Date().toISOString(),
      requestId,
      key,
      expiresIn
    });

    try {
      const result = await errorHandlingService.executeS3Operation(
        async () => {
          const params = {
            Bucket: this.bucketName,
            Key: key,
            Expires: expiresIn
          };

          return this.s3.getSignedUrl('getObject', params);
        },
        requestId
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 signed URL generation succeeded', {
        operationType: 's3_get_signed_url',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key,
          expiresIn,
          urlLength: result.length
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('s3', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 signed URL generation failed', {
        operationType: 's3_get_signed_url',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          key,
          expiresIn,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        's3', 
        false, 
        responseTime, 
        (error as any).code || (error as any).statusCode?.toString() || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Generate pre-signed URL for direct file upload to S3
   * Requirements: 8.1, 8.2, 8.3, 8.5, 6.1, 6.2, 6.4
   */
  async generateUploadUrl(key: string, options: S3UploadUrlOptions): Promise<S3UploadUrlResult> {
    if (!key) {
      throw new ValidationError('Key is required for upload URL generation');
    }

    if (!options.contentType) {
      throw new ValidationError('Content type is required for upload URL generation');
    }

    const expiresIn = options.expiresIn !== undefined ? options.expiresIn : 3600; // Default 1 hour

    if (expiresIn < 1 || expiresIn > 86400) { // Max 24 hours
      throw new ValidationError('Expires in must be between 1 and 86400 seconds');
    }

    const requestId = `s3_upload_url_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 upload URL generation', {
      operationType: 's3_generate_upload_url',
      timestamp: new Date().toISOString(),
      requestId,
      key,
      contentType: options.contentType,
      expiresIn
    });

    try {
      const result = await errorHandlingService.executeS3Operation(
        async () => {
          const params = {
            Bucket: this.bucketName,
            Key: key,
            ContentType: options.contentType,
            Expires: expiresIn
          };

          // Generate pre-signed URL for PUT operation
          const url = this.s3.getSignedUrl('putObject', params);

          // Return URL with key and required headers
          return {
            url,
            key,
            fields: {
              'Content-Type': options.contentType
            }
          };
        },
        requestId
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 upload URL generation succeeded', {
        operationType: 's3_generate_upload_url',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key,
          contentType: options.contentType,
          expiresIn,
          urlLength: result.url.length
        }
      });

      // Requirement 8.5: Record API operation metrics
      monitoringService.recordAPIOperation('s3', true, responseTime);

      return result;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 upload URL generation failed', {
        operationType: 's3_generate_upload_url',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          key,
          contentType: options.contentType,
          expiresIn,
          errorType: (error as Error).name
        }
      });

      // Requirement 8.5: Record API operation metrics with error type
      monitoringService.recordAPIOperation(
        's3', 
        false, 
        responseTime, 
        (error as any).code || (error as any).statusCode?.toString() || (error as Error).name || 'UNKNOWN_ERROR'
      );

      throw error;
    }
  }

  /**
   * Verify that a file upload succeeded by checking file existence
   * Requirements: 6.5
   */
  async verifyUpload(key: string): Promise<boolean> {
    return await this.fileExists(key);
  }

  /**
   * Delete file from S3 with comprehensive error handling
   * Requirements: 8.1, 8.2, 8.3, 7.3, 7.5
   */
  async deleteFile(key: string): Promise<void> {
    if (!key) {
      throw new ValidationError('Key is required for file deletion');
    }

    const requestId = `s3_delete_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 delete operation', {
      operationType: 's3_delete',
      timestamp: new Date().toISOString(),
      requestId,
      key
    });

    try {
      await errorHandlingService.executeS3Operation(
        async () => {
          const deleteParams: AWS.S3.DeleteObjectRequest = {
            Bucket: this.bucketName,
            Key: key
          };

          await this.s3.deleteObject(deleteParams).promise();
        },
        requestId
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 delete operation succeeded', {
        operationType: 's3_delete',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key
        }
      });
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 delete operation failed', {
        operationType: 's3_delete',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          key,
          errorType: (error as Error).name
        }
      });

      throw error;
    }
  }

  /**
   * Check if file exists in S3 with error handling
   * Requirements: 8.1, 8.2, 8.3, 7.1, 7.5
   */
  async fileExists(key: string): Promise<boolean> {
    if (!key) {
      throw new ValidationError('Key is required for file existence check');
    }

    const requestId = `s3_exists_${key}_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 file existence check', {
      operationType: 's3_file_exists',
      timestamp: new Date().toISOString(),
      requestId,
      key
    });

    try {
      const result = await errorHandlingService.executeS3Operation(
        async () => {
          const headParams: AWS.S3.HeadObjectRequest = {
            Bucket: this.bucketName,
            Key: key
          };

          await this.s3.headObject(headParams).promise();
          return true;
        },
        requestId
      );

      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 file existence check succeeded', {
        operationType: 's3_file_exists',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          key,
          exists: result
        }
      });

      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      if (error.code === 'NotFound' || error.statusCode === 404) {
        // File not found is not an error, just log as info
        console.log('S3 file existence check completed - file not found', {
          operationType: 's3_file_exists',
          requestId,
          responseTimeMs: responseTime,
          metadata: {
            key,
            exists: false
          }
        });
        return false;
      }
      
      // Requirement 8.3: Log error code, error message, and full error context on failure
      console.error('S3 file existence check failed', {
        operationType: 's3_file_exists',
        requestId,
        responseTimeMs: responseTime,
        errorCode: error.code || error.statusCode || 'UNKNOWN',
        errorMessage: error.message,
        errorContext: {
          key,
          errorType: error.name
        }
      });

      throw error;
    }
  }

  /**
   * Validate file type and size
   * Requirements: 9.3, 9.5
   */
  validateFile(buffer: Buffer, filename: string, options: {
    allowedTypes?: string[];
    maxSizeBytes?: number;
  } = {}): void {
    const { 
      allowedTypes = S3_CONFIG.ALLOWED_FILE_TYPES,
      maxSizeBytes = S3_CONFIG.MAX_FILE_SIZE 
    } = options;

    // Requirement 9.3: Validate file is not empty
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('File cannot be empty');
    }

    // Requirement 9.3: Validate filename is provided
    if (!filename || filename.trim().length === 0) {
      throw new ValidationError('Filename is required');
    }

    // Requirement 9.3: Validate file size
    if (buffer.length > maxSizeBytes) {
      throw new ValidationError(
        `File size (${buffer.length} bytes) exceeds maximum allowed size of ${maxSizeBytes} bytes (${Math.round(maxSizeBytes / 1024 / 1024)}MB)`
      );
    }

    // Requirement 9.3: Validate file type by extension
    const parts = filename.toLowerCase().split('.');
    if (parts.length < 2) {
      throw new ValidationError(
        'File must have a valid extension'
      );
    }
    
    const fileExtension = parts.pop();
    if (!fileExtension) {
      throw new ValidationError(
        'File must have a valid extension'
      );
    }

    const extensionWithDot = `.${fileExtension}`;
    if (!allowedTypes.includes(extensionWithDot)) {
      throw new ValidationError(
        `File type '${extensionWithDot}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`
      );
    }

    // Requirement 9.3: Validate minimum file size (at least 100 bytes)
    if (buffer.length < 100) {
      throw new ValidationError(
        'File is too small to be valid (minimum 100 bytes required)'
      );
    }
  }

  /**
   * Generate unique S3 key for file storage
   * Requirements: 7.1, 9.4
   */
  generateFileKey(prefix: string, userId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitizedFilename = sanitizeFilename(filename);
    return `${prefix}${userId}/${timestamp}_${sanitizedFilename}`;
  }

  /**
   * Health check for S3 service
   * Requirements: 8.1, 8.2, 8.3, 10.5
   */
  async healthCheck(): Promise<boolean> {
    const requestId = `s3_health_check_${Date.now()}`;
    const startTime = Date.now();
    
    // Requirement 8.1: Log operation type, timestamp, and request identifier before call
    console.log('Starting S3 health check', {
      operationType: 's3_health_check',
      timestamp: new Date().toISOString(),
      requestId
    });

    try {
      // Try to list objects in the bucket (with limit 1 to minimize cost)
      await this.s3.listObjectsV2({
        Bucket: this.bucketName,
        MaxKeys: 1
      }).promise();
      
      // Requirement 8.2: Log response time and key response metadata on success
      const responseTime = Date.now() - startTime;
      console.log('S3 health check succeeded', {
        operationType: 's3_health_check',
        requestId,
        responseTimeMs: responseTime,
        metadata: {
          status: 'healthy'
        }
      });
      
      return true;
    } catch (error) {
      // Requirement 8.3: Log error code, error message, and full error context on failure
      const responseTime = Date.now() - startTime;
      console.error('S3 health check failed', {
        operationType: 's3_health_check',
        requestId,
        responseTimeMs: responseTime,
        errorCode: (error as any).code || (error as any).statusCode || 'UNKNOWN',
        errorMessage: (error as Error).message,
        errorContext: {
          errorType: (error as Error).name
        }
      });
      
      return false;
    }
  }
}

// Factory function to create S3Service instance
export const createS3Service = (config: S3Config): S3Service => {
  return new S3Service(config);
};