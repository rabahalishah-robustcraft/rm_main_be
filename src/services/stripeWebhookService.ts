import Stripe from 'stripe';
import type { Stripe as StripeTypes } from 'stripe';
import { PrismaClient } from '@prisma/client';
import { config } from '../utils/config';
import { SubscriptionTier } from './SubscriptionService';

function getStripeClient() {
  if (!config.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(config.STRIPE_SECRET_KEY);
}

/** Paid access while subscription is usable; past_due keeps access until cancellation. */
function subscriptionStatusGrantsPaid(status: StripeTypes.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

function tierFromSubscription(sub: StripeTypes.Subscription): SubscriptionTier {
  return subscriptionStatusGrantsPaid(sub.status) ? SubscriptionTier.PAID : SubscriptionTier.FREE;
}

async function applySubscriptionToUser(
  prisma: PrismaClient,
  userId: string,
  sub: StripeTypes.Subscription,
  stripeCustomerId: string | null
): Promise<void> {
  const periodEnd =
    typeof sub.current_period_end === 'number'
      ? new Date(sub.current_period_end * 1000)
      : null;

  const customerId =
    stripeCustomerId ??
    (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null);

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: tierFromSubscription(sub),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: sub.status,
      stripeCurrentPeriodEnd: periodEnd
    }
  });
}

async function clearSubscriptionForUser(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: SubscriptionTier.FREE,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: 'canceled',
      stripeCurrentPeriodEnd: null
    }
  });
}

/** Subscription is no longer entitled to paid access; sync DB to free and drop subscription id. */
function subscriptionHasFullyEnded(status: StripeTypes.Subscription.Status): boolean {
  return (
    status === 'canceled' ||
    status === 'unpaid' ||
    status === 'incomplete_expired'
  );
}

async function resolveUserIdForSubscription(
  prisma: PrismaClient,
  sub: StripeTypes.Subscription
): Promise<string | null> {
  const metaUid = sub.metadata?.userId;
  if (metaUid) {
    return metaUid;
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (customerId) {
    const user = await prisma.user.findFirst({
      where: { stripeCustomerId: customerId }
    });
    if (user) {
      return user.id;
    }
  }
  const bySub = await prisma.user.findFirst({
    where: { stripeSubscriptionId: sub.id }
  });
  return bySub?.id ?? null;
}

/**
 * Idempotent handler for verified Stripe webhook events.
 */
export async function processStripeWebhookEvent(
  prisma: PrismaClient,
  event: StripeTypes.Event
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as StripeTypes.Checkout.Session;
      if (session.mode !== 'subscription') {
        return;
      }
      const userId = session.client_reference_id || session.metadata?.userId;
      const subId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      if (!userId || !subId) {
        console.warn('[Stripe webhook] checkout.session.completed missing userId or subscription');
        return;
      }
      const stripe = getStripeClient();
      const sub = await stripe.subscriptions.retrieve(subId);
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
      await applySubscriptionToUser(prisma, userId, sub, customerId);
      break;
    }
    case 'customer.subscription.created': {
      const sub = event.data.object as StripeTypes.Subscription;
      const userId = await resolveUserIdForSubscription(prisma, sub);
      if (!userId) {
        console.warn('[Stripe webhook] subscription.created: could not resolve user', sub.id);
        return;
      }
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      await applySubscriptionToUser(prisma, userId, sub, customerId);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as StripeTypes.Subscription;
      const userId = await resolveUserIdForSubscription(prisma, sub);
      if (!userId) {
        console.warn('[Stripe webhook] subscription.updated: could not resolve user', sub.id);
        return;
      }
      if (subscriptionHasFullyEnded(sub.status)) {
        await clearSubscriptionForUser(prisma, userId);
        break;
      }
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      await applySubscriptionToUser(prisma, userId, sub, customerId);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as StripeTypes.Subscription;
      const userId = await resolveUserIdForSubscription(prisma, sub);
      if (!userId) {
        return;
      }
      await clearSubscriptionForUser(prisma, userId);
      break;
    }
    default:
      break;
  }
}
