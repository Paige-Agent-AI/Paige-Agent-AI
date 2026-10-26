// Apollo.io company enrichment by domain.
// Body: { domain: string }
import { adminClient, corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
// EXP08 stage 0: a platform resource, so the Platform Operator only (§53) — not the global
// `admin` row that every workspace owner carries. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const apolloKey = Deno.env.get("APOLLO_API_KEY");
  if (!apolloKey) return jsonResponse({ error: "apollo_not_configured" }, 500);

  const { domain } = (await req.json().catch(() => ({}))) ?? {};
  if (!domain) return jsonResponse({ error: "missing_domain" }, 400);

  const admin = adminClient();
  const res = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { "Cache-Control": "no-cache", "x-api-key": apolloKey },
  });
  const text = await res.text();
  const payload = (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })();

  await admin.from("paige_enrichment_log").insert({
    subject_type: "company",
    subject_key: domain,
    provider: "apollo",
    payload,
    succeeded: res.ok,
    error: res.ok ? null : `apollo_${res.status}: ${text.slice(0, 300)}`,
  });

  if (!res.ok) return jsonResponse({ error: `apollo_${res.status}` }, 502);
  return jsonResponse({ ok: true, organization: payload?.organization ?? null });
});
