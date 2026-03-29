import Joi from 'joi';
import { ValidationUtils, authSchemas } from '../../../src/utils/validation';

describe('Validation Utils Simple', () => {
  describe('ValidationUtils.validate', () => {
    const testSchema = Joi.object({
      name: Joi.string().required(),
      age: Joi.number().min(0).max(120),
      email: Joi.string().email()
    });

    it('should validate valid data', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com'
      };

      const result = ValidationUtils.validate(validData, testSchema);

      expect(result).toEqual(validData);
    });

    it('should throw ValidationError for invalid data', () => {
      const invalidData = {
        name: '', // Required field empty
        age: -5, // Below minimum
        email: 'invalid-email'
      };

      expect(() => ValidationUtils.validate(invalidData, testSchema)).toThrow();
    });
  });

  describe('Auth Schemas', () => {
    it('should validate valid registration data', () => {
      const validData = {
        email: 'test@example.com',
        password: 'StrongPass123!'
      };

      const result = ValidationUtils.validate(validData, authSchemas.register) as any;

      expect(result.email).toBe('test@example.com');
      expect(result.password).toBe('StrongPass123!');
    });

    it('should reject invalid email', () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'StrongPass123!'
      };

      expect(() => ValidationUtils.validate(invalidData, authSchemas.register)).toThrow();
    });
  });

  describe('ValidationUtils.sanitizeString', () => {
    it('should sanitize string input', () => {
      const input = '  <script>alert("xss")</script>  ';
      const sanitized = ValidationUtils.sanitizeString(input);

      expect(sanitized).toBe('scriptalert("xss")/script');
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });

    it('should return empty string for non-string input', () => {
      expect(ValidationUtils.sanitizeString(123 as any)).toBe('');
      expect(ValidationUtils.sanitizeString(null as any)).toBe('');
      expect(ValidationUtils.sanitizeString(undefined as any)).toBe('');
    });
  });
});