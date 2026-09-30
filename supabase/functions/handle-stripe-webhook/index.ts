// Stripe webhook: subscription + invoice events → paige_subscription_events
// Updates clients.tier and enqueues bridge verb tier_change_notify.
// Public function — relies on Stripe signature verification.
import Stripe from "https://esm.sh/stripe@18.5.0";
import { adminClient, corsHeaders } from "../_shared/adminAuth.ts";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import { findSoleClientByEmailAnyWorkspace } from "../_shared/contact-methods.ts";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!stripeKey || !webhookSecret) {
    return new Response(JSON.stringify({ error: "stripe_not_configured" }), { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (e) {
    return new Response(`invalid signature: ${(e as Error).message}`, { status: 400 });
  }

  const admin = adminClient();

  // Idempotency check
  const existing = await admin.from("paige_subscription_events").select("id").eq("stripe_event_id", event.id).maybeSingle();
  if (existing.data) return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });

  // Resolve tier map
  const cfg = await admin.from("paige_config").select("stripe_price_tier_map").eq("id", 1).maybeSingle();
  const priceTierMap = (cfg.data?.stripe_price_tier_map ?? {}) as Record<string, string>;

  let customerId: string | null = null;
  let tierBefore: string | null = null;
  let tierAfter: string | null = null;
  let mrrDelta = 0;

  const handled = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
  if (!handled.includes(event.type)) {
    await admin.from("paige_subscription_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
      raw: event as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
  }

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const priceId = sub.items?.data?.[0]?.price?.id ?? "";
    tierAfter = event.type === "customer.subscription.deleted" ? null : (priceTierMap[priceId] ?? null);
    const amount = sub.items?.data?.[0]?.price?.unit_amount ?? 0;
    if (event.type === "customer.subscription.created") mrrDelta = amount;
    else if (event.type === "customer.subscription.deleted") mrrDelta = -amount;
  } else if (event.type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice;
    customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  }

  // Resolve contact (clients table has no `tier` column — tier state lives in tier_state)
  let contactId: string | null = null;
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    const email = (customer as Stripe.Customer).email;
    if (email) {
      contactId = (await findSoleClientByEmailAnyWorkspace(admin, email, "handle-stripe-webhook"))?.id ?? null;
    }
  }

  await admin.from("paige_subscription_events").insert({
    stripe_event_id: event.id,
    stripe_customer_id: customerId,
    contact_id: contactId,
    event_type: event.type,
    tier_before: tierBefore,
    tier_after: tierAfter,
    mrr_delta_cents: mrrDelta,
    raw: event as unknown as Record<string, unknown>,
    processed_at: new Date().toISOString(),
  });

  // Notify MMA OS — tier_change_notify fires the cross-system tier router
  if (event.type.startsWith("customer.subscription.")) {
    fireAndForgetBridge("tier_change_notify", {
      contact_id: contactId,
      tier_before: tierBefore,
      tier_after: tierAfter,
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
      mrr_delta_cents: mrrDelta,
    });
  }

  return new Response(JSON.stringify({ ok: true, type: event.type }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
