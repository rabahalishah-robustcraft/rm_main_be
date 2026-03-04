/**
 * Application constants
 */

// Subscription limits
export const SUBSCRIPTION_LIMITS = {
  FREE: {
    MONTHLY_SESSIONS: 3,
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    MAX_AUDIO_DURATION: 10 * 60 // 10 minutes
  },
  PAID: {
    MONTHLY_SESSIONS: -1, // Unlimited
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    MAX_AUDIO_DURATION: 30 * 60 // 30 minutes
  }
} as const;

// File type constants
export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/m4a',
  'audio/aac',
  'audio/ogg'
] as const;

export const ALLOWED_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
] as const;

// File size limits
export const FILE_SIZE_LIMITS = {
  AUDIO: 50 * 1024 * 1024, // 50MB
  RESUME: 10 * 1024 * 1024, // 10MB
  AVATAR: 5 * 1024 * 1024 // 5MB
} as const;

// Performance score ranges (1-5 out of 5)
export const SCORE_RANGES = {
  MIN: 1,
  MAX: 5,
  EXCELLENT: 5,
  GOOD: 4,
  FAIR: 3,
  POOR: 2
} as const;

// Score categories
export const SCORE_CATEGORIES = [
  'clarity',
  'confidence',
  'tone',
  'enthusiasm',
  'specificity'
] as const;

// Experience levels
export const EXPERIENCE_LEVELS = [
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'executive'
] as const;

// Session statuses
export const SESSION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed'
] as const;

// Subscription tiers
export const SUBSCRIPTION_TIERS = [
  'free',
  'paid'
] as const;

// JWT configuration
export const JWT_CONFIG = {
  DEFAULT_EXPIRES_IN: '24h',
  REFRESH_EXPIRES_IN: '7d',
  ALGORITHM: 'HS256' as const,
  ISSUER: 'ai-audio-summarization'
} as const;

// Password configuration
export const PASSWORD_CONFIG = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  SALT_ROUNDS: 12,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBERS: true,
  REQUIRE_SPECIAL_CHARS: true
} as const;

// Rate limiting
export const RATE_LIMITS = {
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 5
  },
  API: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100
  },
  UPLOAD: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 10
  }
} as const;

// External service timeouts
// Requirement 10.4: Configuration constants for retry counts, timeouts, and delays
export const SERVICE_TIMEOUTS = {
  OPENAI: {
    WHISPER: 60000, // 1 minute
    GPT: 30000, // 30 seconds
    MAX_RETRIES: 3
  },
  S3: {
    UPLOAD: 30000, // 30 seconds
    DOWNLOAD: 15000, // 15 seconds
    MAX_RETRIES: 2
  },
  DATABASE: {
    QUERY: 10000, // 10 seconds
    TRANSACTION: 30000 // 30 seconds
  }
} as const;

// Retry configuration constants
// Requirement 10.4: Define retry counts, timeouts, and delays as constants
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000, // 1 second
  DELAYS_MS: [1000, 2000, 4000], // Exponential backoff: 1s, 2s, 4s
  MAX_DELAY_MS: 4000, // 4 seconds
  RETRYABLE_STATUS_CODES: [429, 500, 502, 503, 504],
  RETRYABLE_S3_CODES: [500, 503],
  NON_RETRYABLE_S3_CODES: [400, 403, 404]
} as const;

// Pre-signed URL configuration
// Requirement 10.4: Define default expiration times for pre-signed URLs
export const PRESIGNED_URL_CONFIG = {
  MIN_EXPIRATION_SECONDS: 1, // Minimum 1 second
  MAX_EXPIRATION_SECONDS: 86400, // Maximum 24 hours
  DEFAULT_DOWNLOAD_EXPIRATION: 3600, // 1 hour for downloads
  DEFAULT_UPLOAD_EXPIRATION: 3600, // 1 hour for uploads
  RESUME_EXPIRATION: 3600 // 1 hour for resume files
} as const;

// Validation limits
// Requirement 10.4: Define validation limits (file sizes, token limits)
export const VALIDATION_LIMITS = {
  AUDIO: {
    MIN_SIZE_BYTES: 100, // Minimum 100 bytes
    MAX_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
    MIN_DURATION_SECONDS: 1, // Minimum 1 second
    MAX_DURATION_SECONDS: 30 * 60 // Maximum 30 minutes
  },
  TEXT: {
    MIN_LENGTH: 1, // Minimum 1 character
    MAX_LENGTH: 100000, // Maximum 100k characters
    MAX_TOKENS: 8000, // Maximum tokens for GPT input
    MIN_TOKENS: 1 // Minimum tokens
  },
  FILE: {
    MIN_SIZE_BYTES: 100, // Minimum 100 bytes
    MAX_RESUME_SIZE_BYTES: 10 * 1024 * 1024, // 10MB for resumes
    MAX_AUDIO_SIZE_BYTES: 50 * 1024 * 1024, // 50MB for audio
    MAX_AVATAR_SIZE_BYTES: 5 * 1024 * 1024 // 5MB for avatars
  },
  FILENAME: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 255,
    ALLOWED_CHARS_REGEX: /^[a-zA-Z0-9._-]+$/ // Alphanumeric, dots, hyphens, underscores
  }
} as const;

// Cache durations (in seconds)
export const CACHE_DURATIONS = {
  USER_PROFILE: 300, // 5 minutes
  DASHBOARD_STATS: 600, // 10 minutes
  SYSTEM_SETTINGS: 3600, // 1 hour
  INDUSTRIES: 86400 // 24 hours
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  DEFAULT_OFFSET: 0
} as const;

// OpenAI model names
export const OPENAI_MODELS = {
  WHISPER: 'whisper-1',
  GPT_3_5_TURBO: 'gpt-3.5-turbo',
  GPT_4: 'gpt-4',
  GPT_4_TURBO: 'gpt-4-turbo-preview'
} as const;

// S3 configuration
// Requirement 10.4: S3 configuration with pre-signed URL defaults
export const S3_CONFIG = {
  AUDIO_PREFIX: 'audio/',
  RESUME_PREFIX: 'resumes/',
  AVATAR_PREFIX: 'avatars/',
  SIGNED_URL_EXPIRES: 3600, // 1 hour (default)
  MULTIPART_THRESHOLD: 100 * 1024 * 1024, // 100MB
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ALLOWED_FILE_TYPES: ['.pdf', '.doc', '.docx'] as string[], // For resume uploads
  ALLOWED_AUDIO_TYPES: ['.mp3', '.wav', '.m4a', '.ogg'] as string[], // For audio uploads
  CLEANUP_BATCH_SIZE: 100,
  CLEANUP_AGE_DAYS: 30, // Files older than 30 days without references
  // Pre-signed URL configuration
  PRESIGNED_URL: {
    MIN_EXPIRATION: 1, // 1 second minimum
    MAX_EXPIRATION: 86400, // 24 hours maximum
    DEFAULT_EXPIRATION: 3600 // 1 hour default
  }
};

// Error messages
export const ERROR_MESSAGES = {
  VALIDATION: {
    REQUIRED_FIELD: 'This field is required',
    INVALID_EMAIL: 'Please provide a valid email address',
    INVALID_PASSWORD: 'Password does not meet requirements',
    INVALID_UUID: 'Invalid ID format',
    FILE_TOO_LARGE: 'File size exceeds maximum allowed',
    INVALID_FILE_TYPE: 'File type not supported'
  },
  AUTH: {
    INVALID_CREDENTIALS: 'Invalid email or password',
    TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
    TOKEN_INVALID: 'Invalid authentication token',
    ACCESS_DENIED: 'Access denied',
    ACCOUNT_NOT_FOUND: 'Account not found'
  },
  SUBSCRIPTION: {
    LIMIT_EXCEEDED: 'Monthly session limit exceeded',
    UPGRADE_REQUIRED: 'Upgrade required for this feature',
    INVALID_TIER: 'Invalid subscription tier'
  },
  EXTERNAL: {
    OPENAI_ERROR: 'AI service temporarily unavailable',
    S3_ERROR: 'File storage service error',
    TRANSCRIPTION_FAILED: 'Audio transcription failed',
    ANALYSIS_FAILED: 'AI analysis failed'
  },
  GENERAL: {
    NOT_FOUND: 'Resource not found',
    INTERNAL_ERROR: 'An unexpected error occurred',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
    REQUEST_TIMEOUT: 'Request timed out'
  }
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
  AUTH: {
    REGISTRATION_SUCCESS: 'Account created successfully',
    LOGIN_SUCCESS: 'Logged in successfully',
    LOGOUT_SUCCESS: 'Logged out successfully',
    PASSWORD_UPDATED: 'Password updated successfully'
  },
  PROFILE: {
    UPDATED: 'Profile updated successfully',
    RESUME_UPLOADED: 'Resume uploaded successfully',
    TARGET_ROLE_SET: 'Target role updated successfully'
  },
  SESSION: {
    STARTED: 'Session started successfully',
    AUDIO_UPLOADED: 'Audio uploaded successfully',
    PROCESSING_COMPLETE: 'Analysis complete'
  },
  SUBSCRIPTION: {
    UPGRADED: 'Subscription upgraded successfully',
    DOWNGRADED: 'Subscription downgraded successfully'
  }
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
} as const;

// Environment variables with defaults
export const ENV_DEFAULTS = {
  PORT: 3000,
  NODE_ENV: 'development',
  JWT_EXPIRES_IN: '24h',
  BCRYPT_SALT_ROUNDS: 12,
  CORS_ORIGIN: '*',
  LOG_LEVEL: 'info',
  MAX_REQUEST_SIZE: '10mb',
  REQUEST_TIMEOUT: 30000
} as const;

// Regex patterns
export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
  PHONE: /^\+?[\d\s\-\(\)]+$/,
  URL: /^https?:\/\/.+/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
} as const;

// Date formats
export const DATE_FORMATS = {
  ISO: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  DATE_ONLY: 'YYYY-MM-DD',
  TIME_ONLY: 'HH:mm:ss',
  DISPLAY: 'MMM DD, YYYY',
  DISPLAY_WITH_TIME: 'MMM DD, YYYY HH:mm'
} as const;

// API response formats
export const API_RESPONSE_FORMATS = {
  SUCCESS: {
    status: 'success',
    data: null,
    message: null
  },
  ERROR: {
    status: 'error',
    error: {
      code: null,
      message: null,
      details: null
    },
    timestamp: null,
    path: null
  }
} as const;