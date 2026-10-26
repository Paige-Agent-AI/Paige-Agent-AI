// Admin proxy: list Cal.com bookings.
// Query: status?, eventTypeId?, take?, page?
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
// EXP08 stage 0: a platform resource, so the Platform Operator only (§53) — not the global
// `admin` row that every workspace owner carries. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const apiKey = Deno.env.get("CAL_API_KEY");
  if (!apiKey) return jsonResponse({ error: "cal_not_configured" }, 500);
  const base = Deno.env.get("CAL_BASE_URL") || "https://api.cal.com/v1";

  const url = new URL(req.url);
  const params = new URLSearchParams({ apiKey });
  for (const k of ["status", "eventTypeId", "take", "page"]) {
    const v = url.searchParams.get(k);
    if (v) params.set(k, v);
  }

  const res = await fetch(`${base}/bookings?${params}`);
  const text = await res.text();
  if (!res.ok) return jsonResponse({ error: `cal_${res.status}`, detail: text.slice(0, 500) }, 502);
  return new Response(text, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
