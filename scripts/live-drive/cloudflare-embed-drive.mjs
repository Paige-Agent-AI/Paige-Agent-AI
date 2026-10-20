#!/usr/bin/env node
// A Paige lead form on a website built elsewhere (e.g. by a Genspark agent) and served by CLOUDFLARE PAGES
// (Experience 03, owner clarification 2026-10-13). Driven for real, in a browser, across two origins.
//
// WHAT IT PROVES. The REAL app (vite dev: the real /form/:id route, the real public/embed.js) runs on one origin.
// A static business site runs on another origin under Cloudflare's own Pages runtime (`wrangler pages dev`, workerd,
// honouring the site's `_headers` exactly as Pages does), with no Cloudflare account anywhere. The site pastes the
// exact code Studio hands the owner. Only Supabase is stubbed, at the network; every other Supabase call is blocked,
// so nothing reaches production. It drives what such sites actually do:
//   - a plain page (desktop and phone), from a tagged campaign link to a sent answer;
//   - Cloudflare Rocket Loader, using Cloudflare's own rocket-loader script, on the copied tag (which opts out with
//     data-cfasync="false") and on an older tag that doesn't (Rocket Loader re-runs it);
//   - a restrictive Content-Security-Policy in `_headers`: one that allows Paige, one that blocks the frame, one that
//     blocks outside scripts (where the no-script frame is the answer);
//   - a site builder's sandboxed "custom HTML" block, without and with allow-same-origin, and the no-script frame
//     inside a sandbox;
//   - a success redirect, which moves the visitor's whole page on the business's site;
//   - Paige's own product analytics, which never run inside a form on a business's site.
// It saves the answer one visitor sent (artifacts/cloudflare-embed/sent.json) for form-embed-intake-replay.mjs,
// which files it through the real intake rules and database.
//
// WHAT IT DOES NOT PROVE. Cloudflare's edge itself (Rocket Loader is Cloudflare's script, applied the way the edge
// rewrites a page, but by this harness); the server's origin allow-list, rate limits and bot trap (their own tests);
// a production browser session.
//
// Requires: playwright (root devDep) and wrangler (`WRANGLER_BIN`, else `npx --yes wrangler@4.149.0`). Rocket Loader:
// `ROCKET_LOADER_JS` (a saved copy), else fetched from Cloudflare.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const APP_PORT = 5242;
const HOST_PORT = 8788;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SITE = `http://localhost:${HOST_PORT}`;
const REPO = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(import.meta.dirname, "artifacts/cloudflare-embed");
const SITE_DIR = path.join(OUT, "site");
const FORM_ID = "0b8f1a2e-1111-4222-8333-444455556666";
const SUPABASE = new URL(fs.readFileSync(path.join(REPO, ".env"), "utf8").match(/^VITE_SUPABASE_URL=["']?([^"'\n]+)/m)[1]).host;
const RL_HASH = "7d0fa10a";

const FORM = {
  id: FORM_ID, slug: "spring-consult", name: "Spring consult request",
  schema_json: { sections: [{ title: "About you", fields: [
    { key: "name", type: "text", label: "Your name", required: true },
    { key: "email", type: "email", label: "Work email", required: true },
    { key: "goal", type: "textarea", label: "What would you like help with?" },
  ] }] },
  success_action_json: { message: "Thanks — we'll be in touch within a day." },
};

// The code Studio hands the owner (src/solo/studio/embed-code.ts), with the loader on the app's origin.
const TAG = `<script src="${APP}/embed.js" data-form="${FORM_ID}" data-title="Spring consult request" data-cfasync="false" async></script>`;
const OLD_TAG = `<script src="${APP}/embed.js" data-form="${FORM_ID}" data-title="Spring consult request" async></script>`;
const FRAME = `<iframe src="${APP}/form/${FORM_ID}?embed=1" title="Spring consult request" loading="lazy" style="width:100%;height:720px;border:0;color-scheme:normal"></iframe>`;

// A page shaped like a Genspark-built site: one static file, inline styles, a hero, sections, a footer.
const page = (body, { head = "", tail = "", light = false } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Northwind Advisory</title>${head}
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#0f2a2e;color:#e8f1ef}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid #24484d}
.hero{padding:56px 24px;max-width:960px;margin:0 auto}.hero h1{font-size:40px;line-height:1.1;margin:0 0 12px}
section{max-width:720px;margin:0 auto;padding:24px 16px}footer{padding:32px 24px;color:#9fbab6;border-top:1px solid #24484d}
${light ? "body{background:#fbfaf7;color:#1d2a2c}footer{color:#4c5d5f}header,footer{border-color:#d9dfdd}" : ""}</style></head>
<body><header><strong>Northwind Advisory</strong><nav><a id="before" href="#services" style="color:#9fe0d4">Services</a></nav></header>
<div class="hero"><h1>Strategy for growing firms</h1><p>Book a consult or tell us what you need.</p></div>
<section id="contact"><h2>Tell us about you</h2>${body}<p id="after">We reply within a day.</p></section>
<footer>© Northwind Advisory</footer>${tail}</body></html>`;

const CSP_ALLOWS = `default-src 'self'; script-src 'self' ${APP}; frame-src ${APP}; style-src 'self' 'unsafe-inline'; img-src 'self' data:`;
const sandboxBlock = (sandbox, inner) => `<iframe sandbox="${sandbox}" style="width:100%;height:900px;border:0" title="Custom HTML" srcdoc="${inner.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`;
// What Rocket Loader does to a page at the edge: every script it handles gets type="<hash>-text/javascript", and its
// own loader runs them later. A tag marked data-cfasync="false" is left exactly as written.
const rocket = (tag) => {
  const rewritten = tag.includes('data-cfasync="false"') ? tag : tag.replace("<script ", `<script type="${RL_HASH}-text/javascript" `);
  return page(rewritten, { tail: `<script type="${RL_HASH}-text/javascript">window.__rocketRan = true;</script>
<script src="/rl/rocket-loader.min.js" data-cf-settings="${RL_HASH}-|49" defer></script>` });
};

const SITE_FILES = {
  "index.html": page(TAG),
  // Pasted into the site's <head> instead of where the form should go.
  "head/index.html": page("", { head: TAG }),
  "rocket/index.html": rocket(OLD_TAG),
  "rocket-optout/index.html": rocket(TAG),
  "csp-allows/index.html": page(TAG),
  "csp-noframe/index.html": page(TAG),
  "csp-noscript/index.html": page(TAG),
  "csp-noscript-frame/index.html": page(FRAME),
  "sandbox/index.html": page(sandboxBlock("allow-scripts allow-popups allow-forms", TAG)),
  "sandbox-escape/index.html": page(sandboxBlock("allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms", TAG)),
  "csp-report-only/index.html": page(TAG),
  // The fallback button on a light site, on a dark site, and the owner's dark-look form on a light site; and the
  // booking popup's button (same style) on both, which must keep working exactly as before.
  "csp-noframe-light/index.html": page(TAG, { light: true }),
  "csp-noframe-darkform/index.html": page(TAG.replace(" data-cfasync", ' data-theme="dark" data-cfasync'), { light: true }),
  "booking-popup/index.html": page(`<script src="${APP}/embed.js" data-slug="discovery-call" data-mode="popup" async></script>`),
  "booking-popup-light/index.html": page(`<script src="${APP}/embed.js" data-slug="discovery-call" data-mode="popup" async></script>`, { light: true }),
  "sandbox-same-origin/index.html": page(sandboxBlock("allow-scripts allow-same-origin allow-popups allow-forms", TAG)),
  "sandbox-frame/index.html": page(FRAME.replace("<iframe ", '<iframe sandbox="allow-scripts allow-popups allow-forms" ')),
  "redirect/index.html": page(TAG),
  "thanks/index.html": `<!doctype html><title>Thanks</title><h1 id="thanks">Thanks page on the business's own site</h1>`,
  // Cloudflare Pages reads response headers for each path from this file.
  "_headers": `/csp-allows/*\n  Content-Security-Policy: ${CSP_ALLOWS}\n/csp-report-only/*\n  Content-Security-Policy-Report-Only: default-src 'self'\n/csp-noframe-light/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${APP}; frame-src 'self'; style-src 'self' 'unsafe-inline'\n/csp-noframe-darkform/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${APP}; frame-src 'self'; style-src 'self' 'unsafe-inline'\n/csp-noframe/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${APP}; frame-src 'self'; style-src 'self' 'unsafe-inline'\n/csp-noscript/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; frame-src ${APP}; style-src 'self' 'unsafe-inline'\n/csp-noscript-frame/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; frame-src ${APP}; style-src 'self' 'unsafe-inline'\n`,
};

const results = [];
function check(ok, name, detail = "") { results.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`); }
const portFree = (port) => new Promise((resolve, reject) => { const p = net.createServer(); p.once("error", () => reject(new Error(`Port ${port} is in use.`))); p.once("listening", () => p.close(resolve)); p.listen(port, "127.0.0.1"); });
const ok200 = (port, p) => new Promise((resolve) => { const r = http.get({ host: "127.0.0.1", port, path: p, timeout: 1500 }, (s) => { s.resume(); resolve(s.statusCode === 200); }); r.on("error", () => resolve(false)); r.on("timeout", () => { r.destroy(); resolve(false); }); });
async function stopTree(child) { if (!child?.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 300)); try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
// One scenario that throws records a failure and the run goes on, so every case is reported on every run.
async function scenario(name, fn) {
  try { await fn(); } catch (error) { check(false, `${name}: the scenario ran to the end`, String(error?.message ?? error).split("\n")[0]); }
}

async function rocketLoader() {
  if (process.env.ROCKET_LOADER_JS) return fs.readFileSync(process.env.ROCKET_LOADER_JS, "utf8");
  const res = await fetch(`https://ajax.cloudflare.com/cdn-cgi/scripts/${RL_HASH}/cloudflare-static/rocket-loader.min.js`);
  if (!res.ok) throw new Error(`Rocket Loader could not be fetched (${res.status}); set ROCKET_LOADER_JS to a saved copy.`);
  return res.text();
}

/** Stub Supabase at the network; record what reaches the intake and anything else that tries. */
async function stubSupabase(ctx, { form = FORM } = {}) {
  const seen = { submits: [], unexpected: [] };
  const cors = (req) => ({ "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json" });
  await ctx.route((url) => url.host === SUPABASE, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(req) });
    if (url.pathname === "/rest/v1/rpc/growth_public_form") return route.fulfill({ status: 200, headers: cors(req), body: JSON.stringify([form]) });
    if (url.pathname === "/functions/v1/growth-public-visit") return route.fulfill({ status: 200, headers: cors(req), body: JSON.stringify({ ok: true, visit: "v-1" }) });
    if (url.pathname === "/functions/v1/growth-public-submit") {
      seen.submits.push({ origin: req.headers().origin ?? null, referer: req.headers().referer ?? null, body: JSON.parse(req.postData() ?? "{}") });
      return route.fulfill({ status: 200, headers: cors(req), body: JSON.stringify({ ok: true, submission_id: "sub-1", success_action: form.success_action_json }) });
    }
    seen.unexpected.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  // Paige's own product analytics, wherever they would go.
  seen.analytics = [];
  ctx.on("request", (req) => { const u = new URL(req.url()); if (/(^|\.)(plausible\.io|posthog\.com|facebook\.net|facebook\.com)$/.test(u.hostname) || u.pathname === "/functions/v1/track-event") seen.analytics.push(`${u.host}${u.pathname}`); });
  return seen;
}

/** The visitor fills the form inside `frame` and sends it; returns once the thank-you shows. */
async function fillAndSend(frame) {
  await frame.waitForSelector("#gf-name", { timeout: 30000 });
  await frame.fill("#gf-name", "Dana Reyes");
  await frame.fill("#gf-email", "dana@example.com");
  await settle(1700); // never faster than a person could type: the bot trap times it
  await frame.locator("button", { hasText: "Submit" }).click();
  await frame.waitForSelector("text=Thanks — we'll be in touch within a day.", { timeout: 15000 });
}

const sentOk = (seen, id) => {
  const sent = seen.submits[0];
  check(Boolean(sent) && sent.origin === APP, `${id}: the answers reach Paige's intake from Paige's own origin, not the business's site`, JSON.stringify(sent?.origin));
  check(Boolean(sent) && sent.body.form_id === FORM_ID && !("tenant_id" in sent.body) && sent.body.answers?.email === "dana@example.com" && sent.body.hp === "",
    `${id}: they carry the form, the bot trap and no business id`, JSON.stringify(sent?.body));
  return sent;
};
// The fallback / booking button, measured in pixels on the page it sits on: its text against its own fill (>= 4.5:1),
// its outline against the page around it (>= 3:1, WCAG 1.4.11: the fill or either ring tone), its height, and
// a visible keyboard focus.
async function buttonLooks(pg, frame, selector) {
  const el = await frame.waitForSelector(selector, { timeout: 15000 });
  const facts = await el.evaluate((b) => {
    const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    return { h: r.height, text: cs.color, fill: cs.backgroundColor };
  });
  const box = await el.boundingBox();
  // A 1x1 screenshot, decoded here (no image library, and no reliance on the host page's own policy).
  const px = async (x, y) => {
    const png = await pg.screenshot({ clip: { x, y, width: 1, height: 1 } });
    let at = 8; const idat = []; let colorType = 2;
    while (at < png.length) {
      const len = png.readUInt32BE(at); const type = png.toString("ascii", at + 4, at + 8);
      if (type === "IHDR") colorType = png[at + 8 + 9];
      if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
      at += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    // Grey (0) and grey-alpha (4) carry one value per pixel; colour (2, 6) three. Chromium writes colour.
    return colorType === 0 || colorType === 4 ? [raw[1], raw[1], raw[1]] : [raw[1], raw[2], raw[3]];
  };
  const cy = box.y + box.height / 2;
  const [fill, inner, outer, around] = [await px(box.x + 4, cy), await px(box.x - 1.5, cy), await px(box.x - 2.6, cy), await px(box.x - 14, cy)];
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const parse = (v) => v.match(/\d+/g).slice(0, 3).map(Number);
  const textRatio = ratio(parse(facts.text), parse(facts.fill));
  // Its outline against the page: whichever of the fill or the two ring tones stands out most from what's around it.
  const edgeRatio = Math.max(ratio(fill, around), ratio(inner, around), ratio(outer, around));
  await el.focus();
  await pg.keyboard.press("Shift+Tab"); await pg.keyboard.press("Tab");
  const focus = await el.evaluate((b) => ({ focused: (b.getRootNode().activeElement ?? document.activeElement) === b, outline: getComputedStyle(b).outlineStyle, width: parseFloat(getComputedStyle(b).outlineWidth) }));
  return { h: facts.h, textRatio: Math.round(textRatio * 10) / 10, edgeRatio: Math.round(edgeRatio * 10) / 10, focus, around };
}

const fitsWithoutScroll = async (frame) => frame.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2);

async function main() {
  await portFree(APP_PORT); await portFree(HOST_PORT);
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  for (const [file, body] of Object.entries(SITE_FILES)) { fs.mkdirSync(path.dirname(path.join(SITE_DIR, file)), { recursive: true }); fs.writeFileSync(path.join(SITE_DIR, file), body); }
  fs.mkdirSync(path.join(SITE_DIR, "rl"), { recursive: true });
  fs.writeFileSync(path.join(SITE_DIR, "rl/rocket-loader.min.js"), await rocketLoader());

  // --cors: production serves the app's scripts with `access-control-allow-origin: *` (measured on /assets/*.js
  // 2026-10-13), which is what lets them load in a sandboxed frame at all; the dev server sends none unless asked.
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(APP_PORT), "--strictPort", "--host", "127.0.0.1", "--cors"], { cwd: REPO, stdio: "ignore", detached: true });
  const [bin, ...pre] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ["npx", "--yes", "wrangler@4.149.0"];
  const pages = spawn(bin, [...pre, "pages", "dev", SITE_DIR, "--port", String(HOST_PORT), "--ip", "127.0.0.1"], { cwd: OUT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let pagesLog = ""; pages.stdout.on("data", (d) => { pagesLog += d; }); pages.stderr.on("data", (d) => { pagesLog += d; });
  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 160 && !ready; i++) { ready = (await ok200(APP_PORT, "/embed.js")) && (await ok200(HOST_PORT, "/")); if (!ready) await settle(500); }
    if (!ready) throw new Error(`The app or the Pages site did not start.\n${pagesLog.slice(-800)}`);
    check(/Ready on/.test(pagesLog), "the business's site is served by Cloudflare's Pages runtime (wrangler pages dev), with no Cloudflare account");
    browser = await chromium.launch(buildLaunchOptions());
    const open = async (route, { viewport = { width: 1366, height: 900 }, form } = {}) => {
      const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
      const seen = await stubSupabase(ctx, form ? { form } : {});
      const pg = await ctx.newPage();
      const errors = []; pg.on("pageerror", (e) => errors.push(String(e.message)));
      const consoleLines = []; pg.on("console", (m) => consoleLines.push(m.text()));
      await pg.goto(`${SITE}${route}`, { waitUntil: "domcontentloaded" });
      return { ctx, pg, seen, errors, consoleLines };
    };

    // 1. A plain page, desktop and phone: from a tagged campaign link to a sent answer.
    for (const [label, viewport] of [["desktop-1366", { width: 1366, height: 900 }], ["phone-390", { width: 390, height: 844 }]]) await scenario(`plain ${label}`, async () => {
      const id = `plain ${label}`;
      const { ctx, pg, seen, errors } = await open("/?utm_source=newsletter&utm_campaign=spring-advisory&ref=x&secret=no", { viewport });
      const el = await pg.waitForSelector("iframe", { timeout: 15000 });
      const src = new URL(await el.getAttribute("src"));
      check(src.origin === APP && src.pathname === `/form/${FORM_ID}` && src.searchParams.get("utm_campaign") === "spring-advisory" && !src.searchParams.has("secret") && !src.searchParams.has("ref"),
        `${id}: the copied code frames the form from Paige with the visit's campaign tags and nothing else`, src.href);
      const frame = await el.contentFrame();
      await frame.waitForSelector("h1:has-text('Spring consult request')", { timeout: 30000 }); await settle(700);
      check(await fitsWithoutScroll(frame), `${id}: the frame sizes itself to the form (no inner scrollbar)`);
      check(!(await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), `${id}: the site gains no sideways scroll`);
      check(await el.evaluate((f) => f.previousElementSibling?.tagName === "H2" || f.parentElement?.id === "contact"), `${id}: the form appears where the code was pasted`);
      await pg.screenshot({ path: path.join(OUT, `${label}-ready.png`), fullPage: true });
      await fillAndSend(frame);
      const sent = sentOk(seen, id);
      check(sent?.body.utm?.utm_campaign === "spring-advisory" && sent?.body.utm?.utm_source === "newsletter", `${id}: the answer is credited to the visit's campaign tags`, JSON.stringify(sent?.body.utm));
      if (label === "desktop-1366" && sent) fs.writeFileSync(path.join(OUT, "sent.json"), JSON.stringify({ form: FORM, sent }, null, 2));
      await settle(500);
      check(await fitsWithoutScroll(frame), `${id}: the thank-you fits its frame`);
      check(seen.analytics.length === 0, `${id}: none of Paige's product analytics run on the business's site (Plausible, page_view, Meta Pixel; PostHog is proven by its unit test, no key here)`, JSON.stringify(seen.analytics));
      check(!seen.unexpected.some((c) => c.includes("/rest/v1/paige_config")), `${id}: the Meta Pixel doesn't even look up its settings on the business's site`, JSON.stringify(seen.unexpected));
      check(errors.length === 0, `${id}: no page error`, JSON.stringify(errors));
      await pg.screenshot({ path: path.join(OUT, `${label}-sent.png`), fullPage: true });
      await ctx.close();
    });

    // 1b. The code pasted into <head>: the form still shows, at the end of the page, and works.
    await scenario("code pasted into <head>", async () => {
      const { ctx, pg, seen } = await open("/head/");
      const el = await pg.waitForSelector("iframe", { timeout: 15000 });
      check(await el.evaluate((f) => f.parentElement === document.body && !!f.getBoundingClientRect().height), "code pasted into <head>: the form shows at the end of the page, not hidden in head");
      await fillAndSend(await el.contentFrame()); sentOk(seen, "code pasted into <head>");
      await ctx.close();
    });

    // 2. Rocket Loader. The copied tag opts out; an older tag without the opt-out is re-run by Rocket Loader.
    for (const [route, id] of [["/rocket-optout/", "Rocket Loader, copied tag (opted out)"], ["/rocket/", "Rocket Loader, older tag (re-run by Rocket Loader)"]]) await scenario(id, async () => {
      const { ctx, pg, seen, errors } = await open(route);
      await pg.waitForFunction(() => window.__rocketRan === true, null, { timeout: 15000 }).catch(() => {});
      check(await pg.evaluate(() => window.__rocketRan === true), `${id}: Cloudflare's Rocket Loader ran on the page`);
      const el = await pg.waitForSelector("iframe", { timeout: 15000 }).catch(() => null);
      await settle(1500);
      const frames = await pg.locator("iframe").count();
      check(Boolean(el) && frames === 1, `${id}: exactly one form`, `${frames} frames`);
      if (el) {
        check(await el.evaluate((f) => f.parentElement?.id === "contact"), `${id}: in the place the code was pasted`);
        await fillAndSend(await el.contentFrame()); sentOk(seen, id);
      }
      check(errors.length === 0, `${id}: no page error`, JSON.stringify(errors));
      await ctx.close();
    });

    // 3. Content-Security-Policy set in `_headers`.
    await scenario("CSP allowing Paige", async () => {
      const { ctx, pg, seen, errors } = await open("/csp-allows/");
      const csp = await pg.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
      check(Boolean(csp) && csp.includes("frame-src"), "CSP allowing Paige: Pages served the site's own policy", String(csp));
      const el = await pg.waitForSelector("iframe", { timeout: 15000 });
      await fillAndSend(await el.contentFrame()); sentOk(seen, "CSP allowing Paige");
      check(errors.length === 0, "CSP allowing Paige: no page error", JSON.stringify(errors));
      await ctx.close();
    });
    await scenario("CSP blocking the frame", async () => {
      const { ctx, pg, consoleLines } = await open("/csp-noframe/?utm_campaign=spring-advisory");
      const link = await pg.waitForSelector("a[data-paige-form-link]", { timeout: 15000 }).catch(() => null);
      const href = link ? new URL(await link.getAttribute("href")) : null;
      check(Boolean(link) && (await pg.locator("iframe").count()) === 0 && href?.origin === APP && href?.pathname === `/form/${FORM_ID}` && href?.searchParams.get("utm_campaign") === "spring-advisory" && !href?.searchParams.has("embed"),
        "CSP blocking the frame: the visitor gets a link to the form's own page (with the campaign tags), not a blank box", href?.href ?? "no link");
      check(link ? (await link.getAttribute("target")) === "_blank" : false, "CSP blocking the frame: the link opens the form beside the site");
      check(consoleLines.some((l) => /Content-Security-Policy blocks the form \(frame-src/.test(l) && l.includes(APP)), "CSP blocking the frame: the console names the directive to add", JSON.stringify(consoleLines.filter((l) => /Paige/.test(l))));
      const looks = await buttonLooks(pg, pg.mainFrame(), "a[data-paige-form-link]");
      check(looks.textRatio >= 4.5 && looks.edgeRatio >= 3 && looks.h >= 44 && looks.focus.focused && looks.focus.outline !== "none", `fallback button on a dark site: readable (${looks.textRatio}:1), its edge visible (${looks.edgeRatio}:1), 44px, keyboard focus shown`, JSON.stringify(looks));
      await pg.screenshot({ path: path.join(OUT, "csp-noframe.png"), fullPage: true });
      await ctx.close();
    });
    await scenario("CSP blocking outside scripts", async () => {
      const { ctx, pg } = await open("/csp-noscript/");
      await settle(2500);
      check((await pg.locator("iframe").count()) === 0, "CSP blocking outside scripts: the tag can't run (the no-script code is the answer, next)");
      await ctx.close();
      const second = await open("/csp-noscript-frame/");
      const el = await second.pg.waitForSelector("iframe", { timeout: 15000 });
      const frame = await el.contentFrame();
      await fillAndSend(frame); sentOk(second.seen, "CSP blocking outside scripts, no-script code");
      check(second.seen.analytics.length === 0, "no-script code: none of Paige's product analytics run", JSON.stringify(second.seen.analytics));
      await second.pg.screenshot({ path: path.join(OUT, "csp-noscript-frame-sent.png"), fullPage: true });
      await second.ctx.close();
    });

    // 4. A site builder's sandboxed "custom HTML" block.
    await scenario("sandbox without allow-same-origin", async () => {
      const { ctx, pg, seen, consoleLines } = await open("/sandbox/");
      const block = await (await pg.waitForSelector("iframe[title='Custom HTML']")).contentFrame();
      const link = await block.waitForSelector("a[data-paige-form-link]", { timeout: 15000 }).catch(() => null);
      check(Boolean(link) && (await block.locator("iframe").count()) === 0, "sandbox without allow-same-origin: a link to the form instead of a form that could not send", link ? "" : "no link");
      check(link ? new URL(await link.getAttribute("href")).pathname === `/form/${FORM_ID}` : false, "sandbox without allow-same-origin: the link is the form's own page");
      check(consoleLines.some((l) => /sandbox without allow-same-origin/.test(l)), "sandbox without allow-same-origin: the console says why and what to change");
      check(seen.submits.length === 0, "sandbox without allow-same-origin: nothing was sent");
      await pg.screenshot({ path: path.join(OUT, "sandbox-link.png"), fullPage: true });
      // The tab it opens inherits the sandbox (the block doesn't let popups escape), so the form can't run there:
      // it shows the form's address to copy into a new tab, never a blank page.
      if (link) {
        const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), link.click()]);
        await tab.waitForLoadState("domcontentloaded");
        const shown = await tab.waitForSelector("text=This form opens on its own page", { timeout: 30000 }).catch(() => null);
        const address = shown ? (await tab.locator("p.font-mono").textContent())?.trim() : null;
        const opaque = await tab.evaluate(() => String(window.origin));
        check(Boolean(shown) && address === `${APP}/form/${FORM_ID}`, "sandbox without allow-same-origin: the tab the link opens (still sandboxed) shows the form's address to copy, not a blank page", JSON.stringify({ opaque, address }));
        check((await tab.locator("button", { hasText: "Copy address" }).count()) === 1 && (await tab.locator("a", { hasText: "Open the form" }).count()) === 0, "sandbox without allow-same-origin: that tab offers Copy address, not another sandboxed link");
        await tab.screenshot({ path: path.join(OUT, "sandbox-link-opened-tab.png"), fullPage: true });
      }
      await ctx.close();
    });
    await scenario("sandbox with allow-same-origin", async () => {
      const { ctx, pg, seen } = await open("/sandbox-same-origin/");
      const block = await (await pg.waitForSelector("iframe[title='Custom HTML']")).contentFrame();
      const el = await block.waitForSelector("iframe", { timeout: 15000 });
      await fillAndSend(await el.contentFrame()); sentOk(seen, "sandbox with allow-same-origin");
      await ctx.close();
    });
    await scenario("sandbox that lets tabs escape", async () => {
      const { ctx, pg, seen } = await open("/sandbox-escape/");
      const block = await (await pg.waitForSelector("iframe[title='Custom HTML']")).contentFrame();
      const link = await block.waitForSelector("a[data-paige-form-link]", { timeout: 15000 });
      const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), link.click()]);
      await tab.waitForLoadState("domcontentloaded");
      check(await tab.evaluate(() => String(window.origin)) === APP, "sandbox that lets tabs escape: the link opens the form's own page with its real origin");
      await fillAndSend(tab.mainFrame()); sentOk(seen, "sandbox that lets tabs escape, form's own page");
      await ctx.close();
    });
    for (const [route, label] of [["/csp-noframe-light/", "fallback button on a light site"], ["/csp-noframe-darkform/", "fallback button for a dark-look form, on a light site (inverted)"]]) await scenario(label, async () => {
      const { ctx, pg } = await open(route);
      const looks = await buttonLooks(pg, pg.mainFrame(), "a[data-paige-form-link]");
      check(looks.textRatio >= 4.5 && looks.edgeRatio >= 3 && looks.h >= 44 && looks.focus.focused && looks.focus.outline !== "none", `${label}: readable (${looks.textRatio}:1), its edge visible (${looks.edgeRatio}:1), 44px, keyboard focus shown`, JSON.stringify(looks));
      if (route.includes("darkform")) {
        const fill = await pg.locator("a[data-paige-form-link]").evaluate((a) => getComputedStyle(a).backgroundColor);
        check(fill === "rgb(255, 255, 255)", `${label}: the button is inverted (white) for the owner's dark-look form`, fill);
      }
      await pg.screenshot({ path: path.join(OUT, `${route.replaceAll("/", "")}.png`), fullPage: true });
      await ctx.close();
    });
    for (const [route, label] of [["/booking-popup/", "booking popup button on a dark site"], ["/booking-popup-light/", "booking popup button on a light site"]]) await scenario(label, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
      await ctx.route((url) => url.host === SUPABASE, (r) => r.abort());
      const pg = await ctx.newPage();
      await pg.goto(`${SITE}${route}`, { waitUntil: "domcontentloaded" });
      const btn = await pg.waitForSelector("button:has-text('Book a time')", { timeout: 15000 });
      const looks = await buttonLooks(pg, pg.mainFrame(), "button:has-text('Book a time')");
      check(looks.textRatio >= 4.5 && looks.edgeRatio >= 3 && looks.h >= 44 && looks.focus.focused && looks.focus.outline !== "none", `${label}: readable (${looks.textRatio}:1), its edge visible (${looks.edgeRatio}:1), 44px, keyboard focus shown`, JSON.stringify(looks));
      await pg.screenshot({ path: path.join(OUT, `${route.replaceAll("/", "")}.png`), fullPage: true });
      await btn.click();
      const frame = await pg.waitForSelector("[role=dialog] iframe", { timeout: 15000 }).catch(() => null);
      check(Boolean(frame) && new URL(await frame.getAttribute("src")).pathname === "/book/discovery-call", `${label}: still opens the booking calendar in its dialog, unchanged`);
      await pg.keyboard.press("Escape");
      check((await pg.locator("[role=dialog]").count()) === 0, `${label}: Escape still closes it`);
      await ctx.close();
    });
    await scenario("CSP in report-only mode", async () => {
      const { ctx, pg, seen, consoleLines } = await open("/csp-report-only/");
      const ro = await pg.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy-report-only"));
      check(Boolean(ro), "CSP report-only: Pages served the site's report-only policy", String(ro));
      const el = await pg.waitForSelector("iframe", { timeout: 15000 });
      await settle(1500);
      check((await pg.locator("a[data-paige-form-link]").count()) === 0 && !consoleLines.some((l) => /Content-Security-Policy blocks the form/.test(l)), "CSP report-only: the form stays (a report-only policy never blocks), and no false console advice");
      await fillAndSend(await el.contentFrame()); sentOk(seen, "CSP report-only");
      await ctx.close();
    });
    await scenario("no-script code inside a sandbox", async () => {
      const { ctx, pg, seen } = await open("/sandbox-frame/");
      const frame = await (await pg.waitForSelector("iframe")).contentFrame();
      const link = await frame.waitForSelector("a:has-text('Open the form')", { timeout: 30000 }).catch(() => null);
      const words = await frame.locator("text=This form opens on its own page").count();
      const address = (await frame.locator("p.font-mono").textContent().catch(() => ""))?.trim();
      check(address === `${APP}/form/${FORM_ID}` && (await frame.locator("button", { hasText: "Copy address" }).count()) === 1, "no-script code inside a sandbox: the form's address is shown to copy", String(address));
      check(Boolean(link) && words === 1 && (await frame.locator("#gf-name").count()) === 0, "no-script code inside a sandbox: instead of a blank frame, the visitor is told the form opens on its own page, with a link", link ? "" : "no link");
      check(link ? new URL(await link.getAttribute("href")).searchParams.has("embed") === false : false, "no-script code inside a sandbox: the link opens the full form page");
      check(seen.submits.length === 0, "no-script code inside a sandbox: nothing was sent");
      await pg.screenshot({ path: path.join(OUT, "sandbox-frame.png"), fullPage: true });
      await ctx.close();
    });

    // 5. A success redirect moves the visitor's whole page on the business's site.
    await scenario("redirect", async () => {
      const { ctx, pg } = await open("/redirect/", { form: { ...FORM, success_action_json: { message: "Thanks", redirect_url: `${SITE}/thanks/` } } });
      const frame = await (await pg.waitForSelector("iframe", { timeout: 15000 })).contentFrame();
      await frame.waitForSelector("#gf-name", { timeout: 30000 });
      await frame.fill("#gf-name", "Dana Reyes"); await frame.fill("#gf-email", "dana@example.com"); await settle(1700);
      await frame.locator("button", { hasText: "Submit" }).click();
      await pg.waitForURL(`${SITE}/thanks/`, { timeout: 15000 }).catch(() => {});
      check(pg.url() === `${SITE}/thanks/` && (await pg.locator("#thanks").count()) === 1, "redirect: the business's next page replaces the visitor's page", pg.url());
      await ctx.close();
    });

    // 6. Protected: the form's own page (not on a business's site) keeps Paige's analytics exactly as before.
    await scenario("the form's own page", async () => {
      const ctx = await browser.newContext();
      const seen = await stubSupabase(ctx);
      await ctx.route(/plausible\.io/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
      const pg = await ctx.newPage();
      await pg.goto(`${APP}/form/${FORM_ID}`, { waitUntil: "domcontentloaded" });
      await pg.waitForSelector("h1:has-text('Spring consult request')", { timeout: 30000 }); await settle(800);
      check(seen.analytics.some((u) => /plausible\.io/.test(u)), "the form's own page still loads Paige's site analytics (unchanged)", JSON.stringify(seen.analytics));
      await ctx.close();
    });
  } finally {
    await browser?.close();
    await stopTree(vite);
    await stopTree(pages);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Frames: ${OUT}`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
