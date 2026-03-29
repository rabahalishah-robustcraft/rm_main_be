// Unit test setup
import dotenv from 'dotenv';

// Load test environment variables for unit tests as well
dotenv.config({ path: '.env.test' });

beforeEach(() => {
  jest.clearAllMocks();
});