// Property-based test setup
import * as fc from 'fast-check';

// Configure fast-check for property-based testing
const seedValue = process.env['FC_SEED'] ? parseInt(process.env['FC_SEED']) : undefined;
fc.configureGlobal({
  numRuns: 100, // Minimum 100 iterations per property test
  verbose: process.env['NODE_ENV'] === 'development',
  ...(seedValue !== undefined && { seed: seedValue }),
});

// Custom arbitraries for domain-specific data
export const arbitraries = {
  email: () => fc.emailAddress(),
  // Generate valid passwords that meet requirements (simpler approach)
  password: () => fc.constantFrom(
    'Password123!', 'SecurePass456@', 'MyPassword789#', 'TestPass012$',
    'ValidPass345%', 'StrongPass678^', 'GoodPass901&', 'SafePass234*'
  ),
  // Generate valid user IDs (using cuid-like format)
  userId: () => fc.constantFrom(
    'user123456789', 'test987654321', 'auth456789012', 'demo345678901',
    'sample234567890', 'valid123456789', 'mock987654321', 'fake456789012'
  ),
  sessionId: () => fc.constantFrom(
    'sess123456789', 'audio987654321', 'rec456789012', 'session345678901'
  ),
  score: () => fc.integer({ min: 1, max: 5 }),
  subscriptionTier: () => fc.constantFrom('free', 'paid'),
  industry: () => fc.constantFrom('Technology', 'Finance', 'Healthcare', 'Consulting'),
  jobTitle: () => fc.constantFrom(
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Financial Analyst', 'Investment Banker', 'Management Consultant'
  ),
  audioBuffer: () => fc.uint8Array({ minLength: 1000, maxLength: 10000 }),
  resumeText: () => fc.lorem({ maxCount: 500 }),
};