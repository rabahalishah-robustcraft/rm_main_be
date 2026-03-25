// Integration test setup with real database
import { PrismaClient } from '@prisma/client';

// Integration tests use a real PostgreSQL database.
// DATABASE_URL_TEST should point to a Postgres test database (see .env.test).
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
    }
  }
});

beforeEach(async () => {
  // Clean PostgreSQL public schema before each test run (excluding Prisma migrations table)
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations';
  `;

  for (const { tablename } of tables) {
    // Restart identity to reset sequences; cascade to handle FKs
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE;`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma };