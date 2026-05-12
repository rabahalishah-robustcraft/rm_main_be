import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { config } from '../utils/config';
import { SubscriptionError } from './SubscriptionService';

/** @see https://docs.stripe.com/customer-management/portal-deep-links */
export type BillingPortalIntent = 'default' | 'cancel_subscription';

/**
 * Stripe Checkout (subscription mode) + Customer Portal.
 */
export class StripeBillingService {
  private stripe: Stripe | null;

  constructor(private prisma: PrismaClient) {
    this.stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null;
  }

  isConfiguredForCheckout(): boolean {
    return !!(
      this.stripe &&
      config.STRIPE_PRICE_ID &&
      config.STRIPE_CHECKOUT_SUCCESS_URL &&
      config.STRIPE_CHECKOUT_CANCEL_URL
    );
  }

  isConfiguredForPortal(): boolean {
    return !!(this.stripe && config.STRIPE_BILLING_PORTAL_RETURN_URL);
  }

  private checkoutSuccessUrl(): string {
    const base = config.STRIPE_CHECKOUT_SUCCESS_URL!;
    return base.includes('{CHECKOUT_SESSION_ID}')
      ? base
      : `${base}${base.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
  }

  /**
   * Creates a Stripe Checkout Session (subscription). Caller must be authenticated.
   */
  async createCheckoutSession(userId: string, email: string): Promise<{ url: string }> {
    if (!this.stripe || !this.isConfiguredForCheckout()) {
      throw new SubscriptionError(
        'Stripe checkout is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and either STRIPE_CHECKOUT_SUCCESS_URL + STRIPE_CHECKOUT_CANCEL_URL or a single STRIPE_PUBLIC_APP_BASE_URL (HTTPS origin; defaults /billing/success and /billing/canceled).',
        'STRIPE_NOT_CONFIGURED'
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new SubscriptionError('User not found', 'USER_NOT_FOUND');
    }

    const priceId = config.STRIPE_PRICE_ID!;
    if (priceId.startsWith('prod_')) {
      throw new SubscriptionError(
        'STRIPE_PRICE_ID must be a Price id (price_...), not a Product id (prod_...). In Stripe Dashboard open your product → copy the Price id under Pricing.',
        'STRIPE_INVALID_PRICE_ID'
      );
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email,
        metadata: { userId }
      });
      customerId = customer.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId }
      });
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: this.checkoutSuccessUrl(),
        cancel_url: config.STRIPE_CHECKOUT_CANCEL_URL!,
        client_reference_id: userId,
        metadata: { userId },
        subscription_data: {
          metadata: { userId }
        }
      });

      if (!session.url) {
        throw new SubscriptionError('Checkout session missing redirect URL', 'STRIPE_CHECKOUT_FAILED');
      }

      return { url: session.url };
    } catch (err) {
      if (err instanceof SubscriptionError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SubscriptionError(
        `Stripe checkout failed: ${message}`,
        'STRIPE_CHECKOUT_FAILED',
        err instanceof Error ? err : undefined
      );
    }
  }

  /**
   * Resolves Stripe subscription id for portal flows (DB first, then Stripe API).
   */
  private async resolveStripeSubscriptionIdForCustomer(
    stripeCustomerId: string,
    dbSubscriptionId: string | null
  ): Promise<string | null> {
    if (dbSubscriptionId) {
      return dbSubscriptionId;
    }
    if (!this.stripe) {
      return null;
    }
    const list = await this.stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 15
    });
    const sub = list.data.find((s) =>
      ['active', 'trialing', 'past_due'].includes(s.status)
    );
    return sub?.id ?? null;
  }

  /**
   * Billing Customer Portal (manage/cancel subscription).
   * Pass intent `cancel_subscription` to open Stripe’s cancel flow directly (hosted deep link).
   */
  async createBillingPortalSession(
    userId: string,
    options?: { intent?: BillingPortalIntent }
  ): Promise<{ url: string }> {
    if (!this.stripe || !this.isConfiguredForPortal()) {
      throw new SubscriptionError(
        'Stripe Customer Portal is not configured (STRIPE_BILLING_PORTAL_RETURN_URL and Dashboard Customer portal). For cancel and other toggles to appear, set STRIPE_BILLING_PORTAL_CONFIGURATION_ID to your active portal configuration (bpc_...).',
        'STRIPE_PORTAL_NOT_CONFIGURED'
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      throw new SubscriptionError(
        'No Stripe customer for this account; complete checkout first',
        'STRIPE_CUSTOMER_MISSING'
      );
    }

    const intent = options?.intent ?? 'default';

    try {
      const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
        customer: user.stripeCustomerId,
        return_url: config.STRIPE_BILLING_PORTAL_RETURN_URL!
      };
      const portalConfigId = config.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
      if (portalConfigId) {
        sessionParams.configuration = portalConfigId;
      }

      if (intent === 'cancel_subscription') {
        const subId = await this.resolveStripeSubscriptionIdForCustomer(
          user.stripeCustomerId,
          user.stripeSubscriptionId
        );
        if (!subId) {
          throw new SubscriptionError(
            'No active subscription found to cancel. If you just subscribed, wait a moment and try again.',
            'STRIPE_NO_SUBSCRIPTION_TO_CANCEL'
          );
        }
        sessionParams.flow_data = {
          type: 'subscription_cancel',
          subscription_cancel: {
            subscription: subId
          }
        };
      }

      const session = await this.stripe.billingPortal.sessions.create(sessionParams);
      if (!session.url) {
        throw new SubscriptionError('Billing portal session missing URL', 'STRIPE_PORTAL_FAILED');
      }
      return { url: session.url };
    } catch (err) {
      if (err instanceof SubscriptionError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SubscriptionError(
        `Stripe portal failed: ${message}`,
        'STRIPE_PORTAL_FAILED',
        err instanceof Error ? err : undefined
      );
    }
  }
}
