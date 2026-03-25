import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Import configuration and validation
import { config } from './utils/config';
import { runStartupValidation, getStartupValidator } from './utils/startup';
import { quickIntegrationCheck } from './utils/systemIntegration';
import container from './container';

// Import routes and middleware
import { createApiRoutes } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { 
  requestLogger, 
  performanceMonitor, 
  securityHeaders, 
  sanitizeRequest,
  requestTimeout,
  healthCheck 
} from './middleware/logging';
import { 
  apiRateLimit, 
  abuseDetection 
} from './middleware/rateLimiting';
import { 
  enforceDataIsolation, 
  contentSecurityPolicy, 
  validateRequest, 
  sessionSecurity,
  validateApiKey 
} from './middleware/security';

// Load environment variables
dotenv.config();

// Create the Express app with all middleware and routes (without listening)
async function createApp() {
  console.log('🚀 AI Audio Summarization Backend starting...');

  const validation = await runStartupValidation();

  if (!validation.success) {
    console.error('❌ Startup validation failed. Exiting...');
    process.exit(1);
  }

  // Initialize dependency injection container
  const services = await container.initialize();

  // Perform system integration check
  console.log('🔍 Performing system integration check...');
  const integrationHealthy = await quickIntegrationCheck(services);

  if (!integrationHealthy) {
    console.warn('⚠️  System integration check detected issues - proceeding with caution');
  } else {
    console.log('✅ System integration check passed');
  }

  const app = express();

  // Trust proxy for accurate IP addresses
  app.set('trust proxy', 1);

  // Security middleware (applied first)
  app.use(helmet({
    contentSecurityPolicy: false // We'll use our custom CSP
  }));
  app.use(contentSecurityPolicy);
  app.use(securityHeaders);

  // CORS configuration
  app.use(cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID']
  }));

  // Request logging and monitoring
  if (config.ENABLE_REQUEST_LOGGING) {
    app.use(morgan('combined'));
    app.use(requestLogger);
  }

  if (config.ENABLE_PERFORMANCE_MONITORING) {
    app.use(performanceMonitor);
  }

  // Request timeout
  app.use(requestTimeout(30000)); // 30 second timeout

  // Request validation and sanitization
  app.use(validateRequest);
  app.use(sanitizeRequest);

  // API key validation (optional)
  app.use(validateApiKey);

  // Rate limiting (if enabled)
  if (config.ENABLE_RATE_LIMITING) {
    app.use('/api', apiRateLimit);
  }

  // Abuse detection (if enabled)
  if (config.ENABLE_ABUSE_DETECTION) {
    app.use(abuseDetection);
  }

  // Body parsing middleware
  app.use(express.json({
    limit: `${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))}mb`
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: `${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))}mb`
  }));

  // Session security for authenticated requests
  app.use(sessionSecurity);

  // Health check endpoint (before other routes)
  app.use(healthCheck);

  // API routes with dependency injection
  const apiRoutes = createApiRoutes(services);
  app.use('/api', apiRoutes);

  // Root endpoint with startup summary
  app.get('/', (req, res) => {
    const startupSummary = getStartupValidator().getStartupSummary();

    res.status(200).json({
      success: true,
      message: 'AI Audio Summarization Backend API',
      version: process.env.npm_package_version || '1.0.0',
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString(),
      startup: startupSummary,
      documentation: '/api'
    });
  });

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

// Run startup validation and start listening
async function startServer() {
  const app = await createApp();
  const PORT = config.PORT;

  // Graceful shutdown handling
  const gracefulShutdown = async () => {
    console.log('Shutting down gracefully...');
    await container.cleanup();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Unhandled promise rejection handling
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // In production, you might want to exit the process
    if (config.NODE_ENV === 'production') {
      process.exit(1);
    }
  });

  // Uncaught exception handling
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${config.NODE_ENV}`);
    console.log(`📊 Monitoring: Active`);
    console.log(`🔒 Security: Enhanced`);

    if (config.ENABLE_ADMIN_ENDPOINTS) {
      console.log(`👑 Admin endpoints: Enabled`);
    }

    console.log('🎉 Server startup complete!');
  });

  return app;
}

// Only auto-start when not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { createApp };
export default startServer;