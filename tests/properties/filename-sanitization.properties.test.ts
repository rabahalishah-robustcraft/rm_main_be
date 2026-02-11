import * as fc from 'fast-check';
import { sanitizeFilename } from '../../src/utils/fileUpload';

/**
 * Property-based tests for filename sanitization
 * Feature: backend-production-upgrade
 * **Validates: Requirements 9.4**
 */

describe('Property 17: Filename Sanitization', () => {
  /**
   * Property 17: For any filename containing special characters (excluding alphanumeric, 
   * dots, hyphens, underscores), the system should sanitize it by replacing special 
   * characters with underscores.
   * 
   * **Validates: Requirements 9.4**
   */
  describe('Property 17: Filename sanitization replaces special characters with underscores', () => {
    it('should only contain alphanumeric, dots, hyphens, and underscores after sanitization', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 255 }),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // Result should only contain alphanumeric, dots, hyphens, and underscores
            const validPattern = /^[a-zA-Z0-9._-]*$/;
            expect(sanitized).toMatch(validPattern);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all valid characters (alphanumeric, dots, hyphens, underscores)', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.split('')
          )),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // All valid characters should be preserved exactly
            expect(sanitized).toBe(filename);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should replace each special character with exactly one underscore', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // Count special characters in original
            const specialCharsCount = (filename.match(/[^a-zA-Z0-9._-]/g) || []).length;
            
            // Count underscores added (total underscores minus original underscores)
            const originalUnderscores = (filename.match(/_/g) || []).length;
            const totalUnderscores = (sanitized.match(/_/g) || []).length;
            const addedUnderscores = totalUnderscores - originalUnderscores;
            
            // Each special character should be replaced with one underscore
            expect(addedUnderscores).toBe(specialCharsCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain the same length as original filename', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 255 }),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // Length should be preserved (1-to-1 character replacement)
            expect(sanitized.length).toBe(filename.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be idempotent (sanitizing twice gives same result)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 255 }),
          (filename) => {
            const sanitized1 = sanitizeFilename(filename);
            const sanitized2 = sanitizeFilename(sanitized1);
            
            // Sanitizing an already sanitized filename should not change it
            expect(sanitized2).toBe(sanitized1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve file extensions correctly', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.constantFrom('pdf', 'doc', 'docx', 'txt', 'mp3', 'wav')
          ),
          ([basename, extension]) => {
            const filename = `${basename}.${extension}`;
            const sanitized = sanitizeFilename(filename);
            
            // Extension should be preserved (dots are valid)
            expect(sanitized).toContain(`.${extension}`);
            
            // Should end with the extension
            expect(sanitized.endsWith(`.${extension}`)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty string without error', () => {
      const result = sanitizeFilename('');
      expect(result).toBe('');
    });

    it('should preserve case sensitivity', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
          )),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // Case should be preserved for alphanumeric characters
            expect(sanitized).toBe(filename);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle filenames with common special characters', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.constantFrom(' ', '@', '#', '$', '%', '&', '*', '(', ')', '[', ']', '{', '}', '/', '\\', '|', ':', ';', '"', "'", '<', '>', ',', '?', '!'),
            fc.string({ minLength: 1, maxLength: 20 })
          ),
          ([prefix, specialChar, suffix]) => {
            const filename = `${prefix}${specialChar}${suffix}`;
            const sanitized = sanitizeFilename(filename);
            
            // Special character should be replaced with underscore
            expect(sanitized).not.toContain(specialChar);
            expect(sanitized).toContain('_');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle unicode characters by replacing them', () => {
      fc.assert(
        fc.property(
          fc.unicodeString({ minLength: 1, maxLength: 50 }),
          (filename) => {
            const sanitized = sanitizeFilename(filename);
            
            // Result should only contain ASCII alphanumeric, dots, hyphens, and underscores
            const validPattern = /^[a-zA-Z0-9._-]*$/;
            expect(sanitized).toMatch(validPattern);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
