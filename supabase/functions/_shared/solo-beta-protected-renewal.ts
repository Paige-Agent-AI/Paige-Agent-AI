import type Stripe from "https://esm.sh/stripe@18.5.0";
import {
  buildProtectedSoloTrial,
  hasProtectedSoloRenewalHold,
  PROTECTED_SOLO_BETA_OFFER_CODE,
  PROTECTED_SOLO_RENEWAL_GUARD,
  type ProtectedSoloTrialEnrollment,
} from "./solo-beta-protected-trial.ts";

function refId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

type BoundTrial = ProtectedSoloTrialEnrollment & { subscriptionId: string; trialEnd: number };
type StripeRenewal = {
  customers: Pick<Stripe["customers"], "retrieve">;
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "retrieve"> };
  setupIntents: Pick<Stripe["setupIntents"], "retrieve">;
  prices: Pick<Stripe["prices"], "retrieve">;
  subscriptions: Pick<Stripe["subscriptions"], "retrieve" | "update">;
};

/** Called only after the native verified owner explicitly chooses renewal. */
export async function enableProtectedSoloRenewal(stripe: StripeRenewal, trial: BoundTrial, now: number, enable = true) {
  if (!Number.isSafeInteger(trial.trialEnd) || trial.trialEnd <= now) return "trial_ended" as const;
  const [checkout, price, subscription, customer] = await Promise.all([
    stripe.checkout.sessions.retrieve(trial.stripeCheckoutId),
    stripe.prices.retrieve(trial.stripePriceId),
    stripe.subscriptions.retrieve(trial.subscriptionId),
    stripe.customers.retrieve(trial.stripeCustomerId),
  ]);
  const setupId = refId(checkout.setup_intent);
  const [item] = subscription.items.data;
  if (!setupId || checkout.metadata?.offer_code !== PROTECTED_SOLO_BETA_OFFER_CODE ||
      customer.deleted || customer.id !== trial.stripeCustomerId || customer.livemode !== trial.livemode ||
      subscription.id !== trial.subscriptionId || subscription.livemode !== trial.livemode ||
      subscription.metadata.paige_enrollment !== trial.referenceId ||
      subscription.metadata.offer_code !== PROTECTED_SOLO_BETA_OFFER_CODE ||
      subscription.metadata.paige_renewal_guard !== PROTECTED_SOLO_RENEWAL_GUARD ||
      subscription.trial_end !== trial.trialEnd || refId(subscription.customer) !== trial.stripeCustomerId ||
      subscription.items.has_more || subscription.items.data.length !== 1 ||
      item?.quantity !== 1 || item.price.id !== trial.stripePriceId ||
      subscription.collection_method !== "charge_automatically" || subscription.schedule || subscription.pause_collection) {
    return "renewal_unavailable" as const;
  }
  if (subscription.cancel_at_period_end || subscription.cancel_at || subscription.status === "canceled") {
    return "trial_canceled" as const;
  }
  if (subscription.status !== "trialing") return "trial_ended" as const;

  const setup = await stripe.setupIntents.retrieve(setupId);
  const proposal = buildProtectedSoloTrial(trial, checkout, setup, price);
  if (!proposal.ok) return "renewal_unavailable" as const;

  if (subscription.metadata.paige_renewal_enabled === "verified_consent" &&
      refId(subscription.default_payment_method) === proposal.paymentMethodId) return "renewal_enabled" as const;
  if (!hasProtectedSoloRenewalHold(subscription) || customer.default_source ||
      customer.invoice_settings.default_payment_method) return "renewal_unavailable" as const;
  if (!enable) return "renewal_ready" as const;

  const updated = await stripe.subscriptions.update(trial.subscriptionId, {
    default_payment_method: proposal.paymentMethodId,
    metadata: { paige_renewal_enabled: "verified_consent" },
    proration_behavior: "none",
  }, { idempotencyKey: `solo-beta-verified-renewal-${trial.referenceId}` });
  if (updated.cancel_at_period_end || updated.cancel_at || updated.status === "canceled") return "trial_canceled" as const;
  return updated.id === trial.subscriptionId && updated.livemode === trial.livemode && updated.status === "trialing" &&
    updated.trial_end === trial.trialEnd && refId(updated.default_payment_method) === proposal.paymentMethodId &&
    updated.metadata.paige_renewal_enabled === "verified_consent" ? "renewal_enabled" as const : "renewal_unavailable" as const;
}
