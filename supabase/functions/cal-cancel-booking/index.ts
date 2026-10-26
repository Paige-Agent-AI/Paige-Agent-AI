// Cancel a Cal.com booking and mark our row canceled.
// Body: { cal_event_id: string, reason?: string }
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
// EXP08 stage 0: a platform resource, so the Platform Operator only (§53) — not the global
// `admin` row that every workspace owner carries. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const apiKey = Deno.env.get("CAL_API_KEY");
  if (!apiKey) return jsonResponse({ error: "cal_not_configured" }, 500);
  const base = Deno.env.get("CAL_BASE_URL") || "https://api.cal.com/v1";

  const body = await req.json().catch(() => ({}));
  const { cal_event_id, reason } = body ?? {};
  if (!cal_event_id) return jsonResponse({ error: "missing_cal_event_id" }, 400);

  const res = await fetch(`${base}/bookings/${cal_event_id}/cancel?apiKey=${apiKey}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? "Canceled by admin" }),
  });
  const text = await res.text();
  if (!res.ok) return jsonResponse({ error: `cal_${res.status}`, detail: text.slice(0, 500) }, 502);

  await guard.admin.from("paige_bookings").update({ status: "canceled" }).eq("cal_event_id", cal_event_id);
  return jsonResponse({ ok: true });
});
