import { jwtUtils } from '../../../src/utils/jwt';

describe('JWT Utils Simple', () => {
  const mockPayload = {
    userId: 'test-user-id',
    email: 'test@example.com',
    subscriptionTier: 'free'
  };

  beforeEach(() => {
    // Set test environment variables
    process.env['JWT_SECRET'] = 'test-secret-key';
    process.env['JWT_EXPIRES_IN'] = '1h';
    process.env['JWT_ISSUER'] = 'test-issuer';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env['JWT_SECRET'];
    delete process.env['JWT_EXPIRES_IN'];
    delete process.env['JWT_ISSUER'];
  });

  it('should generate a valid JWT token', () => {
    const token = jwtUtils.generateToken(mockPayload);
    
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('should validate and decode a valid token', () => {
    const token = jwtUtils.generateToken(mockPayload);
    const decoded = jwtUtils.validateToken(token);
    
    expect(decoded.userId).toBe(mockPayload.userId);
    expect(decoded.email).toBe(mockPayload.email);
    expect(decoded.subscriptionTier).toBe(mockPayload.subscriptionTier);
  });
});