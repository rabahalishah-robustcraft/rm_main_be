import prisma from '../../../src/lib/prisma';
import { hashPassword } from '../../../src/utils/password';
import { SubscriptionTier } from '../../../src/types/auth';

/** Create a local user + empty profile with email already verified (integration shortcut). */
export async function createVerifiedUserWithProfile(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      subscriptionTier: SubscriptionTier.FREE,
      emailVerified: true
    }
  });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      aiAttributes: {},
      extractedSkills: []
    }
  });
  return user;
}
