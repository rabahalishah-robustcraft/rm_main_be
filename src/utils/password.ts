import * as bcrypt from 'bcrypt';

class ValidationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface PasswordConfig {
  saltRounds: number;
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

class PasswordUtils {
  private config: PasswordConfig;

  constructor() {
    this.config = {
      saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12'),
      minLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8'),
      maxLength: parseInt(process.env.PASSWORD_MAX_LENGTH || '128'),
      requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
      requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
      requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
      requireSpecialChars: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false'
    };

    // Ensure minimum security standards
    if (this.config.saltRounds < 10) {
      console.warn('Warning: Salt rounds below 10 may not be secure enough');
    }
  }

  /**
   * Hash a password using bcrypt with configured salt rounds
   */
  async hashPassword(password: string): Promise<string> {
    try {
      // Validate password before hashing
      this.validatePassword(password);

      const hash = await bcrypt.hash(password, this.config.saltRounds);
      return hash;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new Error(`Failed to hash password: ${(error as Error).message}`);
    }
  }

  /**
   * Verify a password against its hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      if (!password || !hash) {
        return false;
      }

      const isValid = await bcrypt.compare(password, hash);
      return isValid;
    } catch (error) {
      // Log error but don't expose details
      console.error('Password verification error:', error);
      return false;
    }
  }

  /**
   * Validate password strength according to configured rules
   */
  validatePassword(password: string): void {
    if (!password) {
      throw new ValidationError('Password is required');
    }

    if (typeof password !== 'string') {
      throw new ValidationError('Password must be a string');
    }

    if (password.length < this.config.minLength) {
      throw new ValidationError(`Password must be at least ${this.config.minLength} characters long`);
    }

    if (password.length > this.config.maxLength) {
      throw new ValidationError(`Password must not exceed ${this.config.maxLength} characters`);
    }

    const errors: string[] = [];

    if (this.config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('at least one uppercase letter');
    }

    if (this.config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('at least one lowercase letter');
    }

    if (this.config.requireNumbers && !/\d/.test(password)) {
      errors.push('at least one number');
    }

    if (this.config.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('at least one special character');
    }

    if (errors.length > 0) {
      throw new ValidationError(`Password must contain ${errors.join(', ')}`);
    }
  }

  /**
   * Generate a secure random password
   */
  generateSecurePassword(length: number = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    let charset = '';
    let password = '';

    // Ensure at least one character from each required category
    if (this.config.requireUppercase) {
      charset += uppercase;
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
    }

    if (this.config.requireLowercase) {
      charset += lowercase;
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
    }

    if (this.config.requireNumbers) {
      charset += numbers;
      password += numbers[Math.floor(Math.random() * numbers.length)];
    }

    if (this.config.requireSpecialChars) {
      charset += specialChars;
      password += specialChars[Math.floor(Math.random() * specialChars.length)];
    }

    // Fill remaining length with random characters from full charset
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle the password to avoid predictable patterns
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Check if a password hash needs to be rehashed (due to changed salt rounds)
   */
  needsRehash(hash: string): boolean {
    try {
      const rounds = bcrypt.getRounds(hash);
      return rounds < this.config.saltRounds;
    } catch (error) {
      // If we can't determine rounds, assume it needs rehashing
      return true;
    }
  }

  /**
   * Get password strength score (0-100)
   */
  getPasswordStrength(password: string): number {
    if (!password) return 0;

    let score = 0;
    const length = password.length;

    // Length scoring
    if (length >= 8) score += 25;
    if (length >= 12) score += 10;
    if (length >= 16) score += 10;

    // Character variety scoring
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 10;
    if (/\d/.test(password)) score += 10;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15;

    // Pattern penalties
    if (/(.)\1{2,}/.test(password)) score -= 10; // Repeated characters
    if (/123|abc|qwe/i.test(password)) score -= 10; // Common sequences

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get password strength description
   */
  getPasswordStrengthDescription(password: string): string {
    const score = this.getPasswordStrength(password);

    if (score < 30) return 'Very Weak';
    if (score < 50) return 'Weak';
    if (score < 70) return 'Fair';
    if (score < 90) return 'Strong';
    return 'Very Strong';
  }
}

// Export singleton instance
export const passwordUtils = new PasswordUtils();

// Export individual functions for convenience with proper binding
export const hashPassword = passwordUtils.hashPassword.bind(passwordUtils);
export const verifyPassword = passwordUtils.verifyPassword.bind(passwordUtils);
export const validatePassword = passwordUtils.validatePassword.bind(passwordUtils);
export const generateSecurePassword = passwordUtils.generateSecurePassword.bind(passwordUtils);
export const needsRehash = passwordUtils.needsRehash.bind(passwordUtils);
export const getPasswordStrength = passwordUtils.getPasswordStrength.bind(passwordUtils);
export const getPasswordStrengthDescription = passwordUtils.getPasswordStrengthDescription.bind(passwordUtils);