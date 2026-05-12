/**
 * Side-effect module so ts-node includes Request augmentation when compiling from `src/index.ts`.
 * Import `express` (runtime package), not `express-serve-static-core` (types-only path).
 */
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}
