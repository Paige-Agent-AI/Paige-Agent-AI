import assert from "node:assert/strict";
import { test } from "node:test";
import { enableProtectedSoloRenewal } from "./solo-beta-protected-renewal.ts";
import { PROTECTED_SOLO_BETA_OFFER_CODE, PROTECTED_SOLO_RENEWAL_GUARD } from "./solo-beta-protected-trial.ts";

const now = 1_795_300_000;
const trial = {
  referenceId: "test-enrollment", subscriptionId: "sub_fixture", trialEnd: now + 86400, livemode: false,
  stripeCheckoutId: "cs_fixture", stripeProductId: "prod_fixture", stripePriceId: "price_fixture",
  stripeCustomerId: "cus_fixture",
};

function fixture() {
  const price = {
    id: trial.stripePriceId, product: trial.stripeProductId, active: true, livemode: false,
    unit_amount: 9700, currency: "usd", recurring: { interval: "month", interval_count: 1 },
  };
  const subscription = {
    id: trial.subscriptionId, customer: trial.stripeCustomerId, livemode: false, status: "trialing",
    trial_end: trial.trialEnd, collection_method: "charge_automatically", cancel_at_period_end: false,
    cancel_at: null as number | null, schedule: null, pause_collection: null, default_source: null,
    default_payment_method: null as string | null,
    metadata: {
      paige_enrollment: trial.referenceId, offer_code: PROTECTED_SOLO_BETA_OFFER_CODE,
      paige_renewal_guard: PROTECTED_SOLO_RENEWAL_GUARD, paige_renewal_enabled: "",
    },
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    items: { has_more: false, data: [{ quantity: 1, price }] },
  };
  const writes: unknown[] = [];
  const settings = { customerDefault: null as string | null, cancelWhileUpdating: false };
  const stripe = {
    prices: { retrieve: async () => price },
    checkout: { sessions: { retrieve: async () => ({
      id: trial.stripeCheckoutId, customer: trial.stripeCustomerId, client_reference_id: trial.referenceId,
      status: "complete", mode: "setup", setup_intent: "seti_fixture", livemode: false,
      metadata: { offer_code: PROTECTED_SOLO_BETA_OFFER_CODE },
    }) } },
    setupIntents: { retrieve: async () => ({
      id: "seti_fixture", customer: trial.stripeCustomerId, status: "succeeded", usage: "off_session",
      payment_method: "pm_fixture", livemode: false,
    }) },
    customers: { retrieve: async () => ({
      id: trial.stripeCustomerId, livemode: false, default_source: null,
      invoice_settings: { default_payment_method: settings.customerDefault },
    }) },
    subscriptions: {
      retrieve: async () => subscription,
      update: async (id: string, params: { default_payment_method: string; metadata: Record<string, string> }, options: object) => {
        writes.push({ id, params, options });
        Object.assign(subscription.metadata, params.metadata);
        subscription.default_payment_method = params.default_payment_method;
        if (settings.cancelWhileUpdating) subscription.cancel_at_period_end = true;
        return subscription;
      },
    },
  } as unknown as Parameters<typeof enableProtectedSoloRenewal>[0];
  return { subscription, settings, writes, run: (time = now, enable = true) => enableProtectedSoloRenewal(stripe, trial, time, enable) };
}

test("opening the billing recovery card reads current readiness without enabling renewal", async () => {
  const { writes, run } = fixture();
  assert.equal(await run(now, false), "renewal_ready");
  assert.deepEqual(writes, []);
});

test("the verified renewal writes only the original default method and reconciles a repeat", async () => {
  const { writes, run } = fixture();
  assert.equal(await run(), "renewal_enabled");
  assert.equal(await run(), "renewal_enabled");
  assert.deepEqual(writes, [{
    id: trial.subscriptionId,
    params: { default_payment_method: "pm_fixture", metadata: { paige_renewal_enabled: "verified_consent" }, proration_behavior: "none" },
    options: { idempotencyKey: `solo-beta-verified-renewal-${trial.referenceId}` },
  }]);
});

test("an existing cancellation and the exact expiry boundary make no provider write", async () => {
  const { subscription, writes, run } = fixture();
  subscription.cancel_at_period_end = true;
  assert.equal(await run(), "trial_canceled");
  assert.equal(await run(trial.trialEnd), "trial_ended");
  assert.deepEqual(writes, []);
});

test("a cancellation racing the provider update wins and the action never clears it", async () => {
  const { settings, subscription, writes, run } = fixture();
  settings.cancelWhileUpdating = true;
  assert.equal(await run(), "trial_canceled");
  assert.equal(subscription.cancel_at_period_end, true);
  assert.equal(await run(), "trial_canceled");
  assert.equal(writes.length, 1);
});

test("a foreign method, fallback, or unbound subscription cannot be switched", async () => {
  const { settings, subscription, writes, run } = fixture();
  settings.customerDefault = "pm_unknown";
  assert.equal(await run(), "renewal_unavailable");
  settings.customerDefault = null;
  subscription.default_payment_method = "pm_unknown";
  assert.equal(await run(), "renewal_unavailable");
  subscription.default_payment_method = null;
  subscription.metadata.paige_enrollment = "other";
  assert.equal(await run(), "renewal_unavailable");
  assert.deepEqual(writes, []);
});
