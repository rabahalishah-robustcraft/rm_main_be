import multer from 'multer';
import { Request } from 'express';
import { ValidationError } from '../types/auth';
import { S3_CONFIG } from './constants';

/**
 * File upload utilities for handling multipart form data
 * Requirements: 2.1, 7.1, 7.4
 */

// Configure multer for memory storage (files stored in memory as Buffer)
const storage = multer.memoryStorage();

/**
 * File filter function for resume uploads
 * Requirements: 2.1, 7.1
 */
const resumeFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check file type
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new ValidationError('Only PDF and Word documents are allowed for resume uploads'));
  }

  // Check file extension
  const fileExtension = file.originalname.toLowerCase().split('.').pop();
  if (!fileExtension || !S3_CONFIG.ALLOWED_FILE_TYPES.includes(`.${fileExtension}`)) {
    return cb(new ValidationError(`File type not allowed. Allowed types: ${S3_CONFIG.ALLOWED_FILE_TYPES.join(', ')}`));
  }

  cb(null, true);
};

/**
 * File filter function for audio uploads
 * Requirements: 3.2, 7.1
 */
const audioFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check file type
  const allowedMimeTypes = [
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/ogg',
    'audio/webm'
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new ValidationError('Only audio files are allowed'));
  }

  // Check file extension
  const fileExtension = file.originalname.toLowerCase().split('.').pop();
  if (!fileExtension || !S3_CONFIG.ALLOWED_AUDIO_TYPES.includes(`.${fileExtension}`)) {
    return cb(new ValidationError(`Audio type not allowed. Allowed types: ${S3_CONFIG.ALLOWED_AUDIO_TYPES.join(', ')}`));
  }

  cb(null, true);
};

/**
 * Multer configuration for resume uploads
 * Requirements: 2.1, 7.1
 */
export const resumeUpload = multer({
  storage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: S3_CONFIG.MAX_FILE_SIZE,
    files: 1 // Only allow one file at a time
  }
});

/**
 * Multer configuration for audio uploads
 * Requirements: 3.2, 7.1
 */
export const audioUpload = multer({
  storage,
  fileFilter: audioFileFilter,
  limits: {
    fileSize: S3_CONFIG.MAX_FILE_SIZE,
    files: 1 // Only allow one file at a time
  }
});

/**
 * Generic file validation utility
 * Requirements: 7.1
 */
export const validateFileBuffer = (
  buffer: Buffer, 
  filename: string, 
  options: {
    allowedTypes?: string[];
    maxSizeBytes?: number;
    minSizeBytes?: number;
  } = {}
): void => {
  const { 
    allowedTypes = S3_CONFIG.ALLOWED_FILE_TYPES,
    maxSizeBytes = S3_CONFIG.MAX_FILE_SIZE,
    minSizeBytes = 1
  } = options;

  // Check file size
  if (buffer.length > maxSizeBytes) {
    throw new ValidationError(
      `File size ${buffer.length} bytes exceeds maximum allowed size of ${maxSizeBytes} bytes`
    );
  }

  if (buffer.length < minSizeBytes) {
    throw new ValidationError(
      `File size ${buffer.length} bytes is below minimum required size of ${minSizeBytes} bytes`
    );
  }

  // Check file type by extension
  const fileExtension = filename.toLowerCase().split('.').pop();
  if (!fileExtension) {
    throw new ValidationError('File must have a valid extension');
  }

  const fullExtension = `.${fileExtension}`;
  if (!allowedTypes.includes(fullExtension)) {
    throw new ValidationError(
      `File type '${fullExtension}' not allowed. Allowed types: ${allowedTypes.join(', ')}`
    );
  }

  // Basic file content validation
  if (buffer.length === 0) {
    throw new ValidationError('File cannot be empty');
  }
};

/**
 * Extract file metadata from multer file object
 * Requirements: 7.1
 */
export const extractFileMetadata = (file: Express.Multer.File): {
  originalName: string;
  mimeType: string;
  size: number;
  extension: string;
} => {
  const extension = file.originalname.toLowerCase().split('.').pop() || '';
  
  return {
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    extension
  };
};

/**
 * Sanitize filename for safe storage
 * Replaces special characters with underscores
 * Preserves alphanumeric, dots, hyphens, underscores
 * Requirements: 9.4
 */
export const sanitizeFilename = (filename: string): string => {
  // Replace special characters (anything not alphanumeric, dot, hyphen, or underscore) with underscore
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
};

/**
 * Generate content type from file extension
 * Requirements: 7.1
 */
export const getContentTypeFromExtension = (extension: string): string => {
  const contentTypeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg'
  };

  return contentTypeMap[extension.toLowerCase()] || 'application/octet-stream';
};