import {
  SOLO_BETA_CURRENCY,
  SOLO_BETA_INTERVAL,
  SOLO_BETA_INTERVAL_COUNT,
  SOLO_BETA_TRIAL_DAYS,
} from "./solo-beta-offer.ts";

export const PROTECTED_SOLO_BETA_OFFER_CODE = "paige-solo-beta-monthly-v2" as const;
export const PROTECTED_SOLO_BETA_UNIT_AMOUNT_CENTS = 9_700 as const;
export const SOLO_BETA_VERIFICATION_SECONDS = 72 * 60 * 60;
const TRIAL_SECONDS = SOLO_BETA_TRIAL_DAYS * 24 * 60 * 60;

type StripeRef = string | { id: string } | null;

export type ProtectedSoloTrialEnrollment = {
  referenceId: string;
  stripeCustomerId: string;
  stripeCheckoutId: string;
  stripeProductId: string;
  stripePriceId: string;
  livemode: boolean;
};

type SetupCheckoutReadback = {
  id: string;
  customer: StripeRef;
  client_reference_id: string | null;
  status: string | null;
  mode: string;
  setup_intent: StripeRef;
  livemode: boolean;
};

type SetupIntentReadback = {
  id: string;
  customer: StripeRef;
  status: string;
  usage: string;
  payment_method: StripeRef;
  livemode: boolean;
};

type SoloTrialPrice = {
  id: string;
  product: StripeRef;
  active: boolean;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
};

export type ProtectedSoloTrialReadback = {
  id: string;
  customer: StripeRef;
  livemode: boolean;
  status: string;
  trial_start: number | null;
  trial_end: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  default_payment_method: StripeRef;
  metadata: Record<string, string>;
  items: {
    has_more: boolean;
    data: Array<{
      current_period_end: number;
      quantity?: number;
      price: SoloTrialPrice;
    }>;
  };
  latest_invoice: string | {
    customer: StripeRef;
    currency: string;
    amount_due: number;
    amount_paid: number;
    total: number;
  } | null;
};

function objectId(reference: StripeRef): string | null {
  return typeof reference === "string" ? reference : reference?.id ?? null;
}

function matchesOffer(enrollment: ProtectedSoloTrialEnrollment, price: SoloTrialPrice): boolean {
  return price.active && price.id === enrollment.stripePriceId &&
    objectId(price.product) === enrollment.stripeProductId &&
    price.currency === SOLO_BETA_CURRENCY && price.unit_amount === PROTECTED_SOLO_BETA_UNIT_AMOUNT_CENTS &&
    price.recurring?.interval === SOLO_BETA_INTERVAL && price.recurring.interval_count === SOLO_BETA_INTERVAL_COUNT;
}

/** The caller owns the durable enrollment claim and supplies fresh Stripe reads. */
export function buildProtectedSoloTrial(
  enrollment: ProtectedSoloTrialEnrollment,
  checkout: SetupCheckoutReadback,
  setup: SetupIntentReadback,
  price: SoloTrialPrice & { livemode: boolean },
) {
  if (
    checkout.id !== enrollment.stripeCheckoutId ||
    checkout.livemode !== enrollment.livemode ||
    checkout.client_reference_id !== enrollment.referenceId ||
    checkout.mode !== "setup" || checkout.status !== "complete" ||
    objectId(checkout.customer) !== enrollment.stripeCustomerId ||
    objectId(checkout.setup_intent) !== setup.id
  ) return { ok: false, code: "checkout_binding_mismatch" } as const;

  const paymentMethodId = objectId(setup.payment_method);
  if (
    setup.livemode !== enrollment.livemode ||
    setup.status !== "succeeded" || setup.usage !== "off_session" || !paymentMethodId ||
    objectId(setup.customer) !== enrollment.stripeCustomerId
  ) return { ok: false, code: "setup_binding_mismatch" } as const;

  if (price.livemode !== enrollment.livemode || !matchesOffer(enrollment, price)) {
    return { ok: false, code: "subscription_offer_mismatch" } as const;
  }

  return {
    ok: true as const,
    paymentMethodId,
    params: {
      customer: enrollment.stripeCustomerId,
      items: [{ price: enrollment.stripePriceId, quantity: 1 }],
      trial_period_days: SOLO_BETA_TRIAL_DAYS,
      // Set this at creation so missing webhooks cannot leave renewal enabled.
      cancel_at_period_end: true,
      collection_method: "charge_automatically" as const,
      default_payment_method: paymentMethodId,
      metadata: { paige_enrollment: enrollment.referenceId, offer_code: PROTECTED_SOLO_BETA_OFFER_CODE },
      expand: ["latest_invoice"],
    },
    options: { idempotencyKey: `solo-beta-protected-trial-${enrollment.referenceId}` },
  };
}

/** Admission requires exact provider evidence while renewal is still disabled. */
export function checkProtectedSoloTrial(
  enrollment: ProtectedSoloTrialEnrollment,
  paymentMethodId: string,
  subscription: ProtectedSoloTrialReadback,
) {
  if (
    subscription.livemode !== enrollment.livemode ||
    subscription.status !== "trialing" ||
    objectId(subscription.customer) !== enrollment.stripeCustomerId ||
    subscription.metadata.paige_enrollment !== enrollment.referenceId ||
    subscription.metadata.offer_code !== PROTECTED_SOLO_BETA_OFFER_CODE ||
    !paymentMethodId || objectId(subscription.default_payment_method) !== paymentMethodId
  ) return { ok: false, code: "subscription_binding_mismatch" } as const;

  const item = subscription.items.data[0];
  if (
    subscription.items.has_more || subscription.items.data.length !== 1 ||
    !item || item.quantity !== 1 || !matchesOffer(enrollment, item.price)
  ) return { ok: false, code: "subscription_offer_mismatch" } as const;

  const start = subscription.trial_start;
  const end = subscription.trial_end;
  if (
    start === null || end === null || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start <= 0 || end - start !== TRIAL_SECONDS || item.current_period_end !== end ||
    !subscription.cancel_at_period_end || subscription.cancel_at !== end
  ) return { ok: false, code: "renewal_guard_unverified" } as const;

  const invoice = subscription.latest_invoice;
  if (
    !invoice || typeof invoice === "string" ||
    objectId(invoice.customer) !== enrollment.stripeCustomerId || invoice.currency !== SOLO_BETA_CURRENCY ||
    invoice.amount_due !== 0 || invoice.amount_paid !== 0 || invoice.total !== 0
  ) return { ok: false, code: "zero_trial_invoice_unverified" } as const;

  return {
    ok: true,
    stripeSubscriptionId: subscription.id,
    trialStartAt: start,
    trialEndAt: end,
    emailVerificationDeadline: start + SOLO_BETA_VERIFICATION_SECONDS,
  } as const;
}
