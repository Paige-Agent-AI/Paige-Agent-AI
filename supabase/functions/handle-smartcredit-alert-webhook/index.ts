// SmartCredit alerts webhook — appends to latest snapshot and fires
// funding_readiness_assessed bridge verb. JWT verification disabled; HMAC required.
import { corsHeaders } from "../_shared/adminAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import { findSoleClientByEmailAnyWorkspace } from "../_shared/contact-methods.ts";
import { verifyHmacSha256Hex } from "../_shared/webhookSig.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const rawBody = await req.text();
  const secret = Deno.env.get("SMARTCREDIT_WEBHOOK_SECRET");
  const sig = req.headers.get("x-smartcredit-signature") ?? "";
  if (!secret) return new Response("missing_secret", { status: 500 });
  const ok = await verifyHmacSha256Hex(secret, rawBody, sig);
  if (!ok) return new Response("bad_signature", { status: 401 });

  const event = JSON.parse(rawBody);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const contactEmail = event.email as string | undefined;
  if (!contactEmail) return new Response("no_email", { status: 200 });

  const contact = await findSoleClientByEmailAnyWorkspace(admin, contactEmail, "handle-smartcredit-alert-webhook");
  if (!contact) return new Response("no_contact", { status: 200 });

  const { data: latest } = await admin
    .from("paige_owner_credit_snapshots")
    .select("id, alerts_triggered, score")
    .eq("contact_id", contact.id)
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const alerts = Array.isArray(latest.alerts_triggered) ? [...latest.alerts_triggered] : [];
    alerts.push({ at: new Date().toISOString(), ...event });
    await admin
      .from("paige_owner_credit_snapshots")
      .update({ alerts_triggered: alerts })
      .eq("id", latest.id);
  }

  fireAndForgetBridge("funding_readiness_assessed", {
    contact_id: contact.id,
    composite_score: latest?.score ?? null,
    components: { smartcredit: { event: event.type, severity: event.severity } },
    recommended_lane: "review",
  });

  return new Response("ok", { headers: corsHeaders, status: 200 });
});
