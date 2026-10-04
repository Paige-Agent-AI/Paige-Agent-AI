// Paige Browser — a self-hosted, warm-browser Playwright service that DRIVES a URL headless and
// returns an HONEST STRUCTURED OBSERVATION (§32.c). It is the "eyes" Paige uses to self-verify her
// OWN deployed platform surfaces — the killer of the owner-owed live-walk: instead of asking the
// owner to eyeball a shipped surface, Paige drives it here and reads back title/text/status/steps +
// a screenshot. Deployed to Fly.io (shared-cpu-1x); one warm browser so a verify loop isn't paying
// cold-start each call (the reason we don't use Vercel serverless Chromium).
//
// §18 — this is a NEW home ON PURPOSE, distinct from the other browser seam:
//   • (history) services/visual-renderer was a separate screenshot-one-thing Fly app; it was never
//     deployed and is deleted — screenshots are now this host's /render capability (2026-10-04).
//   • supabase/functions/browser-use = a Browserbase (3rd-party, edge-can't-drive-Playwright)
//     stateful stub. paige-browser is SELF-HOSTED real Playwright (§34 moat — tenant session tokens
//     will eventually flow through this host in a later slice, so it must NOT be a 3rd party).
//
// §9/§34 — this host is DB-FREE by construction: it holds NO Supabase creds and writes NO DB rows.
// The browser_use_sessions ledger write + tenant-scope resolution live in the CALLING edge function
// (Slice 1b). Keeping the browser host DB-free is a deliberate posture — the eyes never hold tenant
// data; the caller resolves scope and records the run.
//
// Slice 1a scope: SELF-VERIFY ONLY. READ-ONLY navigation/observation, NO tenant authentication
// (that is Slice 4), NO interpreter dispatch (that is Slice 1b). Only read-only observation steps
// (assertSelector / assertText / readText) are permitted; any click/submit/type/download step is
// REJECTED with an honest error — those are gated behind the §16 autonomy clamp in a later slice,
// never run silently here.
//
// Endpoints:
//   GET  /healthz                                                         -> 200 "ok"
//   POST /self-verify  (requires X-Browser-Secret == PAIGE_BROWSER_SHARED_SECRET, timing-safe)
//        body: { url, viewport?, waitForSelector?, waitMs?, steps? }      -> 200 JSON observation
//   POST /render       (same secret, rate limit and concurrency cap)
//        body: { url } | { page }, viewport?: "desktop"|"tablet"|"mobile", waitForSelector?
//        -> 200 { ok, width, full_height, slices:[{ y, height, jpeg_base64 }], truncated }
//        url = an allowlisted Paige app origin only; page = a draft rendered DB-free at /render-frame.
//        Screenshots are a capability of THIS host — the separate visual-renderer Fly app was never
//        deployed and is deleted (owner direction 2026-10-04, §18 one browser host).
//
// §13 SSRF — every request the browser makes (the top-level url AND any sub-resource) is filtered
// against private/link-local/cloud-metadata ranges via a page.route interceptor; the final_url is
// re-checked public after redirects. Fork 7 guard, owner-signed-off, NON-NEGOTIABLE.
import express from "express";
import { chromium } from "playwright";
import crypto from "node:crypto";
// SSRF egress guard + two-layer content denylist — extracted to a shared module (§18 one home) so the
// smoke test exercises the SAME real code the server runs (§32), not a mirror that can drift.
import { urlBlockReason, assertPublicUrl, installReadOnlyBrowserEgress, loadDenylist } from "./ssrf-guard.mjs";
// /render — screenshot capture of Paige's own pages for the §33 critique loop. The capture logic lives
// in ./render.mjs (§18 one home) so smoke-render.mjs exercises the code the server runs (§32).
import { renderConfig, validateRenderRequest, renderCapture } from "./render.mjs";

const PORT = process.env.PORT || 8080;
const SECRET = process.env.PAIGE_BROWSER_SHARED_SECRET || "";
const MAX_W = 2000, MAX_H = 2000, DEFAULT_VP = { width: 1280, height: 800 };

// Concurrency + timing caps (Fork 5 v1 soft cap + hard per-run timeouts).
const MAX_CONCURRENT = Math.max(1, Number(process.env.PAIGE_BROWSER_MAX_CONCURRENT) || 3);
const NAV_TIMEOUT_MS = Math.max(1000, Number(process.env.PAIGE_BROWSER_NAV_TIMEOUT_MS) || 30000);
const RUN_CAP_MS = Math.max(NAV_TIMEOUT_MS, Number(process.env.PAIGE_BROWSER_RUN_CAP_MS) || 45000);
// Per-page-operation timeout: bounds selector/handle reads (via page.setDefaultTimeout) AND the
// page.evaluate calls (via withTimeout) so a wedged JS execution context can't hold the observe
// context open past the HTTP hard cap — the context releases promptly instead (peer-gate finding).
const STEP_TIMEOUT_MS = Math.max(1000, Number(process.env.PAIGE_BROWSER_STEP_TIMEOUT_MS) || 10000);

// Observation output caps.
const MAX_TEXT_EXCERPT = 2000;         // chars of tag-stripped page text
const MAX_STEP_TEXT = 2000;            // chars returned by a readText step
const MAX_SCREENSHOT_BYTES = 4_500_000; // png bytes before base64 (~6mb b64); over -> omit + log

// Only these READ-ONLY observation step kinds are permitted in Slice 1a.
const ALLOWED_STEP_KINDS = new Set(["assertSelector", "assertText", "readText"]);

// ── Slice 3a: wildcard capability flag + content caps + honest bot user-agent ────────────────────
// D1=(c) wildcard browsing is OFF by default (owner-ruled 2026-08-12). It flips to true ONLY by an
// explicit owner action AFTER the §39 live peer-gate returns SHIP — NEVER automatically on merge.
// While OFF, /browse-public-url refuses any non-self URL with 403 capability_disabled. /self-verify
// (Slice 2) is UNAFFECTED — its target is paigeagent.ai, always allowed, never the wildcard path (§58).
const WILDCARD_ENABLED = String(process.env.PAIGE_BROWSER_WILDCARD_ENABLED || "").toLowerCase() === "true";
// Self-verify targets always allowed regardless of the wildcard flag (§58 anti-regression).
const SELF_TARGET_SUFFIXES = ["paigeagent.ai"];
function isSelfTarget(host) {
  const h = String(host).toLowerCase();
  return SELF_TARGET_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
}
// R4 page-bomb cap: bound the body text returned so one huge page can't blow up the caller's context
// window or this machine's memory (char cap ≈ byte cap for ASCII; UTF-8 multibyte may run slightly
// under the byte figure — honest approximation, the content_bytes field reports the true UTF-8 size).
const MAX_CONTENT_BYTES = Math.max(1000, Number(process.env.PAIGE_BROWSER_MAX_CONTENT_BYTES) || 500_000);
// R6 honest UA: identify as PaigeBot so a target site can recognize/rate-limit/block us if it chooses.
const PAIGE_UA = "Mozilla/5.0 (compatible; PaigeBot/1.0; +https://paigeagent.ai/bot)";

// Layer-2 content denylist (StevenBlack/hosts, owner-ruled 2026-08-12): load the /app/blocklist.txt
// snapshot into the shared guard's Set once at startup. Missing file (local dev / a failed build
// fetch) -> empty Set -> this layer is a no-op (the SSRF private-IP guard + Cloudflare Families still
// hold). HONEST (§13): build-time snapshot, refreshed on image rebuild; a scheduled weekly refresh is
// a tracked follow-up (task #151), not yet built.
loadDenylist();

// The SSRF egress guard (isPrivateIp/hostBlockReason/urlBlockReason/assertPublicUrl) + the two-layer
// content denylist now live in ./ssrf-guard.mjs (§18 one home; §32 the smoke test runs the REAL code).

// One long-lived browser, launched lazily and relaunched if it ever dies — keeps the loop warm.
// A FAILED launch nulls the cached promise so the next request retries instead of awaiting a
// permanently-rejected promise (which would brick the service until a restart).
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
      .catch((e) => { browserPromise = null; throw e; });
  }
  const b = await browserPromise;
  if (!b.isConnected()) { browserPromise = null; return getBrowser(); }
  return b;
}

const clampVp = (vp) => ({
  width: Math.min(MAX_W, Math.max(320, Number(vp?.width) || DEFAULT_VP.width)),
  height: Math.min(MAX_H, Math.max(240, Number(vp?.height) || DEFAULT_VP.height)),
});

// Race a promise against a timeout so an unbounded page.evaluate (which page.setDefaultTimeout does
// NOT govern) can't hang the observe context. Clears the timer on settle so it never leaks.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

// Read the document body text inside the page, bounded by STEP_TIMEOUT_MS. Returns "" on any failure.
function readBodyText(page) {
  return withTimeout(
    page.evaluate(() => (document.body ? document.body.innerText : "")),
    STEP_TIMEOUT_MS,
    "readBodyText",
  );
}

// Capture a viewport screenshot as base64 png. NEVER throws and NEVER returns undefined on a
// failure path — a null (with a loud log) is the honest "couldn't capture" signal; the caller uses
// whatever this returns as the VISIBLE FALLBACK (§32) so a failed observation still shows something.
async function captureScreenshotB64(page) {
  try {
    const png = await page.screenshot({ type: "png" });
    if (!png || png.length === 0) return null;
    if (png.length > MAX_SCREENSHOT_BYTES) {
      console.error(`[paige-browser] screenshot ${png.length}B exceeds cap ${MAX_SCREENSHOT_BYTES}B; omitting b64`);
      return null;
    }
    return png.toString("base64");
  } catch (e) {
    console.error("[paige-browser] screenshot capture failed:", e?.message || e);
    return null;
  }
}

// Extract tag-stripped, whitespace-collapsed body text, capped. Never throws.
async function extractText(page) {
  try {
    const raw = await readBodyText(page);
    return String(raw || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_EXCERPT);
  } catch (e) {
    console.error("[paige-browser] text extraction failed:", e?.message || e);
    return "";
  }
}

// Run the READ-ONLY observation steps. A non-read-only kind is REJECTED (ok:false + honest detail),
// never silently executed — write/interact steps are gated behind the §16 clamp in a later slice.
async function runSteps(page, steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const out = [];
  for (const step of steps) {
    const kind = step?.kind;
    if (!ALLOWED_STEP_KINDS.has(kind)) {
      console.error(`[paige-browser] rejected non-read-only step kind: ${JSON.stringify(kind)}`);
      out.push({
        kind: kind ?? null,
        ok: false,
        detail: `rejected: step kind "${kind}" is not permitted in self-verify (Slice 1a is read-only: assertSelector, assertText, readText)`,
      });
      continue;
    }
    try {
      if (kind === "assertSelector") {
        if (!step.selector) { out.push({ kind, ok: false, detail: "assertSelector requires a selector" }); continue; }
        const found = (await page.$(String(step.selector))) != null;
        out.push({ kind, ok: found, detail: found ? `selector present: ${step.selector}` : `selector not found: ${step.selector}` });
      } else if (kind === "assertText") {
        const needle = String(step.text ?? "");
        if (!needle) { out.push({ kind, ok: false, detail: "assertText requires text" }); continue; }
        let hay;
        if (step.selector) {
          const el = await page.$(String(step.selector));
          if (!el) { out.push({ kind, ok: false, detail: `selector not found: ${step.selector}` }); continue; }
          hay = await el.innerText().catch(() => "");
        } else {
          hay = await readBodyText(page).catch(() => "");
        }
        const ok = String(hay).includes(needle);
        out.push({ kind, ok, detail: ok ? `text found: "${needle}"` : `text not found: "${needle}"` });
      } else if (kind === "readText") {
        let text;
        if (step.selector) {
          const el = await page.$(String(step.selector));
          if (!el) { out.push({ kind, ok: false, detail: `selector not found: ${step.selector}` }); continue; }
          text = await el.innerText().catch(() => "");
        } else {
          text = await readBodyText(page).catch(() => "");
        }
        out.push({ kind, ok: true, detail: String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_STEP_TEXT) });
      }
    } catch (e) {
      out.push({ kind, ok: false, detail: `step error: ${String(e?.message || e)}` });
    }
  }
  return out;
}

// Drive the url and build the structured observation. NEVER throws — every failure path returns an
// { ok:false, ... } result WITH a visible-fallback screenshot where one can be captured (§13/§32).
// Loud console.error on every failure path (never a silent swallow).
async function observe({ url, viewport, waitForSelector, waitMs, steps }, navTimeout) {
  const start = Date.now();
  const browser = await getBrowser();
  // ctx/page are created INSIDE the try so a throw from newContext/newPage/page.route still hits the
  // finally and closes the context — otherwise a setup failure under memory pressure leaks a
  // BrowserContext per call and can OOM the warm browser (peer-gate finding).
  let ctx = null, page = null, screenshot_b64 = null;
  try {
    ctx = await browser.newContext({ viewport: clampVp(viewport), deviceScaleFactor: 2, serviceWorkers: "block" });
    await installReadOnlyBrowserEgress(ctx);
    page = await ctx.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS); // bound selector/handle ops; evaluate is bounded via withTimeout
    // §13 SSRF: the context fence blocks EVERY request (navigation, popup + sub-resource) to a private/internal host. Covers a
    // redirect from a public url into an internal one AND any internal fetch the page tries.

    let response;
    try {
      response = await page.goto(String(url), { waitUntil: "networkidle", timeout: navTimeout });
    } catch (e) {
      console.error("[paige-browser] navigation failed for", String(url) + ":", e?.message || e);
      screenshot_b64 = await captureScreenshotB64(page); // visible fallback of whatever rendered
      return { ok: false, url, error: `navigation failed: ${String(e?.message || e)}`, http_status: null, screenshot_b64, duration_ms: Date.now() - start };
    }

    const http_status = response ? response.status() : null;
    const final_url = page.url();
    // Re-assert the post-redirect url is public — a public start url can 30x into an internal host.
    try {
      await assertPublicUrl(final_url);
    } catch (e) {
      console.error("[paige-browser] final_url blocked", String(final_url) + ":", e?.message || e);
      return { ok: false, url, final_url, error: `blocked redirect to private/internal host: ${String(e?.message || e)}`, http_status, screenshot_b64: null, duration_ms: Date.now() - start };
    }

    if (waitForSelector) await page.waitForSelector(String(waitForSelector), { timeout: 10000 }).catch(() => {});
    if (waitMs) await page.waitForTimeout(Math.min(8000, Math.max(0, Number(waitMs) || 0)));

    const title = await page.title().catch(() => "");
    const text_excerpt = await extractText(page);
    screenshot_b64 = await captureScreenshotB64(page);
    const stepResults = await runSteps(page, steps);

    return { ok: true, url, final_url, http_status, title, text_excerpt, screenshot_b64, steps: stepResults, duration_ms: Date.now() - start };
  } catch (e) {
    console.error("[paige-browser] observe error for", String(url) + ":", e?.message || e);
    if (!screenshot_b64 && page) screenshot_b64 = await captureScreenshotB64(page);
    return { ok: false, url, error: String(e?.message || e), screenshot_b64, duration_ms: Date.now() - start };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// Hard overall run cap: race the observation against a backstop timer that resolves to an honest
// ok:false. observe() bounds itself with nav/step timeouts; this is the last-resort ceiling. observe
// still closes its own context via its finally even if the timer wins the race.
function withHardCap(promise, ms, url, start) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.error(`[paige-browser] run exceeded hard cap ${ms}ms for ${url}`);
      resolve({ ok: false, url, error: `run exceeded hard cap ${ms}ms`, duration_ms: Date.now() - start });
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// ── Slice 3a: structured content extraction for /browse-public-url (the D2/D3 read-only shape) ────
// Returns the research shape Paige reasons over: title, meta description, h1 headers, capped body text,
// and a bounded links inventory. Never throws — a failed extraction returns an empty shell (§13/§32).
async function extractStructured(page, cap) {
  try {
    return await withTimeout(page.evaluate((maxChars) => {
      const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
      const metaOf = (sel) => document.querySelector(sel)?.getAttribute("content") || null;
      const body = document.body ? document.body.innerText : "";
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ text: clean(a.innerText).slice(0, 120), href: a.href }))
        .filter((l) => l.href && /^https?:/i.test(l.href))
        .slice(0, 100);
      return {
        title: clean(document.title),
        meta_description: metaOf('meta[name="description"]') || metaOf('meta[property="og:description"]'),
        h1_headers: Array.from(document.querySelectorAll("h1")).map((h) => clean(h.innerText)).filter(Boolean).slice(0, 20),
        body_text: clean(body).slice(0, maxChars),
        links_inventory: links,
      };
    }, cap), STEP_TIMEOUT_MS, "extractStructured");
  } catch (e) {
    console.error("[paige-browser] structured extraction failed:", e?.message || e);
    return { title: "", meta_description: null, h1_headers: [], body_text: "", links_inventory: [] };
  }
}

// Drive an arbitrary (guard-passed) public URL and return the structured research observation. Same
// warm-browser + SSRF page.route + post-redirect re-check discipline as observe(); NEVER throws.
// DB-FREE (§9/§34): returns blocked_reason + timing so the CALLING edge function (Slice 3b) writes the
// tenant-scoped paige_browser_usage row — this host never holds tenant data or Supabase creds.
async function browsePublic({ url, viewport, waitForSelector, waitMs, maxContentBytes }, navTimeout) {
  const start = Date.now();
  const cap = Math.min(MAX_CONTENT_BYTES, Math.max(1000, Number(maxContentBytes) || MAX_CONTENT_BYTES));
  const browser = await getBrowser();
  let ctx = null, page = null;
  try {
    ctx = await browser.newContext({ viewport: clampVp(viewport), userAgent: PAIGE_UA, serviceWorkers: "block" });
    await installReadOnlyBrowserEgress(ctx);
    page = await ctx.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    let response;
    try {
      response = await page.goto(String(url), { waitUntil: "networkidle", timeout: navTimeout });
    } catch (e) {
      console.error("[paige-browser] browse nav failed for", String(url) + ":", e?.message || e);
      return { ok: false, url, blocked_reason: null, error: `navigation failed: ${String(e?.message || e)}`, http_status: null, duration_ms: Date.now() - start };
    }

    const http_status = response ? response.status() : null;
    const final_url = page.url();
    // Re-check the post-redirect URL — a public start URL can 30x into an internal host or a denylisted domain.
    const redirectReason = await urlBlockReason(final_url);
    if (redirectReason) {
      console.error("[paige-browser] browse final_url blocked", String(final_url) + ":", redirectReason);
      return { ok: false, url, final_url, blocked_reason: redirectReason, error: `blocked redirect: ${redirectReason}`, http_status, duration_ms: Date.now() - start };
    }
    // §39 peer-gate fix: re-assert the wildcard flag on the FINAL host too. Without this, a self-target
    // (`*.paigeagent.ai`) with an open redirect could 30x to an arbitrary public URL and run the wildcard
    // capability while the flag is OFF — the pre-check only gated the INITIAL host. Redirect target must
    // ALSO clear the flag/self-target gate, not just the SSRF+denylist guard.
    let finalHost = "";
    try { finalHost = new URL(final_url).hostname; } catch { /* keep "" -> treated as non-self */ }
    if (!WILDCARD_ENABLED && !isSelfTarget(finalHost)) {
      console.error("[paige-browser] browse final_url redirected off a self-target while wildcard disabled:", String(final_url));
      return { ok: false, url, final_url, blocked_reason: "wildcard:disabled", error: "blocked redirect: wildcard browsing not yet enabled", http_status, duration_ms: Date.now() - start };
    }

    if (waitForSelector) await page.waitForSelector(String(waitForSelector), { timeout: 10000 }).catch(() => {});
    if (waitMs) await page.waitForTimeout(Math.min(8000, Math.max(0, Number(waitMs) || 0)));

    const content = await extractStructured(page, cap);
    const content_bytes = Buffer.byteLength(content.body_text || "", "utf8");
    return {
      ok: true, url, final_url, http_status, blocked_reason: null,
      ...content, content_bytes,
      honest_verdict: http_status && http_status < 400 ? "ok" : `http_${http_status ?? "unknown"}`,
      duration_ms: Date.now() - start,
    };
  } catch (e) {
    console.error("[paige-browser] browse error for", String(url) + ":", e?.message || e);
    return { ok: false, url, blocked_reason: null, error: String(e?.message || e), duration_ms: Date.now() - start };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function auth(req, res) {
  if (!SECRET) { res.status(500).json({ error: "misconfigured: no shared secret" }); return false; }
  if (!timingSafeEqual(req.get("X-Browser-Secret") || "", SECRET)) { res.status(401).json({ error: "bad secret" }); return false; }
  return true;
}

// In-process concurrency counter (soft cap). Over the cap -> 429 so the caller retries rather than
// piling work onto one shared-cpu-1x machine.
let inFlight = 0;

// Fixed-window per-IP rate limiter — defense-in-depth ON TOP of the shared-secret gate + concurrency
// cap, so even a caller holding the secret can't hammer the (expensive) browser host. Runs BEFORE
// auth so unauthenticated floods are bounded too. Map is pruned opportunistically so an IP-spray
// can't grow it unbounded.
const RATE_MAX = Math.max(1, Number(process.env.PAIGE_BROWSER_RATE_MAX) || 60);
const RATE_WINDOW_MS = Math.max(1000, Number(process.env.PAIGE_BROWSER_RATE_WINDOW_MS) || 60000);
const _rate = new Map(); // ip -> { count, resetAt }
function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  let entry = _rate.get(ip);
  if (!entry || now >= entry.resetAt) { entry = { count: 0, resetAt: now + RATE_WINDOW_MS }; _rate.set(ip, entry); }
  entry.count++;
  if (_rate.size > 10_000) { for (const [k, v] of _rate) if (now >= v.resetAt) _rate.delete(k); }
  if (entry.count > RATE_MAX) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ ok: false, error: "rate limited, retry later" });
  }
  return next();
}

app.post("/self-verify", rateLimit, async (req, res) => {
  if (!auth(req, res)) return;
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ ok: false, error: "valid http(s) url required" });
  try {
    await assertPublicUrl(url);
  } catch (e) {
    return res.status(400).json({ ok: false, url, error: `url rejected: ${String(e?.message || e)}` });
  }

  if (inFlight >= MAX_CONCURRENT) {
    return res.status(429).json({ ok: false, error: "busy, retry" });
  }

  inFlight++;
  const start = Date.now();
  try {
    const result = await withHardCap(observe(req.body, NAV_TIMEOUT_MS), RUN_CAP_MS, String(url), start);
    return res.status(200).json(result);
  } catch (e) {
    // observe() is written not to throw, but a truly unexpected error still returns a structured
    // honest result (200 ok:false) — the caller always needs the observation shape, never a 5xx.
    console.error("[paige-browser] /self-verify unexpected error for", String(url) + ":", e?.message || e);
    return res.status(200).json({ ok: false, url, error: String(e?.message || e), duration_ms: Date.now() - start });
  } finally {
    inFlight--;
  }
});

// ── Slice 3a: wildcard public-URL browsing (D1=(c)) — gated OFF until an owner flips the flag ──────
// Distinct from /self-verify (§18): that observes/asserts Paige's OWN surfaces; this EXTRACTS research
// content from arbitrary public URLs behind the full SSRF + two-layer denylist guard. §37: this
// endpoint has ZERO producers until Slice 3b ships the browse_public_url skill — nothing calls the
// wildcard capability yet, and the flag keeps it inert even after the skill lands, until owner sign-off.
// CodeQL js/missing-rate-limiting is a FALSE POSITIVE here: this route IS rate-limited by the
// `rateLimit` middleware (fixed-window per-IP, same limiter as /self-verify), PLUS the MAX_CONCURRENT
// concurrency cap, PLUS the timing-safe shared-secret `auth()`. CodeQL doesn't model our custom
// in-process limiter (which is also why /self-verify is unflagged only because it's not new-in-diff).
app.post("/browse-public-url", rateLimit, async (req, res) => { // codeql[js/missing-rate-limiting]
  if (!auth(req, res)) return;
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return res.status(400).json({ ok: false, error: "valid http(s) url required", blocked_reason: "scheme:invalid-url" });
  }
  let host;
  try { host = new URL(String(url)).hostname; } catch { return res.status(400).json({ ok: false, error: "invalid url", blocked_reason: "scheme:invalid-url" }); }

  // D3 feature flag: wildcard browsing OFF by default. Non-self URLs are refused until an owner flips
  // PAIGE_BROWSER_WILDCARD_ENABLED=true (AFTER the §39 live peer-gate returns SHIP). §58: self targets
  // (paigeagent.ai) stay allowed — the wildcard flag never gates Paige's own-surface verification.
  if (!WILDCARD_ENABLED && !isSelfTarget(host)) {
    return res.status(403).json({ ok: false, url, error: "capability_disabled", reason: "wildcard browsing not yet enabled", blocked_reason: "wildcard:disabled" });
  }

  // Resolve-first SSRF + denylist pre-check (reason-coded) BEFORE the browser ever touches the URL.
  const blocked = await urlBlockReason(url);
  if (blocked) {
    return res.status(200).json({ ok: false, url, blocked_reason: blocked, error: `blocked: ${blocked}`, http_status: null });
  }

  if (inFlight >= MAX_CONCURRENT) return res.status(429).json({ ok: false, error: "busy, retry" });
  inFlight++;
  const start = Date.now();
  try {
    const result = await withHardCap(browsePublic(req.body, NAV_TIMEOUT_MS), RUN_CAP_MS, String(url), start);
    return res.status(200).json(result);
  } catch (e) {
    console.error("[paige-browser] /browse-public-url unexpected error for", String(url) + ":", e?.message || e);
    return res.status(200).json({ ok: false, url, blocked_reason: null, error: String(e?.message || e), duration_ms: Date.now() - start });
  } finally {
    inFlight--;
  }
});

// ── /render — full-page JPEG slices of Paige's OWN pages for the §33 visual-critique loop ─────────
// Same three gates as the routes above (per-IP rateLimit, timing-safe auth, MAX_CONCURRENT). It never
// renders an arbitrary URL: `url` must sit on an allowlisted Paige app origin (exact match) AND pass the
// SSRF guard; `page` renders a draft at ${PAIGE_APP_ORIGIN}/render-frame with the payload injected. The
// browser context carries the same read-only egress fence. A run failure is 200 ok:false with a reason
// (the caller always gets the structured shape); a refused request is 4xx with a reason. Never a fake image.
// CodeQL js/missing-rate-limiting is a FALSE POSITIVE here for the same reason as /browse-public-url.
const RENDER_CFG = renderConfig();
app.post("/render", rateLimit, async (req, res) => { // codeql[js/missing-rate-limiting]
  if (!auth(req, res)) return;
  const v = await validateRenderRequest(req.body, RENDER_CFG);
  if (!v.ok) return res.status(v.status).json({ ok: false, reason: v.reason, error: v.error });

  if (inFlight >= MAX_CONCURRENT) return res.status(429).json({ ok: false, reason: "busy", error: "busy, retry" });
  inFlight++;
  const start = Date.now();
  try {
    const browser = await getBrowser();
    const result = await withHardCap(
      renderCapture(browser, v, RENDER_CFG, { navTimeout: NAV_TIMEOUT_MS, stepTimeout: STEP_TIMEOUT_MS }),
      RUN_CAP_MS, v.target, start,
    );
    // withHardCap's backstop result has no reason code; give it one so callers can log it honestly.
    if (!result.ok && !result.reason) result.reason = "run_cap_exceeded";
    return res.status(200).json(result);
  } catch (e) {
    console.error("[paige-browser] /render unexpected error for", v.target + ":", e?.message || e);
    return res.status(200).json({ ok: false, reason: "browser_unavailable", error: String(e?.message || e), duration_ms: Date.now() - start });
  } finally {
    inFlight--;
  }
});

app.listen(PORT, () => console.log(`[paige-browser] listening on :${PORT}`));
