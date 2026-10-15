import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync(
  "supabase/functions/solo-beta-subscription-checkout/index.ts",
  "utf8",
);
const webhook = readFileSync(
  "supabase/functions/solo-beta-stripe-webhook/index.ts",
  "utf8",
);
const sender = readFileSync(
  "supabase/functions/send-transactional-email/index.ts",
  "utf8",
);
const status = readFileSync(
  "supabase/functions/solo-beta-enrollment-status/index.ts",
  "utf8",
);
const registry = readFileSync(
  "supabase/functions/_shared/transactional-email-templates/registry.ts",
  "utf8",
);
const template = readFileSync(
  "supabase/functions/_shared/transactional-email-templates/solo-beta-welcome.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20270203000000_solo_beta_welcome_lifecycle.sql",
  "utf8",
);
const drainer = readFileSync(
  "supabase/functions/solo-beta-welcome-drainer/index.ts",
  "utf8",
);
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

describe("Solo Beta dynamic payment methods and verified welcome", () => {
  it("leaves payment-method eligibility to hosted Stripe Checkout", () => {
    const create = checkout.slice(
      checkout.indexOf("stripe.checkout.sessions.create"),
      checkout.indexOf(
        "idempotencyKey:",
        checkout.indexOf("stripe.checkout.sessions.create"),
      ),
    );
    expect(create).toContain('mode: "subscription"');
    expect(create).toContain('payment_method_collection: "always"');
    expect(create).toContain(
      "line_items: [{ price: offer.stripe_price_id, quantity: 1 }]",
    );
    expect(create).not.toMatch(/\bpayment_method_types\s*:/);
    expect(create).not.toMatch(/\bpayment_method_options\s*:/);
    expect(create).not.toMatch(/\bexcluded_payment_method_types\s*:/);
    expect(create).not.toMatch(/\bautomatic_payment_methods\s*:/);
  });

  it("creates the welcome intent atomically from exactly one fulfillment receipt", () => {
    expect(migration).toContain(
      "AFTER INSERT ON public.solo_beta_fulfillment_receipts",
    );
    expect(migration).toContain("NEW.outcome <> 'completed'");
    expect(migration).toContain("fulfillment_event_id text NOT NULL UNIQUE");
    expect(migration).toContain("user_id uuid NOT NULL UNIQUE");
    expect(migration).toContain(
      "ON CONFLICT (fulfillment_event_id) DO NOTHING",
    );
  });

  it("keeps the welcome outbox and delivery functions service-only", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON public\.solo_beta_welcome_deliveries FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.solo_beta_claim_welcome_delivery(text) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.solo_beta_complete_welcome_delivery(uuid,uuid,text) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.solo_beta_fail_welcome_delivery(uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("IF auth.role() <> 'service_role'");
  });

  it("re-derives a verified live Solo owner context before exposing recipient or destination", () => {
    for (const proof of [
      "r.outcome='completed'",
      "e.state='fulfilled'",
      "s.offer_code='paige-solo-beta-monthly-v1'",
      "s.provider_mode='live'",
      "s.provider_verified_at IS NOT NULL",
      "s.status IN ('trialing','active')",
      "m.is_owner=true",
      "m.status='active'",
      "t.account_type='standalone'",
      "t.parent_tenant_id IS NULL",
    ])
      expect(migration).toContain(proof);
    const special = sender.slice(
      sender.indexOf("if (templateName === 'solo-beta-welcome')"),
      sender.indexOf("if (!templateName)"),
    );
    expect(special).toContain(
      "const destination = publicSite + '/solo/' + claim.account_number + '/command-center'",
    );
    // The refusal floor receives only the verified claim, never request-authored scope.
    const withoutClaimBoundScope = special
      .replace(/recipientEmail:\s*claim\.recipient_email/g, "")
      .replace(/tenantId:\s*claim\.tenant_id/g, "");
    expect(withoutClaimBoundScope).not.toContain("recipientEmail");
    expect(withoutClaimBoundScope).not.toContain("tenantId");
  });

  it("sends only after fulfillment and retries completed Stripe events idempotently", () => {
    const fulfillment = webhook.indexOf(
      'admin.rpc("solo_beta_fulfill_checkout"',
    );
    const send = webhook.indexOf("await deliverVerifiedWelcome", fulfillment);
    expect(fulfillment).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(fulfillment);
    expect(webhook).toMatch(
      /lifecycle_state === "completed"[\s\S]+deliverVerifiedWelcome/,
    );
    expect(webhook).not.toMatch(
      /checkout\.session\.expired[\s\S]{0,900}deliverVerifiedWelcome/,
    );
    expect(webhook).toMatch(
      /if \(!response\.ok\) throw new Error\(["']welcome_delivery_failed["']\)/,
    );
  });

  it("uses a stable provider idempotency key and fails ambiguous outcomes closed", () => {
    expect(sender).toContain("'Idempotency-Key': messageId");
    expect(sender).toContain(".upsert({");
    expect(sender).toContain("{ onConflict: 'message_id' }");
    expect(sender).toContain(
      "await failClaim('provider_outcome_ambiguous', true)",
    );
    expect(sender).toContain("await failClaim('send_log_commit_failed', true)");
    expect(migration).toContain("ambiguous_delivery_window_expired");
    expect(migration).toContain("attempt_count>=5");
    expect(migration).toContain("'needs_attention'");
  });

  it("durably re-drives due and abandoned welcome attempts through the same sender", () => {
    expect(drainer).toContain('admin.rpc("verify_cron_token"');
    expect(drainer).toContain('.in("state", ["pending", "retryable_failure"])');
    expect(drainer).toContain('.eq("state", "sending")');
    expect(drainer).toContain('templateName: "solo-beta-welcome"');
    expect(drainer).toContain("fulfillmentEventId: eventId");
    expect(migration).toContain("'solo-beta-welcome-drain'");
    expect(migration).toContain("public.cron_token_header()");
    expect(supabaseConfig).toMatch(
      /\[functions\.solo-beta-welcome-drainer\]\s+verify_jwt = false/,
    );
  });

  it("renders billing copy from the freshly verified subscription state", () => {
    expect(migration).toContain("t.account_number,s.status,s.trial_ends_at");
    expect(sender).toContain("subscriptionStatus: claim.subscription_status");
    expect(sender).toContain("trialEndsAt: claim.trial_ends_at");
    expect(template).toContain('subscriptionStatus === "active"');
    expect(template).toContain(
      "Your subscription is active at $74.50 per month.",
    );
    expect(template).toContain("Your 30-day trial is active");
  });
  it("never sends the historical generic welcome at agreement acceptance", () => {
    const finalizerStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.record_signup_acceptance",
    );
    const finalizer = migration.slice(
      finalizerStart,
      migration.indexOf(
        "REVOKE ALL ON FUNCTION public.record_signup_acceptance",
        finalizerStart,
      ),
    );
    /* original-slice-marker */ const removed = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION public.record_signup_acceptance",
      ),
    );
    expect(finalizer).not.toContain("net.http_post");
    expect(finalizer).not.toContain("'welcome'");
    expect(finalizer).toContain("legal_acceptances");
  });

  it("registers truthful transactional copy without claiming an immediate charge", () => {
    expect(registry).toContain("'solo-beta-welcome': soloBetaWelcome");
    expect(template).toContain("Your 30-day trial is active");
    expect(template).toContain("$74.50 per");
    expect(template).toMatch(
      /unless you cancel\s+before your first paid renewal/,
    );
    expect(template).toContain("does not claim");
    expect(template).toMatch(/category: ["']transactional["']/);
    expect(template).not.toContain("on autopilot");
  });

  it("returns only a safe delivery state alongside verified enrollment", () => {
    expect(status).toContain('admin.from("solo_beta_welcome_deliveries")');
    expect(status).toContain("welcome_delivery: welcomeDelivery");
    expect(status).not.toContain("provider_message_id");
    expect(status).not.toContain("recipient_email");
  });
});
