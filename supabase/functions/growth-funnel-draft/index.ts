// growth-funnel-draft — Paige's whole-funnel generator (Vibe Studio, CLAUDE.md §18/§19).
//
// A funnel is a COMPOSITION problem, not a lesser feature (§19): multiple pages + a form +
// a sequence between them. So this function does NOT re-implement page/form drafting — it
// PLANS the funnel from one brief, then calls the two drafters that already exist
// (growth-page-draft, growth-form-draft) server-to-server and stitches their results into
// one complete drafted funnel (§12 — reuse, never fork). PURE DRAFT: this function writes
// NOTHING to the database. Persisting the pages/form/funnel rows is the caller's job
// (studio.ts buildFunnelFromDraft → savePageDraft/saveForm/saveFunnel), exactly like
// growth-page-draft hands blocks back for savePageDraft to persist.
//
// The v1 shape mirrors the funnel model the manual FunnelMode already builds — an entry
// landing PAGE, an intake FORM, and a thank-you — so a funnel drafted here and a funnel
// built by hand are the same three-step object, just one arrived from a brief (§18/§19).
// Multi-page sequences (upsell/webinar/multi-step) are the tracked fast-follow, not skipped.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//
//   Request:
//     {
//       brief:      string,   // REQUIRED. >= 5 chars after trim. What the funnel is for.
//       tenant_id?: string,   // SERVICE-ROLE CALLERS ONLY. IGNORED for JWT callers, whose
//                             //   tenant is resolved server-side (see SECURITY).
//     }
//
//   200 {
//     name:  string,               // the funnel's name
//     goal:  string | null,        // one-line goal, or null
//     page: {                      // the entry landing page (from growth-page-draft)
//       title:      string,
//       brief:      string,        // the sub-brief Paige planned for the page
//       blocks:     GrowthBlock[],
//       theme_json: GrowthPageTheme,
//       seo_json:   { title?, description? },
//     },
//     form: {                      // the intake form step (from growth-form-draft), or null
//       name:   string,            //   if the plan decided a page-only funnel is right
//       brief:  string,
//       schema: CleanFormSchema,
//     } | null,
//   }
//   4xx/5xx { error: { code, message } }   // structured, non-2xx, never a 200-with-error
//
//   Error codes:
//     400 BAD_JSON           request body was not JSON
//     400 EMPTY_BRIEF        brief missing or shorter than 5 characters
//     400 INVALID_TENANT_ID  service-role caller passed a malformed tenant_id
//     401 UNAUTHENTICATED    no / invalid bearer token
//     403 FORBIDDEN          JWT caller lacks admin or super_admin
//     422 NO_VALID_PAGE      the composed page drafter produced no usable page — a funnel
//                            with no live entry page captures nothing, so we refuse rather
//                            than hand back a dead funnel wearing a 200 (§13).
//     502 MODEL_UNAVAILABLE  the plan model call failed (real cause logged + reported)
//     502 MODEL_BAD_OUTPUT   the plan model returned something that isn't a JSON object
//     500 INTERNAL           anything else — with the real message, never a generic shrug
//
// ── SECURITY (§13 — tenant isolation, least privilege) ──────────────────────
// Same pin as growth-page-draft / growth-form-draft: a JWT caller's tenant is resolved
// SERVER-SIDE via current_user_tenant_id() run in the caller's OWN JWT context; only a
// service-role bearer (Paige's agent, §10) may name a tenant. The tenant WE resolve is the
// only tenant passed down to the sibling drafters — a JWT caller can never steer this
// function to draft against a tenant they don't belong to.
//
// Doctrine:
//   §2  — this function adds NO finance/credit framing. It plans generic client-service
//         funnels; the sibling drafters already enforce the §2 field/vocab exclusions.
//   §12 — composes the existing drafters instead of forking their prompts/validators.
//   §13 — reports the real drafters' real output; refuses (422) rather than fabricate a page.
//   §14 — the plan step routes through the model router's reasoning tier ("doc_draft"),
//         matching the tier the drafters it orchestrates already use.
//   §19 — one brief in, a real working funnel out — the whole point of this file.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { chatCompletionCompat } from "../_shared/claude.ts";
import { routedChatCompletion } from "../_shared/model-router.ts";
import { extractJson, str } from "../_shared/growth-blocks.ts";
import { retrieveTenantKnowledge, buildKnowledgeBlock } from "../_shared/studio-brain.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_MAX_TOKENS = 1024;

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: jsonHeaders });
}
function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders });
}

/** Same JWT-claims peek the sibling drafters use. */
function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Call a sibling drafter server-to-server with the service-role bearer + the tenant WE
 *  resolved. Returns the parsed 200 body, or throws a structured cause on any non-2xx —
 *  the drafter's own structured error is surfaced, never swallowed (§13). */
async function callDrafter(fnName: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      apikey: supabaseServiceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? "DRAFTER_FAILED";
    const message = json?.error?.message ?? `${fnName} returned ${res.status}`;
    const err = new Error(`${fnName}: ${message}`) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return json;
}

const PLAN_SYSTEM = `You are Paige, planning a marketing FUNNEL for a client-based service business (coach, consultant, agency, advisor) from one operator brief.

A funnel here is a short, real sequence: an entry LANDING PAGE, then an intake FORM/questionnaire, then a thank-you. Your job is ONLY to plan it — name it, and write the two sub-briefs that the page generator and the form generator will each build from. Do NOT write the page or the form yourself.

VOICE (§3): direct, confident, mogul-founder. No "AI-powered", no "seamless", no "streamline".

DEFAULTS (§2): never introduce credit, funding, lending, financing, or "readiness/funding score" language unless the operator's own brief explicitly asks for it. Keep it generic to client-service businesses.

COPY BAR (raises the quality of the copy the downstream page/form generators write): each sub-brief must be concrete enough that the page generator can write direct-response copy from it, not vague filler. So:
- Name a SPECIFIC outcome the offer delivers (a real result, ideally with a timeframe or number when the operator gave one) — never "grow your business".
- Name the EXACT audience (e.g. "consultants booked out but doing all delivery themselves"), not "everyone".
- Name ONE clear action the lead takes. Never invent facts, testimonials, prices, or stats the operator didn't give — a specific brief means specific about what's REAL, never fabricated (§13/§15).

Rules:
- "landing_brief" must be a complete, specific brief for a single landing page that captures the offer in the operator's brief — the hook, the specific outcome, who exactly it's for, and the one call to action (per the COPY BAR above). One or two sentences.
- "form_brief" must describe the intake questions that qualify or onboard the lead for THIS offer — the real questions, in order, in plain human wording. One or two sentences. If the funnel genuinely needs no separate intake form beyond the page's own signup (a bare opt-in), return form_brief as an empty string and form_name as an empty string.
- "form_name" is a short human label for the form (e.g. "Application", "Discovery intake"), or "" if there is no form.
- "goal" is one short line naming the outcome the funnel drives, or "".

Return ONLY a single JSON object, no prose, no markdown fences:
{"name": string, "goal": string, "landing_brief": string, "form_brief": string, "form_name": string}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 1. Authenticate + decide the caller ──────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return fail(401, "UNAUTHENTICATED", "A bearer token is required.");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = parseJwtClaims(token)?.role === "service_role";

    // ── 2. Parse + validate BEFORE spending a model call ─────────────────────
    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail(400, "BAD_JSON", "Request body must be JSON.");
    }
    const brief = str(body?.brief).trim().slice(0, 4000);
    if (brief.length < 5) {
      return fail(400, "EMPTY_BRIEF", "Give a brief: what's the funnel for, and who's it for?");
    }

    // ── 3. Resolve the caller / tenant SERVER-SIDE (same pin as the drafters) ──
    let tenantId: string | null = null;
    if (isServiceRole) {
      const named = str(body?.tenant_id).trim();
      if (named) {
        if (!UUID_RE.test(named)) return fail(400, "INVALID_TENANT_ID", "tenant_id must be a UUID.");
        tenantId = named;
      }
    } else {
      const authed = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: uErr } = await authed.auth.getUser();
      if (uErr || !user) {
        return fail(401, "UNAUTHENTICATED", uErr?.message || "Could not verify this session.");
      }
      const { data: roleRows, error: rErr } = await authed.from("user_roles").select("role").eq("user_id", user.id);
      if (rErr) {
        console.error("growth-funnel-draft: role lookup failed:", rErr);
        return fail(500, "INTERNAL", `Could not read your roles: ${rErr.message}`);
      }
      const roles = (roleRows || []).map((r: any) => r.role);
      if (!roles.some((r: string) => r === "admin" || r === "super_admin")) {
        return fail(403, "FORBIDDEN", "Admin access required.");
      }
      const { data: resolved, error: tErr } = await authed.rpc("current_user_tenant_id");
      if (tErr) {
        console.error("growth-funnel-draft: tenant resolve failed:", tErr);
        return fail(500, "INTERNAL", `Could not resolve your workspace: ${tErr.message}`);
      }
      tenantId = str(resolved).trim() || null;
    }

    // ── 4. Plan the funnel (reasoning tier, §14) ─────────────────────────────
    // The Studio's brain (#310): ground the funnel PLAN in this practice's own knowledge, so the
    // name and the sub-briefs it hands the page/form drafters are native to the business. The
    // composed page/form drafts each retrieve their own KB context too (Slice A), so the whole
    // funnel is brain-aware end to end. Non-fatal (§13); IDOR-safe on the tenant WE resolved (§9).
    let knowledgeBlock = "";
    try {
      knowledgeBlock = buildKnowledgeBlock(await retrieveTenantKnowledge(tenantId, brief, 5));
    } catch (e) {
      console.warn("growth-funnel-draft: KB retrieval failed, no brain context:", (e as Error)?.message);
    }

    const messages = [
      { role: "system", content: PLAN_SYSTEM + knowledgeBlock },
      { role: "user", content: `Brief: ${brief}` },
    ];
    let plan: any = null;
    try {
      let raw = "";
      try {
        const data = await routedChatCompletion("doc_draft", {
          messages,
          response_format: { type: "json_object" },
          max_tokens: PLAN_MAX_TOKENS,
        });
        raw = str(data?.choices?.[0]?.message?.content);
      } catch (routerErr: any) {
        console.warn("growth-funnel-draft: router call failed, retrying on reasoning tier:", routerErr?.message);
        const retry = await chatCompletionCompat(
          { messages, response_format: { type: "json_object" }, max_tokens: PLAN_MAX_TOKENS },
          "reasoning",
        );
        raw = str(retry?.choices?.[0]?.message?.content);
      }
      if (!raw.trim()) throw new Error("model returned an empty completion");
      try {
        plan = extractJson(raw);
      } catch (parseErr: any) {
        console.error("growth-funnel-draft: unparseable plan (tail):", raw.slice(-400));
        return fail(502, "MODEL_BAD_OUTPUT", `The model did not return a usable funnel plan: ${parseErr?.message}`);
      }
    } catch (modelErr: any) {
      console.error("growth-funnel-draft: plan model call failed:", modelErr);
      return fail(502, "MODEL_UNAVAILABLE",
        `Could not reach the model to plan the funnel: ${modelErr?.message || "unknown error"}`);
    }

    const funnelName = str(plan?.name).trim() || "New funnel";
    const goal = str(plan?.goal).trim() || null;
    const landingBrief = str(plan?.landing_brief).trim() || brief;
    const formBrief = str(plan?.form_brief).trim();
    const formName = str(plan?.form_name).trim();

    // ── 5. Compose the entry page — REQUIRED. No live entry page = a dead funnel (§13). ──
    let pagePayload: any;
    try {
      pagePayload = await callDrafter("growth-page-draft", {
        brief: landingBrief,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      });
    } catch (e: any) {
      const status = e?.status && e.status >= 500 ? 502 : 422;
      console.error("growth-funnel-draft: page drafter failed:", e?.message);
      return fail(status, status === 502 ? "MODEL_UNAVAILABLE" : "NO_VALID_PAGE",
        `Couldn't draft the funnel's entry page: ${e?.message || "unknown error"}`);
    }
    const blocks = Array.isArray(pagePayload?.blocks) ? pagePayload.blocks : [];
    if (blocks.length === 0) {
      return fail(422, "NO_VALID_PAGE",
        "That didn't produce a usable entry page. Try again, or give the brief a bit more to work with.");
    }
    const seo = pagePayload?.seo_json ?? {};
    const pageTitle = str(seo?.title).trim() || funnelName;

    // ── 6. Compose the intake form — OPTIONAL (a bare opt-in funnel is legitimate). A form
    //       miss must NOT fail the whole funnel: the page alone is already a working funnel
    //       (§13 — degrade the optional step, never the core). ──────────────────────────
    let form: { name: string; brief: string; schema: unknown } | null = null;
    if (formBrief.length >= 5) {
      try {
        const formPayload = await callDrafter("growth-form-draft", {
          brief: formBrief,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        });
        if (formPayload?.schema) {
          form = { name: formName || "Intake form", brief: formBrief, schema: formPayload.schema };
        }
      } catch (e: any) {
        // The page carried; the form step is what didn't. Log and continue with a page-only
        // funnel rather than throwing away a good entry page over an optional second step.
        console.warn("growth-funnel-draft: form drafter failed, continuing page-only:", e?.message);
      }
    }

    return ok({
      name: funnelName,
      goal,
      page: {
        title: pageTitle,
        brief: landingBrief,
        blocks,
        theme_json: pagePayload?.theme_json ?? null,
        seo_json: seo,
      },
      form,
    });
  } catch (e: any) {
    console.error("growth-funnel-draft: unhandled error:", e);
    return fail(500, "INTERNAL", e?.message || "Failed to draft the funnel.");
  }
});
