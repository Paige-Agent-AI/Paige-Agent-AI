import assert from "node:assert/strict";
import { test } from "node:test";
import { SOLO_BETA_TRIAL_DAYS } from "./solo-beta-offer.ts";
import {
  buildProtectedSoloTrial,
  checkProtectedSoloTrial,
  PROTECTED_SOLO_BETA_OFFER_CODE,
  type ProtectedSoloTrialReadback,
} from "./solo-beta-protected-trial.ts";

const start = 1_795_300_000;
const end = start + 30 * 24 * 60 * 60;
const enrollment = {
  referenceId: "5721fc39-3958-4ff9-82fe-f96f5c96a199",
  stripeCustomerId: "cus_fixture",
  stripeCheckoutId: "cs_test_fixture",
  stripeProductId: "prod_fixture",
  stripePriceId: "price_fixture",
  livemode: false,
} as const;
const checkout = {
  id: enrollment.stripeCheckoutId,
  customer: enrollment.stripeCustomerId,
  client_reference_id: enrollment.referenceId,
  status: "complete",
  mode: "setup",
  setup_intent: "seti_fixture",
  livemode: false,
} as const;
const setup = {
  id: "seti_fixture",
  status: "succeeded",
  usage: "off_session",
  customer: enrollment.stripeCustomerId,
  payment_method: "pm_fixture",
  livemode: false,
} as const;
const price = {
  id: enrollment.stripePriceId, product: enrollment.stripeProductId, active: true,
  unit_amount: 9_700, currency: "usd", recurring: { interval: "month", interval_count: 1 },
  livemode: false,
} as const;
const zeroTrialInvoice = { customer: enrollment.stripeCustomerId, currency: "usd", amount_due: 0, amount_paid: 0, total: 0 };

function readback(): ProtectedSoloTrialReadback {
  return {
    id: "sub_fixture",
    livemode: false,
    customer: enrollment.stripeCustomerId,
    status: "trialing",
    trial_start: start,
    trial_end: end,
    cancel_at: end,
    cancel_at_period_end: true,
    default_payment_method: "pm_fixture",
    metadata: { paige_enrollment: enrollment.referenceId, offer_code: PROTECTED_SOLO_BETA_OFFER_CODE },
    items: { has_more: false, data: [{
      current_period_end: end,
      quantity: 1,
      price,
    }] },
    latest_invoice: zeroTrialInvoice,
  };
}

test("binds a completed SetupIntent to a trial with renewal stopped at creation", () => {
  const result = buildProtectedSoloTrial(enrollment, checkout, setup, price);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.params.cancel_at_period_end, true);
  assert.equal(result.params.trial_period_days, SOLO_BETA_TRIAL_DAYS);
  assert.equal(result.params.default_payment_method, setup.payment_method);
  assert.deepEqual(result.params.items, [{ price: enrollment.stripePriceId, quantity: 1 }]);
  assert.equal(result.options.idempotencyKey, `solo-beta-protected-trial-${enrollment.referenceId}`);
  assert.deepEqual(buildProtectedSoloTrial(enrollment, checkout, setup, price), result);
});

test("refuses an incomplete, mismatched, or cross-mode provider result", () => {
  for (const badCheckout of [
    { ...checkout, status: "open" },
    { ...checkout, customer: "cus_other" },
    { ...checkout, client_reference_id: "other-enrollment" },
    { ...checkout, setup_intent: "seti_other" },
    { ...checkout, mode: "subscription" },
    { ...checkout, livemode: true },
  ]) assert.deepEqual(buildProtectedSoloTrial(enrollment, badCheckout, setup, price), { ok: false, code: "checkout_binding_mismatch" });

  for (const badSetup of [
    { ...setup, status: "requires_action" },
    { ...setup, usage: "on_session" },
    { ...setup, customer: "cus_other" },
    { ...setup, payment_method: null },
    { ...setup, livemode: true },
  ]) assert.deepEqual(buildProtectedSoloTrial(enrollment, checkout, badSetup, price), { ok: false, code: "setup_binding_mismatch" });
});

test("refuses to create a trial against the old, archived, or wrong-mode price", () => {
  for (const badPrice of [
    { ...price, unit_amount: 7_450 },
    { ...price, active: false },
    { ...price, livemode: true },
    { ...price, id: "price_old" },
    { ...price, product: "prod_other" },
  ]) assert.deepEqual(buildProtectedSoloTrial(enrollment, checkout, setup, badPrice), { ok: false, code: "subscription_offer_mismatch" });
});

test("accepts only fresh readback with the original price, zero invoice, and exact cancellation date", () => {
  const result = checkProtectedSoloTrial(enrollment, setup.payment_method, readback());
  assert.deepEqual(result, { ok: true, stripeSubscriptionId: "sub_fixture", trialStartAt: start, trialEndAt: end, emailVerificationDeadline: start + 72 * 3600 });
  for (const invalid of [
    { ...readback(), cancel_at: end + 1 },
    { ...readback(), cancel_at_period_end: false },
    { ...readback(), default_payment_method: "pm_different" },
    { ...readback(), metadata: { paige_enrollment: "other", offer_code: PROTECTED_SOLO_BETA_OFFER_CODE } },
    { ...readback(), metadata: { paige_enrollment: enrollment.referenceId, offer_code: "paige-solo-beta-monthly-v1" } },
    { ...readback(), items: { has_more: false, data: [{ ...readback().items.data[0], price: { ...readback().items.data[0].price, unit_amount: 7_450 } }] } },
    { ...readback(), items: { has_more: true, data: readback().items.data } },
    { ...readback(), latest_invoice: { ...zeroTrialInvoice, amount_due: 9_700 } },
  ]) assert.equal(checkProtectedSoloTrial(enrollment, setup.payment_method, invalid).ok, false);
});
