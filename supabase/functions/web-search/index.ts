// Paige admin web search — Firecrawl-backed (Tavily deprecated per Doctrine §88).
// Body: { query: string, limit?: number }
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
// EXP08 stage 0: a platform resource, so the Platform Operator only (§53) — not the global
// `admin` row that every workspace owner carries. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query || query.length < 2 || query.length > 500) {
    return jsonResponse({ error: "invalid_query", detail: "Provide 2-500 characters." }, 400);
  }
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 5), 10));

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return jsonResponse({ error: "firecrawl_not_configured" }, 500);

  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    return jsonResponse(
      { error: `firecrawl_${res.status}`, detail: (await res.text()).slice(0, 500) },
      502,
    );
  }
  const data = await res.json();
  // Firecrawl v2: { success, data: { web: [...] } } — also handle older shapes
  let raw: Array<{ title?: string; description?: string; url?: string }> = [];
  if (Array.isArray(data?.data?.web)) raw = data.data.web;
  else if (Array.isArray(data?.data)) raw = data.data;
  else if (Array.isArray(data?.web)) raw = data.web;
  else if (Array.isArray(data?.results)) raw = data.results;

  const results = raw
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url, description: r.description ?? "", url: r.url }));

  return jsonResponse({ ok: true, query, results });
});
