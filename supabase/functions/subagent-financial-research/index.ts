// Sub-Agent: Financial Research Agent — DEPRECATED SHIM (#165/#166).
//
// This function no longer synthesizes anything itself. It forwards to the universal,
// cited, anti-fabrication engine `paige-deep-research` with the opaque `domain:"funding"`
// hint (an opt-in caller — never a platform default, §2). The old single-LLM path and its
// hardcoded vertical system prompt were removed: no fact is ever produced here without
// cited, reliability-ranked sources that survived the engine's deterministic gate (§13).
//
// The Deno.serve handler + response shape are kept so existing importers/callers don't break;
// results now carry real citations and honest degraded states straight from the engine.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function ok(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // This deprecated compatibility handler is not a public delegation door.
  // Canonical customer research binds its ordinary caller at paige-deep-research.
  // Never upgrade an ordinary caller's asserted actor to service authority here.
  const bearer = req.headers.get("Authorization")?.trim().match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!SERVICE_KEY || bearer !== SERVICE_KEY) {
    return ok({ ok: false, error: "Research compatibility access could not be verified." }, 401);
  }

  let payload: {
    input?: { lender?: string; product?: string; question?: string; limit?: number };
    user_id?: string;
    client_user_id?: string | null;
  } = {};
  try { payload = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }
  const input = payload.input ?? {};

  const subject = input.question ?? input.lender ?? input.product ?? "";
  if (!subject) return ok({ ok: false, error: "lender, product, or question required" }, 400);

  const userId = payload.user_id ?? (payload as any).input?.user_id;
  if (!userId) return ok({ ok: false, error: "user_id is required (forwarded to paige-deep-research)" }, 400);

  // Forward to the engine. domain:"funding" is an opt-in hint (this is the funding caller);
  // the engine treats it as an opaque string. persist:false — this path is ephemeral.
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/paige-deep-research`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      question: subject,
      user_id: userId,
      client_user_id: payload.client_user_id ?? null,
      domain: "funding",
      caller: "lender-research",
      max_hops: 2,
      strict: true,
      persist: false,
    }),
  });

  const dr = await resp.json().catch(() => null) as
    | {
        run_id: string;
        findings: Array<{ text: string; citations: number[]; confidence: string; unverifiedFields?: string[] }>;
        sources: Array<{ index: number; url: string; title: string; snippet: string; excluded: boolean; reliability: string }>;
        coverage: { stop_reason: string; note: string; configured: boolean };
      }
    | null;

  if (!dr || !resp.ok) {
    return ok({
      ok: false,
      subagent: "financial-research",
      deprecated: true,
      forwarded_to: "paige-deep-research",
      error: "Deep-research engine unavailable.",
    }, 502);
  }

  // Map engine output back to the legacy response shape. Every fact here is cited or absent.
  const citable = (dr.sources ?? []).filter((s) => !s.excluded);
  const brief = dr.findings.length
    ? dr.findings.map((f) => `• ${f.text} ${f.citations.map((c) => `[${c}]`).join("")} (${f.confidence})`).join("\n")
    : "";
  const summary = !dr.coverage.configured
    ? "Live research is not connected — no sources could be gathered, so nothing was produced."
    : dr.findings.length
      ? `Researched "${subject}" across ${citable.length} verified source(s). Verify details directly before acting.`
      : `Searched "${subject}" but found no source that survived verification. Reporting nothing rather than an unverified claim.`;

  return ok({
    ok: true,
    subagent: "financial-research",
    deprecated: true,
    forwarded_to: "paige-deep-research",
    run_id: dr.run_id,
    subject,
    summary,
    brief,
    findings: dr.findings,
    sources: citable.map((s) => ({ title: s.title, description: s.snippet, url: s.url })),
    verification_required: true,
    configured: dr.coverage.configured,
    confidence: dr.findings.length >= 3 ? "medium" : "low",
    requires_approval: false,
  });
});
