import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  SOLO_BETA_OFFER_CODE,
  SOLO_BETA_PRODUCT_NAME,
  validateSoloBetaOffer,
} from "../_shared/solo-beta-offer.ts";
import {
  rawErrorDetail,
  readInvoiceSubscriptionId,
  readSubscriptionItemPeriod,
  stageError,
} from "../_shared/solo-beta-stripe-shapes.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const safeCode = (error: unknown) => {
  const raw = error instanceof Error ? error.message : "fulfillment_failed";
  return /^[a-z0-9_]{1,120}$/i.test(raw) ? raw : "fulfillment_failed";
};
const digest = async (raw: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const deliverVerifiedWelcome = async (supabaseUrl: string, serviceKey: string, fulfillmentEventId: string) => {
  const response = await fetch(supabaseUrl + "/functions/v1/send-transactional-email", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + serviceKey,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateName: "solo-beta-welcome",
      fulfillmentEventId,
    }),
  });
  if (!response.ok) throw new Error("welcome_delivery_failed");
};

// Success exits reset the operator-only diagnostic field so a later retry that
// succeeds never leaves a stale "last error" behind (mirrors last_error_code's
// NULL-on-completion semantics). Only this function writes the field.
// (Structural type: the runtime client is schema-untyped in this function.)
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = { from: (table: string) => any };
const clearErrorDetail = async (admin: SupabaseAdmin, eventId: string) => {
  await admin.from("stripe_event_log").update({ metadata: {} }).eq("event_id", eventId);
};
const persistErrorDetail = async (admin: SupabaseAdmin, eventId: string, detail: string) => {
  await admin.from("stripe_event_log").update({
    metadata: { last_error_detail: detail.slice(0, 300) },
  }).eq("event_id", eventId);
};
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!supabaseUrl || !serviceKey || !stripeKey || !webhookSecret) {
    return json(503, { error: "solo_beta_configuration_unavailable" });
  }
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return json(400, { error: "invalid_signature" });
  }
  if (!event.livemode) return json(400, { error: "test_event_rejected" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const payloadDigest = await digest(raw);
  const providerCreatedAt = new Date(event.created * 1000).toISOString();
  let eventClaimed = false;

  try {
    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.actor_user_id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (session.metadata?.offer_code !== SOLO_BETA_OFFER_CODE || !session.livemode
        || session.mode !== "subscription" || !userId || !customerId) {
        return json(400, { error: "event_not_eligible" });
      }
      const { error } = await admin.rpc("solo_beta_expire_checkout", {
        _event_id: event.id,
        _payload_digest: payloadDigest,
        _provider_created_at: providerCreatedAt,
        _user_id: userId,
        _session_id: session.id,
        _customer_id: customerId,
      });
      if (error) throw new Error("checkout_expiration_failed");
      return json(200, { received: true });
    }
    if (event.type === "checkout.session.completed") {
      const hinted = event.data.object as Stripe.Checkout.Session;
      if (hinted.metadata?.offer_code !== SOLO_BETA_OFFER_CODE) return json(400, { error: "event_not_eligible" });
      const session = await stripe.checkout.sessions.retrieve(hinted.id, { expand: ["subscription"] });
      if (!session.livemode || session.mode !== "subscription" || !["paid", "no_payment_required"].includes(session.payment_status)) {
        return json(400, { error: "checkout_not_verified" });
      }
      const userId = session.metadata?.actor_user_id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!userId || !customerId || !subscriptionId) return json(400, { error: "checkout_identity_missing" });
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
      const subscriptionActor = subscription.metadata?.actor_user_id;
      const subscriptionCustomerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (!userId || session.client_reference_id !== userId || subscriptionActor !== userId || subscriptionCustomerId !== customerId) {
        return json(400, { error: "event_not_eligible" });
      }
      if (subscription.items.data.length !== 1) return json(400, { error: "checkout_item_mismatch" });
      const item = subscription.items.data[0];
      const price = item?.price;
      const product = price && typeof price.product !== "string" ? price.product : null;
      const productDeleted = product && "deleted" in product ? product.deleted : false;
      const period = readSubscriptionItemPeriod(item);
      if (!price || item.quantity !== 1 || !product || productDeleted || !("active" in product)
        || product.active !== true || !("name" in product) || product.name !== SOLO_BETA_PRODUCT_NAME
        || !period) return json(400, { error: "checkout_item_mismatch" });
      const productId = product.id;
      const { data: configured, error: configuredError } = await admin.from("platform_subscription_offers")
        .select("stripe_product_id,stripe_price_id").eq("offer_code", SOLO_BETA_OFFER_CODE).single();
      if (configuredError || !configured) return json(503, { error: "solo_beta_configuration_unavailable" });
      const validation = validateSoloBetaOffer({
        offerCode: subscription.metadata?.offer_code ?? session.metadata?.offer_code ?? null,
        purpose: "checkout_fulfillment",
        livemode: subscription.livemode,
        configuredProductId: configured?.stripe_product_id ?? null,
        configuredPriceId: configured?.stripe_price_id ?? null,
        observedProductId: productId,
        observedPriceId: price.id,
        priceActive: price.active,
        unitAmountCents: price.unit_amount,
        currency: price.currency,
        recurring: price.recurring ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
        trialStart: subscription.trial_start,
        trialEnd: subscription.trial_end,
        paymentMethodCollected: Boolean(subscription.default_payment_method),
        subscriptionStatus: subscription.status,
      });
      if (!validation.ok) return json(400, { error: "event_not_eligible" });
      const { data: claimed, error: claimError } = await admin.rpc("solo_beta_claim_stripe_event", {
        _event_id: event.id, _event_type: event.type, _livemode: event.livemode,
        _payload_digest: payloadDigest, _user_id: userId, _session_id: session.id,
        _subscription_id: subscription.id, _customer_id: customerId,
        _provider_created_at: providerCreatedAt,
      });
      if (claimError) throw stageError("event_claim_failed", claimError);
      const claim = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!claim?.claimed) {
        if (claim?.lifecycle_state === "completed") {
          await clearErrorDetail(admin, event.id);
          await deliverVerifiedWelcome(supabaseUrl, serviceKey, event.id);
          return json(200, { received: true, duplicate: true });
        }
        return json(409, { error: "event_processing_retry" });
      }
      eventClaimed = true;

      const { data: enrollment, error: enrollmentError } = await admin.from("solo_beta_enrollments")
        .select("checkout_attempt,checkout_fencing_token,checkout_session_id,stripe_customer_id")
        .eq("user_id", userId).maybeSingle();
      if (enrollmentError) throw stageError("enrollment_identity_mismatch", enrollmentError);
      if (!enrollment || enrollment.checkout_session_id !== session.id
        || enrollment.stripe_customer_id !== customerId || !enrollment.checkout_fencing_token) {
        throw new Error("enrollment_identity_mismatch");
      }

      const { error: fulfillError } = await admin.rpc("solo_beta_fulfill_checkout", {
        _event_id: event.id, _user_id: userId,
        _attempt: enrollment.checkout_attempt, _fencing_token: enrollment.checkout_fencing_token,
        _customer_id: customerId,
        _subscription_id: subscription.id, _session_id: session.id,
        _product_id: productId, _price_id: price.id, _livemode: subscription.livemode,
        _unit_amount: price.unit_amount, _currency: price.currency,
        _interval: price.recurring?.interval, _interval_count: price.recurring?.interval_count,
        _subscription_status: subscription.status, _period_start: period.start, _period_end: period.end,
        _trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
        _trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        _cancel_at_period_end: subscription.cancel_at_period_end,
      });
      if (fulfillError) throw stageError("atomic_fulfillment_failed", fulfillError);
      await clearErrorDetail(admin, event.id);
      await deliverVerifiedWelcome(supabaseUrl, serviceKey, event.id);
      return json(200, { received: true });
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
      let subscriptionId: string | null = null;
      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as Stripe.Invoice;
        subscriptionId = readInvoiceSubscriptionId(invoice);
      } else {
        subscriptionId = (event.data.object as Stripe.Subscription).id;
      }
      if (!subscriptionId) return json(400, { error: "event_not_eligible" });
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
      const userId = subscription.metadata?.actor_user_id;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (!userId || !customerId) return json(400, { error: "event_not_eligible" });
      if (subscription.items.data.length !== 1) return json(400, { error: "event_not_eligible" });
      const item = subscription.items.data[0];
      const price = item?.price;
      const product = price && typeof price.product !== "string" ? price.product : null;
      const productDeleted = product && "deleted" in product ? product.deleted : false;
      const period = readSubscriptionItemPeriod(item);
      if (!price || item.quantity !== 1 || !product || productDeleted
        || !("name" in product) || product.name !== SOLO_BETA_PRODUCT_NAME
        || !period) return json(400, { error: "event_not_eligible" });
      const productId = product.id;
      const { data: persisted, error: persistedError } = await admin.from("platform_subscriptions")
        .select("offer_code,provider_mode,stripe_product_id,stripe_price_id,stripe_customer_id")
        .eq("stripe_subscription_id", subscription.id).maybeSingle();
      if (persistedError) return json(503, { error: "solo_beta_subscription_unavailable" });
      if (!persisted || persisted.offer_code !== SOLO_BETA_OFFER_CODE || persisted.provider_mode !== "live"
        || persisted.stripe_customer_id !== customerId) return json(400, { error: "event_not_eligible" });
      const normalizedStatus = event.type === "customer.subscription.deleted"
        ? "canceled"
        : event.type === "invoice.payment_failed"
          ? "past_due"
          : subscription.status;
      const validation = validateSoloBetaOffer({
        offerCode: persisted.offer_code, purpose: "lifecycle_sync",
        livemode: subscription.livemode, configuredProductId: persisted.stripe_product_id,
        configuredPriceId: persisted.stripe_price_id, observedProductId: productId,
        observedPriceId: price.id, priceActive: price.active, unitAmountCents: price.unit_amount,
        currency: price.currency, recurring: price.recurring ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
        trialStart: subscription.trial_start, trialEnd: subscription.trial_end,
        paymentMethodCollected: Boolean(subscription.default_payment_method),
        subscriptionStatus: normalizedStatus,
      });
      if (!validation.ok) return json(400, { error: "event_not_eligible" });
      const { data: claimed, error: claimError } = await admin.rpc("solo_beta_claim_stripe_event", {
        _event_id: event.id, _event_type: event.type, _livemode: event.livemode,
        _payload_digest: payloadDigest, _user_id: userId, _session_id: null,
        _subscription_id: subscription.id, _customer_id: customerId,
        _provider_created_at: providerCreatedAt,
      });
      if (claimError) throw stageError("event_claim_failed", claimError);
      const claim = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!claim?.claimed) {
        if (claim?.lifecycle_state === "completed") {
          await clearErrorDetail(admin, event.id);
          return json(200, { received: true, duplicate: true });
        }
        return json(409, { error: "event_processing_retry" });
      }
      eventClaimed = true;


      const { error: syncError } = await admin.rpc("solo_beta_sync_subscription", {
        _event_id: event.id, _event_type: event.type, _provider_created_at: providerCreatedAt,
        _subscription_id: subscription.id, _customer_id: customerId, _user_id: userId,
        _product_id: productId,
        _price_id: price.id, _livemode: subscription.livemode, _unit_amount: price.unit_amount,
        _currency: price.currency, _interval: price.recurring?.interval,
        _interval_count: price.recurring?.interval_count, _subscription_status: normalizedStatus,
        _period_start: period.start, _period_end: period.end,
        _trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
        _trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        _cancel_at_period_end: subscription.cancel_at_period_end,
      });
      if (syncError) throw stageError("lifecycle_sync_failed", syncError);
      await clearErrorDetail(admin, event.id);
      return json(200, { received: true });
    }
    return json(200, { received: true, ignored: true });
  } catch (error) {
    const rawDetail = rawErrorDetail(error) ?? (error instanceof Error ? error.message : String(error));
    console.error("solo_beta_stripe_webhook_failed", {
      eventId: typeof event !== "undefined" ? event.id : null,
      eventType: typeof event !== "undefined" ? event.type : null,
      message: rawDetail,
    });
    if (eventClaimed) {
      await admin.rpc("solo_beta_fail_stripe_event", { _event_id: event.id, _error_code: safeCode(error) });
      // Restricted diagnostic evidence: last_error_code keeps the stable snake_case
      // name, but database/provider messages containing spaces or punctuation
      // (constraint text, PGRST bodies) would otherwise be lost. Persist the raw
      // detail on the operator-only event row so the real SQL failure is always
      // identifiable without exposing it in any customer-facing surface.
      await persistErrorDetail(admin, event.id, rawDetail);
    }
    return json(500, { error: "solo_beta_webhook_retry_required" });
  }
});
