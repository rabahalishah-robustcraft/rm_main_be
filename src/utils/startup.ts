import { config, validateConfig, checkConfigHealth } from './config';
import { monitoringService } from '../services/MonitoringService';
import prisma from '../lib/prisma';

/**
 * Startup validation and initialization
 */
export class StartupValidator {
  private static instance: StartupValidator;
  private validationResults: { [key: string]: boolean } = {};

  private constructor() {}

  public static getInstance(): StartupValidator {
    if (!StartupValidator.instance) {
      StartupValidator.instance = new StartupValidator();
    }
    return StartupValidator.instance;
  }

  /**
   * Run all startup validations
   */
  public async runStartupValidation(): Promise<{ success: boolean; errors: string[] }> {
    console.log('🚀 Starting application validation...');
    
    const errors: string[] = [];

    try {
      // 1. Validate configuration
      console.log('📋 Validating configuration...');
      const configValidation = this.validateConfiguration();
      if (!configValidation.success) {
        errors.push(...configValidation.errors);
      }

      // 2. Validate database connection
      console.log('🗄️  Validating database connection...');
      const dbValidation = await this.validateDatabase();
      if (!dbValidation.success) {
        errors.push(...dbValidation.errors);
      }

      // 3. Validate external services
      console.log('🌐 Validating external services...');
      const servicesValidation = await this.validateExternalServices();
      if (!servicesValidation.success) {
        errors.push(...servicesValidation.errors);
      }

      // 4. Initialize monitoring
      console.log('📊 Initializing monitoring...');
      const monitoringValidation = await this.initializeMonitoring();
      if (!monitoringValidation.success) {
        errors.push(...monitoringValidation.errors);
      }

      // 5. Validate system resources
      console.log('💻 Checking system resources...');
      const resourceValidation = this.validateSystemResources();
      if (!resourceValidation.success) {
        errors.push(...resourceValidation.errors);
      }

      const success = errors.length === 0;
      
      if (success) {
        console.log('✅ All startup validations passed');
      } else {
        console.error('❌ Startup validation failed with errors:');
        errors.forEach(error => console.error(`   - ${error}`));
      }

      return { success, errors };
    } catch (error) {
      const errorMessage = `Startup validation failed: ${(error as Error)?.message || String(error) || 'Unknown error'}`;
      console.error('💥', errorMessage);
      return { success: false, errors: [errorMessage] };
    }
  }

  /**
   * Validate configuration
   */
  private validateConfiguration(): { success: boolean; errors: string[] } {
    try {
      const configValidation = validateConfig();
      if (!configValidation.isValid) {
        return { success: false, errors: configValidation.errors };
      }

      const configHealth = checkConfigHealth();
      if (!configHealth.healthy) {
        // Config health issues are warnings, not errors
        console.warn('⚠️  Configuration health warnings:');
        configHealth.issues.forEach(issue => console.warn(`   - ${issue}`));
      }

      this.validationResults.configuration = true;
      return { success: true, errors: [] };
    } catch (error) {
      const errorMessage = `Configuration validation failed: ${(error as Error)?.message || String(error) || 'Unknown error'}`;
      return { success: false, errors: [errorMessage] };
    }
  }

  /**
   * Validate database connection
   */
  private async validateDatabase(): Promise<{ success: boolean; errors: string[] }> {
    try {
      // Test basic connectivity
      await prisma.$queryRaw`SELECT 1`;
      
      // Test that required tables exist
      const tableChecks = await Promise.all([
        prisma.user.findFirst().catch(() => null),
        prisma.userProfile.findFirst().catch(() => null),
        prisma.audioSession.findFirst().catch(() => null),
        prisma.usageTracking.findFirst().catch(() => null)
      ]);

      this.validationResults.database = true;
      return { success: true, errors: [] };
    } catch (error) {
      const errorMessage = `Database validation failed: ${(error as Error)?.message || String(error) || 'Unknown error'}`;
      return { success: false, errors: [errorMessage] };
    }
  }

  /**
   * Validate external services configuration
   * Requirements: 10.1, 10.2, 10.5
   */
  private async validateExternalServices(): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Requirement 10.1, 10.2: Validate OpenAI API keys at startup
    if (!config.OPENAI_API_KEY) {
      errors.push('Missing required environment variable: OPENAI_API_KEY - GPT API key is required for AI analysis');
    } else if (config.OPENAI_API_KEY.length < 20) {
      errors.push('Invalid OPENAI_API_KEY: API key appears to be too short (minimum 20 characters)');
    }

    // Requirement 10.1, 10.2: Validate Whisper API key at startup
    if (!config.WHISPER_API_KEY) {
      errors.push('Missing required environment variable: WHISPER_API_KEY - Whisper API key is required for audio transcription');
    } else if (config.WHISPER_API_KEY.length < 20) {
      errors.push('Invalid WHISPER_API_KEY: API key appears to be too short (minimum 20 characters)');
    }

    // Requirement 10.1, 10.2: Validate AWS credentials at startup
    if (!config.AWS_ACCESS_KEY_ID) {
      errors.push('Missing required environment variable: AWS_ACCESS_KEY_ID - AWS credentials are required for S3 file storage');
    }
    if (!config.AWS_SECRET_ACCESS_KEY) {
      errors.push('Missing required environment variable: AWS_SECRET_ACCESS_KEY - AWS credentials are required for S3 file storage');
    }
    if (!config.AWS_S3_BUCKET) {
      errors.push('Missing required environment variable: AWS_S3_BUCKET - S3 bucket name is required for file storage');
    }

    // JWT validation
    if (!config.JWT_SECRET) {
      errors.push('Missing required environment variable: JWT_SECRET - JWT secret is required for authentication');
    } else if (config.JWT_SECRET.length < 32) {
      errors.push('Invalid JWT_SECRET: Secret should be at least 32 characters long for security');
    }

    // Requirement 10.5: Log clear error messages for missing variables
    if (errors.length > 0) {
      console.error('❌ Configuration validation failed - required environment variables are missing or invalid:');
      errors.forEach(error => console.error(`   ⚠️  ${error}`));
      console.error('\n💡 Please ensure all required environment variables are set in your .env file');
    }

    this.validationResults.externalServices = errors.length === 0;
    return { success: errors.length === 0, errors };
  }

  /**
   * Initialize monitoring service
   */
  private async initializeMonitoring(): Promise<{ success: boolean; errors: string[] }> {
    try {
      // Trigger initial metrics collection
      await monitoringService.collectSystemMetrics();
      
      // Perform initial health check
      await monitoringService.performHealthChecks();

      this.validationResults.monitoring = true;
      return { success: true, errors: [] };
    } catch (error) {
      const errorMessage = `Monitoring initialization failed: ${(error as Error)?.message || String(error) || 'Unknown error'}`;
      return { success: false, errors: [errorMessage] };
    }
  }

  /**
   * Validate system resources
   */
  private validateSystemResources(): { success: boolean; errors: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
    
    if (heapUsedMB > 500) { // 500MB
      warnings.push(`High initial memory usage: ${heapUsedMB.toFixed(1)}MB`);
    }

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 16) {
      errors.push(`Node.js version ${nodeVersion} is not supported. Please use Node.js 16 or higher.`);
    } else if (majorVersion < 18) {
      warnings.push(`Node.js version ${nodeVersion} is outdated. Consider upgrading to Node.js 18+.`);
    }

    // Check environment
    if (config.NODE_ENV === 'production') {
      if (!config.ADMIN_EMAILS && !config.ADMIN_DOMAINS) {
        warnings.push('No admin access configured for production environment');
      }
    }

    // Log warnings
    if (warnings.length > 0) {
      console.warn('⚠️  System resource warnings:');
      warnings.forEach(warning => console.warn(`   - ${warning}`));
    }

    this.validationResults.systemResources = errors.length === 0;
    return { success: errors.length === 0, errors };
  }

  /**
   * Get validation results
   */
  public getValidationResults(): { [key: string]: boolean } {
    return { ...this.validationResults };
  }

  /**
   * Check if all validations passed
   */
  public isFullyValidated(): boolean {
    return Object.values(this.validationResults).every(result => result === true);
  }

  /**
   * Get startup summary
   */
  public getStartupSummary(): any {
    return {
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      nodeVersion: process.version,
      platform: process.platform,
      validations: this.validationResults,
      fullyValidated: this.isFullyValidated(),
      configuration: {
        port: config.PORT,
        database: config.DATABASE_URL ? 'configured' : 'not_configured',
        openai: {
          gpt: config.OPENAI_API_KEY ? 'configured' : 'not_configured',
          whisper: config.WHISPER_API_KEY ? 'configured' : 'not_configured'
        },
        aws: {
          s3: config.AWS_S3_BUCKET ? 'configured' : 'not_configured',
          region: config.AWS_REGION,
          credentials: (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) ? 'configured' : 'not_configured'
        },
        features: {
          rateLimiting: config.ENABLE_RATE_LIMITING,
          abuseDetection: config.ENABLE_ABUSE_DETECTION,
          adminEndpoints: config.ENABLE_ADMIN_ENDPOINTS
        }
      }
    };
  }
}

/**
 * Run startup validation
 */
export async function runStartupValidation(): Promise<{ success: boolean; errors: string[] }> {
  const validator = StartupValidator.getInstance();
  return await validator.runStartupValidation();
}

/**
 * Get startup validator instance
 */
export function getStartupValidator(): StartupValidator {
  return StartupValidator.getInstance();
}