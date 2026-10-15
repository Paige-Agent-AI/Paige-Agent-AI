// Edge function: proxy to MMA OS bridge for campaign reads.
// Centralizes auth header injection so the React app never needs the bearer.
// Verbs: list_active_campaigns, get_campaign_detail, list_contact_enrollments,
// enroll_contact_manual, exit_contact_from_campaign, get_campaign_metrics

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_VERBS = new Set([
  "list_active_campaigns",
  "get_campaign_detail",
  "list_contact_enrollments",
  "enroll_contact_manual",
  "exit_contact_from_campaign",
  "get_campaign_metrics",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const verb = String(body?.verb ?? "");
    if (!ALLOWED_VERBS.has(verb)) {
      return json({ error: `Unknown verb: ${verb}` }, 400);
    }

    const baseUrl = Deno.env.get("PAIGE_OS_BRIDGE_URL");
    const apiKey = Deno.env.get("PAIGE_OS_BRIDGE_API_KEY");

    if (!baseUrl || !apiKey) {
      // Graceful fallback so UI can render shape even before MMA OS ships v15.
      return json({
        ok: true,
        stub: true,
        message: "PAIGE_OS_BRIDGE_URL / PAIGE_OS_BRIDGE_API_KEY not configured yet",
        data: stubFor(verb),
      });
    }

    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/${verb}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body?.payload ?? {}),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function stubFor(verb: string): unknown {
  if (verb === "list_active_campaigns") return { campaigns: [] };
  if (verb === "get_campaign_detail") return { campaign: null, content: [], recent_enrollments: [] };
  if (verb === "list_contact_enrollments") return { enrollments: [] };
  if (verb === "get_campaign_metrics") return { open_rate: 0, click_rate: 0, completion_rate: 0, churn_rate: 0, series: [] };
  return { ok: true };
}
