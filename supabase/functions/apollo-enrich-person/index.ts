// Apollo.io person enrichment by email.
// Body: { email: string, contact_id?: string, source?: string }
// Public (no admin guard) because it is invoked by a DB trigger via anon key.
// Internal trigger header skips the operator check; manual calls require the Platform Operator.
import { adminClient, corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
// EXP08 stage 0: a platform resource, so the Platform Operator only (§53) — not the global
// `admin` row that every workspace owner carries. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal = serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`;
  if (!isInternal) {
    const guard = await requireOperator(req);
    if (!guard.ok) return guard.response;
  }

  const apolloKey = Deno.env.get("APOLLO_API_KEY");
  if (!apolloKey) return jsonResponse({ error: "apollo_not_configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const { email, contact_id = null } = body ?? {};
  if (!email) return jsonResponse({ error: "missing_email" }, 400);

  const admin = adminClient();

  try {
    const res = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apolloKey,
      },
      body: JSON.stringify({ email, reveal_personal_emails: false }),
    });
    const text = await res.text();
    const payload = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();

    await admin.from("paige_enrichment_log").insert({
      subject_type: "person",
      subject_key: email,
      contact_id,
      provider: "apollo",
      payload,
      succeeded: res.ok,
      error: res.ok ? null : `apollo_${res.status}: ${text.slice(0, 300)}`,
    });

    if (!res.ok) return jsonResponse({ ok: false, error: `apollo_${res.status}` }, 200);
    return jsonResponse({ ok: true, person: payload?.person ?? null });
  } catch (e) {
    await admin.from("paige_enrichment_log").insert({
      subject_type: "person",
      subject_key: email,
      contact_id,
      provider: "apollo",
      payload: {},
      succeeded: false,
      error: `exception: ${(e as Error).message}`.slice(0, 300),
    });
    return jsonResponse({ ok: false, error: "exception" }, 200);
  }
});
