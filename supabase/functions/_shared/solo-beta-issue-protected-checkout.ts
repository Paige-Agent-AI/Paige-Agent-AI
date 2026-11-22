import { PROTECTED_SOLO_BETA_OFFER_CODE, PROTECTED_SOLO_BETA_UNIT_AMOUNT_CENTS } from "./solo-beta-protected-trial.ts";

const CHECKOUT_REPLAY_SECONDS = 23 * 60 * 60;
const RETURN_PATH = "/signup/solo";

export type ProtectedSignupIntake = {
  referenceId: string;
  primaryEmail: string;
  stripeProductId: string;
  stripePriceId: string;
  livemode: boolean;
  createdAt: number;
  returnOrigin: string;
};

type CheckoutSession = {
  id: string;
  url: string | null;
  livemode: boolean;
  status: string | null;
  mode: string;
  client_reference_id: string | null;
  customer: string | { id: string } | null;
  metadata: Record<string, string> | null;
};

type IssueCheckoutStore = {
  readAttempt(referenceId: string): Promise<{ checkoutId: string; stripeCustomerId: string } | null>;
  bindAttempt(intake: ProtectedSignupIntake, checkoutId: string, stripeCustomerId: string): Promise<boolean>;
};

type CheckoutStripe = {
  customers: { create(params: { email: string; metadata: Record<string, string> }, options: { idempotencyKey: string }):
    Promise<{ id: string; livemode: boolean }> };
  checkout: { sessions: {
    retrieve(id: string): Promise<CheckoutSession>;
    create(params: {
      mode: "setup";
      currency: "usd";
      customer: string;
      client_reference_id: string;
      metadata: Record<string, string>;
      success_url: string;
      cancel_url: string;
      custom_text: { submit: { message: string } };
    }, options: { idempotencyKey: string }): Promise<CheckoutSession>;
  } };
  prices: { retrieve(id: string, options: { expand: string[] }): Promise<{
    id: string;
    livemode: boolean;
    active: boolean;
    product: string | { id: string; active?: boolean; deleted?: boolean };
    unit_amount: number | null;
    currency: string;
    recurring: { interval: string; interval_count: number } | null;
  }> };
};

function readOpenCheckout(intake: ProtectedSignupIntake, session: CheckoutSession, stripeCustomerId: string) {
  if (session.mode !== "setup" || session.livemode !== intake.livemode ||
      session.client_reference_id !== intake.referenceId || session.metadata?.offer_code !== PROTECTED_SOLO_BETA_OFFER_CODE ||
      (typeof session.customer === "string" ? session.customer : session.customer?.id) !== stripeCustomerId) {
    return { ok: false, code: "checkout_binding_mismatch" } as const;
  }
  if (session.status !== "open" || !session.url || URL.parse(session.url)?.origin !== "https://checkout.stripe.com") {
    return { ok: false, code: session.status === "complete" ? "checkout_complete" : "checkout_requires_recovery" } as const;
  }
  return { ok: true, url: session.url } as const;
}

/** Call with the quote and identity already bound in a server-authenticated intake. */
export async function issueProtectedSoloCheckout(
  intake: ProtectedSignupIntake,
  now: number,
  store: IssueCheckoutStore,
  stripe: CheckoutStripe,
) {
  const existing = await store.readAttempt(intake.referenceId);
  if (existing) return readOpenCheckout(intake, await stripe.checkout.sessions.retrieve(existing.checkoutId), existing.stripeCustomerId);

  // A lost customer or Checkout write may be retried with the exact key within
  // the Stripe retention window. An older unknown attempt needs reconciliation.
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(intake.createdAt) || now < intake.createdAt ||
      now - intake.createdAt >= CHECKOUT_REPLAY_SECONDS) return { ok: false, code: "checkout_requires_recovery" } as const;

  const price = await stripe.prices.retrieve(intake.stripePriceId, { expand: ["product"] });
  const product = typeof price.product === "string" ? null : price.product;
  if (!price.active || price.livemode !== intake.livemode || price.id !== intake.stripePriceId ||
      !product || product.deleted || !product.active || product.id !== intake.stripeProductId ||
      price.unit_amount !== PROTECTED_SOLO_BETA_UNIT_AMOUNT_CENTS || price.currency !== "usd" ||
      price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
    return { ok: false, code: "subscription_offer_mismatch" } as const;
  }

  const metadata = { offer_code: PROTECTED_SOLO_BETA_OFFER_CODE, paige_enrollment: intake.referenceId };
  const customer = await stripe.customers.create({ email: intake.primaryEmail, metadata },
    { idempotencyKey: `solo-beta-protected-customer-${intake.referenceId}` });
  if (!customer.id || customer.livemode !== intake.livemode) return { ok: false, code: "checkout_binding_mismatch" } as const;

  const result = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    customer: customer.id,
    client_reference_id: intake.referenceId,
    metadata,
    success_url: `${intake.returnOrigin}${RETURN_PATH}?checkout=protected-success`,
    cancel_url: `${intake.returnOrigin}${RETURN_PATH}?checkout=protected-cancel`,
    custom_text: { submit: { message: "30 days free. Then US$97 per month when you verify your email and enable renewal. Without verification, the trial ends without a charge." } },
  }, { idempotencyKey: `solo-beta-protected-checkout-${intake.referenceId}` });

  const open = readOpenCheckout(intake, result, customer.id);
  if (!open.ok) return open;
  if (!await store.bindAttempt(intake, result.id, customer.id)) return { ok: false, code: "checkout_attempt_not_bound" } as const;
  return open;
}
