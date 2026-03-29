import request from 'supertest';
import prisma from '../../../src/lib/prisma';
import { safeEmailVerificationOTPDeleteMany } from './safePrismaCleanup';

/**
 * Register via API, mark email verified (test shortcut), login — returns Bearer token.
 */
export async function getVerifiedAuthToken(
  app: import('express').Application,
  email: string,
  password: string
): Promise<{ token: string; userId: string }> {
  await request(app)
    .post('/api/auth/register')
    .send({ email, password })
    .expect(201);

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });
  if (!user) {
    throw new Error(`Expected user after register: ${email}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true }
  });
  await safeEmailVerificationOTPDeleteMany(prisma, { email: email.toLowerCase() });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    token: res.body.data.token,
    userId: user.id
  };
}

/**
 * After a successful `POST /api/auth/register`, mark the user verified in the DB (test shortcut) and login.
 * Use when the test already registered the user and must assert the register response shape.
 */
export async function verifyUserEmailInDbAndLogin(
  app: import('express').Application,
  email: string,
  password: string
): Promise<{ token: string; userId: string }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });
  if (!user) {
    throw new Error(`User not found for verify+login: ${email}`);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true }
  });
  await safeEmailVerificationOTPDeleteMany(prisma, { email: email.toLowerCase() });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    token: res.body.data.token,
    userId: user.id
  };
}
