/**
 * Dependency Injection Container
 * Wires all services together with proper dependency management
 * Requirements: All requirements integration
 */

import { PrismaClient } from '@prisma/client';
import { config } from './utils/config';

// Import all services
import { AuthService } from './services/AuthService';
import { createEmailService } from './services/EmailService';
import { ProfileService } from './services/ProfileService';
import { AudioSessionService } from './services/AudioSessionService';
import { SubscriptionService } from './services/SubscriptionService';
import { DashboardService } from './services/DashboardService';
import { OpenAIService } from './services/OpenAIService';
import { S3Service, createS3Service } from './services/S3Service';
import { monitoringService } from './services/MonitoringService';
import { ErrorHandlingService } from './services/ErrorHandlingService';

export interface ServiceContainer {
  // Core services
  prisma: PrismaClient;
  authService: AuthService;
  profileService: ProfileService;
  audioSessionService: AudioSessionService;
  subscriptionService: SubscriptionService;
  dashboardService: DashboardService;
  
  // External service integrations
  openaiService: OpenAIService;
  s3Service: S3Service;
  
  // System services
  monitoringService: typeof monitoringService;
  errorHandlingService: ErrorHandlingService;
}

class Container {
  private static instance: Container;
  private services: ServiceContainer | null = null;

  private constructor() {}

  public static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  public async initialize(): Promise<ServiceContainer> {
    if (this.services) {
      return this.services;
    }

    console.log('🔧 Initializing service container...');

    // Initialize Prisma client
    const prisma = new PrismaClient({
      log: config.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });

    // Test database connection
    try {
      await prisma.$connect();
      console.log('✅ Database connection established');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw new Error('Failed to connect to database');
    }

    // Initialize S3 Service
    const s3Config = {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      region: config.AWS_REGION,
      bucketName: config.AWS_S3_BUCKET
    };
    const s3Service = createS3Service(s3Config);
    console.log('✅ S3 service initialized');

    // Initialize OpenAI Service
    const openaiConfig = {
      gptApiKey: config.OPENAI_API_KEY,
      whisperApiKey: config.WHISPER_API_KEY,
      maxRetries: 3,
      timeout: 60000
    };
    const openaiService = new OpenAIService(openaiConfig);
    console.log('✅ OpenAI service initialized');

    // Initialize Email Service (optional - for password reset)
    const emailService = createEmailService({
      resendApiKey: config.RESEND_API_KEY,
      fromAddress: config.EMAIL_FROM_ADDRESS || 'noreply@example.com',
      fromName: config.EMAIL_FROM_NAME || 'Your App'
    });

    // Initialize Error Handling Service
    const errorHandlingService = ErrorHandlingService.getInstance();
    console.log('✅ Error handling service initialized');

    // Initialize core business services with dependencies
    const authService = new AuthService(
      prisma,
      emailService,
      config.GOOGLE_CLIENT_ID
    );
    const subscriptionService = new SubscriptionService(prisma);
    const dashboardService = new DashboardService(prisma);
    const profileService = new ProfileService(s3Service, openaiService, prisma);
    const audioSessionService = new AudioSessionService(
      prisma, 
      openaiService, 
      s3Service, 
      subscriptionService
    );

    console.log('✅ Core services initialized');

    // Create service container
    this.services = {
      prisma,
      authService,
      profileService,
      audioSessionService,
      subscriptionService,
      dashboardService,
      openaiService,
      s3Service,
      monitoringService,
      errorHandlingService
    };

    console.log('🎉 Service container initialization complete');
    return this.services;
  }

  public getServices(): ServiceContainer {
    if (!this.services) {
      throw new Error('Container not initialized. Call initialize() first.');
    }
    return this.services;
  }

  public async cleanup(): Promise<void> {
    if (this.services) {
      console.log('🧹 Cleaning up services...');
      await this.services.prisma.$disconnect();
      console.log('✅ Services cleaned up');
    }
  }
}

export const container = Container.getInstance();
export default container;