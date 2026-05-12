// Integration test setup with real database
import { PrismaClient } from '@prisma/client';

// Session pipeline integration tests mock AssemblyAI but still read config at import time.
process.env.ASSEMBLYAI_API_KEY ||= 'integration-test-assemblyai-api-key-placeholder';
process.env.WEBHOOK_BASE_URL ||= 'https://example.com';

// Integration tests use a real PostgreSQL database.
// DATABASE_URL_TEST should point to a Postgres test database (see .env.test).
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
    }
  }
});

// Do not truncate the schema before every test: multi-step suites keep users/tokens across
// `it` blocks, and the app uses the same DATABASE_URL. Suites should clean up in afterAll/afterEach.

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma };