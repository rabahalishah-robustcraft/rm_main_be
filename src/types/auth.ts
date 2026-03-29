export enum SubscriptionTier {
  FREE = 'free',
  PAID = 'paid'
}

export enum ErrorCode {
  // Validation Errors (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Authentication Errors (401)
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  
  // Authorization Errors (403)
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Not Found Errors (404)
  NOT_FOUND = 'NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  PROFILE_NOT_FOUND = 'PROFILE_NOT_FOUND',
  
  // Usage Limit Errors (429)
  USAGE_LIMIT_ERROR = 'USAGE_LIMIT_ERROR',
  MONTHLY_LIMIT_EXCEEDED = 'MONTHLY_LIMIT_EXCEEDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // External Service Errors (502)
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  OPENAI_API_ERROR = 'OPENAI_API_ERROR',
  S3_UPLOAD_ERROR = 'S3_UPLOAD_ERROR',
  TRANSCRIPTION_ERROR = 'TRANSCRIPTION_ERROR',
  
  // Internal Errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

export interface User {
  id: string;
  email: string;
  passwordHash: string | null; // null for Google OAuth users
  subscriptionTier: SubscriptionTier;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthService {
  register(email: string, password: string): Promise<{ user: User; token: string }>;
  login(email: string, password: string): Promise<{ user: User; token: string }>;
  validateToken(token: string): Promise<User>;
  logout(token: string): Promise<void>;
  refreshToken(token: string): Promise<string>;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(code: ErrorCode, message: string, statusCode: number = 500, details?: any) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', details?: any) {
    super(ErrorCode.AUTHENTICATION_ERROR, message, 401, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: any) {
    super(ErrorCode.NOT_FOUND, message, 404, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string = 'External service error', details?: any) {
    super(ErrorCode.EXTERNAL_SERVICE_ERROR, message, 502, details);
  }
}

// Profile types
export interface UserProfile {
  id: string;
  userId: string;
  
  // Profile Information (from Figma design)
  fullName?: string;
  currentJobTitle?: string;
  currentCompany?: string;
  school?: string;
  degreeInfo?: string;
  previousJobTitles?: string[];
  
  // Resume and Skills
  resumeS3Key?: string;
  extractedSkills: string[];
  experienceLevel?: string;
  
  // Target Role
  targetIndustry?: string;
  targetJobTitle?: string;
  
  // AI Attributes
  aiAttributes: Record<string, any>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileUpdateData {
  fullName?: string;
  currentJobTitle?: string;
  currentCompany?: string;
  school?: string;
  degreeInfo?: string;
  previousJobTitles?: string[];
  targetIndustry?: string;
  targetJobTitle?: string;
  experienceLevel?: string;
}

// Database types
export interface DatabaseUserProfile {
  id: string;
  userId: string;
  
  // Profile Information
  fullName: string | null;
  currentJobTitle: string | null;
  currentCompany: string | null;
  school: string | null;
  degreeInfo: string | null;
  previousJobTitles: string[];
  
  // Resume and Skills
  resumeS3Key: string | null;
  extractedSkills: string[];
  experienceLevel: string | null;
  
  // Target Role
  targetIndustry: string | null;
  targetJobTitle: string | null;
  
  // AI Attributes
  aiAttributes: any; // JSON type from Prisma
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateProfileData {
  fullName?: string;
  currentJobTitle?: string;
  currentCompany?: string;
  school?: string;
  degreeInfo?: string;
  previousJobTitles?: string[];
  resumeS3Key?: string;
  targetIndustry?: string;
  targetJobTitle?: string;
  aiAttributes?: any;
  extractedSkills?: string[];
  experienceLevel?: string;
}

// Service interfaces
export interface ProfileService {
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, data: ProfileUpdateData): Promise<UserProfile>;
  uploadResume(userId: string, file: Buffer, filename: string): Promise<string>;
  processResumeFromText(userId: string, extractedText: string): Promise<void>;
  processResume(userId: string, s3Key: string): Promise<void>;
  setTargetRole(userId: string, industry: string, jobTitle: string): Promise<void>;
  deleteProfile(userId: string): Promise<void>;
}