import './types/express-augment';
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
  requestTimeoutWithLongAiRoutes,
  healthCheck 
} from './middleware/logging';
import { 
  apiRateLimitExcludingWebhooks, 
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
  console.log('Recruit Me AI Backend starting...');

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

  // Request timeout: default 30s; PATCH .../transcript 2m; POST .../audio uses AUDIO_UPLOAD_REQUEST_TIMEOUT_MS
  app.use(
    requestTimeoutWithLongAiRoutes(30000, 120000, config.AUDIO_UPLOAD_REQUEST_TIMEOUT_MS)
  );

  // Request validation and sanitization
  app.use(validateRequest);
  app.use(sanitizeRequest);

  // API key validation (optional)
  app.use(validateApiKey);

  // Rate limiting (if enabled) — skip /api/webhooks (AssemblyAI server callbacks)
  if (config.ENABLE_RATE_LIMITING) {
    app.use('/api', apiRateLimitExcludingWebhooks);
  }

  const rawJsonWebhookParser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const buf = req.body as Buffer;
    if (Buffer.isBuffer(buf)) {
      req.rawBody = buf;
      try {
        req.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      } catch {
        req.body = {};
      }
    } else {
      req.rawBody = Buffer.alloc(0);
      req.body = req.body ?? {};
    }
    next();
  };

  // Raw JSON body for AssemblyAI + Stripe webhooks (must run before express.json)
  app.use(
    '/api/webhooks/assemblyai',
    express.raw({ type: 'application/json', limit: '2mb' }),
    rawJsonWebhookParser
  );
  app.use(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '2mb' }),
    rawJsonWebhookParser
  );

  // Body parsing middleware (must run before abuse detection so body/query strings are inspectable)
  app.use(express.json({
    limit: `${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))}mb`
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: `${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))}mb`
  }));

  // Abuse detection (if enabled) — after parsers; see abuseDetection implementation
  if (config.ENABLE_ABUSE_DETECTION) {
    app.use(abuseDetection);
  }

  // Session security for authenticated requests
  app.use(sessionSecurity);

  // Health check endpoint (before other routes)
  app.use(healthCheck);

  // API routes with dependency injection (single mount: all routes under /api only)
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

  // Bind all interfaces so tools like ngrok (forwarding to localhost:PORT) can reach the process.
  // If you see ngrok ERR_NGROK_8012 / 502, confirm this PORT matches `ngrok http <PORT>` and the app is running.
  const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';

  app.listen(PORT, LISTEN_HOST, () => {
    console.log(`✅ Server listening on http://${LISTEN_HOST}:${PORT}`);
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