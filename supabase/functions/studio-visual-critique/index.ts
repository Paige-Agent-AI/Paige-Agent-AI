// studio-visual-critique — the Studio design agent's EYES (§25 "see it before you ship it", §33).
//
// A generated Studio artifact is rendered to a screenshot and read by a Claude VISION model, which
// returns a SHIP / ITERATE / BLOCK verdict + concrete findings graded against the SAME anti-pattern
// vocabulary the generator is steered away from (_shared/cheesy-tells.ts, §18 one home for the tells).
// This closes the loop the owner keeps having to close by eye: the agent SEES what it built and, on
// ITERATE/BLOCK, is handed a refined prompt to regenerate — before the artifact reaches the tenant.
//
// TWO ways in to a screenshot (the artifact is already a raster, or it must be rendered):
//   • image_url  — an already-rendered image artifact (generate-image returns a public URL). Fetched
//                  directly; NO renderer needed. This is the path that works the moment this deploys.
//   • render{url|html} — a page/funnel that is BLOCKS, not pixels. Rendered to a PNG by the Fly
//                  Playwright renderer (services/visual-renderer). Needs VISUAL_RENDERER_URL/_SECRET;
//                  unset → an honest needs_config degrade (§13), never a faked verdict.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//   Request: {
//     image_url?: string,                       // path A: critique an existing image
//     render?: { url?, html?, viewport?, waitForSelector?, waitMs? },  // path B: render then critique
//     artifact_kind?: "image"|"page"|"funnel"|"form",   // steers the rubric (default "image")
//     brief?: string,                           // the original ask, so the critic judges vs intent
//     session_id?: uuid, deliverable_id?: uuid, // soft links for the log row
//     iteration?: number,                       // which loop pass this is (default 0)
//     spent_usd?: number,                       // running loop cost so far (default 0)
//     tenant_id?: uuid                          // REQUIRED for a service-role caller. A JWT caller's
//                                               // tenant is their session's workspace (§9); a
//                                               // tenant_id naming any other workspace is refused
//   }
//   200 { ok:true, verdict, summary, blockers[], should_fix[], nits[], cheesy_tells_hit[],
//         refined_prompt?, iteration, cost_estimate_usd, spent_usd, capped?, low_confidence? }
//   200 { ok:false, needs_config:true, message }   — renderer/model not configured (honest degrade)
//   403 { error, forbidden:true }                  — JWT caller: no workspace open, another workspace
//                                                  //   named, or not its owner/admin/managing agency
//   500 { error }                                  — the workspace/permission lookup failed (retryable)
//   4xx { error }                                  — bad input / auth
//
// ── DOCTRINE ─────────────────────────────────────────────────────────────────
//   §9  — a JWT caller can ONLY critique for the workspace their session is in, and only as its
//         owner/admin or managing agency (_shared/studio-caller.ts resolveStudioCaller, the rule every
//         Studio backend uses). A platform-wide user_roles admin/super_admin grants nothing — that
//         table has no tenant. A service-role caller (Paige's headless agent) must pass tenant_id —
//         it has already resolved + authorized it. paige-ai-chat's critique loop calls with the
//         person's JWT and the tenant from get_paige_persona_context, so it takes the JWT path.
//   §13 — HONEST degrade: no renderer/model → needs_config, never a fabricated SHIP. If the critic's
//         reply can't be parsed into a verdict, we FAIL-OPEN to SHIP with low_confidence:true (a
//         broken critic must not BLOCK a legitimate artifact) and LOG the malfunction — never silent.
//   §33 — hard caps so an iterate loop can't run away: MAX_ITERATIONS and COST_CAP_USD. On either cap
//         the verdict is forced to SHIP with capped:true (stop iterating, keep the best we have).
//   §17/§18 — the vision pass routes through the ONE model seam (callModel "vision-critique"/"frontier")
//         which is Claude-vision ONLY by construction (no open-tier cell exists). No second vision client.
//   §32 — the renderer is smoke-tested (services/visual-renderer/smoke.mjs); every failure path here
//         degrades to something VISIBLE (needs_config / logged error), never a silent blank.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { callModel } from "../_shared/model-router.ts";
import { CHEESY_TELLS_AVOID } from "../_shared/cheesy-tells.ts";
import { assertPublicHttpUrl } from "../_shared/ssrf-guard.ts";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RENDERER_URL = (Deno.env.get("VISUAL_RENDERER_URL") ?? "").replace(/\/+$/, "");
const RENDERER_SECRET = Deno.env.get("VISUAL_RENDERER_SECRET") ?? "";

// §33 loop ceilings (env-overridable so they can be retuned without a deploy).
const MAX_ITERATIONS = Number(Deno.env.get("STUDIO_CRITIQUE_MAX_ITERATIONS") ?? "3");
const COST_CAP_USD = Number(Deno.env.get("STUDIO_CRITIQUE_COST_CAP_USD") ?? "2");
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw — stays under Claude's ~5MB base64-DECODED ceiling
                                          // (base64 inflates ~33%), so a valid image never wastes a
                                          // frontier call by over-shooting the model limit (§13).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const p = parts[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Fetch an image URL → base64 (bounded). Returns null on any failure (honest degrade, never throws
 *  into a blank). */
async function fetchImageAsBase64(url: string): Promise<{ b64: string; media: string } | null> {
  try {
    // §13 SSRF: reject private/link-local/metadata targets BEFORE fetching, and refuse redirects so a
    // redirect can't bounce us to an internal host after the check.
    await assertPublicHttpUrl(url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!resp.ok) { console.error(`[studio-visual-critique] image fetch ${resp.status} for ${url}`); return null; }
    const media = (resp.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!media.startsWith("image/")) { console.error(`[studio-visual-critique] non-image content-type ${media}`); return null; }
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
      console.error(`[studio-visual-critique] image size out of range: ${buf.byteLength} bytes`);
      return null;
    }
    return { b64: base64Encode(buf), media };
  } catch (e) {
    // §32: log the CAUSE loudly (ssrf-block vs unreachable vs redirect) — never a silent null.
    console.error("[studio-visual-critique] image fetch failed:", (e as Error)?.message ?? e);
    return null;
  }
}

/** Render a page/funnel to a PNG via the Fly renderer. Returns null when not configured OR on failure
 *  (the caller turns null into a needs_config/logged degrade — never a faked screenshot). */
async function renderToBase64(
  render: { url?: string; html?: string; viewport?: unknown; waitForSelector?: string; waitMs?: number },
): Promise<{ b64: string; media: string } | null> {
  if (!RENDERER_URL || !RENDERER_SECRET) return null;
  const path = render.html ? "/render-html" : "/render";
  try {
    // Defense in depth (§13): if a target URL is given, reject private/metadata hosts here too — the
    // renderer enforces the same guard, so this closes the hole even if the two ever drift.
    if (!render.html && typeof render.url === "string") await assertPublicHttpUrl(render.url);
    const resp = await fetch(`${RENDERER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Renderer-Secret": RENDERER_SECRET },
      body: JSON.stringify(render),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) { console.error(`[studio-visual-critique] renderer ${resp.status} on ${path}`); return null; }
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
      console.error(`[studio-visual-critique] rendered PNG size out of range: ${buf.byteLength} bytes`);
      return null;
    }
    return { b64: base64Encode(buf), media: "image/png" };
  } catch (e) {
    console.error("[studio-visual-critique] render failed:", (e as Error)?.message ?? e);
    return null;
  }
}

function base64Encode(buf: Uint8Array): string {
  // Chunked to avoid a spread-arg stack overflow on large buffers.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const RUBRIC = (kind: string, brief: string) => `You are a world-class design critic — the standard is Linear, Stripe, Vercel, Framer, Raycast. You are looking at a screenshot of a ${kind} a design agent just generated${brief ? ` for this brief: "${brief}"` : ""}.

Judge TASTE, not just correctness: hierarchy, spacing rhythm, type ladder, contrast, whether it reads "expensive" or generic-admin. Grade it against these anti-patterns (a hit is a defect): ${CHEESY_TELLS_AVOID}

Return ONLY strict JSON, no prose, no code fences:
{
  "verdict": "SHIP" | "ITERATE" | "BLOCK",
  "summary": "one sentence — the single most important judgment",
  "blockers": ["must-fix defects that make this not shippable"],
  "should_fix": ["real improvements short of a blocker"],
  "nits": ["minor polish"],
  "cheesy_tells_hit": ["which named anti-patterns above this trips, if any"],
  "refined_prompt": "if verdict is ITERATE or BLOCK: a concrete, improved generation prompt that fixes the blockers/should_fix while keeping the intent. Empty string if SHIP."
}
SHIP = stands next to the references without embarrassment. ITERATE = real gaps, worth one more pass. BLOCK = fundamentally wrong (off-brief, broken, or trips multiple anti-patterns).`;

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Strip code fences and grab the first {...} object.
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const asStrArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "A bearer token is required." });
    const token = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = parseJwtClaims(token)?.role === "service_role";

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "Request body must be JSON." }); }

    const imageUrl = str(body.image_url);
    const render = (body.render && typeof body.render === "object") ? body.render as Record<string, unknown> : null;
    if (!imageUrl && !render) return json(400, { error: "Provide image_url or render{url|html}." });

    const artifactKind = ["image", "page", "funnel", "form"].includes(str(body.artifact_kind))
      ? str(body.artifact_kind) : "image";
    const brief = str(body.brief).slice(0, 2000);
    const iteration = Math.max(0, Math.floor(num(body.iteration, 0)));
    const spentUsd = Math.max(0, num(body.spent_usd, 0));
    const sessionId = UUID_RE.test(str(body.session_id)) ? str(body.session_id) : null;
    const deliverableId = UUID_RE.test(str(body.deliverable_id)) ? str(body.deliverable_id) : null;

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── §9 tenant resolution — JWT caller can only critique for THEIR OWN tenant ──────────────
    let tenantId: string;
    let actorUserId: string | null = null;
    let actorRole = "operator";
    if (isServiceRole) {
      // Paige's headless agent / an internal edge caller — it has already resolved+authorized a tenant.
      tenantId = str(body.tenant_id);
      if (!UUID_RE.test(tenantId)) return json(400, { error: "A service-role caller must pass a valid tenant_id." });
    } else {
      const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: uErr } = await authed.auth.getUser();
      if (uErr || !user) return json(401, { error: uErr?.message || "Could not verify this session." });
      actorUserId = user.id;
      // The session's own workspace, its owner/admin or managing agency only. A body tenant_id can
      // only be refused here, never chosen — there is no cross-tenant critique on a person's session.
      const caller = await resolveStudioCaller(authed, body.tenant_id);
      if (!caller.ok) {
        return caller.status === 403
          ? json(403, { error: caller.error, forbidden: true })
          : json(500, { error: caller.error });
      }
      tenantId = caller.tenantId;
      actorRole = "tenant"; // acting inside their own workspace (resolveStudioCaller); audit label only
    }

    // ── §33 caps — stop an iterate loop before it runs away ──────────────────────────────────
    if (iteration >= MAX_ITERATIONS || spentUsd >= COST_CAP_USD) {
      const capReason = iteration >= MAX_ITERATIONS
        ? `iteration cap (${MAX_ITERATIONS}) reached`
        : `cost cap ($${COST_CAP_USD}) reached`;
      await logCritique(admin, {
        tenantId, sessionId, deliverableId, artifactKind, iteration,
        verdict: "SHIP", summary: `Stopped iterating — ${capReason}; keeping the current artifact.`,
        findings: {}, model: null, cost: 0, spentUsd, capped: true, lowConfidence: false,
        imageSource: imageUrl ? "image_url" : "render", actorUserId,
      });
      return json(200, {
        ok: true, verdict: "SHIP", capped: true,
        summary: `Stopped iterating — ${capReason}.`,
        blockers: [], should_fix: [], nits: [], cheesy_tells_hit: [], refined_prompt: "",
        iteration, spent_usd: spentUsd, cost_estimate_usd: 0,
      });
    }

    // ── Get the screenshot ───────────────────────────────────────────────────────────────────
    const shot = imageUrl ? await fetchImageAsBase64(imageUrl) : await renderToBase64(render!);
    if (!shot) {
      const needsRenderer = !imageUrl && (!RENDERER_URL || !RENDERER_SECRET);
      const message = needsRenderer
        ? "The visual renderer isn't configured (VISUAL_RENDERER_URL/_SECRET). Deploy services/visual-renderer and set the secrets to critique pages/funnels."
        : "Couldn't capture a screenshot to critique (image unreachable, too large, or render failed).";
      // Honest degrade — never a fabricated verdict (§13).
      return json(200, { ok: false, needs_config: needsRenderer, error: "no_screenshot", message });
    }

    // ── Vision critique via the ONE model seam (Claude-vision only by construction) ───────────
    let res;
    try {
      res = await callModel("vision-critique", "frontier", {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: RUBRIC(artifactKind, brief) },
            { type: "image_url", image_url: { url: `data:${shot.media};base64,${shot.b64}` } },
          ],
        }],
      }, {
        tenantId, actorRole, actorUserId: actorUserId ?? undefined,
        persist: false, callerFunction: "studio-visual-critique",
      });
    } catch (e) {
      // A model/gate throw must not blank the loop — log loudly, fail-open to SHIP (§13/§32).
      console.error("[studio-visual-critique] callModel threw:", e);
      await logCritique(admin, {
        tenantId, sessionId, deliverableId, artifactKind, iteration,
        verdict: "SHIP", summary: "Critic errored — accepting the artifact (fail-open).",
        findings: { error: String((e as Error)?.message ?? e) }, model: null, cost: 0, spentUsd,
        capped: false, lowConfidence: true, imageSource: imageUrl ? "image_url" : "render", actorUserId,
      });
      return json(200, {
        ok: true, verdict: "SHIP", low_confidence: true,
        summary: "Critic errored — accepting the artifact.",
        blockers: [], should_fix: [], nits: [], cheesy_tells_hit: [], refined_prompt: "",
        iteration, spent_usd: spentUsd, cost_estimate_usd: 0,
      });
    }

    if (res?.needs_config) {
      return json(200, { ok: false, needs_config: true, error: "model_needs_config", message: "The vision model isn't configured for critique." });
    }

    const cost = num(res?.cost_estimate_usd, 0);
    const newSpent = Math.round((spentUsd + cost) * 10000) / 10000;
    const parsed = extractJson(str(res?.content));

    if (!parsed || !["SHIP", "ITERATE", "BLOCK"].includes(str(parsed.verdict))) {
      // Unparseable critique — fail-OPEN to SHIP (a broken critic must not block a real artifact) and
      // LOG the malfunction so it's never silent (§13).
      console.error("[studio-visual-critique] unparseable critique reply:", str(res?.content).slice(0, 500));
      await logCritique(admin, {
        tenantId, sessionId, deliverableId, artifactKind, iteration,
        verdict: "SHIP", summary: "Critique unparseable — accepting the artifact (fail-open).",
        findings: { raw: str(res?.content).slice(0, 1000) }, model: str(res?.model) || null, cost,
        spentUsd: newSpent, capped: false, lowConfidence: true,
        imageSource: imageUrl ? "image_url" : "render", actorUserId,
      });
      return json(200, {
        ok: true, verdict: "SHIP", low_confidence: true,
        summary: "Critique unparseable — accepting the artifact.",
        blockers: [], should_fix: [], nits: [], cheesy_tells_hit: [], refined_prompt: "",
        iteration, spent_usd: newSpent, cost_estimate_usd: cost,
      });
    }

    const verdict = str(parsed.verdict);
    const out = {
      verdict,
      summary: str(parsed.summary).slice(0, 500),
      blockers: asStrArray(parsed.blockers),
      should_fix: asStrArray(parsed.should_fix),
      nits: asStrArray(parsed.nits),
      cheesy_tells_hit: asStrArray(parsed.cheesy_tells_hit),
      refined_prompt: verdict === "SHIP" ? "" : str(parsed.refined_prompt).slice(0, 4000),
    };

    await logCritique(admin, {
      tenantId, sessionId, deliverableId, artifactKind, iteration,
      verdict, summary: out.summary,
      findings: { blockers: out.blockers, should_fix: out.should_fix, nits: out.nits, cheesy_tells_hit: out.cheesy_tells_hit },
      model: str(res?.model) || null, cost, spentUsd: newSpent, capped: false, lowConfidence: false,
      imageSource: imageUrl ? "image_url" : "render", actorUserId,
    });

    return json(200, { ok: true, ...out, iteration, spent_usd: newSpent, cost_estimate_usd: cost });
  } catch (e) {
    console.error("[studio-visual-critique] unhandled:", e);
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});

// ── Log row via service role, tenant_id EXPLICIT (§9). Best-effort: logging never blocks the reply. ──
async function logCritique(
  admin: ReturnType<typeof createClient>,
  r: {
    tenantId: string; sessionId: string | null; deliverableId: string | null; artifactKind: string;
    iteration: number; verdict: string; summary: string; findings: Record<string, unknown>;
    model: string | null; cost: number; spentUsd: number; capped: boolean; lowConfidence: boolean;
    imageSource: string; actorUserId: string | null;
  },
): Promise<void> {
  try {
    await admin.from("studio_visual_critique_log").insert({
      tenant_id: r.tenantId,
      session_id: r.sessionId,
      deliverable_id: r.deliverableId,
      artifact_kind: r.artifactKind,
      image_source: r.imageSource,
      iteration: r.iteration,
      verdict: r.verdict,
      summary: r.summary,
      findings: r.findings,
      model: r.model,
      cost_estimate_usd: r.cost,
      spent_usd: r.spentUsd,
      capped: r.capped,
      low_confidence: r.lowConfidence,
      created_by: r.actorUserId,
    });
  } catch (e) {
    console.error("[studio-visual-critique] log insert failed (non-blocking):", e);
  }
}
