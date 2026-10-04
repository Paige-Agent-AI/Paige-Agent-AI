// Edge function: proxy to MMA OS bridge v15 for member-journey reads.
// Verbs: get_journey, set_journey_stage, auto_compute_stage
// Returns a graceful stub when PAIGE_OS_BRIDGE_URL/KEY are not configured so the
// Paige UI can render its shell.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_VERBS = new Set([
  "get_journey",
  "set_journey_stage",
  "auto_compute_stage",
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
  if (verb === "get_journey") return { events: [], stage: null };
  if (verb === "auto_compute_stage") return { stage_slug: null };
  return { ok: true };
}
