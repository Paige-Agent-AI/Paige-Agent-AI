// growth-form-draft — Paige's standalone form/questionnaire generator (Vibe Studio Phase 1,
// CLAUDE.md §18). The form-mode mirror of growth-page-draft: from one sentence, derive a
// real GrowthFormSchema — no page, no blocks, no theme, no SEO. PURE DRAFT — zero DB writes.
// Creating the form (growth_form_upsert) is a separate action, called through studio.ts's
// saveForm() once the operator is happy with the drafted schema.
//
// Reuses the EXACT cleanFormSchema()/GROWTH_FORM_SCHEMA_SPEC pair growth-page-draft already
// uses for its `questionnaire_answer` extension (§12 — extract, never fork) — this is not a
// new schema-derivation approach, it's the same one, standalone.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//
//   Request:
//     {
//       brief:      string,   // REQUIRED. >= 5 chars after trim. What the form should ask.
//       tenant_id?: string,   // SERVICE-ROLE CALLERS: names the tenant. JWT CALLERS: never
//                             //   chooses one; a tenant_id naming another workspace is refused.
//     }
//
//   200  { schema: CleanFormSchema }
//   4xx/5xx { error: { code, message } }   // structured, non-2xx, never a 200-with-error
//
//   Error codes:
//     400 BAD_JSON           request body was not JSON
//     400 EMPTY_BRIEF        brief missing or shorter than 5 characters
//     400 INVALID_TENANT_ID  service-role caller passed a malformed tenant_id
//     401 UNAUTHENTICATED    no / invalid bearer token
//     403 FORBIDDEN          JWT caller has no workspace open, named another workspace, or is
//                            not its owner/admin or managing agency (body also carries
//                            `forbidden: true`)
//     500 INTERNAL           also: the workspace/permission lookup itself failed (retryable)
//     422 NO_VALID_SCHEMA    the model produced ZERO fields that survive cleanFormSchema().
//                            Handing back a hardcoded generic schema would dress a failed
//                            generation up as a successful one (§13) — we refuse; the caller
//                            (FormMode) falls back to its own template picker.
//     502 MODEL_UNAVAILABLE  the model call failed (real cause logged + reported)
//     502 MODEL_BAD_OUTPUT   the model returned something that isn't a JSON object
//     500 INTERNAL           anything else — with the real message, never a generic shrug
//
// ── SECURITY (§13 — tenant isolation, least privilege) ──────────────────────
// Same rule as growth-page-draft (_shared/studio-caller.ts resolveStudioCaller): a JWT caller
// drafts for the workspace their session is in, as its owner/admin or managing agency; a body
// tenant naming another workspace is refused, and a platform-wide user_roles admin grants
// nothing. Only a service-role bearer (Paige's agent, §10) may name a tenant. The tenant
// resolved here is the only one the Studio brain (#310) retrieves knowledge for.
//
// Doctrine:
//   §2  — never invent an "ssn4"/"currency" field, or credit/funding framing, unless the
//         brief explicitly asks for it — cleanFormSchema() already enforces the type
//         exclusion; this function adds no framing of its own.
//   §14 — routed through the model router's reasoning tier ("doc_draft"), matching the SAME
//         tier growth-page-draft uses for its own questionnaire extension — a form a human
//         reviews before it goes live is not cheap internal-draft work.
//   §15 — the model derives fields ONLY from what the operator described; it does not invent
//         questions they didn't ask for (beyond the name/email fallback cleanFormSchema()
//         itself guarantees every lead form carries).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { chatCompletionCompat } from "../_shared/claude.ts";
import { routedChatCompletion } from "../_shared/model-router.ts";
import { extractJson, str } from "../_shared/growth-blocks.ts";
import { cleanFormSchema, GROWTH_FORM_SCHEMA_SPEC } from "../_shared/growth-forms.ts";
import { retrieveTenantKnowledge, buildKnowledgeBlock } from "../_shared/studio-brain.ts";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Small output ceiling — a form schema is far lighter than a whole page (no blocks/theme/seo),
// but headroom matters the same way it does in growth-page-draft: under-provisioning here
// truncates mid-object and turns into a deterministic failure, not an occasional one.
const FORM_MAX_TOKENS = 3072;

/** Structured failure. Never a 200-with-{error}; never a swallowed generic (§13). */
function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message }, ...extra }), { status, headers: jsonHeaders });
}
function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders });
}

/** Same JWT-claims peek growth-page-draft uses. */
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 1. Authenticate, and decide which caller this is ─────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return fail(401, "UNAUTHENTICATED", "A bearer token is required.");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = parseJwtClaims(token)?.role === "service_role";

    // ── 2. Parse + validate the request BEFORE spending a model call ─────────
    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail(400, "BAD_JSON", "Request body must be JSON.");
    }

    const brief = str(body?.brief).trim().slice(0, 4000);
    if (brief.length < 5) {
      return fail(400, "EMPTY_BRIEF",
        "Give a brief: what should the form ask, and what's it for?");
    }

    // ── 3. Resolve the caller / tenant SERVER-SIDE (same rule as growth-page-draft) ───
    // The tenant WE resolve is the only one the Studio brain (#310) reads — a JWT caller can
    // never steer retrieval at a workspace other than their own (§9). Null only for a
    // service-role caller that named no tenant: that means "no brain context".
    let tenantId: string | null = null;
    if (isServiceRole) {
      const named = str(body?.tenant_id).trim();
      if (named) {
        if (!UUID_RE.test(named)) {
          return fail(400, "INVALID_TENANT_ID", "tenant_id must be a UUID.");
        }
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

      const caller = await resolveStudioCaller(authed, body?.tenant_id);
      if (!caller.ok) {
        return caller.status === 403
          ? fail(403, "FORBIDDEN", caller.error, { forbidden: true })
          : fail(500, "INTERNAL", caller.error);
      }
      tenantId = caller.tenantId;
    }

    // The Studio brain (#310): retrieve this practice's own knowledge relevant to the brief so
    // the questionnaire asks in THEIR terms and captures what THEY actually need. Non-fatal (§13).
    let knowledgeBlock = "";
    try {
      knowledgeBlock = buildKnowledgeBlock(await retrieveTenantKnowledge(tenantId, brief, 5));
    } catch (e) {
      console.warn("growth-form-draft: KB retrieval failed, no brain context:", (e as Error)?.message);
    }

    // ── 4. The draft ─────────────────────────────────────────────────────────
    const SYSTEM = `You are Paige, drafting a standalone form/questionnaire for a client-based service business from the operator's own description of what it should ask.

VOICE (§3): direct, confident, mogul-founder — but a form is mostly labels, so this mainly means: no filler questions, no corporate throat-clearing in help text.

LABEL QUALITY: field labels are plain, human, and specific — the exact thing you're asking for ("What's the one result you want from this?"), never a vague or jargon label ("Objective details"). Help text is used ONLY when a field genuinely needs a clarifying nudge, and then it's one short concrete sentence — never boilerplate, never restating the label. A required field is marked required; an optional one isn't padded with filler.

DEFAULTS (§2): never introduce credit, funding, lending, financing, or "readiness/funding score" fields unless the operator's own brief explicitly asks for them.

Derive the fields EXACTLY from what the operator described, in the order given — do not invent questions they didn't ask for, and never fabricate placeholder/example values (§15). Never use "ssn4" or "currency" types; use "text" for money- or ID-like answers.${knowledgeBlock}

Return ONLY a single JSON object, no prose, no markdown fences:
{ "form_schema_json": ${GROWTH_FORM_SCHEMA_SPEC} }`;

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Brief: ${brief}` },
    ];

    // Reasoning-tier, deliberately (§14) — same tier growth-page-draft uses for this exact
    // derivation when it runs inside the page flow; a form a human reviews before it goes
    // live is not cheap internal-draft work.
    let parsed: any = null;
    try {
      let raw = "";
      try {
        const data = await routedChatCompletion("doc_draft", {
          messages,
          response_format: { type: "json_object" },
          max_tokens: FORM_MAX_TOKENS,
        });
        raw = str(data?.choices?.[0]?.message?.content);
      } catch (routerErr: any) {
        // One retry on the SAME reasoning tier — mirrors growth-page-draft's own retry
        // discipline: never silently downgrade the model, never re-truncate for want of
        // headroom, and losing a form to a transient blip is worse than one extra call.
        console.warn("growth-form-draft: router call failed, retrying on reasoning tier:", routerErr?.message);
        const retry = await chatCompletionCompat(
          { messages, response_format: { type: "json_object" }, max_tokens: FORM_MAX_TOKENS },
          "reasoning",
        );
        raw = str(retry?.choices?.[0]?.message?.content);
      }
      if (!raw.trim()) throw new Error("model returned an empty completion");
      try {
        parsed = extractJson(raw);
      } catch (parseErr: any) {
        console.error("growth-form-draft: unparseable model output (tail):", raw.slice(-400));
        return fail(502, "MODEL_BAD_OUTPUT", `The model did not return a usable form: ${parseErr?.message}`);
      }
    } catch (modelErr: any) {
      console.error("growth-form-draft: model call failed:", modelErr);
      return fail(502, "MODEL_UNAVAILABLE",
        `Could not reach the model to draft the form: ${modelErr?.message || "unknown error"}`);
    }

    // ── 5. Clean/repair the model's proposal — GUARANTEED to pass growth_validate_form_schema
    //    downstream, or null. A null here means we refuse rather than ship a failed
    //    generation wearing a 200 (§13) — the caller falls back to its own template picker.
    const schema = cleanFormSchema(parsed?.form_schema_json ?? parsed);
    if (!schema) {
      console.error("growth-form-draft: no valid schema in model output:", JSON.stringify(parsed).slice(0, 400));
      return fail(422, "NO_VALID_SCHEMA",
        "That didn't produce a usable form. Try again, or give the brief a little more to work with — the real questions, in order.");
    }

    return ok({ schema });
  } catch (e: any) {
    console.error("growth-form-draft: unhandled error:", e);
    return fail(500, "INTERNAL", e?.message || "Failed to draft the form.");
  }
});
