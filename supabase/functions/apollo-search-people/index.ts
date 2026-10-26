// Apollo.io prospect search proxy.
// Body: { q?: string, titles?: string[], company_domains?: string[], page?: number, per_page?: number }
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
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

  const body = (await req.json().catch(() => ({}))) ?? {};
  const search: Record<string, unknown> = {
    page: body.page ?? 1,
    per_page: Math.min(body.per_page ?? 25, 100),
  };
  if (body.q) search.q_keywords = body.q;
  if (Array.isArray(body.titles) && body.titles.length) search.person_titles = body.titles;
  if (Array.isArray(body.company_domains) && body.company_domains.length) {
    search.q_organization_domains = body.company_domains.join("\n");
  }

  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apolloKey,
    },
    body: JSON.stringify(search),
  });
  const text = await res.text();
  if (!res.ok) return jsonResponse({ error: `apollo_${res.status}`, detail: text.slice(0, 500) }, 502);
  return new Response(text, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
