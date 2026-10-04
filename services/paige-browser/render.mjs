// paige-browser /render — screenshots of Paige's OWN pages for the Studio visual-critique loop (§33).
//
// WHY IT LIVES HERE (§18 one browser host, owner direction 2026-10-04): the critique loop needs a warm
// Playwright that can capture a page. paige-browser already IS that host — live on Fly, secret-gated,
// rate-limited, concurrency-capped, SSRF-fenced. A second Fly app (services/visual-renderer) was
// written for this and never deployed; it is deleted, and screenshots are a capability of this host.
//
// EXTRACTED to its own module (like ssrf-guard.mjs) so smoke-render.mjs runs the REAL capture code,
// not a hand-copied mirror (§32: a green build is not a working render). server.js starts a listener
// on import, so the testable logic cannot live there.
//
// Two targets, both Paige's own (never an arbitrary URL — that is /browse-public-url's job, gated):
//   { url }   a page on an allowlisted Paige app origin (PAIGE_RENDER_ALLOWED_ORIGINS), e.g. a
//             published /p/<tenant>/<page>. Exact-origin match, THEN the SSRF guard.
//   { page }  a draft that exists only as data. The browser opens ${PAIGE_APP_ORIGIN}/render-frame and
//             the payload is injected before any script runs (addInitScript). The frame is DB-free:
//             it renders the payload through the same <GrowthBlocks> the public page uses.
//
// Output is full-page, in SLICES: JPEG at DPR 1, each slice at most ~1600 CSS px tall, a hard cap on
// slice count. A 2x full-page PNG was 6-7 MB — over the edge function's 4 MB image budget — so the
// capture is sized for the consumer, not for print. `truncated:true` says honestly that the page ran
// past the slice cap; nothing pretends the bottom was seen.
//
// §13 every failure is { ok:false, reason, error } — never a placeholder image. §9/§34 DB-free: no
// Supabase creds, no tenant rows; the calling edge function owns scope and the audit row.
import { urlBlockReason, installReadOnlyBrowserEgress } from "./ssrf-guard.mjs";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const VIEWPORT_PRESETS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  tablet: Object.freeze({ width: 834, height: 1112 }),
  mobile: Object.freeze({ width: 390, height: 844, isMobile: true, hasTouch: true, userAgent: MOBILE_UA }),
});

const DEFAULT_ALLOWED_ORIGINS = "https://paigeagent.ai,https://app.paigeagent.ai";
const DEFAULT_APP_ORIGIN = "https://paigeagent.ai";
export const RENDER_FRAME_PATH = "/render-frame";
export const DEFAULT_PAGE_READY_SELECTOR = '[data-render-ready="true"]';
// Every app page carries this post-hydration marker (src/main.tsx) — the published-URL default.
export const DEFAULT_URL_READY_SELECTOR = "[data-app-ready]";

const int = (v, d, lo, hi) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d;
};

function normalizeOrigin(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Resolved render configuration. Every knob has a safe default so no new Fly secret is required. */
export function renderConfig(env = process.env) {
  const allowedOrigins = new Set(
    String(env.PAIGE_RENDER_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
      .split(",").map(normalizeOrigin).filter(Boolean),
  );
  return {
    allowedOrigins,
    appOrigin: normalizeOrigin(env.PAIGE_APP_ORIGIN || DEFAULT_APP_ORIGIN) || DEFAULT_APP_ORIGIN,
    maxPayloadBytes: int(env.PAIGE_RENDER_MAX_PAYLOAD_BYTES, 1_000_000, 1_000, 1_800_000),
    sliceHeight: int(env.PAIGE_RENDER_SLICE_HEIGHT, 1600, 400, 4000),
    maxSlices: int(env.PAIGE_RENDER_MAX_SLICES, 8, 1, 20),
    jpegQuality: int(env.PAIGE_RENDER_JPEG_QUALITY, 80, 30, 95),
    readyTimeoutMs: int(env.PAIGE_RENDER_READY_TIMEOUT_MS, 15_000, 500, 30_000),
    maxSliceBytes: int(env.PAIGE_RENDER_MAX_SLICE_BYTES, 3_500_000, 50_000, 4_000_000),
  };
}

const fail = (status, reason, error) => ({ ok: false, status, reason, error });
const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** Only the fields the render frame reads cross into the browser — never whatever else a caller sent. */
function pickPagePayload(page) {
  return {
    blocks: page.blocks,
    theme: isPlainObject(page.theme) ? page.theme : null,
    brand: isPlainObject(page.brand) ? page.brand : null,
    tenant_name: typeof page.tenant_name === "string" ? page.tenant_name.slice(0, 200) : null,
  };
}

/**
 * Validate a /render body. Returns the normalized request, or { ok:false, status, reason, error }.
 * Never throws. Every refusal carries a stable reason code the caller can log (§13).
 */
export async function validateRenderRequest(body, cfg) {
  const b = isPlainObject(body) ? body : {};
  const hasUrl = b.url != null && b.url !== "";
  const hasPage = b.page != null;
  if (hasUrl === hasPage) return fail(400, "bad_request", "provide exactly one of url or page");

  const viewportName = b.viewport == null || b.viewport === "" ? "desktop" : String(b.viewport);
  if (!Object.prototype.hasOwnProperty.call(VIEWPORT_PRESETS, viewportName)) {
    return fail(400, "invalid_viewport", `viewport must be one of ${Object.keys(VIEWPORT_PRESETS).join(", ")}`);
  }

  let waitForSelector = null;
  if (b.waitForSelector != null && b.waitForSelector !== "") {
    if (typeof b.waitForSelector !== "string" || b.waitForSelector.length > 200) {
      return fail(400, "invalid_selector", "waitForSelector must be a string of at most 200 characters");
    }
    waitForSelector = b.waitForSelector;
  }

  if (hasUrl) {
    let u;
    try { u = new URL(String(b.url)); } catch { return fail(400, "invalid_url", "url is not a valid URL"); }
    if (u.protocol !== "https:" && u.protocol !== "http:") return fail(400, "invalid_url", "url must be http(s)");
    if (u.username || u.password) return fail(400, "invalid_url", "url must not carry credentials");
    if (!cfg.allowedOrigins.has(u.origin)) {
      return fail(403, "origin_not_allowed", `url origin ${u.origin} is not a Paige app origin this host renders`);
    }
    const blocked = await urlBlockReason(u.href);
    if (blocked) return fail(400, `blocked:${blocked}`, `url rejected: ${blocked}`);
    return {
      ok: true, mode: "url", target: u.href, expectOrigin: u.origin, payload: null, viewportName,
      readySelector: waitForSelector || DEFAULT_URL_READY_SELECTOR,
    };
  }

  if (!isPlainObject(b.page)) return fail(400, "invalid_page", "page must be an object");
  if (!Array.isArray(b.page.blocks)) return fail(400, "invalid_page", "page.blocks must be an array");
  const payload = pickPagePayload(b.page);
  let size;
  try { size = Buffer.byteLength(JSON.stringify(payload), "utf8"); } catch { return fail(400, "invalid_page", "page is not serializable"); }
  if (size > cfg.maxPayloadBytes) {
    return fail(413, "payload_too_large", `page payload is ${size} bytes; the cap is ${cfg.maxPayloadBytes}`);
  }
  const target = `${cfg.appOrigin}${RENDER_FRAME_PATH}`;
  const blocked = await urlBlockReason(target);
  if (blocked) return fail(503, `app_origin_blocked:${blocked}`, `the configured app origin is not renderable: ${blocked}`);
  return {
    ok: true, mode: "page", target, expectOrigin: cfg.appOrigin, payload, viewportName,
    readySelector: waitForSelector || DEFAULT_PAGE_READY_SELECTOR,
  };
}

function contextOptions(viewportName) {
  const p = VIEWPORT_PRESETS[viewportName];
  return {
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: 1,
    isMobile: !!p.isMobile,
    hasTouch: !!p.hasTouch,
    ...(p.userAgent ? { userAgent: p.userAgent } : {}),
    serviceWorkers: "block",
    // Entrance animations (gp-fade-rise, aurora drift) all no-op under reduced motion, so a capture is
    // the settled page rather than a frame of a transition.
    reducedMotion: "reduce",
  };
}

/**
 * Capture the validated request as full-page JPEG slices. NEVER throws: every failure is an honest
 * { ok:false, reason, error }. `opts.instrumentContext(ctx)` runs BEFORE the egress fence is
 * installed (test receivers only — the fence still decides first, exactly as in production);
 * `opts.onPage(page)` lets a smoke inspect the live page before the context closes.
 */
export async function renderCapture(browser, req, cfg, opts = {}) {
  const start = Date.now();
  const navTimeout = opts.navTimeout ?? 30_000;
  const stepTimeout = opts.stepTimeout ?? 10_000;
  const done = (o) => ({ ...o, viewport: req.viewportName, mode: req.mode, duration_ms: Date.now() - start });
  let ctx = null;
  try {
    ctx = await browser.newContext(contextOptions(req.viewportName));
    if (opts.instrumentContext) await opts.instrumentContext(ctx);
    await installReadOnlyBrowserEgress(ctx);
    if (req.mode === "page") {
      // Injected into the render frame ONLY. addInitScript also runs in child frames (a media block's
      // third-party iframe), so the payload — an unpublished draft — is set only when the document is
      // the frame itself on the configured app origin.
      await ctx.addInitScript(({ payload, origin, path }) => {
        if (window.location.origin === origin && window.location.pathname === path) {
          Object.defineProperty(window, "__PAIGE_RENDER_PAYLOAD__", { value: payload, writable: false, configurable: false });
        }
      }, { payload: req.payload, origin: req.expectOrigin, path: RENDER_FRAME_PATH });
    }
    const page = await ctx.newPage();
    page.setDefaultTimeout(stepTimeout);

    let response;
    try {
      response = await page.goto(req.target, { waitUntil: "load", timeout: navTimeout });
    } catch (e) {
      console.error("[paige-browser] render navigation failed for", req.target + ":", e?.message || e);
      return done({ ok: false, reason: "navigation_failed", error: `navigation failed: ${String(e?.message || e)}` });
    }
    const http_status = response ? response.status() : null;
    if (http_status != null && http_status >= 400) {
      return done({ ok: false, reason: `http_${http_status}`, error: `the page answered HTTP ${http_status}`, http_status });
    }
    // Off-origin = refuse. Checked after navigation AND again right before capture, because a client-side
    // redirect (location.replace in a script) lands AFTER goto resolves — and its target might carry a
    // ready marker of its own. Only a page still on the Paige origin is ever captured.
    const offOrigin = () => {
      const url = page.url();
      let origin = null;
      try { origin = new URL(url).origin; } catch { /* stays null */ }
      if (origin === req.expectOrigin) return null;
      console.error("[paige-browser] render redirected off-origin:", url);
      return done({ ok: false, reason: "blocked_redirect", error: "the page redirected away from the Paige app origin", final_url: url, http_status });
    };
    const early = offOrigin();
    if (early) return early;

    try {
      // `attached`, not visible: the app's post-hydration marker is a hidden element.
      await page.waitForSelector(req.readySelector, { state: "attached", timeout: cfg.readyTimeoutMs });
    } catch {
      const moved = offOrigin();
      if (moved) return moved;
      console.error(`[paige-browser] render never became ready (${req.readySelector}) for`, req.target);
      return done({ ok: false, reason: "not_ready", error: `the page never signalled ready (${req.readySelector}) within ${cfg.readyTimeoutMs}ms`, final_url: page.url(), http_status });
    }

    if (req.mode === "url") {
      // A published page lazy-loads below-the-fold images; walk the page once so they are requested,
      // then return to the top. The render frame upgrades lazy images itself before it signals ready.
      await page.evaluate(async () => {
        const step = Math.max(200, window.innerHeight);
        const max = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
        for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      }).catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    const late = offOrigin();
    if (late) return late;
    const final_url = page.url();

    const width = VIEWPORT_PRESETS[req.viewportName].width;
    const full_height = await page.evaluate(() =>
      Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)),
    );
    if (!Number.isFinite(full_height) || full_height <= 0) {
      return done({ ok: false, reason: "empty_page", error: "the page has no measurable height", final_url, http_status });
    }
    const capturable = Math.min(full_height, cfg.maxSlices * cfg.sliceHeight);
    const slices = [];
    for (let y = 0; y < capturable; y += cfg.sliceHeight) {
      const height = Math.min(cfg.sliceHeight, capturable - y);
      const buf = await page.screenshot({
        type: "jpeg", quality: cfg.jpegQuality, fullPage: true, animations: "disabled",
        clip: { x: 0, y, width, height },
      });
      if (!buf || buf.length === 0) {
        return done({ ok: false, reason: "capture_failed", error: `slice at y=${y} came back empty`, final_url, http_status });
      }
      if (buf.length > cfg.maxSliceBytes) {
        return done({ ok: false, reason: "slice_too_large", error: `slice at y=${y} is ${buf.length} bytes; the cap is ${cfg.maxSliceBytes}`, final_url, http_status });
      }
      slices.push({ y, height, jpeg_base64: buf.toString("base64") });
    }
    // A navigation DURING capture would make the slices a mix of two documents — refuse it too.
    const moved = offOrigin();
    if (moved) return moved;
    if (opts.onPage) await opts.onPage(page);
    return done({ ok: true, width, full_height, slices, truncated: full_height > capturable, final_url, http_status });
  } catch (e) {
    console.error("[paige-browser] render error for", req.target + ":", e?.message || e);
    return done({ ok: false, reason: "render_error", error: String(e?.message || e) });
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}
