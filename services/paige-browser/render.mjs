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
//   { url }   a PUBLISHED landing page (/p/<tenant>/<page>) on an allowlisted Paige app origin
//             (PAIGE_RENDER_ALLOWED_ORIGINS). Exact-origin match, THEN the SSRF guard. Ready when the
//             page's own data — the row and its brand — has settled ([data-growth-page-ready]).
//   { page }  a draft that exists only as data. The browser opens ${PAIGE_APP_ORIGIN}/render-frame and
//             the payload is injected before any script runs (addInitScript). The frame is DB-free:
//             it renders the payload through the same <GrowthPageView> the public page uses.
//
// Output is full-page, in SLICES: JPEG at DPR 1, each slice at most ~1600 CSS px tall, a hard cap on
// slice count (the caller may ask for fewer). A 2x full-page PNG was 6-7 MB — over the edge function's
// 4 MB image budget — so the capture is sized for the consumer. `truncated:true` says honestly that the
// page ran past the slice cap; nothing pretends the bottom was seen.
//
// §13 every failure is { ok:false, reason, error } — never a placeholder image. A page that THROWS is
// `render_crashed` with its message, never a misleading `not_ready`. §9/§34 DB-free: no Supabase creds,
// no tenant rows; the calling edge function owns scope and the audit row.
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
// GrowthPageRenderer sets this once the published row AND its brand (or the brand's failure) have
// settled — "missing" when the page does not exist. The app-wide [data-app-ready] marker only says the
// app mounted, which is before the page's data arrives, so it is not the URL-mode default.
export const DEFAULT_URL_READY_SELECTOR = "[data-growth-page-ready]";
// Set by the render frame's error boundary when a block throws.
export const RENDER_ERROR_SELECTOR = "[data-render-error]";
// Every phase leaves this much of the run deadline for capture + close.
const CAPTURE_RESERVE_MS = 4000;

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
    readyTimeoutMs: int(env.PAIGE_RENDER_READY_TIMEOUT_MS, 12_000, 500, 30_000),
    maxSliceBytes: int(env.PAIGE_RENDER_MAX_SLICE_BYTES, 3_500_000, 50_000, 4_000_000),
  };
}

const fail = (status, reason, error) => ({ ok: false, status, reason, error });
const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/**
 * Only the fields the render frame reads cross into the browser — never whatever else a caller sent.
 * The edge function (studio-visual-critique) builds the IDENTICAL shape and measures it the same way
 * (UTF-8 bytes of JSON.stringify), so the two payload caps agree to the byte.
 */
export function pickPagePayload(page) {
  return {
    blocks: page.blocks,
    theme: isPlainObject(page.theme) ? page.theme : null,
    brand: isPlainObject(page.brand) ? page.brand : null,
    tenant_name: typeof page.tenant_name === "string" ? page.tenant_name.slice(0, 200) : null,
  };
}
export const pagePayloadBytes = (payload) => Buffer.byteLength(JSON.stringify(payload), "utf8");

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

  // The caller may ask for FEWER slices than the host cap (the edge function sends only what it uses);
  // a larger ask is clamped to the cap, never refused.
  let maxSlices = cfg.maxSlices;
  if (b.maxSlices != null) {
    const n = Number(b.maxSlices);
    if (!Number.isInteger(n) || n < 1) return fail(400, "invalid_max_slices", "maxSlices must be a positive integer");
    maxSlices = Math.min(n, cfg.maxSlices);
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
      ok: true, mode: "url", target: u.href, expectOrigin: u.origin, payload: null, viewportName, maxSlices,
      readySelector: waitForSelector || DEFAULT_URL_READY_SELECTOR,
    };
  }

  if (!isPlainObject(b.page)) return fail(400, "invalid_page", "page must be an object");
  if (!Array.isArray(b.page.blocks)) return fail(400, "invalid_page", "page.blocks must be an array");
  const payload = pickPagePayload(b.page);
  let size;
  try { size = pagePayloadBytes(payload); } catch { return fail(400, "invalid_page", "page is not serializable"); }
  if (size > cfg.maxPayloadBytes) {
    return fail(413, "payload_too_large", `page payload is ${size} bytes; the cap is ${cfg.maxPayloadBytes}`);
  }
  const target = `${cfg.appOrigin}${RENDER_FRAME_PATH}`;
  const blocked = await urlBlockReason(target);
  if (blocked) return fail(503, `app_origin_blocked:${blocked}`, `the configured app origin is not renderable: ${blocked}`);
  return {
    ok: true, mode: "page", target, expectOrigin: cfg.appOrigin, payload, viewportName, maxSlices,
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
 * { ok:false, reason, error }.
 *
 * `opts.deadline` (epoch ms) is the run's hard end. Every wait is sized to finish inside it with time
 * left to capture, and at the deadline the browser context is CLOSED — so a timed-out run stops using
 * the browser instead of working on after the caller has been answered and the slot released.
 * `opts.instrumentContext(ctx)` runs BEFORE the egress fence is installed (test receivers only — the
 * fence still decides first, exactly as in production); `opts.onPage(page)` lets a smoke inspect the
 * live page before the context closes.
 */
export async function renderCapture(browser, req, cfg, opts = {}) {
  const start = Date.now();
  const deadline = opts.deadline ?? start + 45_000;
  const navTimeoutCap = opts.navTimeout ?? 30_000;
  const stepTimeout = opts.stepTimeout ?? 10_000;
  const maxSlices = req.maxSlices ?? cfg.maxSlices;
  const remaining = () => deadline - Date.now();
  const done = (o) => ({ ...o, viewport: req.viewportName, mode: req.mode, duration_ms: Date.now() - start });
  let ctx = null;
  let timedOut = false;
  let deadlineTimer = null;
  const pageErrors = [];
  try {
    ctx = await browser.newContext(contextOptions(req.viewportName));
    const ctxRef = ctx;
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[paige-browser] render hit its deadline for ${req.target}; closing the context`);
      ctxRef.close().catch(() => {});
    }, Math.max(0, remaining()));
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
    page.on("pageerror", (e) => { pageErrors.push(String(e?.message || e).slice(0, 500)); });

    let response;
    // A wait shortened to fit the deadline that then times out is the deadline's doing, not the page's.
    const navTimeout = Math.max(500, Math.min(navTimeoutCap, remaining() - CAPTURE_RESERVE_MS));
    try {
      response = await page.goto(req.target, { waitUntil: "load", timeout: navTimeout });
    } catch (e) {
      if (timedOut || (navTimeout < navTimeoutCap && /timeout/i.test(String(e?.message || e)))) return done({ ok: false, reason: "run_cap_exceeded", error: "the render ran past its deadline during navigation" });
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
    const crashed = (message) => {
      console.error(`[paige-browser] render crashed for ${req.target}: ${message}`);
      return done({ ok: false, reason: "render_crashed", error: `the page threw while rendering: ${message}`, page_errors: pageErrors.slice(0, 5), final_url: page.url(), http_status });
    };
    const early = offOrigin();
    if (early) return early;

    // Wait for EITHER the ready marker or the error boundary's marker. `attached`, not visible: the
    // markers may be hidden elements.
    const readyTimeout = Math.max(250, Math.min(cfg.readyTimeoutMs, remaining() - CAPTURE_RESERVE_MS));
    try {
      await page.waitForSelector(`${req.readySelector}, ${RENDER_ERROR_SELECTOR}`, { state: "attached", timeout: readyTimeout });
    } catch {
      if (timedOut) return done({ ok: false, reason: "run_cap_exceeded", error: "the render ran past its deadline waiting for ready" });
      const moved = offOrigin();
      if (moved) return moved;
      // A page that threw and so never signalled ready is a crash, not a slow page (§32).
      if (pageErrors.length) return crashed(pageErrors[0]);
      if (readyTimeout < cfg.readyTimeoutMs) return done({ ok: false, reason: "run_cap_exceeded", error: "the render ran out of its deadline waiting for ready", final_url: page.url(), http_status });
      console.error(`[paige-browser] render never became ready (${req.readySelector}) for`, req.target);
      return done({ ok: false, reason: "not_ready", error: `the page never signalled ready (${req.readySelector})`, final_url: page.url(), http_status });
    }
    const boundaryError = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute("data-render-error") ?? null, RENDER_ERROR_SELECTOR).catch(() => null);
    if (boundaryError != null) return crashed(boundaryError || pageErrors[0] || "unknown error");
    const growthState = await page.evaluate(() => document.querySelector("[data-growth-page-ready]")?.getAttribute("data-growth-page-ready") ?? null).catch(() => null);
    if (req.mode === "url" && growthState === "missing") {
      return done({ ok: false, reason: "page_not_found", error: "the published page does not exist (or is not published)", final_url: page.url(), http_status });
    }

    if (req.mode === "url") {
      // A published page lazy-loads below-the-fold media; walk the page once so it is requested, then
      // return to the top. The render frame upgrades its own lazy images and embeds before it signals
      // ready, so it needs no walk.
      await page.evaluate(async () => {
        const step = Math.max(200, window.innerHeight);
        const max = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
        for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      }).catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: Math.max(0, Math.min(3000, remaining() - CAPTURE_RESERVE_MS)) }).catch(() => {});
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
    const capturable = Math.min(full_height, maxSlices * cfg.sliceHeight);
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
    if (timedOut) return done({ ok: false, reason: "run_cap_exceeded", error: "the render ran past its deadline during capture" });
    if (opts.onPage) await opts.onPage(page);
    return done({ ok: true, width, full_height, slices, truncated: full_height > capturable, final_url, http_status });
  } catch (e) {
    if (timedOut) return done({ ok: false, reason: "run_cap_exceeded", error: "the render ran past its deadline" });
    console.error("[paige-browser] render error for", req.target + ":", e?.message || e);
    return done({ ok: false, reason: "render_error", error: String(e?.message || e) });
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (ctx) await ctx.close().catch(() => {});
  }
}
