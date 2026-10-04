// studio-visual-critique — the Studio design agent's EYES (§25 "see it before you ship it", §33).
//
// A generated Studio artifact is turned into pixels and read by a Claude VISION model, which returns a
// SHIP / ITERATE / BLOCK verdict + concrete findings graded against the SAME anti-pattern vocabulary
// the generator is steered away from (_shared/cheesy-tells.ts, §18 one home for the tells). On
// ITERATE/BLOCK the caller is handed a refined prompt to regenerate — before the tenant sees it.
//
// TWO ways in to pixels (the artifact is already a raster, or it must be rendered):
//   • image_url — an already-rendered image artifact (generate-image returns a public URL). Fetched
//                 directly; no renderer needed.
//   • render    — a LANDING PAGE that is blocks, not pixels, rendered by paige-browser's /render
//                 (services/paige-browser — the ONE browser host, §18; the separate visual-renderer
//                 Fly app was never deployed and is deleted, owner direction 2026-10-04):
//                   render.page = the page payload { blocks, theme?, brand?, tenant_name? } — a DRAFT
//                                 works, it is drawn DB-free at the app's /render-frame;
//                   render.url  = a published landing page (/p/<tenant>/<page>) on a Paige app origin.
//                 Funnels and forms are REFUSED for render: /render-frame draws one block page, and only
//                 the published landing page signals that its data has loaded. Critique them through
//                 image_url, or per landing page.
//                 BOTH paths run only when STUDIO_VISUAL_CRITIQUE_ENABLED is "true" — the same flag that
//                 gates the product loop — so deploying this function opens neither paige-browser nor a
//                 frontier vision call to every workspace owner. Off → `status:"disabled"`, no
//                 paige-browser call, no image fetch, no model call, no row.
//
// ── CONTRACT ────────────────────────────────────────────────────────────────
// POST (JWT or service-role bearer required)
//   Request: {
//     image_url?: string,                                    // path A: critique an existing image
//     render?: { page?: {...} | url?: string, viewport?: "desktop"|"tablet"|"mobile" },  // path B
//     artifact_kind?: "image"|"page"|"funnel"|"form",   // steers the rubric (default "image", or
//                                                       //   "page" when render is given)
//     brief?: string,                           // the original ask, so the critic judges vs intent
//     session_id?: uuid, deliverable_id?: uuid, // the LOOP KEY (deliverable first) — see §33 below
//     iteration?: number, spent_usd?: number,   // the caller's claim; never lowers the server's count
//     tenant_id?: uuid                          // REQUIRED for a service-role caller, and it is the
//                                               // tenant the log row and the model trace carry. A JWT
//                                               // caller's tenant is their session's workspace (§9);
//                                               // a tenant_id naming any other workspace is refused
//   }
//   200 { ok:true, verdict, summary, blockers[], should_fix[], nits[], cheesy_tells_hit[],
//         refined_prompt?, iteration, cost_estimate_usd, spent_usd, capped?, capture?, logged, log_error? }
//   200 { ok:false, verdict:"NO_VERDICT", reason, message, needs_config, logged, log_error? }
//        reason ∈ screenshot_service_unavailable | render_failed | screenshot_unavailable |
//                 image_unavailable | critique_unavailable | critique_failed   (also in findings.reason)
//   200 { ok:false, status:"disabled", message }   — either path while the flag is off (NO row: never attempted)
//   429 { ok:false, status:"throttled", retry_after_seconds, message } — per-tenant throttle (NO row)
//   503 { ok:false, status:"throttle_unavailable"|"loop_state_unavailable", message } — fail closed (NO row)
//   403 { error, forbidden:true } · 500 { error } · 4xx { error }
//
// ── DOCTRINE ─────────────────────────────────────────────────────────────────
//   §9  — a JWT caller can ONLY critique for the workspace their session is in, and only as its
//         owner/admin or managing agency (_shared/studio-caller.ts resolveStudioCaller). A service-role
//         caller (Paige's headless agent) must pass tenant_id; that tenant is what the log + trace record.
//         Input parsing and the render URL's DNS check run only AFTER the caller is authenticated.
//   §13 — "never attempted" writes NO row (flag off, throttled, bad input, refused caller). An attempt
//         that produced no verdict writes verdict NO_VERDICT with one of six reason codes — it is never
//         dressed up as a SHIP. That includes a critic that threw or replied unparseably (formerly a
//         fail-open SHIP with low_confidence): a fabricated SHIP is worse than "no review", and the gate
//         treats NO_VERDICT as no review (keeps the original artifact, no regeneration). The insert's
//         error is checked and returned (`logged:false, log_error`). cost_estimate_usd is an ESTIMATE.
//   §33 — caps: MAX_ITERATIONS and COST_CAP_USD, enforced on SERVER-DERIVED state, not the caller's
//         word. With a loop key (deliverable_id, else session_id) the function counts this tenant's
//         critique rows for that key over the last STUDIO_CRITIQUE_LOOP_WINDOW_MIN minutes: effective
//         iteration = max(claimed, critiques that ran), effective spend = max(claimed, summed estimates).
//         Without a key there is nothing to derive from, so the claim is used AND the per-tenant
//         throttle is the backstop: at most STUDIO_CRITIQUE_THROTTLE_MAX rows per
//         STUDIO_CRITIQUE_THROTTLE_WINDOW_MIN minutes (default 12 per 10), counted before any work.
//   §17/§18 — the vision pass routes through the ONE model seam (callModel "vision-critique"/"frontier")
//         which is Claude-vision ONLY by construction (no open-tier cell exists). No second vision client.
//   §32 — the renderer is smoke-tested (services/paige-browser/smoke-render.mjs); every failure path here
//         degrades to something VISIBLE (a reason code + a log row), never a silent blank.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { callModel } from "../_shared/model-router.ts";
import { CHEESY_TELLS_AVOID } from "../_shared/cheesy-tells.ts";
import { assertPublicHttpUrl } from "../_shared/ssrf-guard.ts";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// paige-browser — the one browser host. The same two secrets skill-runner already reads.
const BROWSER_URL = (Deno.env.get("PAIGE_BROWSER_URL") ?? "").replace(/\/+$/, "");
const BROWSER_SECRET = Deno.env.get("PAIGE_BROWSER_SECRET") ?? "";
// Both critique paths (image_url and render) are live only with the product loop's own flag (read per
// request, so flipping it needs no deploy).
const critiqueEnabled = () => (Deno.env.get("STUDIO_VISUAL_CRITIQUE_ENABLED") ?? "").toLowerCase() === "true";

const envInt = (k: string, d: number, lo: number, hi: number) => {
  const n = Math.floor(Number(Deno.env.get(k) ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d;
};
// Same contract for a decimal: unset, blank, non-numeric or ≤0 falls back to the default, and the value
// is clamped — a malformed env var can never become NaN and silently switch a cap off (NaN >= x is false).
const envNumber = (k: string, d: number, lo: number, hi: number) => {
  const n = Number(Deno.env.get(k) ?? "");
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d;
};
// §33 loop ceilings (env-overridable so they can be retuned without a deploy).
const MAX_ITERATIONS = envInt("STUDIO_CRITIQUE_MAX_ITERATIONS", 3, 1, 10);
const COST_CAP_USD = envNumber("STUDIO_CRITIQUE_COST_CAP_USD", 2, 0.01, 50);
const THROTTLE_WINDOW_MIN = envInt("STUDIO_CRITIQUE_THROTTLE_WINDOW_MIN", 10, 1, 1440);
const THROTTLE_MAX = envInt("STUDIO_CRITIQUE_THROTTLE_MAX", 12, 1, 500);
const LOOP_WINDOW_MIN = envInt("STUDIO_CRITIQUE_LOOP_WINDOW_MIN", 60, 1, 1440);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw per image — stays under Claude's ~5MB base64-DECODED
                                          // ceiling (base64 inflates ~33%), so a valid image never
                                          // wastes a frontier call by over-shooting the model limit (§13).
// How many page slices (top first) one critique asks for and sends, and the raw-byte budget across
// them. Slices are ~1600 CSS px of a page each; four covers a typical landing page's top 6400px.
const MAX_SLICES_TO_MODEL = Math.max(1, Math.min(8, Number(Deno.env.get("STUDIO_CRITIQUE_MAX_SLICES") ?? "4") || 4));
const MAX_TOTAL_SLICE_BYTES = 12 * 1024 * 1024;
// paige-browser's PAIGE_RENDER_MAX_PAYLOAD_BYTES default. Measured on the SAME object paige-browser
// measures (render.mjs pickPagePayload: blocks, theme|null, brand|null, tenant_name|null) the SAME way
// (UTF-8 bytes of JSON.stringify), so the two caps agree to the byte.
const MAX_PAGE_PAYLOAD_BYTES = 1_000_000;
const RENDER_TIMEOUT_MS = 50_000; // paige-browser answers inside its own 45s cap; this only bounds the wait.
const VIEWPORTS = ["desktop", "tablet", "mobile"];
const LOG_TABLE = "studio_visual_critique_log";

type NoVerdictReason =
  | "screenshot_service_unavailable" | "render_failed" | "screenshot_unavailable"
  | "image_unavailable" | "critique_unavailable" | "critique_failed";

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
const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

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

interface Shot { b64: string; media: string }
interface Capture { width: number; full_height: number; slices_sent: number; slices_total: number; truncated: boolean; viewport: string }
type ShotResult =
  | { ok: true; shots: Shot[]; capture: Capture | null }
  | { ok: false; reason: NoVerdictReason; detail: string; needsConfig?: boolean };

/** Fetch an image URL → base64 (bounded). Never throws — a failure is an explicit reason code. */
async function fetchImage(url: string): Promise<ShotResult> {
  try {
    // §13 SSRF: reject private/link-local/metadata targets BEFORE fetching, and refuse redirects so a
    // redirect can't bounce us to an internal host after the check.
    await assertPublicHttpUrl(url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!resp.ok) return { ok: false, reason: "image_unavailable", detail: `image fetch answered HTTP ${resp.status}` };
    const media = (resp.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!media.startsWith("image/")) return { ok: false, reason: "image_unavailable", detail: `not an image (${media})` };
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, reason: "image_unavailable", detail: `image size out of range: ${buf.byteLength} bytes` };
    }
    return { ok: true, shots: [{ b64: base64Encode(buf), media }], capture: null };
  } catch (e) {
    // §32: the CAUSE (ssrf-block vs unreachable vs redirect) is carried, never a silent null.
    const detail = String((e as Error)?.message ?? e);
    console.error("[studio-visual-critique] image fetch failed:", detail);
    return { ok: false, reason: "image_unavailable", detail: `image fetch failed: ${detail}` };
  }
}

/** Render a landing page via paige-browser /render and pick the slices to send. Never throws. */
async function renderSlices(request: Record<string, unknown>, viewport: string): Promise<ShotResult> {
  if (!BROWSER_URL || !BROWSER_SECRET) {
    return { ok: false, reason: "screenshot_service_unavailable", detail: "PAIGE_BROWSER_URL / PAIGE_BROWSER_SECRET are not set", needsConfig: true };
  }
  let resp: Response;
  try {
    resp = await fetch(`${BROWSER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Browser-Secret": BROWSER_SECRET },
      // maxSlices: ask only for what this function will send — no capture work the model never sees.
      body: JSON.stringify({ ...request, viewport, maxSlices: MAX_SLICES_TO_MODEL }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch (e) {
    const detail = String((e as Error)?.message ?? e);
    console.error("[studio-visual-critique] screenshot service unreachable:", detail);
    return { ok: false, reason: "screenshot_service_unavailable", detail: `screenshot service unreachable: ${detail}` };
  }
  let body: Record<string, unknown> = {};
  let parsed = true;
  try { body = await resp.json(); } catch { parsed = false; }
  // The SERVICE could not take the job (down, busy, rate-limited, mis-secreted) — not a render result.
  if (!parsed || resp.status === 429 || resp.status === 401 || resp.status >= 500) {
    const detail = `screenshot service answered HTTP ${resp.status}${str(body.reason) ? ` (${str(body.reason)})` : ""}`;
    console.error(`[studio-visual-critique] ${detail}`);
    return { ok: false, reason: "screenshot_service_unavailable", detail };
  }
  if (!resp.ok || body.ok !== true) {
    const r = str(body.reason) || `http_${resp.status}`;
    const d = str(body.error);
    console.error(`[studio-visual-critique] render refused/failed: ${r}${d ? ` — ${d}` : ""}`);
    return { ok: false, reason: "render_failed", detail: d ? `${r}: ${d}` : r };
  }
  const all = Array.isArray(body.slices) ? body.slices.filter((s) => isObj(s) && typeof s.jpeg_base64 === "string") : [];
  if (all.length === 0) return { ok: false, reason: "screenshot_unavailable", detail: "the renderer returned no slices" };
  const shots: Shot[] = [];
  let total = 0;
  for (const s of all.slice(0, MAX_SLICES_TO_MODEL)) {
    const b64 = (s as { jpeg_base64: string }).jpeg_base64;
    const raw = Math.floor((b64.length * 3) / 4);
    if (raw > MAX_IMAGE_BYTES || total + raw > MAX_TOTAL_SLICE_BYTES) break;
    total += raw;
    shots.push({ b64, media: "image/jpeg" });
  }
  if (shots.length === 0) return { ok: false, reason: "screenshot_unavailable", detail: "every slice exceeded the image size budget" };
  return {
    ok: true,
    shots,
    capture: {
      width: num(body.width, 0),
      full_height: num(body.full_height, 0),
      slices_sent: shots.length,
      slices_total: all.length,
      // Honest coverage: the model is not seeing the whole page if paige-browser truncated it OR we
      // sent fewer slices than it captured.
      truncated: body.truncated === true || shots.length < all.length,
      viewport,
    },
  };
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

function coverageNote(c: Capture | null, shots: number): string {
  if (!c) return "";
  const seen = `You are looking at ${shots} screenshot slice${shots === 1 ? "" : "s"}, top to bottom, of a page rendered at ${c.width}px wide (${c.viewport}); the full page is ${c.full_height}px tall.`;
  return c.truncated
    ? ` ${seen} The page CONTINUES below what you can see — judge only what is shown and do not assume what is not.`
    : ` ${seen} Together they show the whole page.`;
}

const RUBRIC = (kind: string, brief: string, coverage: string) => `You are a world-class design critic — the standard is Linear, Stripe, Vercel, Framer, Raycast. You are looking at a screenshot of a ${kind} a design agent just generated${brief ? ` for this brief: "${brief}"` : ""}.${coverage}

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

/** Normalize body.render into the paige-browser request, or an input error. */
function parseRender(render: Record<string, unknown>, artifactKind: string): { request: Record<string, unknown>; viewport: string } | { error: string } {
  if ("html" in render) return { error: "render.html is no longer supported — send render.page (the page payload) or render.url." };
  if (artifactKind === "funnel" || artifactKind === "form") {
    return { error: `render supports landing pages only: /render-frame draws a single block page and only a published landing page signals that its data has loaded, so a ${artifactKind} cannot be rendered truthfully yet. Critique its pages one by one, or send image_url.` };
  }
  const viewport = render.viewport == null || render.viewport === "" ? "desktop" : str(render.viewport);
  if (!VIEWPORTS.includes(viewport)) return { error: `render.viewport must be one of ${VIEWPORTS.join(", ")}.` };
  const hasPage = render.page != null;
  const hasUrl = str(render.url) !== "";
  if (hasPage === hasUrl) return { error: "render needs exactly one of page or url." };
  if (hasPage) {
    if (!isObj(render.page) || !Array.isArray(render.page.blocks)) return { error: "render.page must be an object with a blocks array." };
    const p = render.page;
    // The identical shape paige-browser's pickPagePayload builds — so both caps measure the same bytes.
    const page = {
      blocks: p.blocks,
      theme: isObj(p.theme) ? p.theme : null,
      brand: isObj(p.brand) ? p.brand : null,
      tenant_name: typeof p.tenant_name === "string" ? p.tenant_name.slice(0, 200) : null,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
    if (bytes > MAX_PAGE_PAYLOAD_BYTES) return { error: `render.page is ${bytes} bytes; the cap is ${MAX_PAGE_PAYLOAD_BYTES}.` };
    return { request: { page }, viewport };
  }
  return { request: { url: str(render.url) }, viewport };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "A bearer token is required." });
    const token = authHeader.slice("Bearer ".length).trim();
    const isServiceRole = parseJwtClaims(token)?.role === "service_role";

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "Request body must be JSON." }); }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── §9 tenant resolution FIRST — nothing about the request is parsed or resolved for an unknown caller ──
    let tenantId: string;
    let actorUserId: string | null = null;
    let actorRole = "operator";
    if (isServiceRole) {
      // Paige's headless agent / an internal edge caller — it has already resolved+authorized a tenant.
      // That tenant is the one the log row AND the model trace carry below.
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

    // ── Input (after auth) ───────────────────────────────────────────────────────────────────
    const imageUrl = str(body.image_url);
    const render = isObj(body.render) ? body.render : null;
    if (!imageUrl && !render) return json(400, { error: "Provide image_url or render{page|url}." });
    if (imageUrl && render) return json(400, { error: "Provide image_url or render, not both." });
    const kinds = ["image", "page", "funnel", "form"];
    const artifactKind = kinds.includes(str(body.artifact_kind)) ? str(body.artifact_kind) : (render ? "page" : "image");
    let renderReq: { request: Record<string, unknown>; viewport: string } | null = null;
    if (render) {
      const parsed = parseRender(render, artifactKind);
      if ("error" in parsed) return json(400, { error: parsed.error });
      // Defense in depth (§13): a url target is SSRF-checked here too; paige-browser also allowlists
      // it to Paige's own app origins and runs its own guard.
      if (typeof parsed.request.url === "string") {
        try { await assertPublicHttpUrl(parsed.request.url); } catch (e) {
          return json(400, { error: `render.url rejected: ${String((e as Error)?.message ?? e)}` });
        }
      }
      renderReq = parsed;
    }
    const brief = str(body.brief).slice(0, 2000);
    const claimedIteration = Math.max(0, Math.floor(num(body.iteration, 0)));
    const claimedSpent = Math.max(0, num(body.spent_usd, 0));
    const sessionId = UUID_RE.test(str(body.session_id)) ? str(body.session_id) : null;
    const deliverableId = UUID_RE.test(str(body.deliverable_id)) ? str(body.deliverable_id) : null;
    const imageSource = imageUrl ? "image_url" : "render";

    // ── Both paths are live only with the product flag. Never attempted → no row, no call. ──
    if (!critiqueEnabled()) {
      return json(200, {
        ok: false, status: "disabled",
        message: render
          ? "Page critique is switched off (STUDIO_VISUAL_CRITIQUE_ENABLED). Nothing was rendered or recorded."
          : "Image critique is switched off (STUDIO_VISUAL_CRITIQUE_ENABLED). Nothing was fetched or recorded.",
      });
    }

    // ── Per-tenant throttle, before ANY work or row. Fails closed. ───────────────────────────
    // NOT ATOMIC UNDER CONCURRENCY (§13). This is a count-then-insert: the row that "spends" a slot is
    // only written after the model call, so N parallel requests can all read the same count (e.g. 0)
    // and all run — bypassing THROTTLE_MAX here and the §33 iteration/cost caps below, which read the
    // same rows the same way. An atomic reservation (an advisory-locked count+insert of a pending row,
    // per tenant and per loop key) is a REQUIRED prerequisite before STUDIO_VISUAL_CRITIQUE_ENABLED is
    // ever turned on. The flag is OFF by owner ruling, so today this path is unreachable.
    const since = new Date(Date.now() - THROTTLE_WINDOW_MIN * 60_000).toISOString();
    const { count: recent, error: tErr } = await admin.from(LOG_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", since);
    if (tErr) {
      console.error("[studio-visual-critique] throttle count failed (refusing):", tErr);
      return json(503, { ok: false, status: "throttle_unavailable", message: "Couldn't check this workspace's critique budget, so nothing was run. Try again shortly." });
    }
    if ((recent ?? 0) >= THROTTLE_MAX) {
      return json(429, {
        ok: false, status: "throttled", retry_after_seconds: THROTTLE_WINDOW_MIN * 60,
        message: `This workspace has used its ${THROTTLE_MAX} critiques for the last ${THROTTLE_WINDOW_MIN} minutes. Nothing was run.`,
      });
    }

    // ── §33 loop state from the server's own rows, never lower than the caller's claim ────────
    let derivedIteration = 0;
    let derivedSpent = 0;
    const loopKey = deliverableId ? { col: "deliverable_id", val: deliverableId } : sessionId ? { col: "session_id", val: sessionId } : null;
    if (loopKey) {
      const loopSince = new Date(Date.now() - LOOP_WINDOW_MIN * 60_000).toISOString();
      const { data: rows, error: lErr } = await admin.from(LOG_TABLE)
        .select("verdict, capped, cost_estimate_usd")
        .eq("tenant_id", tenantId)
        .eq(loopKey.col, loopKey.val)
        .gte("created_at", loopSince)
        .limit(500);
      if (lErr) {
        console.error("[studio-visual-critique] loop-state read failed (refusing):", lErr);
        return json(503, { ok: false, status: "loop_state_unavailable", message: "Couldn't read this loop's history, so nothing was run. Try again shortly." });
      }
      for (const r of (rows ?? []) as Array<{ verdict?: string; capped?: boolean; cost_estimate_usd?: number | string | null }>) {
        derivedSpent += Number(r.cost_estimate_usd ?? 0) || 0;
        if (r.verdict && r.verdict !== "NO_VERDICT" && !r.capped) derivedIteration += 1;
      }
      derivedSpent = Math.round(derivedSpent * 10000) / 10000;
    }
    const iteration = Math.max(claimedIteration, derivedIteration);
    const spentUsd = Math.max(claimedSpent, derivedSpent);
    const loopState = { iteration_claimed: claimedIteration, iteration_derived: derivedIteration, spent_claimed: claimedSpent, spent_derived: derivedSpent, key: loopKey?.col ?? null };

    const baseLog = { tenantId, sessionId, deliverableId, artifactKind, iteration, imageSource, actorUserId };
    const noVerdict = async (reason: NoVerdictReason, message: string, detail: string, extra: { needsConfig?: boolean; model?: string | null; cost?: number; spent?: number } = {}) => {
      // Attempted, but no verdict. Never a SHIP; the reason code is stored and returned (§13).
      const log = await logCritique(admin, {
        ...baseLog, verdict: "NO_VERDICT", summary: message.slice(0, 500),
        findings: { reason, detail: detail.slice(0, 1000) },
        model: extra.model ?? null, cost: extra.cost ?? 0, spentUsd: extra.spent ?? spentUsd, capped: false, lowConfidence: false,
      });
      return json(200, {
        ok: false, verdict: "NO_VERDICT", reason, needs_config: extra.needsConfig === true, message,
        iteration, spent_usd: extra.spent ?? spentUsd, cost_estimate_usd: extra.cost ?? 0, loop: loopState, ...log,
      });
    };

    // ── §33 caps — stop an iterate loop before it runs away ──────────────────────────────────
    if (iteration >= MAX_ITERATIONS || spentUsd >= COST_CAP_USD) {
      const capReason = iteration >= MAX_ITERATIONS
        ? `iteration cap (${MAX_ITERATIONS}) reached`
        : `cost cap ($${COST_CAP_USD}) reached`;
      const log = await logCritique(admin, {
        ...baseLog, verdict: "SHIP", summary: `Stopped iterating — ${capReason}; keeping the current artifact.`,
        findings: { loop: loopState }, model: null, cost: 0, spentUsd, capped: true, lowConfidence: false,
      });
      return json(200, {
        ok: true, verdict: "SHIP", capped: true,
        summary: `Stopped iterating — ${capReason}.`,
        blockers: [], should_fix: [], nits: [], cheesy_tells_hit: [], refined_prompt: "",
        iteration, spent_usd: spentUsd, cost_estimate_usd: 0, loop: loopState, ...log,
      });
    }

    // ── Get the pixels ───────────────────────────────────────────────────────────────────────
    const shot = imageUrl ? await fetchImage(imageUrl) : await renderSlices(renderReq!.request, renderReq!.viewport);
    if (!shot.ok) {
      const message = shot.reason === "screenshot_service_unavailable"
        ? (shot.needsConfig
          ? "The screenshot service isn't configured (PAIGE_BROWSER_URL / PAIGE_BROWSER_SECRET), so pages can't be critiqued yet."
          : `The screenshot service couldn't take the job (${shot.detail}).`)
        : shot.reason === "render_failed"
          ? `Couldn't render the page to critique it (${shot.detail}).`
          : shot.reason === "screenshot_unavailable"
            ? `The page rendered but no usable screenshot came back (${shot.detail}).`
            : `Couldn't fetch the image to critique it (${shot.detail}).`;
      return await noVerdict(shot.reason, message, shot.detail, { needsConfig: shot.needsConfig });
    }

    // ── Vision critique via the ONE model seam (Claude-vision only by construction) ───────────
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: RUBRIC(artifactKind, brief, coverageNote(shot.capture, shot.shots.length)) },
      ...shot.shots.map((s) => ({ type: "image_url", image_url: { url: `data:${s.media};base64,${s.b64}` } })),
    ];
    const capture = shot.capture ?? undefined;
    let res;
    try {
      res = await callModel("vision-critique", "frontier", { messages: [{ role: "user", content }] }, {
        tenantId, actorRole, actorUserId: actorUserId ?? undefined,
        persist: false, callerFunction: "studio-visual-critique",
      });
    } catch (e) {
      // The critic itself failed. NOT a SHIP — "no review", logged, and the caller keeps its artifact.
      console.error("[studio-visual-critique] callModel threw:", e);
      const detail = String((e as Error)?.message ?? e);
      return await noVerdict("critique_failed", "The critic failed, so this artifact has not been reviewed.", detail);
    }

    if (res?.needs_config) {
      return await noVerdict("critique_unavailable", "The vision model isn't configured for critique.", "callModel vision-critique answered needs_config", { needsConfig: true });
    }

    const cost = num(res?.cost_estimate_usd, 0); // an ESTIMATE from the router, never a billed figure
    const newSpent = Math.round((spentUsd + cost) * 10000) / 10000;
    const parsed = extractJson(str(res?.content));

    if (!parsed || !["SHIP", "ITERATE", "BLOCK"].includes(str(parsed.verdict))) {
      // The model ran (and cost something) but gave no usable verdict: NO_VERDICT, never a fabricated SHIP.
      console.error("[studio-visual-critique] unparseable critique reply:", str(res?.content).slice(0, 500));
      return await noVerdict("critique_failed", "The critic's reply couldn't be read, so this artifact has not been reviewed.",
        `unparseable reply: ${str(res?.content).slice(0, 900)}`, { model: str(res?.model) || null, cost, spent: newSpent });
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

    const log = await logCritique(admin, {
      ...baseLog, verdict, summary: out.summary,
      findings: { blockers: out.blockers, should_fix: out.should_fix, nits: out.nits, cheesy_tells_hit: out.cheesy_tells_hit, capture },
      model: str(res?.model) || null, cost, spentUsd: newSpent, capped: false, lowConfidence: false,
    });

    return json(200, { ok: true, ...out, iteration, spent_usd: newSpent, cost_estimate_usd: cost, capture, loop: loopState, ...log });
  } catch (e) {
    console.error("[studio-visual-critique] unhandled:", e);
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});

// ── Log row via service role, tenant_id EXPLICIT (§9). Logging never blocks the reply, but its
// outcome is CHECKED and returned to the caller — a row that failed to write is reported, not assumed.
async function logCritique(
  // Typed SupabaseClient, not ReturnType<typeof createClient>: the inferred form resolves table rows
  // to `never` and the insert fails overload resolution (the model-router / llm-trace idiom).
  admin: SupabaseClient,
  r: {
    tenantId: string; sessionId: string | null; deliverableId: string | null; artifactKind: string;
    iteration: number; verdict: "SHIP" | "ITERATE" | "BLOCK" | "NO_VERDICT" | string; summary: string;
    findings: Record<string, unknown>; model: string | null; cost: number; spentUsd: number;
    capped: boolean; lowConfidence: boolean; imageSource: string; actorUserId: string | null;
  },
): Promise<{ logged: true } | { logged: false; log_error: string }> {
  try {
    const { error } = await admin.from(LOG_TABLE).insert({
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
      cost_estimate_usd: r.cost, // labelled ESTIMATE in the column comment and the contract
      spent_usd: r.spentUsd,
      capped: r.capped,
      low_confidence: r.lowConfidence,
      created_by: r.actorUserId,
    });
    if (error) {
      const msg = String((error as { message?: string }).message ?? error);
      console.error("[studio-visual-critique] log insert failed:", msg);
      return { logged: false, log_error: msg };
    }
    return { logged: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[studio-visual-critique] log insert threw:", msg);
    return { logged: false, log_error: msg };
  }
}
