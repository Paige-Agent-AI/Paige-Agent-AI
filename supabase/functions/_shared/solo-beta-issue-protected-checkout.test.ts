import assert from "node:assert/strict";
import { issueProtectedSoloCheckout, type ProtectedSignupIntake } from "./solo-beta-issue-protected-checkout.ts";
import { overRateLimit } from "./rateLimit.ts";

const now = 1_795_310_000;
const intake: ProtectedSignupIntake = {
  referenceId: "ff740390-bb62-4e89-9134-f3ff48bd73f9", primaryEmail: "sandbox@example.invalid",
  stripeProductId: "prod_fixture", stripePriceId: "price_fixture", livemode: false,
  createdAt: now, returnOrigin: "http://localhost:5173",
};

function fixture() {
  const stripeCustomerId = "cus_fixture";
  const checkoutId = "cs_test_fixture";
  const session = {
    id: checkoutId, url: "https://checkout.stripe.com/example", livemode: false, status: "open",
    mode: "setup", customer: stripeCustomerId, client_reference_id: intake.referenceId,
    metadata: { offer_code: "paige-solo-beta-monthly-v2" },
  };
  const observations: string[] = [];
  let bound: { checkoutId: string; stripeCustomerId: string } | null = null;
  const store: Parameters<typeof issueProtectedSoloCheckout>[2] = {
    readAttempt: () => Promise.resolve(bound),
    bindAttempt: (_intake, checkoutId, stripeCustomerId) => {
      observations.push("bound");
      bound = { checkoutId, stripeCustomerId };
      return Promise.resolve(true);
    },
  };
  const stripe: Parameters<typeof issueProtectedSoloCheckout>[3] = {
    customers: { create: (params, options) => {
      assert.equal(params.email, intake.primaryEmail);
      assert.equal(options.idempotencyKey, `solo-beta-protected-customer-${intake.referenceId}`);
      observations.push("customer");
      return Promise.resolve({ livemode: false, id: stripeCustomerId });
    } },
    checkout: { sessions: {
      create: (params, options) => {
        assert.equal(params.mode, "setup");
        assert.equal(params.customer, stripeCustomerId);
        assert.equal(new URL(params.success_url).origin, intake.returnOrigin);
        assert.equal(options.idempotencyKey, `solo-beta-protected-checkout-${intake.referenceId}`);
        observations.push("checkout");
        return Promise.resolve(session);
      },
      retrieve: () => Promise.resolve(session),
    } },
    prices: { retrieve: () => Promise.resolve({
      id: intake.stripePriceId, product: { id: intake.stripeProductId, active: true }, livemode: false,
      unit_amount: 9700, active: true, currency: "usd", recurring: { interval: "month", interval_count: 1 },
    }) },
  };
  return { observations, store, stripe, session };
}

Deno.test("opens one hosted setup session and reuses the bound session on retry", async () => {
  const { store, stripe, observations, session } = fixture();
  const result = await issueProtectedSoloCheckout(intake, now, store, stripe);
  assert.deepEqual(result, { ok: true, url: session.url });
  assert.deepEqual(await issueProtectedSoloCheckout(intake, now + 10, store, stripe), result);
  assert.deepEqual(observations, ["customer", "checkout", "bound"]);
});

Deno.test("does not replay an unbound Stripe write past the safe window", async () => {
  const { store, stripe, observations } = fixture();
  assert.deepEqual(await issueProtectedSoloCheckout(intake, now + 23 * 3600, store, stripe),
    { ok: false, code: "checkout_requires_recovery" });
  assert.deepEqual(observations, []);
});

Deno.test("rejects a mismatched amount before any Stripe write", async () => {
  const { store, stripe, observations } = fixture();
  const price = await stripe.prices.retrieve(intake.stripePriceId, { expand: ["product"] });
  stripe.prices.retrieve = () => Promise.resolve({ ...price, unit_amount: 7450 });
  assert.deepEqual(await issueProtectedSoloCheckout(intake, now, store, stripe), { ok: false, code: "subscription_offer_mismatch" });
  assert.deepEqual(observations, []);
});

Deno.test("rejects an archived Stripe Product even when its Price is still active", async () => {
  const { store, stripe, observations } = fixture();
  const price = await stripe.prices.retrieve(intake.stripePriceId, { expand: ["product"] });
  stripe.prices.retrieve = () => Promise.resolve({ ...price, product: { id: intake.stripeProductId, active: false } });
  assert.deepEqual(await issueProtectedSoloCheckout(intake, now, store, stripe), { ok: false, code: "subscription_offer_mismatch" });
  assert.deepEqual(observations, []);
});

Deno.test("the cost-bearing signup throttle requires an explicit allow response", async () => {
  for (const data of [false, null, undefined, "true"]) {
    const admin = { rpc: () => Promise.resolve({ data, error: null }) };
    assert.equal(await overRateLimit(admin, "protected-solo-start:test", 8, 60, true), true);
  }
  assert.equal(await overRateLimit({ rpc: () => Promise.resolve({ data: true, error: null }) }, "test", 8, 60, true), false);
  assert.equal(await overRateLimit({ rpc: () => Promise.resolve({ data: true, error: {} }) }, "test", 8, 60, true), true);
});
