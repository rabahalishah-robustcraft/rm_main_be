// Global test setup
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Stripe placeholders so config validates when .env.test omits billing
process.env.STRIPE_SECRET_KEY ||= 'sk_test_integration_placeholder';
process.env.STRIPE_PRICE_ID ||= 'price_integration_placeholder';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_integration_placeholder';
process.env.STRIPE_PUBLIC_APP_BASE_URL ||= 'https://example.com';
process.env.STRIPE_CHECKOUT_SUCCESS_URL ||= 'https://example.com/billing/success?session_id={CHECKOUT_SESSION_ID}';
process.env.STRIPE_CHECKOUT_CANCEL_URL ||= 'https://example.com/billing/canceled';
process.env.STRIPE_BILLING_PORTAL_RETURN_URL ||= 'https://example.com/billing';

// Set test timeout
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};