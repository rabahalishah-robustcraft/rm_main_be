import * as jwt from 'jsonwebtoken';

class AuthenticationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export interface JWTPayload {
  userId: string;
  email: string;
  subscriptionTier: string;
  iat?: number;
  exp?: number;
}

export interface ResetTokenPayload {
  email: string;
  purpose: 'password_reset';
  iat?: number;
  exp?: number;
}

export interface JWTConfig {
  secret: string;
  expiresIn: string;
  issuer: string;
}

class JWTUtils {
  private config: JWTConfig;

  constructor() {
    this.config = {
      secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      issuer: process.env.JWT_ISSUER || 'ai-audio-summarization'
    };

    // Validate required configuration
    if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
  }

  /**
   * Generate a JWT token for a user
   */
  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    try {
      return jwt.sign(payload, this.config.secret, {
        expiresIn: this.config.expiresIn,
        issuer: this.config.issuer,
        algorithm: 'HS256'
      } as jwt.SignOptions);
    } catch (error) {
      throw new AuthenticationError('Failed to generate token', { error: (error as Error).message });
    }
  }

  /**
   * Validate and decode a JWT token
   */
  validateToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.config.secret, {
        issuer: this.config.issuer,
        algorithms: ['HS256']
      }) as JWTPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      } else {
        throw new AuthenticationError('Token validation failed', { error: (error as Error).message });
      }
    }
  }

  /**
   * Decode a JWT token without validation (for debugging/logging)
   */
  decodeToken(token: string): JWTPayload | null {
    try {
      return jwt.decode(token) as JWTPayload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  /**
   * Check if a token is expired without throwing an error
   */
  isTokenExpired(token: string): boolean {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) {
        return true;
      }

      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp < currentTime;
    } catch (error) {
      return true;
    }
  }

  /**
   * Refresh a token (generate new token with same payload but extended expiry)
   */
  refreshToken(token: string): string {
    const payload = this.validateToken(token);
    
    // Remove JWT specific fields and regenerate
    const { iat, exp, ...userPayload } = payload;
    return this.generateToken(userPayload);
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token: string): Date | null {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) {
        return null;
      }

      return new Date(decoded.exp * 1000);
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate a short-lived reset token for password reset flow
   */
  generateResetToken(email: string): string {
    try {
      const payload: Omit<ResetTokenPayload, 'iat' | 'exp'> = {
        email: email.toLowerCase(),
        purpose: 'password_reset'
      };
      return jwt.sign(payload, this.config.secret, {
        expiresIn: '15m',
        issuer: this.config.issuer,
        algorithm: 'HS256'
      } as jwt.SignOptions);
    } catch (error) {
      throw new AuthenticationError('Failed to generate reset token', { error: (error as Error).message });
    }
  }

  /**
   * Validate and decode a password reset token
   */
  validateResetToken(token: string): ResetTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.secret, {
        issuer: this.config.issuer,
        algorithms: ['HS256']
      }) as ResetTokenPayload;

      if (decoded.purpose !== 'password_reset') {
        throw new AuthenticationError('Invalid reset token');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Reset token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid reset token');
      } else if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError('Reset token validation failed', { error: (error as Error).message });
    }
  }
}

// Export singleton instance
export const jwtUtils = new JWTUtils();

// Export individual functions for convenience with proper binding
export const generateToken = jwtUtils.generateToken.bind(jwtUtils);
export const validateToken = jwtUtils.validateToken.bind(jwtUtils);
export const generateResetToken = jwtUtils.generateResetToken.bind(jwtUtils);
export const validateResetToken = jwtUtils.validateResetToken.bind(jwtUtils);
export const decodeToken = jwtUtils.decodeToken.bind(jwtUtils);
export const extractTokenFromHeader = jwtUtils.extractTokenFromHeader.bind(jwtUtils);
export const isTokenExpired = jwtUtils.isTokenExpired.bind(jwtUtils);
export const refreshToken = jwtUtils.refreshToken.bind(jwtUtils);
export const getTokenExpiration = jwtUtils.getTokenExpiration.bind(jwtUtils);