// Integration test setup with real database
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST || 'file:./test.db'
    }
  }
});

beforeAll(async () => {
  // Run migrations for test database
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
});

beforeEach(async () => {
  // Clean database before each test
  const tablenames = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations';
  `;
  
  for (const { name } of tablenames) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${name}";`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma };