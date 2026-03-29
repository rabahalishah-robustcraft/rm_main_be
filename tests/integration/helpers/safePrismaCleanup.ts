import { PrismaClient } from '@prisma/client';

/** Prisma: table does not exist (migrations not applied yet). */
const TABLE_DOES_NOT_EXIST = 'P2021';

function isMissingTableError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: string }).code === TABLE_DOES_NOT_EXIST
  );
}

export async function safeEmailVerificationOTPDeleteMany(
  prisma: PrismaClient,
  where: { email: string | { contains: string } }
): Promise<void> {
  try {
    await prisma.emailVerificationOTP.deleteMany({ where });
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
}
