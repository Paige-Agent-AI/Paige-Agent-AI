import type {SalesPaymentAdmin} from "../_shared/sales-payments/database-port.ts";
import { routeVerifiedSalesStripeEvent } from "../_shared/sales-payments/stripe-event-adapter.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { upsertBillingAccount } from "../_shared/platform-billing.ts";
import { findSoleClientByEmailAnyWorkspace } from "../_shared/contact-methods.ts";

import { reconcilePaymentSetup } from "../_shared/payment-setup-reconciliation.ts";
import { verifyStripeWebhook } from "../_shared/stripe-webhook-signature.ts";
import { SOLO_BETA_OFFER_CODE } from "../_shared/solo-beta-offer.ts";
import { readInvoiceSubscriptionId } from "../_shared/solo-beta-stripe-shapes.ts";

// Legacy Stripe account (original PaigeAgent account)
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2025-08-27.basil",
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

// V2 Stripe account (new account being set up by MMA Ops). Both stay live so
// we can dual-route during the cutover. Either secret can verify a signature.
const stripeV2 = new Stripe(
  Deno.env.get("STRIPE_SECRET_KEY_V2") || Deno.env.get("STRIPE_SECRET_KEY") || "",
  { apiVersion: "2025-08-27.basil" },
);
const webhookSecretV2 = Deno.env.get("STRIPE_WEBHOOK_SECRET_V2") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

// === Step 2 helpers: tier resolution, tier_state writes, MMA OS short-hop ===

// Map a Stripe price ID → canonical tier label. Price IDs live in env so the
// Stripe-side IDs can rotate without a code deploy (Standard $8 / Premium $44
// / VIP $97 per project knowledge §2).
function priceIdToTier(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const map: Record<string, string> = {};
  const std = Deno.env.get("STRIPE_PRICE_STANDARD"); if (std) map[std] = "standard";
  const prm = Deno.env.get("STRIPE_PRICE_PREMIUM");  if (prm) map[prm] = "premium";
  const vip = Deno.env.get("STRIPE_PRICE_VIP");      if (vip) map[vip] = "vip";
  // V2 account overrides (optional — for the new Stripe account's price IDs)
  const stdV2 = Deno.env.get("STRIPE_PRICE_STANDARD_V2"); if (stdV2) map[stdV2] = "standard";
  const prmV2 = Deno.env.get("STRIPE_PRICE_PREMIUM_V2");  if (prmV2) map[prmV2] = "premium";
  const vipV2 = Deno.env.get("STRIPE_PRICE_VIP_V2");      if (vipV2) map[vipV2] = "vip";
  return map[priceId] ?? null;
}

// Upsert tier_state by contact_email + write an audit_log row + fire a
// best-effort short-hop to MMA OS. Never throws — failures are logged.
async function upsertTierState(
  supabaseAdmin: any,
  args: {
    email: string;
    tier: string;
    paymentStatus?: string;
    source: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripePriceId?: string | null;
    stripeAccountId?: string | null;
    currentPeriodEnd?: string | null;
    lastPaymentAt?: string | null;
    eventId: string;
    eventType: string;
  },
) {
  if (!args.email) {
    logStep("upsertTierState skipped: missing email", { eventId: args.eventId });
    return;
  }
  try {
    // Try to resolve user_id + client_id for nicer joins downstream.
    let userId: string | null = null;
    let clientId: string | null = null;
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
      const u = userData?.users?.find((x: any) => x.email?.toLowerCase() === args.email.toLowerCase());
      if (u) userId = u.id;
    } catch (_) { /* ignore */ }
    clientId = (await findSoleClientByEmailAnyWorkspace(supabaseAdmin, args.email, "stripe-webhook"))?.id ?? null;

    const { error } = await supabaseAdmin
      .from("tier_state")
      .upsert(
        {
          contact_email: args.email.toLowerCase(),
          user_id: userId,
          client_id: clientId,
          tier: args.tier,
          payment_status: args.paymentStatus ?? "active",
          source: args.source,
          stripe_customer_id: args.stripeCustomerId ?? null,
          stripe_subscription_id: args.stripeSubscriptionId ?? null,
          stripe_price_id: args.stripePriceId ?? null,
          stripe_account_id: args.stripeAccountId ?? null,
          current_period_end: args.currentPeriodEnd ?? null,
          last_payment_at: args.lastPaymentAt ?? null,
        },
        { onConflict: "contact_email" },
      );
    if (error) {
      logStep("tier_state upsert failed", { error: error.message, email: args.email });
      return;
    }

    // Audit log — GLBA §5 requires audit trail on every billing event.
    try {
      await supabaseAdmin.from("audit_logs").insert({
        event_type: `stripe.${args.eventType}`,
        actor_id: userId,
        metadata: {
          email: args.email,
          tier: args.tier,
          payment_status: args.paymentStatus,
          stripe_event_id: args.eventId,
          stripe_account_id: args.stripeAccountId,
          stripe_subscription_id: args.stripeSubscriptionId,
          source: args.source,
        },
      });
    } catch (e) {
      logStep("audit_logs insert failed (non-fatal)", { error: String(e) });
    }

    // Short-hop to MMA OS so its brain sees the tier change instantly.
    // Best-effort, fire-and-forget with retries: must never block the 200 back to Stripe.
    const shortHop = fireMmaOsTierSync({
      email: args.email,
      tier: args.tier,
      paymentStatus: args.paymentStatus ?? "active",
      stripeAccountId: args.stripeAccountId ?? null,
      eventId: args.eventId,
    });
    // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(shortHop);
    } else {
      // Fallback: detach so retries don't block the handler.
      shortHop.catch((e) => logStep("MMA OS short-hop detached error", { error: String(e) }));
    }
  } catch (e) {
    logStep("upsertTierState exception", { error: String(e) });
  }
}

// Transient: network error, 408, 429, or any 5xx. Permanent (4xx other): no retry.
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

const PAIGE_OS_MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const PAIGE_OS_BASE_DELAY_MS = 500;
const PAIGE_OS_MAX_DELAY_MS = 8000;
const PAIGE_OS_TIMEOUT_MS = 10_000;

function backoffDelay(attempt: number): number {
  // attempt is 1-indexed for retries (1 = first retry)
  const exp = Math.min(PAIGE_OS_BASE_DELAY_MS * Math.pow(3, attempt - 1), PAIGE_OS_MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

async function fireMmaOsTierSync(payload: {
  email: string;
  tier: string;
  paymentStatus: string;
  stripeAccountId: string | null;
  eventId: string;
}) {
  const url = Deno.env.get("PAIGE_OS_EDGE_URL") || Deno.env.get("PAIGE_OS_BRIDGE_URL");
  const key = Deno.env.get("PAIGE_OS_BRIDGE_API_KEY");
  if (!url || !key) {
    logStep("MMA OS short-hop skipped: missing PAIGE_OS_EDGE_URL or PAIGE_OS_BRIDGE_API_KEY");
    return;
  }

  const body = JSON.stringify({
    verb: "sync_tier",
    payload: {
      contact_email: payload.email,
      tier: payload.tier,
      payment_status: payload.paymentStatus,
      source: "paige.stripe",
      stripe_account_id: payload.stripeAccountId,
      stripe_event_id: payload.eventId,
      occurred_at: new Date().toISOString(),
    },
  });

  for (let attempt = 1; attempt <= PAIGE_OS_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAIGE_OS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "Idempotency-Key": `tier-sync:${payload.eventId}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        logStep("MMA OS short-hop succeeded", { eventId: payload.eventId, attempt });
        return;
      }

      const text = await res.text().catch(() => "");
      if (!isTransientStatus(res.status) || attempt === PAIGE_OS_MAX_ATTEMPTS) {
        logStep("MMA OS short-hop failed (non-fatal, giving up)", {
          status: res.status,
          attempt,
          body: text.slice(0, 200),
        });
        return;
      }
      const delay = backoffDelay(attempt);
      logStep("MMA OS short-hop transient failure, retrying", {
        status: res.status,
        attempt,
        nextDelayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      clearTimeout(timeout);
      if (attempt === PAIGE_OS_MAX_ATTEMPTS) {
        logStep("MMA OS short-hop exception (non-fatal, giving up)", {
          error: String(e),
          attempt,
        });
        return;
      }
      const delay = backoffDelay(attempt);
      logStep("MMA OS short-hop network error, retrying", {
        error: String(e),
        attempt,
        nextDelayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Sends affiliate-conversion-earned email after a successful attribution.
// Looks up: affiliate user email, commission rate label, and MTD earnings.
async function sendAffiliateConversionEmail(
  supabaseAdmin: any,
  conversionId: string,
  productIdOrPlanName?: string,
) {
  // Load conversion + affiliate
  const { data: conv } = await supabaseAdmin
    .from("referral_conversions")
    .select("affiliate_id, commission_cents, converted_at")
    .eq("id", conversionId)
    .maybeSingle();
  if (!conv?.affiliate_id) return;

  const { data: aff } = await supabaseAdmin
    .from("affiliate_profiles")
    .select("user_id, commission_tier_id")
    .eq("id", conv.affiliate_id)
    .maybeSingle();
  if (!aff?.user_id) return;

  const { data: tier } = await supabaseAdmin
    .from("affiliate_commission_tiers")
    .select("commission_rate, display_name")
    .eq("id", aff.commission_tier_id)
    .maybeSingle();

  // Lookup affiliate email via auth admin
  const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(aff.user_id);
  const recipientEmail = userRes?.user?.email;
  if (!recipientEmail) return;

  // Calculate month-to-date earnings (attributed only)
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data: mtdRows } = await supabaseAdmin
    .from("referral_conversions")
    .select("commission_cents")
    .eq("affiliate_id", conv.affiliate_id)
    .eq("status", "attributed")
    .gte("converted_at", start.toISOString());
  const mtdCents = (mtdRows ?? []).reduce(
    (s: number, r: any) => s + (r.commission_cents ?? 0),
    0,
  );

  const fmt = (cents: number) =>
    `$${((cents ?? 0) / 100).toFixed(2)}`;
  const ratePct = tier?.commission_rate
    ? `${Math.round(Number(tier.commission_rate) * 100)}%`
    : undefined;

  // Friendly plan label
  let planName = productIdOrPlanName ?? "PaigeAgent";
  if (planName?.startsWith("prod_")) planName = "PaigeAgent";

  await supabaseAdmin.functions.invoke("send-transactional-email", {
    body: {
      templateName: "affiliate-conversion-earned",
      recipientEmail,
      recipientUserId: aff.user_id,
      idempotencyKey: `aff-conv-${conversionId}`,
      templateData: {
        planName,
        commissionEarned: fmt(conv.commission_cents ?? 0),
        commissionRate: ratePct,
        monthToDate: fmt(mtdCents),
      },
    },
  });
}

// When a broker signs up via another broker's BROK referral code we write a
// 20% / 12-month recurring commission row to broker_referral_commissions.
// Idempotent: keyed on (referring_broker_id, referred_broker_id) — only the
// first matching subscription event creates the row.
async function maybeRecordBrokerReferralCommission(
  supabaseAdmin: any,
  newSubscriberUserId: string,
  stripeSubscriptionId: string,
  amountCents: number,
) {
  // Is the new subscriber a broker?
  const { data: referredBroker } = await supabaseAdmin
    .from("broker_profiles")
    .select("id, broker_referral_code, business_name")
    .eq("user_id", newSubscriberUserId)
    .maybeSingle();
  if (!referredBroker?.id || !referredBroker.broker_referral_code) {
    return;
  }
  if (!String(referredBroker.broker_referral_code).toUpperCase().startsWith("BROK-")) {
    return;
  }

  // Find the referring broker by their issued referral_code
  const { data: referringBroker } = await supabaseAdmin
    .from("broker_profiles")
    .select("id, business_name")
    .eq("referral_code", referredBroker.broker_referral_code)
    .maybeSingle();
  if (!referringBroker?.id || referringBroker.id === referredBroker.id) {
    return;
  }

  // Already recorded?
  const { data: existing } = await supabaseAdmin
    .from("broker_referral_commissions")
    .select("id")
    .eq("referring_broker_id", referringBroker.id)
    .eq("referred_broker_id", referredBroker.id)
    .maybeSingle();
  if (existing?.id) {
    logStep("Broker referral commission already exists", { id: existing.id });
    return;
  }

  // 20% of monthly amount, 12 months. amountCents from initial checkout total.
  const monthlyAmount = (amountCents / 100) * 0.2;
  const startedAt = new Date();
  const expiresAt = new Date(startedAt);
  expiresAt.setMonth(expiresAt.getMonth() + 12);

  const { error } = await supabaseAdmin
    .from("broker_referral_commissions")
    .insert({
      referring_broker_id: referringBroker.id,
      referred_broker_id: referredBroker.id,
      commission_rate: 0.20,
      duration_months: 12,
      monthly_amount: monthlyAmount,
      status: "active",
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  if (error) {
    logStep("Failed to insert broker referral commission", { error: error.message });
  } else {
    logStep("Broker referral commission recorded", {
      referring: referringBroker.business_name,
      referred: referredBroker.business_name,
      monthlyAmount,
      stripeSubscriptionId,
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      throw new Error("No stripe-signature header found");
    }

    const body = await req.text();

    // Verify webhook signature — try V2 secret first, fall back to legacy.
    // Either Stripe account can fire this endpoint; whichever signing secret
    // verifies the payload tells us which account it came from.
    const verified = await verifyStripeWebhook(
      body, signature, stripe, stripeV2, webhookSecret, webhookSecretV2, Stripe.createSubtleCryptoProvider(),
    );
    if (!verified) {
      logStep("Webhook signature verification failed (both accounts)");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const event = verified.event as Stripe.Event;
    const verifiedAccount = verified.account;
    logStep("Webhook signature verified", { type: event!.type, account: verifiedAccount });
    const stripeAccountId = (event! as any).account ?? null;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Sales reconciliation must run after authentication and before the legacy insert-first
    // dedup gate. Failed allocation returns retryable 503; no event can consume an unpersisted
    // financial result. No raw event body or provider error enters Sales evidence.
    const salesEvent=await routeVerifiedSalesStripeEvent(supabaseAdmin as unknown as SalesPaymentAdmin,event,verifiedAccount,Deno.env.get("STRIPE_SECRET_KEY")??"");
    if(salesEvent.handled)return new Response(JSON.stringify({code:salesEvent.code}),{status:salesEvent.status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});

    // The account's single Stripe endpoint stays the ingress. Route only signed,
    // live Solo events into the dedicated recoverable/atomic lifecycle before the
    // legacy insert-first gate can consume them. Browser fields never participate.
    const verifiedStripe = verifiedAccount === "v2" ? stripeV2 : stripe;
    let isSoloBetaEvent = false;
    if (event.livemode && verifiedAccount === "legacy") {
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
        isSoloBetaEvent = (event.data.object as Stripe.Checkout.Session).metadata?.offer_code === SOLO_BETA_OFFER_CODE;
      } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        isSoloBetaEvent = (event.data.object as Stripe.Subscription).metadata?.offer_code === SOLO_BETA_OFFER_CODE;
      } else if (event.type === "invoice.payment_failed") {
        const subscriptionId = readInvoiceSubscriptionId(event.data.object as Stripe.Invoice);
        if (subscriptionId) {
          try {
            const subscription = await verifiedStripe.subscriptions.retrieve(subscriptionId);
            isSoloBetaEvent = subscription.metadata?.offer_code === SOLO_BETA_OFFER_CODE;
          } catch {
            return new Response(JSON.stringify({ error: "solo_beta_subscription_readback_unavailable" }), {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
    }
    if (isSoloBetaEvent) {
      const soloResponse = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/solo-beta-stripe-webhook`,
        { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body },
      );
      return new Response(await soloResponse.text(), {
        status: soloResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Billing setup has its own transactional completion gate. It MUST precede the
    // legacy insert-first log and every other product route. A failed commit returns
    // non-2xx without permanently consuming the event. Provider details stay confined.
    if (event!.type === "checkout.session.completed" &&
        (event!.data.object as Stripe.Checkout.Session).metadata?.platform_billing_connect_tenant_id) {
      const result = await reconcilePaymentSetup(
        event!, verifiedAccount!, verifiedAccount === "v2" ? stripeV2 : stripe, supabaseAdmin,
      );
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Idempotency gate — Stripe retries the same event on transient failures.
    // INSERT first; if it conflicts, we already processed this event and can
    // ACK immediately. Guarantees handlers run at-most-once per event.
    {
      const { error: idempErr } = await supabaseAdmin
        .from("stripe_event_log")
        .insert({
          event_id: event!.id,
          account_id: stripeAccountId,
          type: event!.type,
          livemode: (event! as any).livemode ?? null,
          metadata: { verified_account: verifiedAccount },
        });
      if (idempErr) {
        // Postgres unique_violation = 23505 → already processed
        if ((idempErr as any).code === "23505") {
          logStep("Duplicate event — already processed, acking", { eventId: event!.id });
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Any other error: log but proceed (better to risk dup than lose the event)
        logStep("stripe_event_log insert error (continuing)", { error: idempErr.message });
      }
    }

    // Handle different event types
    const ADDITIONAL_BUSINESS_PRICE_ID = Deno.env.get(
      "STRIPE_ADDITIONAL_BUSINESS_PRICE_ID",
    ) ?? "";


    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Processing checkout.session.completed", { sessionId: session.id });
        // === Tenant storefront order (L2 storefront plane) ===
        // Discriminant: session.metadata.tenant_price_id is Stripe-SIGNED metadata
        // set by the producer `tenant-checkout-session`. If present, this is a tenant
        // storefront order — handle it here and short-circuit FIRST, so a storefront
        // subscription-mode checkout can never be mis-handled by the slot- or
        // platform-plan blocks below.
        if (session.metadata?.tenant_price_id) {
          try {
            // Only mark complete once the funds are captured. One-time 'payment'
            // sessions fire already paid; guard anyway for subscription-mode orders.
            if (session.payment_status === "paid") {
              // Terminal status is the literal 'complete' — tenant_orders CHECK
              // allows ('pending','complete','failed','refunded','cancelled');
              // writing 'paid' throws 23514. StorefrontPanel lights success on 'complete'.
              // Idempotent: the status='pending' predicate makes a webhook replay a 0-row update.
              const { data: updated, error: orderErr } = await supabaseAdmin
                .from("tenant_orders")
                .update({
                  status: "complete",
                  stripe_payment_intent_id: (session.payment_intent as string | null) ?? null,
                  updated_at: new Date().toISOString(),
                })
                .eq("stripe_session_id", session.id)
                .eq("status", "pending")
                .select("id");

              if (orderErr) {
                logStep("Storefront order: update failed", {
                  sessionId: session.id,
                  error: orderErr.message,
                });
              } else {
                logStep("Storefront order: marked complete", {
                  sessionId: session.id,
                  rows: updated?.length ?? 0,
                });
              }
            } else {
              logStep("Storefront order: skipped, not paid", {
                sessionId: session.id,
                payment_status: session.payment_status,
              });
            }
          } catch (storefrontErr) {
            // A storefront-order failure must never 500 the webhook and block
            // platform-subscription events. Log and swallow.
            logStep("Storefront order handler error", {
              sessionId: session.id,
              error: String(storefrontErr),
            });
          }
          // IMPORTANT — do NOT fall through to slot / plan blocks.
          break;
        }

        // === Marketplace paid install (Exchange install-revenue plane) ===
        // Discriminant: session.metadata.marketplace_item_slug is Stripe-SIGNED
        // metadata set by the producer `marketplace-checkout-session`. If present,
        // this is a paid marketplace install — complete it here and short-circuit,
        // so a one-time 'payment' marketplace checkout can never be mis-routed into
        // the slot- or platform-plan blocks below. All identifiers come from the
        // Stripe-signed metadata, never the request body (§9). mode is always
        // 'payment', so this never reaches the subscription-only upsertTierState
        // arms (#459).
        if (session.metadata?.marketplace_item_slug) {
          try {
            // Only complete once funds are captured. One-time 'payment' sessions
            // fire already paid; guard anyway.
            if (session.payment_status === "paid") {
              const itemSlug = session.metadata.marketplace_item_slug;
              const itemId = session.metadata.marketplace_item_id ?? null;
              const buyerTenantId = session.metadata.tenant_id ?? null;
              const actorUserId = session.metadata.actor_user_id ?? null;
              const paymentIntentId =
                (session.payment_intent as string | null) ?? null;

              if (!itemId || !buyerTenantId || !actorUserId) {
                // actorUserId is required by the 5-arg install overload's
                // is_tenant_admin_as(actor,tenant) gate — guard early + loud so a
                // missing signed identifier never reaches a pointless invoke.
                logStep("Marketplace install: missing signed identifiers", {
                  sessionId: session.id,
                  itemSlug,
                  hasItemId: !!itemId,
                  hasTenant: !!buyerTenantId,
                  hasActor: !!actorUserId,
                });
              } else {
                // Drive the EXISTING install writer (§18 — do not fork the ledger).
                // A service-role invoke lands in the 5-arg actor overload; the RPC
                // is idempotent on ON CONFLICT (tenant_id,item_id) and writes the
                // REAL, non-zero ledger row (gross=price_cents; fee/net derived from
                // take_rate_bps) — no phantom revenue.
                const { error: installErr } = await supabaseAdmin.functions.invoke(
                  "marketplace-install",
                  {
                    body: {
                      item_slug: itemSlug,
                      tenant_id: buyerTenantId,
                      actor_user_id: actorUserId,
                      installed_by_agent: "stripe",
                    },
                  },
                );
                if (installErr) {
                  logStep("Marketplace install: writer invoke failed", {
                    sessionId: session.id,
                    itemSlug,
                    error: (installErr as any)?.message ?? String(installErr),
                  });
                } else {
                  // Stamp payment refs onto the install row (UNIQUE tenant_id,item_id
                  // → at most one). Fixed-value UPDATE is self-idempotent.
                  const { data: installRow, error: findErr } = await supabaseAdmin
                    .from("marketplace_installs")
                    .select("id")
                    .eq("tenant_id", buyerTenantId)
                    .eq("item_id", itemId)
                    .maybeSingle();

                  if (findErr || !installRow) {
                    logStep("Marketplace install: install row not found for stamp", {
                      sessionId: session.id,
                      itemSlug,
                      error: findErr?.message ?? null,
                    });
                  } else {
                    const { error: stampErr } = await supabaseAdmin
                      .from("marketplace_installs")
                      .update({
                        stripe_checkout_session_id: session.id,
                        stripe_payment_intent_id: paymentIntentId,
                      })
                      .eq("id", installRow.id);
                    if (stampErr) {
                      logStep("Marketplace install: install stamp failed", {
                        sessionId: session.id,
                        error: stampErr.message,
                      });
                    }

                    // Stamp stripe_ref onto the newest 'install' ledger row for this
                    // install, only where still NULL — a replay finds none → 0-row
                    // update, so it can never double-stamp.
                    const { data: ledgerRow } = await supabaseAdmin
                      .from("marketplace_install_ledger")
                      .select("id")
                      .eq("install_id", installRow.id)
                      .eq("event_type", "install")
                      .is("stripe_ref", null)
                      .order("occurred_at", { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    if (ledgerRow) {
                      const { error: ledgerErr } = await supabaseAdmin
                        .from("marketplace_install_ledger")
                        .update({ stripe_ref: paymentIntentId })
                        .eq("id", ledgerRow.id);
                      if (ledgerErr) {
                        logStep("Marketplace install: ledger stamp failed", {
                          sessionId: session.id,
                          error: ledgerErr.message,
                        });
                      }
                    }

                    logStep("Marketplace install: completed", {
                      sessionId: session.id,
                      itemSlug,
                      installId: installRow.id,
                      tenantId: buyerTenantId,
                    });
                  }
                }
              }
            } else {
              logStep("Marketplace install: skipped, not paid", {
                sessionId: session.id,
                payment_status: session.payment_status,
              });
            }
          } catch (mktErr) {
            // A marketplace-install failure must never 500 the webhook and block
            // platform-subscription events. Log and swallow (§13 honest, non-throwing).
            logStep("Marketplace install handler error", {
              sessionId: session.id,
              error: String(mktErr),
            });
          }
          // IMPORTANT — do NOT fall through to slot / plan blocks.
          break;
        }

        // === Platform subscription (Tier-1 Paige-held rail, B-Platform) ===
        // Discriminant: session.metadata.platform_plan_slug is Stripe-SIGNED metadata
        // set by the producer `platform-subscription-checkout`. If present, this is a
        // tenant becoming a Paige customer — write platform_subscriptions here and
        // short-circuit, so a subscription-mode platform checkout can never be
        // mis-routed into the slot- or plan-tier blocks below. All identifiers come
        // from the Stripe-signed metadata, never the request body (§9). The
        // platform_subscriptions RLS allows only the platform owner to write, so this
        // service-role upsert is the sole writer (§18).
        if (session.metadata?.platform_plan_slug) {
          try {
            // Provision once the checkout is fulfillable: a PAID session (charged) OR
            // a trial-start session (no_payment_required — trial_period_days set, no
            // immediate charge). Anything else is skipped.
            if (
              session.payment_status === "paid" ||
              session.payment_status === "no_payment_required"
            ) {
              const now = new Date().toISOString();
              // Trial start ⇒ the subscription is 'trialing'; an immediate charge ⇒
              // 'active'. no_payment_required in mode:"subscription" (no coupons in
              // this flow) ⟺ a trial, so this mapping is exact. Do NOT hardcode
              // "active" — customer.subscription.updated later writes the real
              // subscription.status ("active") on the first charge.
              const platformStatus =
                session.payment_status === "no_payment_required"
                  ? "trialing"
                  : "active";
              const planId = session.metadata.platform_plan_id ?? null;
              const actorUserId = session.metadata.actor_user_id ?? null;
              const billingPeriod =
                session.metadata.billing_period ?? "monthly";
              const stripeSubId = (session.subscription as string | null) ?? null;
              const stripeCustId = (session.customer as string | null) ?? null;
              // The PRESENCE of a signed tenant_id discriminates the two B-Platform
              // paths: present ⇒ GRANDFATHERED (upsert onto that existing tenant);
              // absent ⇒ ONBOARDING pay-before-workspace (PROVISION the tenant + owner
              // role for actor_user_id, then subscribe). The producer sets tenant_id
              // only on the grandfathered path.
              const tenantId = session.metadata.tenant_id ?? null;

              if (tenantId) {
                // ── GRANDFATHERED: existing tenant becomes/updates a subscriber ─────
                if (!planId || !stripeSubId) {
                  logStep("Platform subscription: missing signed identifiers", {
                    sessionId: session.id,
                    hasPlan: !!planId,
                    hasTenant: !!tenantId,
                    hasSub: !!stripeSubId,
                  });
                } else {
                  // Idempotent: a webhook replay hits UNIQUE(tenant_id,
                  // stripe_subscription_id) and upserts the same row.
                  const { data: upserted, error: subErr } = await supabaseAdmin
                    .from("platform_subscriptions")
                    .upsert(
                      {
                        tenant_id: tenantId,
                        plan_id: planId,
                        status: platformStatus,
                        billing_period: billingPeriod,
                        stripe_subscription_id: stripeSubId,
                        stripe_customer_id: stripeCustId,
                        updated_at: now,
                      },
                      { onConflict: "tenant_id,stripe_subscription_id" },
                    )
                    .select("id");

                  if (subErr) {
                    logStep("Platform subscription: upsert failed", {
                      sessionId: session.id,
                      tenantId,
                      error: subErr.message,
                    });
                  } else {
                    logStep("Platform subscription: written", {
                      sessionId: session.id,
                      tenantId,
                      status: platformStatus,
                      rows: upserted?.length ?? 0,
                    });

                    // Billing Foundation A: record the VERIFIED customer ↔ workspace mapping
                    // (design v2 §4.4). Never overwrites a different existing mapping — that is
                    // audited as a conflict for an operator. A failure here is logged and never
                    // undoes the subscription write above.
                    if (stripeCustId) {
                      const mapped = await upsertBillingAccount(supabaseAdmin, {
                        tenantId,
                        stripeCustomerId: stripeCustId,
                        stripeAccount: verifiedAccount === "v2" ? "v2" : "legacy",
                        source: "checkout",
                        actorUserId: actorUserId ?? null,
                      });
                      if (mapped.outcome !== "inserted" && mapped.outcome !== "already_mapped") {
                        logStep("Platform billing account: not mapped", { sessionId: session.id, tenantId, outcome: mapped.outcome, code: (mapped as { code?: string }).code ?? null });
                      }
                    }

                    // Mark a super-admin invite consumed (idempotent per sub;
                    // replay-safe). Best-effort — a consume failure must not undo the
                    // subscription. actor is the subscribing tenant admin.
                    const inviteTok = session.metadata.invite_token ?? null;
                    if (inviteTok && actorUserId) {
                      const { error: cErr } = await supabaseAdmin.rpc(
                        "consume_platform_invite",
                        {
                          _token: inviteTok,
                          _user_id: actorUserId,
                          _stripe_subscription_id: stripeSubId,
                        },
                      );
                      if (cErr) {
                        logStep("Platform subscription: invite consume failed", {
                          sessionId: session.id,
                          tenantId,
                          error: cErr.message,
                        });
                      }
                    }

                    // Entitlement bridge — flip a still-trial tenant live. Idempotent:
                    // the status='trial' predicate makes an already-active tenant a
                    // 0-row update.
                    const { error: tenantErr } = await supabaseAdmin
                      .from("tenants")
                      .update({ status: "active", updated_at: now })
                      .eq("id", tenantId)
                      .eq("status", "trial");
                    if (tenantErr) {
                      logStep("Platform subscription: tenant activate failed", {
                        sessionId: session.id,
                        tenantId,
                        error: tenantErr.message,
                      });
                    }
                  }
                }
              } else {
                // ── ONBOARDING (pay-before-workspace): PROVISION then subscribe ─────
                // A freshly-signed-up auth user paid before any workspace existed. The
                // signed metadata carries no tenant_id — so we provision the tenant +
                // owner role here (provision_tenant_as, a service-role explicit-owner
                // twin of provision_tenant with NO auth.uid() dependency), then upsert
                // the subscription onto the newly-provisioned tenant.
                if (!planId || !actorUserId || !stripeSubId) {
                  logStep("Platform subscription: onboarding missing signed identifiers", {
                    sessionId: session.id,
                    hasPlan: !!planId,
                    hasActor: !!actorUserId,
                    hasSub: !!stripeSubId,
                  });
                } else {
                  // ── task #66: read the STAGED signup_intake row ─────────────────
                  // The /onboarding step staged the buyer's business context + chosen
                  // plan + derived account_type + accepted agreement here BEFORE the
                  // Stripe hop. Provision the tenant from it so a paid customer gets the
                  // REAL name / industry / account_type + a logged agreement — never the
                  // old hardcoded null/standalone. Service role ⇒ RLS-exempt read.
                  // ── SECURITY (§9/§13): TIER is derived from the Stripe-SIGNED plan
                  //    slug ONLY — NEVER from signup_intake. signup_intake is a
                  //    client-writable row (RLS lets a user upsert their OWN row with
                  //    ANY account_type), so trusting intakeRow.account_type would let a
                  //    buyer pay the solo price with {plan_slug:solo, account_type:agency}
                  //    staged and get provisioned as agency. session.metadata.platform_
                  //    plan_slug is set by platform-subscription-checkout from the price
                  //    actually PAID — the only trustworthy tier. enterprise never reaches
                  //    here (checkout 400s non-self-serve); the map covers every live case.
                  const planSlugMeta = session.metadata.platform_plan_slug ?? "";
                  const derivedType =
                    planSlugMeta === "agency"
                      ? "agency"
                      : planSlugMeta === "enterprise"
                        ? "enterprise"
                        : "standalone";
                  const acctType = derivedType; // NEVER intakeRow.account_type.

                  // ── AGREEMENT (§9 compliance): derived from the TRUSTED tier and
                  //    ALWAYS written — never taken from the client-staged intakeRow.
                  //    Map tier → its saas-* subscriber-agreement slug (mirrors
                  //    WorkspaceProvisioner LANE_TO_AGREEMENT — no shared module is
                  //    reachable from an edge fn, §18), then resolve the CURRENT version
                  //    from legal_documents (the source of truth). provision_tenant_as
                  //    re-validates is_current before it logs the row. This guarantees a
                  //    subscriber-agreement acceptance is recorded for EVERY paid
                  //    provision — including a direct-checkout path with no intake row.
                  const LANE_TO_AGREEMENT: Record<string, string> = {
                    standalone: "saas-standalone",
                    agency: "saas-agency",
                    enterprise: "saas-enterprise",
                  };
                  const agreementSlug = LANE_TO_AGREEMENT[acctType] ?? "saas-standalone";
                  const { data: legalDoc } = await supabaseAdmin
                    .from("legal_documents")
                    .select("version")
                    .eq("slug", agreementSlug)
                    .eq("is_current", true)
                    .maybeSingle();
                  const agreementVersion =
                    (legalDoc as { version?: number } | null)?.version ?? null;
                  if (agreementVersion === null) {
                    // Honest degrade (§13): no current agreement doc ⇒ we cannot log the
                    // acceptance, but provisioning must not be blocked. Log loudly.
                    logStep("Platform subscription: no current agreement for tier", {
                      sessionId: session.id,
                      acctType,
                      agreementSlug,
                    });
                  }

                  // Read the staged intake row for BUSINESS CONTEXT ONLY (name / industry
                  // / team_size / who_you_help) — and ONLY when it belongs to THIS
                  // purchase: its staged plan_slug must match the signed plan slug AND it
                  // must be unconsumed. A stale row from a cancelled prior checkout, or a
                  // row staged for a different plan, is ignored entirely (fall back to
                  // the no-intake nulls). Service role ⇒ RLS-exempt read.
                  const { data: intakeRow } = await supabaseAdmin
                    .from("signup_intake")
                    .select(
                      "plan_slug, business_name, industry, team_size, who_you_help, consumed_at",
                    )
                    .eq("user_id", actorUserId)
                    .maybeSingle();
                  const intakeMatches =
                    !!intakeRow &&
                    intakeRow.plan_slug === planSlugMeta &&
                    intakeRow.consumed_at == null;
                  const ctx = intakeMatches ? intakeRow : null;

                  // §32 idempotent per owner: on a webhook replay provision_tenant_as
                  // returns the SAME top-level tenant (tenants_one_toplevel_per_owner),
                  // so the subscription upsert below simply no-ops. The extended RPC
                  // writes the subscriber-agreement legal_acceptances row idempotently
                  // (ON CONFLICT DO NOTHING) — a backstop for the accept-time frontend
                  // write, so terms are recorded even if that write failed.
                  const { data: provData, error: provErr } =
                    await supabaseAdmin.rpc("provision_tenant_as", {
                      _owner: actorUserId,
                      _name: ctx?.business_name ?? null,
                      _account_type: acctType,
                      _industry: ctx?.industry ?? null,
                      _team_size: ctx?.team_size ?? null,
                      _description: ctx?.who_you_help ?? null,
                      _agreement_slug: agreementSlug,
                      _agreement_version: agreementVersion,
                    });
                  // rpc returns the single tenants row; handle array/object defensively.
                  const tenantRow = Array.isArray(provData)
                    ? provData[0]
                    : provData;
                  if (provErr || !tenantRow?.id) {
                    // Do NOT upsert a subscription with a null tenant — log loudly and
                    // stop (§13/§32). The charge succeeded; a provisioning failure is a
                    // surfaced anomaly, not a silently-orphaned subscription row.
                    logStep("Platform subscription: onboarding provision failed", {
                      sessionId: session.id,
                      actorUserId,
                      error: provErr?.message ?? "provision_tenant_as returned no tenant",
                    });
                  } else {
                    const newTenantId = tenantRow.id as string;
                    // Idempotent: UNIQUE(tenant_id, stripe_subscription_id) on replay.
                    // tenant status is already 'active' from provision; owner
                    // membership + profiles.active_tenant_id are set there too.
                    const { data: upserted, error: subErr } = await supabaseAdmin
                      .from("platform_subscriptions")
                      .upsert(
                        {
                          tenant_id: newTenantId,
                          plan_id: planId,
                          status: platformStatus,
                          billing_period: billingPeriod,
                          stripe_subscription_id: stripeSubId,
                          stripe_customer_id: stripeCustId,
                          updated_at: now,
                        },
                        { onConflict: "tenant_id,stripe_subscription_id" },
                      )
                      .select("id");

                    if (subErr) {
                      logStep("Platform subscription: onboarding upsert failed", {
                        sessionId: session.id,
                        tenantId: newTenantId,
                        error: subErr.message,
                      });
                    } else {
                      logStep("Platform subscription: provisioned + written", {
                        sessionId: session.id,
                        tenantId: newTenantId,
                        actorUserId,
                        status: platformStatus,
                        rows: upserted?.length ?? 0,
                      });

                      // Billing Foundation A: the onboarding path is the dominant new-customer
                      // path, so the mapping is recorded here too (design v2 C4 — both sites).
                      if (stripeCustId && newTenantId) {
                        const mapped = await upsertBillingAccount(supabaseAdmin, {
                          tenantId: newTenantId,
                          stripeCustomerId: stripeCustId,
                          stripeAccount: verifiedAccount === "v2" ? "v2" : "legacy",
                          source: "checkout",
                          actorUserId: actorUserId ?? null,
                        });
                        if (mapped.outcome !== "inserted" && mapped.outcome !== "already_mapped") {
                          logStep("Platform billing account: not mapped", { sessionId: session.id, tenantId: newTenantId, outcome: mapped.outcome, code: (mapped as { code?: string }).code ?? null });
                        }
                      }

                      // task #66: mark the staged intake CONSUMED (audit trail, §13 —
                      // retained, not deleted). Only the row that MATCHED this purchase
                      // (same signed plan slug, unconsumed) is consumed — a stale/
                      // mismatched row is left untouched. Idempotent: the
                      // .is('consumed_at', null) predicate makes an already-consumed row
                      // a 0-row update on webhook replay.
                      if (intakeMatches) {
                        const { error: consumeErr } = await supabaseAdmin
                          .from("signup_intake")
                          .update({ consumed_at: now })
                          .eq("user_id", actorUserId)
                          .is("consumed_at", null);
                        if (consumeErr) {
                          logStep("Platform subscription: intake consume failed", {
                            sessionId: session.id,
                            actorUserId,
                            error: consumeErr.message,
                          });
                        }
                      }

                      // Mark a super-admin invite consumed. The provisioned owner IS
                      // actorUserId (provision_tenant_as(_owner: actorUserId)).
                      // Idempotent per sub; best-effort.
                      const inviteTok = session.metadata.invite_token ?? null;
                      if (inviteTok) {
                        const { error: cErr } = await supabaseAdmin.rpc(
                          "consume_platform_invite",
                          {
                            _token: inviteTok,
                            _user_id: actorUserId,
                            _stripe_subscription_id: stripeSubId,
                          },
                        );
                        if (cErr) {
                          logStep("Platform subscription: invite consume failed", {
                            sessionId: session.id,
                            tenantId: newTenantId,
                            error: cErr.message,
                          });
                        }
                      }
                    }
                  }
                }
              }
            } else {
              logStep("Platform subscription: skipped, not paid", {
                sessionId: session.id,
                payment_status: session.payment_status,
              });
            }
          } catch (platformErr) {
            // A platform-subscription failure must never 500 the webhook and block
            // other events. Log and swallow (§13 honest, non-throwing).
            logStep("Platform subscription handler error", {
              sessionId: session.id,
              error: String(platformErr),
            });
          }
          // IMPORTANT — do NOT fall through to slot / plan blocks.
          break;
        }

        // === Additional business slot purchase ===
        // Detect by metadata.purpose OR by matching the configured price ID.
        let isSlotPurchase =
          session.metadata?.purpose === "additional_business_slot";
        if (!isSlotPurchase && session.mode === "subscription" && session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(
              session.subscription as string,
            );
            const priceId = sub.items.data[0]?.price?.id;
            if (
              ADDITIONAL_BUSINESS_PRICE_ID &&
              priceId === ADDITIONAL_BUSINESS_PRICE_ID
            ) {
              isSlotPurchase = true;
            }
          } catch (e) {
            logStep("Slot detect: subscription retrieve failed", {
              error: String(e),
            });
          }
        }

        if (isSlotPurchase) {
          try {
            const customerId = session.customer as string;
            const customer = await stripe.customers.retrieve(customerId);
            const email = (customer as Stripe.Customer).email;
            const metaUserId = session.metadata?.paige_user_id ?? null;

            // Resolve user via metadata first, then email lookup
            let slotUser: { id: string; email?: string | null } | null = null;
            if (metaUserId) {
              const { data: u } = await supabaseAdmin.auth.admin.getUserById(
                metaUserId,
              );
              if (u?.user) slotUser = { id: u.user.id, email: u.user.email };
            }
            if (!slotUser && email) {
              const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
              const u = userData.users.find((x) => x.email === email);
              if (u) slotUser = { id: u.id, email: u.email };
            }

            if (!slotUser) {
              logStep("Slot purchase: user not found", { email, metaUserId });
              break;
            }

            // Increment additional_businesses_count by 1 (idempotent on
            // checkout.session.completed because Stripe only fires once per
            // checkout). Bootstrap row if missing using the plan's default.
            const { data: existing } = await supabaseAdmin
              .from("user_business_limits")
              .select("max_businesses, additional_businesses_count")
              .eq("user_id", slotUser.id)
              .maybeSingle();

            let nextMax = existing?.max_businesses ?? null;
            let nextAdd = (existing?.additional_businesses_count ?? 0) + 1;

            if (!existing) {
              const { data: subRow } = await supabaseAdmin
                .from("user_subscriptions")
                .select("plan_slug")
                .eq("user_id", slotUser.id)
                .maybeSingle();
              const { data: defaultMax } = await supabaseAdmin.rpc(
                "default_max_businesses_for_plan",
                { _plan_slug: subRow?.plan_slug ?? null },
              );
              nextMax = (defaultMax as number) ?? 1;
            }

            const { error: limitErr } = await supabaseAdmin
              .from("user_business_limits")
              .upsert(
                {
                  user_id: slotUser.id,
                  max_businesses: nextMax,
                  additional_businesses_count: nextAdd,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id" },
              );
            if (limitErr) {
              logStep("Slot purchase: limit upsert failed", {
                error: limitErr.message,
              });
            } else {
              logStep("Slot purchase: limit incremented", {
                user_id: slotUser.id,
                additional_businesses_count: nextAdd,
                effective_limit: (nextMax ?? 1) + nextAdd,
              });
            }

            // Audit log
            try {
              await supabaseAdmin.from("audit_logs").insert({
                user_id: slotUser.id,
                entity: "user_business_limits",
                action: "stripe_slot_purchased",
                entity_id: slotUser.id,
                data: {
                  stripe_session_id: session.id,
                  stripe_subscription_id: session.subscription,
                  additional_businesses_count: nextAdd,
                  effective_limit: (nextMax ?? 1) + nextAdd,
                },
              });
            } catch (e) {
              logStep("Slot purchase: audit log failed", { error: String(e) });
            }

            // Confirmation email
            if (slotUser.email) {
              try {
                await supabaseAdmin.functions.invoke(
                  "send-transactional-email",
                  {
                    body: {
                      templateName: "business-slot-added",
                      recipientEmail: slotUser.email,
                      recipientUserId: slotUser.id,
                      idempotencyKey: `slot-added-${session.id}`,
                      templateData: {
                        effectiveLimit: (nextMax ?? 1) + nextAdd,
                      },
                    },
                  },
                );
              } catch (e) {
                logStep("Slot purchase: email send failed", { error: String(e) });
              }
            }
          } catch (slotErr) {
            logStep("Slot purchase handler error", { error: String(slotErr) });
          }
          // IMPORTANT — do NOT fall through to plan upsert.
          break;
        }

        if (session.mode === "subscription") {
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;

          // Get customer email
          const customer = await stripe.customers.retrieve(customerId);
          const email = (customer as Stripe.Customer).email;

          if (!email) {
            throw new Error("No customer email found");
          }

          // Find user by email
          const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
          const user = userData.users.find(u => u.email === email);

          if (!user) {
            logStep("User not found for email", { email });
            break;
          }

          // Get subscription details
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const productId = subscription.items.data[0].price.product as string;

          // Update or insert subscription
          const { error: upsertError } = await supabaseAdmin
            .from("user_subscriptions")
            .upsert({
              user_id: user.id,
              stripe_subscription_id: subscriptionId,
              plan_slug: productId,
              status: "active",
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "user_id",
            });

          if (upsertError) {
            logStep("Error upserting subscription", { error: upsertError });
          } else {
            logStep("Subscription created/updated successfully");
          }

          // Analytics: subscription_started
          try {
            await supabaseAdmin.from("analytics_events").insert({
              user_id: user.id,
              event_name: "subscription_started",
              event_category: "revenue",
              properties: {
                tier: productId,
                amount_cents: session.amount_total || 0,
                currency: session.currency || "usd",
                stripe_subscription_id: subscriptionId,
              },
              page_path: "edge:stripe-webhook",
            });
          } catch (e) {
            logStep("analytics subscription_started insert failed", { error: String(e) });
          }

          // Attribute referral conversion (initial subscription payment)
          try {
            const amountCents = session.amount_total || 0;
            if (amountCents > 0) {
              const { data: convId, error: attrError } = await supabaseAdmin.rpc(
                "attribute_conversion",
                {
                  p_user_id: user.id,
                  p_stripe_customer_id: customerId,
                  p_stripe_sub_id: subscriptionId,
                  p_amount_cents: amountCents,
                  p_event_type: "initial",
                },
              );
              if (attrError) {
                logStep("Referral attribution error", { error: attrError.message });
              } else if (convId) {
                logStep("Referral conversion attributed", { convId });
                // Fire affiliate-conversion-earned email to the affiliate
                try {
                  await sendAffiliateConversionEmail(supabaseAdmin, convId as string, productId);
                } catch (e) {
                  logStep("Affiliate conversion email error", { error: String(e) });
                }
              }
            }
          } catch (attrErr) {
            logStep("Referral attribution exception", { error: String(attrErr) });
          }

          // Send payment confirmation email
          try {
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("full_name")
              .eq("user_id", user.id)
              .single();

            await supabaseAdmin.functions.invoke("send-payment-confirmation-email", {
              body: {
                planName: productId,
                amount: session.amount_total || 0,
                subscriptionEnd: new Date(subscription.current_period_end * 1000).toISOString(),
              },
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
            });
            logStep("Payment confirmation email sent");
          } catch (emailError) {
            logStep("Error sending payment confirmation email", { error: emailError });
          }
          // Broker→broker referral: if the new subscriber is a broker who signed up
          // via another broker's BROK code, write a 20%/12-month commission row.
          try {
            await maybeRecordBrokerReferralCommission(
              supabaseAdmin,
              user.id,
              subscriptionId,
              session.amount_total || 0,
            );
          } catch (brokerErr) {
            logStep("Broker→broker commission error", { error: String(brokerErr) });
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing customer.subscription.updated", { subscriptionId: subscription.id });

        // === Platform subscription lifecycle (B-Platform) ===
        // Discriminant: subscription.metadata.platform_plan_slug (set on
        // subscription_data at checkout). If present, this is a platform-subscription
        // lifecycle change — sync platform_subscriptions and short-circuit. Existing
        // user_subscriptions rows carry no platform_plan_slug, so they flow through
        // unchanged below (§9 — additive, never alters the existing arm).
        if (subscription.metadata?.platform_plan_slug) {
          const now = new Date().toISOString();
          try {
            // Read the period defensively: the pinned Stripe apiVersion (basil) moved
            // current_period_start/end off the Subscription object onto its items, so a
            // basil-shaped payload has them under items.data[0]. A bad/absent epoch must
            // NOT drop the status sync — build the update with status ALWAYS present and
            // only attach the period fields when they parse to a valid date.
            const item = subscription.items?.data?.[0] as
              | { current_period_start?: number; current_period_end?: number }
              | undefined;
            const startEpoch =
              item?.current_period_start ?? subscription.current_period_start;
            const endEpoch =
              item?.current_period_end ?? subscription.current_period_end;
            const toIso = (epoch: unknown): string | null => {
              const n = Number(epoch);
              if (!Number.isFinite(n) || n <= 0) return null;
              const d = new Date(n * 1000);
              return Number.isNaN(d.getTime()) ? null : d.toISOString();
            };
            const startIso = toIso(startEpoch);
            const endIso = toIso(endEpoch);
            const psUpdate: Record<string, unknown> = {
              status: subscription.status,
              cancel_at_period_end: subscription.cancel_at_period_end ?? false,
              updated_at: now,
            };
            if (startIso) psUpdate.current_period_start = startIso;
            if (endIso) psUpdate.current_period_end = endIso;
            const { error: psErr } = await supabaseAdmin
              .from("platform_subscriptions")
              .update(psUpdate)
              .eq("stripe_subscription_id", subscription.id);
            if (psErr) {
              logStep("Platform subscription: lifecycle update failed", {
                subscriptionId: subscription.id,
                error: psErr.message,
              });
            } else {
              logStep("Platform subscription: lifecycle updated", {
                subscriptionId: subscription.id,
                status: subscription.status,
              });
            }
          } catch (e) {
            logStep("Platform subscription: lifecycle update error", {
              subscriptionId: subscription.id,
              error: String(e),
            });
          }
          break;
        }

        // Detect tier change for `subscription_upgraded` event.
        let fromTier: string | null = null;
        try {
          const { data: existing } = await supabaseAdmin
            .from("user_subscriptions")
            .select("plan_slug, user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
          fromTier = existing?.plan_slug ?? null;
          const toTier = (subscription.items.data[0]?.price.product as string) ?? null;

          if (fromTier && toTier && fromTier !== toTier && existing?.user_id) {
            await supabaseAdmin.from("analytics_events").insert({
              user_id: existing.user_id,
              event_name: "subscription_upgraded",
              event_category: "revenue",
              properties: {
                from_tier: fromTier,
                to_tier: toTier,
                stripe_subscription_id: subscription.id,
              },
              page_path: "edge:stripe-webhook",
            });
          }
        } catch (e) {
          logStep("analytics subscription_upgraded insert failed", { error: String(e) });
        }

        const { error } = await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) {
          logStep("Error updating subscription", { error });
        } else {
          logStep("Subscription updated successfully");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing customer.subscription.deleted", { subscriptionId: subscription.id });

        // === Platform subscription cancellation (B-Platform) ===
        // Discriminant: subscription.metadata.platform_plan_slug. If present, mark the
        // platform_subscriptions row canceled and short-circuit. We do NOT touch
        // tenants.status on cancel — dunning/suspension is a follow-up surface.
        // Additive: user_subscriptions rows have no platform_plan_slug and flow through
        // unchanged below (§9).
        if (subscription.metadata?.platform_plan_slug) {
          const now = new Date().toISOString();
          try {
            const { error: psErr } = await supabaseAdmin
              .from("platform_subscriptions")
              .update({
                status: "canceled",
                cancel_at_period_end: true,
                updated_at: now,
              })
              .eq("stripe_subscription_id", subscription.id);
            if (psErr) {
              logStep("Platform subscription: cancel failed", {
                subscriptionId: subscription.id,
                error: psErr.message,
              });
            } else {
              logStep("Platform subscription: canceled", {
                subscriptionId: subscription.id,
              });
            }
          } catch (e) {
            logStep("Platform subscription: cancel error", {
              subscriptionId: subscription.id,
              error: String(e),
            });
          }
          break;
        }

        // Lookup user + tier before mutating, so we can fire analytics with context.
        try {
          const { data: existing } = await supabaseAdmin
            .from("user_subscriptions")
            .select("plan_slug, user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
          if (existing?.user_id) {
            await supabaseAdmin.from("analytics_events").insert({
              user_id: existing.user_id,
              event_name: "subscription_cancelled",
              event_category: "revenue",
              properties: {
                tier: existing.plan_slug,
                stripe_subscription_id: subscription.id,
                cancellation_reason: (subscription as unknown as { cancellation_details?: { reason?: string } }).cancellation_details?.reason ?? null,
              },
              page_path: "edge:stripe-webhook",
            });
          }
        } catch (e) {
          logStep("analytics subscription_cancelled insert failed", { error: String(e) });
        }

        const { error } = await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) {
          logStep("Error canceling subscription", { error });
        } else {
          logStep("Subscription canceled successfully");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        logStep("Processing invoice.payment_succeeded", { invoiceId: invoice.id });

        // Update subscription status to active on successful payment
        if (invoice.subscription) {
          const { error } = await supabaseAdmin
            .from("user_subscriptions")
            .update({
              status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", invoice.subscription as string);

          if (error) {
            logStep("Error updating subscription after payment", { error });
          } else {
            logStep("Subscription marked as active after payment");
          }

          // Attribute recurring referral commission (skip the very first invoice — handled by checkout.session.completed)
          try {
            const billingReason = (invoice as any).billing_reason as string | undefined;
            const isRecurring = billingReason === "subscription_cycle";
            const amountCents = invoice.amount_paid || 0;
            if (isRecurring && amountCents > 0) {
              const customerId = invoice.customer as string;
              const customer = await stripe.customers.retrieve(customerId);
              const email = (customer as Stripe.Customer).email;
              if (email) {
                const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
                const user = userData.users.find((u) => u.email === email);
                if (user) {
                  const { data: convId, error: attrError } = await supabaseAdmin.rpc(
                    "attribute_conversion",
                    {
                      p_user_id: user.id,
                      p_stripe_customer_id: customerId,
                      p_stripe_sub_id: invoice.subscription as string,
                      p_amount_cents: amountCents,
                      p_event_type: "recurring",
                    },
                  );
                  if (attrError) {
                    logStep("Recurring attribution error", { error: attrError.message });
                  } else if (convId) {
                    logStep("Recurring referral conversion attributed", { convId });
                    try {
                      // Best-effort plan name from subscription
                      let planName: string | undefined = undefined;
                      try {
                        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
                        planName = sub.items.data[0]?.price?.product as string | undefined;
                      } catch (_) { /* ignore */ }
                      await sendAffiliateConversionEmail(supabaseAdmin, convId as string, planName);
                    } catch (e) {
                      logStep("Affiliate conversion email error (recurring)", { error: String(e) });
                    }
                  }
                }
              }
            }
          } catch (attrErr) {
            logStep("Recurring attribution exception", { error: String(attrErr) });
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        logStep("Processing invoice.payment_failed", { invoiceId: invoice.id });

        // Update subscription status to past_due on failed payment
        if (invoice.subscription) {
          const { error } = await supabaseAdmin
            .from("user_subscriptions")
            .update({
              status: "past_due",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", invoice.subscription as string);

          if (error) {
            logStep("Error updating subscription after failed payment", { error });
          } else {
            logStep("Subscription marked as past_due");
          }
        }
        break;
      }

      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing customer.subscription.created", { subscriptionId: subscription.id });
        try {
          const activeStripe = verifiedAccount === "v2" ? stripeV2 : stripe;
          const customer = await activeStripe.customers.retrieve(subscription.customer as string);
          const email = (customer as Stripe.Customer).email;
          const priceId = subscription.items.data[0]?.price?.id ?? null;
          const tier = priceIdToTier(priceId) ?? "standard";
          if (email) {
            await upsertTierState(supabaseAdmin, {
              email,
              tier,
              paymentStatus: subscription.status === "active" ? "active" : subscription.status,
              source: "paige.stripe",
              stripeCustomerId: subscription.customer as string,
              stripeSubscriptionId: subscription.id,
              stripePriceId: priceId,
              stripeAccountId,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
              eventId: event.id,
              eventType: event.type,
            });
          }
        } catch (e) {
          logStep("subscription.created tier sync error", { error: String(e) });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        logStep("Processing invoice.paid", { invoiceId: invoice.id });
        try {
          const activeStripe = verifiedAccount === "v2" ? stripeV2 : stripe;
          const customerId = invoice.customer as string;
          const customer = await activeStripe.customers.retrieve(customerId);
          const email = (customer as Stripe.Customer).email;
          let priceId: string | null = null;
          let currentPeriodEnd: string | null = null;
          if (invoice.subscription) {
            const sub = await activeStripe.subscriptions.retrieve(invoice.subscription as string);
            priceId = sub.items.data[0]?.price?.id ?? null;
            currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
          }
          const tier = priceIdToTier(priceId) ?? "standard";
          if (email) {
            await upsertTierState(supabaseAdmin, {
              email,
              tier,
              paymentStatus: "active",
              source: "paige.stripe",
              stripeCustomerId: customerId,
              stripeSubscriptionId: (invoice.subscription as string) ?? null,
              stripePriceId: priceId,
              stripeAccountId,
              currentPeriodEnd,
              lastPaymentAt: new Date().toISOString(),
              eventId: event.id,
              eventType: event.type,
            });
          }
        } catch (e) {
          logStep("invoice.paid tier sync error", { error: String(e) });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        logStep("Processing charge.refunded", { chargeId: charge.id, amount: charge.amount_refunded });
        try {
          const activeStripe = verifiedAccount === "v2" ? stripeV2 : stripe;
          const customer = await activeStripe.customers.retrieve(charge.customer as string);
          const email = (customer as Stripe.Customer).email;
          // Full refund → downgrade to standard. Partial refund → log only.
          const isFullRefund = charge.amount_refunded >= charge.amount;
          if (email && isFullRefund) {
            await upsertTierState(supabaseAdmin, {
              email,
              tier: "standard",
              paymentStatus: "canceled",
              source: "paige.stripe",
              stripeCustomerId: charge.customer as string,
              stripeAccountId,
              eventId: event.id,
              eventType: event.type,
            });
          } else if (email) {
            // Partial refund: still write an audit log for compliance.
            await supabaseAdmin.from("audit_logs").insert({
              event_type: "stripe.charge.refunded.partial",
              metadata: {
                email,
                amount: charge.amount,
                amount_refunded: charge.amount_refunded,
                stripe_charge_id: charge.id,
                stripe_event_id: event.id,
              },
            });
          }
        } catch (e) {
          logStep("charge.refunded tier sync error", { error: String(e) });
        }
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    // Mark event as processed (idempotency log close-out)
    try {
      await supabaseAdmin
        .from("stripe_event_log")
        .update({ processed_at: new Date().toISOString() })
        .eq("event_id", event.id);
    } catch (_) { /* non-fatal */ }


    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    logStep("ERROR in webhook handler", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
