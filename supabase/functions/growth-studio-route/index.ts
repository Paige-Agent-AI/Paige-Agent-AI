// growth-studio-route — the Studio's single-entry-point classifier (Vibe Studio Phase 1,
// CLAUDE.md §18: "a creation surface must not force the operator to pre-select an artifact
// type before describing what they want").
//
// One brief in, one cheap judgment out: is the operator asking for a landing/lead PAGE, a
// multi-step FUNNEL, a standalone FORM (no page around it), or an IMAGE. This is a routing hint,
// not a generation — the actual draft for whichever artifact wins still runs through its own seam
// (growth-page-draft, growth-funnel-draft, growth-form-draft, generate-image). Nothing here writes
// to the database.
//
// STANDALONE COPY is NOT a Studio artifact type (§18/§21): a brief that is purely marketing text
// (a post, email, ad, caption, SMS) is something Paige writes directly in chat, never a Studio
// artifact. A words-only brief classifies as "page" (the nearest real asset); Paige's chat is
// copy's one home.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//
//   Request:
//     { brief: string }   // REQUIRED. >= 5 chars after trim.
//
//   200  { artifact: "page"|"funnel"|"form"|"image", reasoning: string }
//        ALWAYS 200 with a real artifact — a model miss or unparseable reply degrades to
//        "page" (the most capable/flexible fallback) rather than failing the request. A
//        legitimate brief must never dead-end on a classifier hiccup (§13).
//   4xx/5xx { error: { code, message } }   // only for genuinely bad input/auth — never for
//                                          //   "the model didn't answer cleanly."
//
//   Error codes:
//     400 BAD_JSON           request body was not JSON
//     400 EMPTY_BRIEF        brief missing or shorter than 5 characters
//     400 INVALID_TENANT_ID  service-role caller passed a malformed tenant_id
//     401 UNAUTHENTICATED    no / invalid bearer token
//     403 FORBIDDEN          JWT caller has no workspace open, named another workspace, or is
//                            not its owner/admin or managing agency (body also carries
//                            `forbidden: true`)
//     500 INTERNAL           anything else — with the real message, never a generic shrug —
//                            including a failed workspace/permission lookup (retryable)
//
// ── SECURITY ─────────────────────────────────────────────────────────────────
// Same rule as growth-page-draft (_shared/studio-caller.ts resolveStudioCaller): a JWT caller
// must be the owner/admin or managing agency of the workspace their session is in, a body
// tenant naming another workspace is refused, and a platform-wide user_roles admin grants
// nothing. This function reads no tenant-scoped data today, so the resolved workspace is used
// only for the gate. Only a service-role bearer (Paige's agent, §10) may name a tenant.
//
// Doctrine:
//   §14 — cheap, fast tier: this is a "classify" job (model-router.ts CHEAP_KINDS), so it
//         rides the open-model tier when Featherless is configured, Claude classification
//         otherwise — never the reasoning tier for a one-word judgment call.
//   §13 — never fabricate a confident answer past an honest fallback; default to "page" on
//         any ambiguity or parse failure rather than fail closed on a legitimate brief.
//   §18 — this is the seam that makes "type first, classify second" possible: the Studio's
//         one composer stays the single entry point and this is what decides where the
//         brief lands.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { routedChatCompletion } from "../_shared/model-router.ts";
import { extractJson, str } from "../_shared/growth-blocks.ts";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StudioArtifact = "page" | "funnel" | "form" | "image";
const VALID_ARTIFACTS: readonly StudioArtifact[] = ["page", "funnel", "form", "image"];

function isStudioArtifact(v: unknown): v is StudioArtifact {
  return typeof v === "string" && (VALID_ARTIFACTS as readonly string[]).includes(v);
}

/** Structured failure. Never a swallowed generic (§13). */
function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message }, ...extra }), { status, headers: jsonHeaders });
}
function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders });
}

/** Same JWT-claims peek growth-page-draft uses — signature already verified upstream by the
 *  gateway (verify_jwt=true); this only tells us which kind of caller we're looking at. */
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

const SYSTEM = `You classify a one-sentence creation brief for a client-based service business's marketing studio into exactly ONE of four artifact types:

"page" — a SINGLE landing/lead page: a registration page, a sales page, a lead-magnet opt-in, a waitlist, an event page. One web address, multiple sections, but ONE page.
"funnel" — a SEQUENCE of pages/steps, not one page: a landing page THEN an intake form/application THEN a thank-you; a lead funnel, an application funnel, an opt-in-to-booking flow, a "capture then qualify" flow. Choose this when the operator describes a multi-step path a lead moves THROUGH, or explicitly says "funnel".
"form" — a standalone form or questionnaire, requested WITHOUT a page around it — an intake form, an application, a survey, a screening questionnaire the operator wants on its own.
"image" — a single image or graphic — a promo graphic, a social visual, an ad image, a photo-style asset.

IMPORTANT — standalone marketing TEXT is NOT one of these types. A brief that is purely words for a post, email, ad, caption, SMS, or blog outline — no page, no form, no funnel, no image asked for — is something Paige writes directly in chat, not a Studio artifact. When a brief is only words like that, classify it as "page" (the nearest real asset the studio builds); the studio never produces a bare-copy artifact.

Read the brief and decide which ONE the operator is actually asking for. "funnel" wins over "page" only when there's a real multi-step path (capture → qualify → confirm) or the word "funnel"; a single opt-in or sales page is "page". If it's otherwise ambiguous, choose "page" — it's the most capable fallback.

Return ONLY a single JSON object, no prose, no markdown fences:
{"artifact": "page"|"funnel"|"form"|"image", "reasoning": "one short sentence"}`;

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
      return fail(400, "EMPTY_BRIEF", "Give a brief before Paige can figure out what to build.");
    }

    // ── 3. Gate the caller on their workspace SERVER-SIDE (same rule as growth-page-draft) ───
    if (isServiceRole) {
      const named = str(body?.tenant_id).trim();
      if (named && !UUID_RE.test(named)) {
        return fail(400, "INVALID_TENANT_ID", "tenant_id must be a UUID.");
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
    }

    // ── 4. Classify — cheap/fast tier, never the reasoning model for this (§14) ──────
    // Any failure here (router outage, unparseable reply, an artifact value we don't
    // recognize) degrades to "page" rather than failing the request — a legitimate brief
    // must never dead-end on a classifier hiccup (§13).
    let artifact: StudioArtifact = "page";
    let reasoning = "Defaulted to the page builder.";
    try {
      const data = await routedChatCompletion("classify", {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Brief: ${brief}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 200,
      });
      const raw = str(data?.choices?.[0]?.message?.content);
      const parsed = extractJson(raw);
      if (isStudioArtifact(parsed?.artifact)) {
        artifact = parsed.artifact;
        reasoning = str(parsed?.reasoning).trim().slice(0, 240) || reasoning;
      } else {
        console.warn("growth-studio-route: model returned an unrecognized artifact, defaulting to page:", parsed?.artifact);
      }
    } catch (err: any) {
      console.warn("growth-studio-route: classification failed, defaulting to page:", err?.message);
    }

    return ok({ artifact, reasoning });
  } catch (e: any) {
    console.error("growth-studio-route: unhandled error:", e);
    return fail(500, "INTERNAL", e?.message || "Failed to classify the brief.");
  }
});
