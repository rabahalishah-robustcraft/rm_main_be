import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

/**
 * Configuration schema for validation
 */
const configSchema = Joi.object({
  // Server Configuration
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  
  // Database Configuration
  DATABASE_URL: Joi.string().uri().required(),
  
  // JWT Configuration
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  
  // OpenAI Configuration
  OPENAI_API_KEY: Joi.string().required(),
  WHISPER_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-3.5-turbo'),
  OPENAI_MAX_TOKENS: Joi.number().integer().min(1).default(1000),
  OPENAI_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),
  
  // AWS Configuration
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_S3_BUCKET: Joi.string().required(),
  
  // CORS Configuration
  CORS_ORIGIN: Joi.string().default('*'),
  
  // Security Configuration
  ADMIN_EMAILS: Joi.string().optional(),
  ADMIN_DOMAINS: Joi.string().optional(),
  
  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(1).default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(900000), // 15 minutes
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: Joi.number().integer().min(1).default(10), // Increased from 5 to 10 attempts per window
  
  // File Upload Configuration
  MAX_FILE_SIZE: Joi.number().integer().min(1).default(50 * 1024 * 1024), // 50MB
  ALLOWED_FILE_TYPES: Joi.string().default('pdf,doc,docx,mp3,wav,m4a'),
  
  // Subscription Configuration
  FREE_TIER_MONTHLY_LIMIT: Joi.number().integer().min(0).default(3),
  PAID_TIER_MONTHLY_LIMIT: Joi.number().integer().min(-1).default(-1), // -1 = unlimited
  
  // Monitoring Configuration
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  ENABLE_REQUEST_LOGGING: Joi.boolean().default(true),
  ENABLE_PERFORMANCE_MONITORING: Joi.boolean().default(true),
  
  // External Service Configuration
  REDIS_URL: Joi.string().uri().optional(),
  SENTRY_DSN: Joi.string().uri().optional(),

  // Google OAuth (optional - use placeholders until client provides)
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),

  // Email (optional - Resend; use placeholders until client provides)
  RESEND_API_KEY: Joi.string().optional(),
  EMAIL_FROM_ADDRESS: Joi.string().email().optional(),
  EMAIL_FROM_NAME: Joi.string().optional(),
  
  // Feature Flags
  ENABLE_RATE_LIMITING: Joi.boolean().default(true),
  ENABLE_ABUSE_DETECTION: Joi.boolean().default(true),
  ENABLE_ADMIN_ENDPOINTS: Joi.boolean().default(true)
}).unknown(true); // Allow unknown environment variables

/**
 * Validated configuration object
 */
export interface Config {
  // Server Configuration
  NODE_ENV: string;
  PORT: number;
  
  // Database Configuration
  DATABASE_URL: string;
  
  // JWT Configuration
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  
  // OpenAI Configuration
  OPENAI_API_KEY: string;
  WHISPER_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_MAX_TOKENS: number;
  OPENAI_TEMPERATURE: number;
  
  // AWS Configuration
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_S3_BUCKET: string;
  
  // CORS Configuration
  CORS_ORIGIN: string;
  
  // Security Configuration
  ADMIN_EMAILS?: string;
  ADMIN_DOMAINS?: string;
  
  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  AUTH_RATE_LIMIT_WINDOW_MS: number;
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: number;
  
  // File Upload Configuration
  MAX_FILE_SIZE: number;
  ALLOWED_FILE_TYPES: string;
  
  // Subscription Configuration
  FREE_TIER_MONTHLY_LIMIT: number;
  PAID_TIER_MONTHLY_LIMIT: number;
  
  // Monitoring Configuration
  LOG_LEVEL: string;
  ENABLE_REQUEST_LOGGING: boolean;
  ENABLE_PERFORMANCE_MONITORING: boolean;
  
  // External Service Configuration
  REDIS_URL?: string;
  SENTRY_DSN?: string;

  // Google OAuth
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // Email (Resend)
  RESEND_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  
  // Feature Flags
  ENABLE_RATE_LIMITING: boolean;
  ENABLE_ABUSE_DETECTION: boolean;
  ENABLE_ADMIN_ENDPOINTS: boolean;
}

/**
 * Validate and load configuration
 */
function loadConfig(): Config {
  const { error, value } = configSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    const errorMessages = error.details.map(detail => 
      `${detail.path.join('.')}: ${detail.message}`
    ).join('\n');
    
    throw new Error(`Configuration validation failed:\n${errorMessages}`);
  }

  return value as Config;
}

/**
 * Configuration instance
 */
export const config = loadConfig();

/**
 * Validate configuration on startup
 */
export function validateConfig(): { isValid: boolean; errors: string[] } {
  try {
    loadConfig();
    return { isValid: true, errors: [] };
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errors = errorMessage.includes('Configuration validation failed:') 
      ? errorMessage.split('\n').slice(1) 
      : [errorMessage];
    
    return { isValid: false, errors };
  }
}

/**
 * Get configuration value with type safety
 */
export function getConfig<K extends keyof Config>(key: K): Config[K] {
  return config[key];
}

/**
 * Check if feature is enabled
 */
export function isFeatureEnabled(feature: keyof Pick<Config, 'ENABLE_RATE_LIMITING' | 'ENABLE_ABUSE_DETECTION' | 'ENABLE_ADMIN_ENDPOINTS'>): boolean {
  return config[feature];
}

/**
 * Get admin emails as array
 */
export function getAdminEmails(): string[] {
  if (!config.ADMIN_EMAILS) {
    return [];
  }
  return config.ADMIN_EMAILS.split(',').map(email => email.trim()).filter(Boolean);
}

/**
 * Get admin domains as array
 */
export function getAdminDomains(): string[] {
  if (!config.ADMIN_DOMAINS) {
    return [];
  }
  return config.ADMIN_DOMAINS.split(',').map(domain => domain.trim()).filter(Boolean);
}

/**
 * Get allowed file types as array
 */
export function getAllowedFileTypes(): string[] {
  return config.ALLOWED_FILE_TYPES.split(',').map(type => type.trim().toLowerCase()).filter(Boolean);
}

/**
 * Runtime configuration updates (for non-sensitive settings)
 */
class RuntimeConfig {
  private runtimeSettings = new Map<string, any>();

  set(key: string, value: any): void {
    // Only allow certain settings to be updated at runtime
    const allowedRuntimeSettings = [
      'LOG_LEVEL',
      'ENABLE_REQUEST_LOGGING',
      'ENABLE_PERFORMANCE_MONITORING',
      'RATE_LIMIT_MAX_REQUESTS',
      'RATE_LIMIT_WINDOW_MS'
    ];

    if (!allowedRuntimeSettings.includes(key)) {
      throw new Error(`Runtime configuration update not allowed for: ${key}`);
    }

    this.runtimeSettings.set(key, value);
    
    // Log configuration change
    console.log('Runtime configuration updated:', {
      key,
      value,
      timestamp: new Date().toISOString()
    });
  }

  get(key: string): any {
    return this.runtimeSettings.get(key) ?? (config as any)[key];
  }

  has(key: string): boolean {
    return this.runtimeSettings.has(key);
  }

  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.runtimeSettings.entries()) {
      result[key] = value;
    }
    return result;
  }

  reset(key?: string): void {
    if (key) {
      this.runtimeSettings.delete(key);
    } else {
      this.runtimeSettings.clear();
    }
  }
}

export const runtimeConfig = new RuntimeConfig();

/**
 * Configuration health check
 */
export function checkConfigHealth(): { healthy: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check required environment variables
  const requiredVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'OPENAI_API_KEY',
    'WHISPER_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET'
  ];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      issues.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Check JWT secret strength
  if (config.JWT_SECRET && config.JWT_SECRET.length < 32) {
    issues.push('JWT_SECRET should be at least 32 characters long');
  }

  // Check admin configuration
  if (!config.ADMIN_EMAILS && !config.ADMIN_DOMAINS) {
    issues.push('No admin access configured (ADMIN_EMAILS or ADMIN_DOMAINS)');
  }

  // Check file size limits
  if (config.MAX_FILE_SIZE > 100 * 1024 * 1024) { // 100MB
    issues.push('MAX_FILE_SIZE is very large, consider reducing for security');
  }

  return {
    healthy: issues.length === 0,
    issues
  };
}

/**
 * Export configuration for use in other modules
 */
export default config;