// growth-block-edit — Paige's conversational per-section editor (Vibe Studio / Growth OS).
//
// The missing seam under the Studio's "talk to a section" pillar: one natural-language
// instruction ("make the headline punchier", "add a third pricing tier", "cut this in half")
// + one existing GrowthBlock -> one REVISED GrowthBlock. PURE DRAFT — zero DB writes. The
// caller persists the result through growth_page_edit_blocks / growth_page_upsert, which is
// exactly the validation this function pre-enforces (see CONTRACT below).
//
// Sibling: growth-page-draft generates a whole page. This revises one section of it. Both
// bottom out in the same 17-type block contract, now shared in _shared/growth-blocks.ts.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//
//   Request:
//     {
//       block:        GrowthBlock,   // REQUIRED. The section as it exists today.
//       instruction:  string,        // REQUIRED. What to change, in plain language.
//       block_index?: number,        // OPTIONAL. 0-based position on the page; context only —
//                                    //   the caller already owns it, so it is NOT echoed back.
//       tenant_id?:   string         // SERVICE-ROLE CALLERS: names the tenant. JWT CALLERS:
//                                    //   never chooses one — the session's own workspace is
//                                    //   used; a tenant_id naming another one is refused (403).
//     }
//
//   200  { block: GrowthBlock }                  // the revision, same `type`, save-safe
//   4xx/5xx { error: { code, message } }         // structured, non-2xx, never a 200-with-error
//
//   Error codes:
//     400 BAD_JSON            request body was not JSON
//     400 MISSING_BLOCK       no block, or not an object
//     400 UNKNOWN_BLOCK_TYPE  block.type is not one of the 17 GrowthBlock types
//     400 INVALID_BLOCK       the block you SENT already fails GrowthBlock validation
//     400 MISSING_INSTRUCTION instruction is empty / too short to act on
//     400 INVALID_BLOCK_INDEX block_index was present but not a non-negative integer
//     400 INVALID_TENANT_ID   service-role caller passed a malformed tenant_id
//     401 UNAUTHENTICATED     no / invalid bearer token
//     403 FORBIDDEN           JWT caller has no workspace open, named another workspace, or is
//                             not its owner/admin or managing agency (body also carries
//                             `forbidden: true`)
//     500 INTERNAL            also: the workspace/permission lookup itself failed (retryable)
//     422 BLOCK_TYPE_CHANGED  the model tried to change the section's kind — an edit revises a
//                             section, it does not turn a hero into a pricing table
//     422 REVISION_INVALID    the revision fails GrowthBlock validation (it would be rejected
//                             on save — handing it back would be worse than no revision)
//     422 NEW_PLACEHOLDER     the revision introduced a NEW [ADD_X] token; growth_page_publish
//                             hard-refuses unresolved placeholders, so this is un-publishable
//     422 CONTENT_BLOCKED     the revision solicits an SSN — never, on any surface (§2)
//     502 MODEL_UNAVAILABLE   the model call failed (real cause logged + reported, not swallowed)
//     502 MODEL_BAD_OUTPUT    the model returned something that isn't a JSON object
//     500 INTERNAL            anything else — with the real message, never a generic shrug
//
// ── SECURITY (§13 — tenant isolation, least privilege) ──────────────────────
// This function does NOT trust `tenant_id` from a JWT caller. _shared/studio-caller.ts
// resolveStudioCaller takes the workspace from current_user_tenant_id() in the CALLER's own JWT
// context, refuses a body tenant naming a different one, and requires the caller to be that exact
// workspace's owner/admin or its managing agency — the same rule as growth-page-draft. A
// platform-wide user_roles admin grants nothing: that table has no tenant. Only a service-role
// bearer — Paige's agent calling this headlessly (§10) — may name a tenant explicitly. The
// service-role key is used ONLY to read brand for the tenant resolved here.
//
// Doctrine: §2 (never introduce credit/funding/lending framing — a tenant's own funding content
// is theirs, but we never ADD it) · §3 (direct, confident, mogul-founder voice) · §10 (callable
// seam: the Studio is one caller, Paige's agent is another) · §13 (structured errors, real
// causes, non-2xx on failure) · §14 (model-routed, reasoning-tier, never a hardcoded model) ·
// §15 (resolve placeholders, never invent facts).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";
import { chatCompletionCompat } from "../_shared/claude.ts";
import { routedChatCompletion } from "../_shared/model-router.ts";
import {
  BLOCK_REQUIREMENTS,
  extractJson,
  GROWTH_BLOCK_SPEC,
  isGrowthBlockType,
  newPlaceholders,
  str,
  validateBlock,
} from "../_shared/growth-blocks.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An SSN solicitation is never legitimate on a landing page, in any vertical, for any tenant.
// (Deliberately narrow: we do NOT regex-block credit/funding words — a tenant who opted into a
// funding offer owns that copy (§2 clarification). The SYSTEM prompt is what stops us ADDING it.)
const SSN_RE = /\bssn\b|social[\s-]?security[\s-]?(number|#)/i;

/** Structured failure. Never a 200-with-{error}; never a swallowed generic. */
function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message }, ...extra }), { status, headers: jsonHeaders });
}
function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders });
}

/**
 * Read the (already gateway-verified) bearer's claims. verify_jwt=true means the token's
 * signature is checked upstream; this only tells us WHICH kind of caller it is, so we can decide
 * whether `tenant_id` in the body is even allowed to be read. Mirrors process-email-queue.
 */
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

    const inputBlock = body?.block;
    if (!inputBlock || typeof inputBlock !== "object" || Array.isArray(inputBlock)) {
      return fail(400, "MISSING_BLOCK", "Send the section to edit as `block` — a GrowthBlock object.");
    }
    const blockType = str(inputBlock.type);
    if (!isGrowthBlockType(blockType)) {
      return fail(400, "UNKNOWN_BLOCK_TYPE", `"${blockType || "(none)"}" is not a GrowthBlock type.`);
    }
    // The block we were handed must itself be save-safe. If it isn't, an edit can't fix that —
    // the caller is holding something the page could never have persisted, and we say so rather
    // than quietly "revising" a broken section into a differently-broken one.
    const cleanInput = validateBlock(inputBlock);
    if (!cleanInput) {
      return fail(400, "INVALID_BLOCK",
        `The ${blockType} block you sent isn't valid — it needs ${BLOCK_REQUIREMENTS[blockType]}.`);
    }

    const instruction = str(body?.instruction).trim().slice(0, 2000);
    if (instruction.length < 3) {
      return fail(400, "MISSING_INSTRUCTION", "Say what to change — e.g. \"make the headline punchier\" or \"add a third pricing tier\".");
    }

    let blockIndex: number | null = null;
    if (body?.block_index !== undefined && body?.block_index !== null) {
      const n = Number(body.block_index);
      if (!Number.isInteger(n) || n < 0) {
        return fail(400, "INVALID_BLOCK_INDEX", "block_index must be a non-negative integer.");
      }
      blockIndex = n;
    }

    // ── 3. Resolve the tenant SERVER-SIDE (the IDOR-safe path) ───────────────
    // JWT caller: the session's own workspace, its owner/admin or managing agency only
    // (resolveStudioCaller, §9). `body.tenant_id` can only be refused here, never chosen.
    // Service-role caller: Paige's agent running headlessly (§10) may name the tenant.
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

    // ── 4. Brand context (truthful, §13) — read with the tenant WE resolved ───
    // The theme itself is owned by the page, not by a single block, so we only need the brand
    // NAME here: it keeps the revised copy native to the practice. Never hallucinated.
    let brandName = "";
    if (tenantId) {
      const admin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: b, error: bErr } = await admin.rpc("resolve_tenant_brand", { _tenant_id: tenantId });
      if (bErr) {
        // Non-fatal: an edit without brand context is still a good edit. Log the real cause.
        console.warn("growth-block-edit: brand lookup failed, continuing without it:", bErr.message);
      } else {
        const row = Array.isArray(b) ? b[0] : b;
        if (row) brandName = str(row.product_name) || str(row.tenant_name) || "";
      }
    }

    // ── 5. The revision ──────────────────────────────────────────────────────
    const SYSTEM = `You are Paige, editing ONE section of a live landing page for a client-based service business${brandName ? ` called "${brandName}"` : ""}. The operator tells you what to change; you return the revised section.

VOICE (§3): direct, confident, mogul-founder. Never use "AI-powered", "streamline", "seamless", or "empower". The audience is client-based service businesses — coaches, consultants, agencies, advisors, thought leaders — so prefer inclusive words (practice, business, clients, work, team) over narrowly "coaching".

THE HARD RULES OF AN EDIT:
1. SAME TYPE. The revised block MUST keep "type": "${blockType}". You are revising this section, not replacing it with a different kind of section. If the instruction asks for a different section type, do the closest faithful thing WITHIN this type.
2. SURGICAL. Change what the instruction asks for and what that change necessarily drags with it. Leave everything else — the fields, the facts, the links, the real URLs, the structure — exactly as it was. This is an edit, not a rewrite.
3. NO NEW FACTS (§15). Do NOT invent specifics you were not given: no dates, times, prices, links, statistics, testimonial names, client results, or logos. Every real https:// URL already in the block stays byte-for-byte identical unless you were told to change it. If the instruction asks for something you have no facts for, produce the structure and leave the unknown out — never fabricate.
4. PLACEHOLDERS ARE DEBT (§15). If the block already contains a bracketed editable token (e.g. "[ADD_WEBINAR_DATE]"), RESOLVE it when the instruction gives you what it needs; otherwise leave it exactly as-is. NEVER introduce a NEW bracketed placeholder token. The publish step hard-refuses unresolved placeholders, so a new one makes this page un-publishable.
5. CONTENT (§2). Do NOT introduce credit, funding, lending, loan, financing, or "readiness/funding score" framing that is not ALREADY in this block or explicitly asked for in the instruction. Never ask for, mention, or collect a Social Security number.

${GROWTH_BLOCK_SPEC}

OUTPUT — return ONLY a single JSON object, no prose, no markdown fences:
{ "block": GrowthBlock }
The block must be COMPLETE — the full revised section, every field it should keep, not a diff or a patch.`;

    const messages = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Section${blockIndex !== null ? ` (position ${blockIndex} on the page)` : ""} — current "${blockType}" block:
${JSON.stringify(cleanInput, null, 2)}

Instruction: ${instruction}`,
      },
    ];

    // Reasoning-tier, deliberately (§14). This is CLIENT-FACING PUBLISHED COPY under the
    // tenant's brand — a "doc_draft" (a draft a human reviews before it ships), never an
    // "internal_first_draft": that kind is in CHEAP_KINDS and would route this page's headline
    // to an open 8B model. doc_draft is a REASONING kind -> Claude reasoning tier, always.
    // Route through the router; never hardcode a model. Do not re-cheapen this call.
    let parsed: any = null;
    try {
      let raw = "";
      try {
        const data = await routedChatCompletion("doc_draft", {
          messages,
          response_format: { type: "json_object" },
          max_tokens: 6000, // a rich_text section can legitimately run to 20k chars of html
        });
        raw = str(data?.choices?.[0]?.message?.content);
      } catch (routerErr: any) {
        // One retry on the same reasoning tier — model calls fail transiently, and losing an
        // operator's edit to a blip is worse than one extra call. Same tier, so this can never
        // silently downgrade the model. If it fails again we report the REAL cause.
        console.warn("growth-block-edit: router call failed, retrying on reasoning tier:", routerErr?.message);
        const retry = await chatCompletionCompat(
          { messages, response_format: { type: "json_object" }, max_tokens: 6000 },
          "reasoning",
        );
        raw = str(retry?.choices?.[0]?.message?.content);
      }
      if (!raw.trim()) throw new Error("model returned an empty completion");
      try {
        parsed = extractJson(raw);
      } catch (parseErr: any) {
        console.error("growth-block-edit: unparseable model output:", raw.slice(0, 400));
        return fail(502, "MODEL_BAD_OUTPUT", `The model did not return a JSON block: ${parseErr?.message}`);
      }
    } catch (modelErr: any) {
      console.error("growth-block-edit: model call failed:", modelErr);
      return fail(502, "MODEL_UNAVAILABLE", `Could not reach the model to make that edit: ${modelErr?.message || "unknown error"}`);
    }

    // ── 6. Gate the revision on the SAME contract the save enforces ──────────
    // Everything below is the whole point of this function: a revision the Studio accepts but
    // growth_page_upsert / growth_page_edit_blocks would then reject on save is worse than no
    // revision at all. If it can't be persisted, it doesn't leave here as a 200.
    const candidate = (parsed?.block && typeof parsed.block === "object") ? parsed.block : parsed;

    const revisedType = str(candidate?.type);
    if (revisedType !== blockType) {
      console.error(`growth-block-edit: model changed block type ${blockType} -> ${revisedType || "(none)"}`);
      return fail(422, "BLOCK_TYPE_CHANGED",
        `An edit revises a section, it does not change its kind — the revision came back as "${revisedType || "(none)"}" instead of "${blockType}". Try a more specific instruction.`);
    }

    const revised = validateBlock(candidate);
    if (!revised) {
      console.error("growth-block-edit: revision failed block validation:", JSON.stringify(candidate).slice(0, 400));
      return fail(422, "REVISION_INVALID",
        `That edit produced a ${blockType} section that can't be saved — it needs ${BLOCK_REQUIREMENTS[blockType]}. Nothing was changed.`);
    }

    // growth_page_publish HARD-REFUSES unresolved [ADD_X] tokens. A pre-existing placeholder is
    // the operator's debt and may survive an edit; a NEW one is debt WE created, and it would
    // silently make their page un-publishable. Refuse it.
    const introduced = newPlaceholders(cleanInput, revised);
    if (introduced.length) {
      console.error("growth-block-edit: revision introduced placeholders:", introduced);
      return fail(422, "NEW_PLACEHOLDER",
        `That edit added a placeholder (${introduced.join(", ")}) the page can't publish with. Give me the missing detail and I'll write it in.`);
    }

    if (SSN_RE.test(JSON.stringify(revised))) {
      console.error("growth-block-edit: revision solicited an SSN — refused");
      return fail(422, "CONTENT_BLOCKED", "That edit asks for a Social Security number, which never goes on a page. Nothing was changed.");
    }

    return ok({ block: revised });
  } catch (e: any) {
    // Last line: still non-2xx, still the REAL cause (§13 — never a swallowed generic).
    console.error("growth-block-edit: unhandled error:", e);
    return fail(500, "INTERNAL", e?.message || "Failed to edit the section.");
  }
});
