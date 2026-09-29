// affiliate-application-confirm — the "we received your application" email for the public affiliate
// form (/affiliates), which anyone can submit without an account.
//
// This used to be sent by the browser calling send-transactional-email directly with the publishable
// key, which is what left that function open to anyone. The send function now refuses unauthenticated
// callers, so the one legitimately anonymous email moves here, where what is sent is fixed and bounded:
//   * only for an application that exists and was submitted in the last 15 minutes;
//   * only to the address stored on that application, never one named in the request;
//   * only the `affiliate-application-received` template, with data read from the row;
//   * at most once per application, once a day per address, and a platform-wide hourly ceiling,
//     so the form cannot be turned into a way to mail strangers from the platform's domain.
// It then calls send-transactional-email as an internal caller (service role).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";

const TEMPLATE = "affiliate-application-received";
const FRESH_MS = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstNameOnly(fullName: unknown): string | null {
  const first = String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'-]{0,39}$/u.test(first) ? first : null;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let applicationId = "";
  try {
    const body = await req.json();
    applicationId = String(body?.applicationId ?? "");
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!UUID.test(applicationId)) return json(400, { error: "application_required" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  // Per-IP ceiling first, so junk ids cannot be sprayed at the table. Every limiter fails CLOSED: when
  // it errors, no mail goes.
  if (await overRateLimit(admin, `aff-confirm:ip:${trustedClientIp(req)}`, 5, 3600, true)) {
    return json(429, { error: "rate_limited" });
  }

  const { data: app, error: appErr } = await admin
    .from("affiliate_applications")
    .select("id, email, full_name, requested_tier_key, created_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (appErr) return json(503, { error: "application_lookup_failed" });
  // One answer for "no such application" and "too old", so the endpoint cannot be used to probe ids.
  if (!app || Date.now() - new Date(app.created_at).getTime() > FRESH_MS) {
    return json(404, { error: "application_not_found" });
  }

  const email = String(app.email ?? "").trim().toLowerCase();
  if (!email) return json(404, { error: "application_not_found" });

  const idempotencyKey = `aff-app-received-${app.id}`;
  const { data: prior, error: priorErr } = await admin
    .from("email_send_log")
    .select("message_id")
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["pending", "sent"])
    .limit(1);
  if (priorErr) return json(503, { error: "send_log_lookup_failed" });
  if ((prior ?? []).length > 0) return json(200, { success: true, duplicate: true });

  // Counted only for a real, fresh, not-yet-confirmed application: once a day per address, and a
  // platform-wide hourly ceiling that junk requests cannot use up.
  if (await overRateLimit(admin, `aff-confirm:to:${email}`, 1, 86400, true)) {
    return json(429, { error: "rate_limited" });
  }
  if (await overRateLimit(admin, "aff-confirm:all", 30, 3600, true)) {
    return json(429, { error: "rate_limited" });
  }

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      templateName: TEMPLATE,
      recipientEmail: email,
      // No recipientUserId: the applicant sets user_id on their own row, and the sender would
      // take that account's tenant name and reply-to for this mail.
      idempotencyKey,
      templateData: {
        // The applicant typed this; only a plain first name reaches the email, never a link.
        name: firstNameOnly(app.full_name),
        tierKey: app.requested_tier_key,
      },
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[affiliate-application-confirm] send failed", { status: res.status, error: out?.error });
    return json(502, { error: "send_failed" });
  }
  return json(200, { success: true, sent: out?.sent === true });
});
