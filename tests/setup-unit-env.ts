/**
 * Runs before test files load (Jest setupFiles).
 * CI has no .env / .env.test — provide required config placeholders so modules
 * that call loadConfig() at import time do not crash the suite.
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
dotenv.config(); // local .env if present; does not override existing vars

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test?schema=public',
  JWT_SECRET: 'unit-test-jwt-secret-minimum-32-characters',
  OPENAI_API_KEY: 'sk-unit-test-openai-key-placeholder',
  WHISPER_API_KEY: 'sk-unit-test-whisper-key-placeholder',
  AWS_ACCESS_KEY_ID: 'AKIATESTACCESSKEYID0000',
  AWS_SECRET_ACCESS_KEY: 'unit-test-aws-secret-access-key',
  AWS_S3_BUCKET: 'unit-test-bucket',
  AWS_REGION: 'us-east-1',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
