#!/usr/bin/env node
// A Paige lead form on a business's OWN website (Experience 03), driven for real across two origins.
//
// WHAT IT PROVES. It runs the REAL app (vite dev, the real /form/:id route and the real public/embed.js)
// on one origin, and a plain "business website" on ANOTHER origin that pastes the exact code Studio hands
// the owner. Only Supabase is stubbed, at the network: growth_public_form answers the form, growth-public-visit
// and growth-public-submit answer as the server would. Every other Supabase request fails the run, so nothing
// can reach production. For each frame it checks: the loader builds the right frame (the form's id, the host
// page's campaign tags and nothing else), the frame sizes itself with no inner scrollbar, the visitor can
// reach the form by keyboard, a required question blocks sending, the answers reach Paige's intake from
// Paige's own origin (never the host's) with the campaign tags and no business id, the success, the error
// and the taken-offline states read plainly, a success redirect moves the visitor's whole page, the frame
// fits a phone, and the booking calendar's tag still builds its own frame.
//
// WHAT IT DOES NOT PROVE. The server's own rules (origin allow-list, bot trap, rate limits, the S1a campaign
// stamp and S1b routing) — those are proven by their SQL and edge tests; nor a production browser session.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const APP_PORT = 5232;
const HOST_PORT = 5233;
const APP = `http://127.0.0.1:${APP_PORT}`;
// "localhost" vs "127.0.0.1": a different origin, as a business's own domain is.
const SITE = `http://localhost:${HOST_PORT}`;
const REPO = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(import.meta.dirname, "artifacts/form-embed");
const FORM_ID = "0b8f1a2e-1111-4222-8333-444455556666";
const SUPABASE = new URL(fs.readFileSync(path.join(REPO, ".env"), "utf8").match(/^VITE_SUPABASE_URL=["']?([^"'\n]+)/m)[1]).host;

const FORM = {
  id: FORM_ID, slug: "spring-consult", name: "Spring consult request",
  schema_json: { sections: [{ title: "About you", fields: [
    { key: "name", type: "text", label: "Your name", required: true },
    { key: "email", type: "email", label: "Work email", required: true },
    { key: "goal", type: "textarea", label: "What would you like help with?" },
  ] }] },
  success_action_json: { message: "Thanks — we'll be in touch within a day." },
};

// The exact code Studio hands the owner (src/solo/studio/EmbedCode.tsx embedSnippet), with the loader on the app's origin.
const snippet = (extra = "") => `<script src="${APP}/embed.js" data-form="${FORM_ID}" data-title="Spring consult request"${extra} async></script>`;
const site = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acme Advisory</title>
<style>body{margin:0;font:16px/1.5 Georgia,serif;background:#f4efe6;color:#2b2118}main{max-width:720px;margin:0 auto;padding:32px 16px}h1{font-size:28px;margin:0 0 8px}</style></head>
<body><main><h1>Acme Advisory</h1><p>Spring consults are open. Tell us a little about you.</p><a id="before" href="#">Our services</a>${body}<p id="after">We reply within a day.</p></main></body></html>`;
const PAGES = {
  "/": site(snippet()),
  "/dark": site(snippet(' data-theme="dark"')),
  "/booking": site(`<script src="${APP}/embed.js" data-slug="discovery-call" async></script>`),
  "/thanks": `<!doctype html><title>Thanks</title><h1 id="thanks">Thanks page on the business's own site</h1>`,
};

const results = [];
function check(ok, name, detail = "") { results.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`); }
const portFree = (port) => new Promise((resolve, reject) => { const p = net.createServer(); p.once("error", () => reject(new Error(`Port ${port} is in use.`))); p.once("listening", () => p.close(resolve)); p.listen(port, "127.0.0.1"); });
const up = () => new Promise((resolve) => { const r = http.get({ host: "127.0.0.1", port: APP_PORT, path: "/embed.js", timeout: 1500 }, (s) => { s.resume(); resolve(s.statusCode === 200); }); r.on("error", () => resolve(false)); r.on("timeout", () => { r.destroy(); resolve(false); }); });
async function stopTree(child) { if (!child?.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 300)); try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }

/** Stub Supabase at the network for one context. `form`/`submit` choose the server's answer. */
async function stubSupabase(ctx, { form = FORM, submit = { status: 200, body: { ok: true, submission_id: "sub-1" } } } = {}) {
  const seen = { submits: [], visits: 0, unexpected: [] };
  const cors = (req) => ({ "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json" });
  await ctx.route((url) => url.host === SUPABASE, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(req) });
    if (url.pathname === "/rest/v1/rpc/growth_public_form") return route.fulfill({ status: 200, headers: cors(req), body: JSON.stringify(form ? [form] : []) });
    if (url.pathname === "/functions/v1/growth-public-visit") { seen.visits++; return route.fulfill({ status: 200, headers: cors(req), body: JSON.stringify({ ok: true, visit: "v-1" }) }); }
    if (url.pathname === "/functions/v1/growth-public-submit") {
      seen.submits.push({ origin: req.headers().origin, body: JSON.parse(req.postData() ?? "{}") });
      return route.fulfill({ status: submit.status, headers: cors(req), body: JSON.stringify(submit.body) });
    }
    seen.unexpected.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  return seen;
}

// The app shell's own reads on any route (configuration, product analytics). The stub blocks them, so they
// never reach production; the run lists them rather than hiding them.
const SHELL_CALLS = new Set(["GET /rest/v1/paige_config", "POST /functions/v1/track-event"]);
const frameOf = async (page) => { const el = await page.waitForSelector("iframe", { timeout: 15000 }); return { el, frame: await el.contentFrame() }; };
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await portFree(APP_PORT); await portFree(HOST_PORT);
  fs.mkdirSync(OUT, { recursive: true });
  const siteServer = http.createServer((req, res) => {
    const page = PAGES[new URL(req.url, SITE).pathname];
    res.writeHead(page ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" }); res.end(page ?? "not found");
  }).listen(HOST_PORT, "127.0.0.1");
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(APP_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) { ready = await up(); if (!ready) await settle(500); }
    if (!ready) throw new Error("The app did not start.");
    browser = await chromium.launch(buildLaunchOptions());

    for (const [label, viewport] of [["desktop-1366", { width: 1366, height: 900 }], ["phone-390", { width: 390, height: 844 }]]) {
      for (const scheme of ["light", "dark"]) {
        const id = `${label}/${scheme}`;
        const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce" });
        const seen = await stubSupabase(ctx);
        const page = await ctx.newPage();
        const errors = []; page.on("pageerror", (e) => errors.push(String(e.message)));
        // A visitor arrives from a tagged campaign link; an unrelated parameter must not travel.
        await page.goto(`${SITE}/?utm_source=newsletter&utm_campaign=spring-advisory&ref=producthunt&secret=do-not-forward`, { waitUntil: "domcontentloaded" });
        const { el, frame } = await frameOf(page);
        const src = new URL(await el.getAttribute("src"));
        check(src.origin === APP && src.pathname === `/form/${FORM_ID}` && src.searchParams.get("embed") === "1"
          && src.searchParams.get("utm_campaign") === "spring-advisory" && src.searchParams.get("utm_source") === "newsletter" && !src.searchParams.has("secret") && !src.searchParams.has("ref"),
          `${id}: the loader frames this form from Paige, carrying the page's campaign tags and nothing else`, src.href);
        check(await el.getAttribute("title") === "Spring consult request", `${id}: the frame is named for the form`);
        // While the app boots, the frame paints no Paige splash or fallback: the business's page shows through.
        await frame.waitForSelector("body", { state: "attached", timeout: 30000 });
        const boot = await frame.evaluate(() => {
          const splash = document.getElementById("paige-splash");
          const fallback = document.querySelector("#root > main");
          return { splash: splash ? { bg: getComputedStyle(splash).backgroundColor, words: splash.textContent.trim() } : null, fallback: fallback ? getComputedStyle(fallback).display : null };
        });
        check((!boot.splash || (/rgba\(0, 0, 0, 0\)|transparent/.test(boot.splash.bg) && boot.splash.words === "")) && (boot.fallback === null || boot.fallback === "none"),
          `${id}: no Paige splash or fallback inside the business's page while it loads`, JSON.stringify(boot));
        // The form's own heading, not anything painted while the app boots.
        await frame.waitForSelector("h1:has-text('Spring consult request')", { timeout: 30000 });
        await settle(600);
        const fit = await el.evaluate((f) => { const p = getComputedStyle(f.parentElement); return { height: f.getBoundingClientRect().height, width: f.getBoundingClientRect().width, parent: f.parentElement.clientWidth - parseFloat(p.paddingLeft) - parseFloat(p.paddingRight) }; });
        const inner = await frame.evaluate(() => ({ scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight, bg: getComputedStyle(document.body).backgroundColor, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
        check(fit.height !== 720 && inner.scroll <= inner.client + 2, `${id}: the frame sizes itself to the form, no inner scrollbar`, JSON.stringify({ fit, inner }));
        check(Math.abs(fit.width - fit.parent) <= 1 && !inner.wide, `${id}: the form fits the width it's given`, JSON.stringify(fit));
        check(/rgba\(0, 0, 0, 0\)|transparent/.test(inner.bg), `${id}: the business's own page shows around the card`, inner.bg);
        // Pixels, not styles: the frame's corner (outside the card) must show the business's page colour.
        const corner = await page.screenshot({ clip: await el.evaluate((f) => { const r = f.getBoundingClientRect(); return { x: r.left + 1, y: r.top + 1, width: 1, height: 1 }; }) });
        const site = await page.screenshot({ clip: { x: 2, y: 2, width: 1, height: 1 } });
        check(corner.equals(site), `${id}: no box behind the card — the frame's corner is the business's page`, "corner pixel differs from the page");
        const hostWide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        check(!hostWide, `${id}: the business's page gains no sideways scroll`);
        // Contrast of the form's own text against what is painted behind it.
        const contrast = await frame.evaluate(() => {
          const c = document.createElement("canvas").getContext("2d");
          const rgb = (v) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = v; c.fillRect(0, 0, 1, 1); const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
          const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
          const bg = (el) => { for (let n = el; n; n = n.parentElement) { const x = rgb(getComputedStyle(n).backgroundColor); if (x.a > 0.9) return x; } return { r: 255, g: 255, b: 255 }; };
          let worst = { ratio: 99, what: "" };
          for (const el of document.querySelectorAll("h1, h3, label, p, button")) {
            if (!el.textContent.trim() || el.closest("[aria-hidden=true]")) continue;
            const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(bg(el))].sort((x, y) => y - x);
            const ratio = (hi + 0.05) / (lo + 0.05);
            if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.tagName}:${el.textContent.trim().slice(0, 30)}` };
          }
          return worst;
        });
        check(contrast.ratio >= 4.5, `${id}: the form's text contrast >= 4.5:1 (worst ${contrast.ratio})`, contrast.what);
        await page.screenshot({ path: path.join(OUT, `${label}-${scheme}-ready.png`), fullPage: true });

        // Keyboard: from the host page's link before it, Tab enters the frame and the first stop inside is the first question.
        await page.focus("#before");
        let focused = null;
        for (let i = 0; i < 4 && !focused; i++) {
          await page.keyboard.press("Tab");
          focused = await frame.evaluate(() => (document.hasFocus() && document.activeElement && document.activeElement !== document.body ? document.activeElement.id || document.activeElement.tagName : null));
        }
        check(focused === "gf-name", `${id}: Tab from the business's page reaches the form's first question`, String(focused));
        const submit = frame.locator("button", { hasText: "Submit" });
        check(await submit.isDisabled(), `${id}: a required question left empty blocks sending`);
        await frame.fill("#gf-name", "Dana Reyes");
        await frame.fill("#gf-email", "dana@example.com");
        await settle(1700); // a person takes a moment; the form never sends faster than one could type
        await submit.click();
        await frame.waitForSelector("text=Thanks — we'll be in touch within a day.", { timeout: 15000 });
        const sent = seen.submits[0];
        check(Boolean(sent) && sent.origin === APP, `${id}: the answers go to Paige's intake from Paige's own origin, not the business's`, JSON.stringify(sent?.origin));
        check(Boolean(sent) && sent.body.form_id === FORM_ID && sent.body.utm?.utm_campaign === "spring-advisory" && sent.body.utm?.utm_source === "newsletter"
          && !("tenant_id" in sent.body) && sent.body.answers?.email === "dana@example.com" && sent.body.hp === "",
          `${id}: the answers carry the form, the visit's campaign tags and the bot trap, never a business id`, JSON.stringify(sent?.body));
        await settle(500);
        const after = await el.evaluate((f) => f.getBoundingClientRect().height);
        const innerAfter = await frame.evaluate(() => ({ scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight }));
        check(innerAfter.scroll <= innerAfter.client + 2, `${id}: the success card fits its frame too (resized to ${Math.round(after)}px)`, JSON.stringify(innerAfter));
        const strange = seen.unexpected.filter((call) => !SHELL_CALLS.has(call));
        check(strange.length === 0, `${id}: nothing but the app shell's own reads tried Supabase, and those were blocked (${seen.unexpected.length})`, JSON.stringify(strange));
        check(errors.length === 0, `${id}: no page error`, JSON.stringify(errors));
        await page.screenshot({ path: path.join(OUT, `${label}-${scheme}-sent.png`), fullPage: true });
        await ctx.close();
      }
    }

    // The owner chose a dark form: the card is dark on a visitor whose system is light, with nothing behind it;
    // and a visitor whose system is dark still gets the default light card on the business's light page.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "light" });
      await stubSupabase(ctx);
      const page = await ctx.newPage();
      await page.goto(`${SITE}/dark`); const { el, frame } = await frameOf(page);
      await frame.waitForSelector("h1:has-text('Spring consult request')", { timeout: 30000 }); await settle(600);
      const looks = await frame.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), card: getComputedStyle(document.querySelector(".bg-card")).backgroundColor }));
      const corner = await page.screenshot({ clip: await el.evaluate((f) => { const r = f.getBoundingClientRect(); return { x: r.left + 1, y: r.top + 1, width: 1, height: 1 }; }) });
      const site = await page.screenshot({ clip: { x: 2, y: 2, width: 1, height: 1 } });
      check(looks.dark && corner.equals(site), "data-theme=dark: a dark card the owner chose, with no box behind it", JSON.stringify(looks));
      await page.screenshot({ path: path.join(OUT, "desktop-1366-chosen-dark.png"), fullPage: true });
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "dark" });
      await stubSupabase(ctx);
      const page = await ctx.newPage();
      await page.goto(`${SITE}/`); const { frame } = await frameOf(page);
      await frame.waitForSelector("h1:has-text('Spring consult request')", { timeout: 30000 }); await settle(300);
      const dark = await frame.evaluate(() => document.documentElement.classList.contains("dark"));
      const stored = await frame.evaluate(() => { try { return localStorage.getItem("theme"); } catch { return "unreadable"; } });
      check(!dark && stored === null, "default: a dark-system visitor still gets the light card, and the owner's stored theme is never written", JSON.stringify({ dark, stored }));
      await ctx.close();
    }
    // The server refuses (rate limited): the visitor is told, in the frame, and nothing claims success.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await stubSupabase(ctx, { submit: { status: 429, body: { error: "rate_limited" } } });
      const page = await ctx.newPage();
      await page.goto(`${SITE}/`); const { frame } = await frameOf(page);
      await frame.waitForSelector("#gf-name", { timeout: 20000 });
      await frame.fill("#gf-name", "Dana Reyes"); await frame.fill("#gf-email", "dana@example.com"); await settle(1700);
      await frame.locator("button", { hasText: "Submit" }).click();
      // The form's own alert (the app shell has alert regions of its own, so match the words, not the role).
      const alert = await frame.waitForSelector("[role=alert]:has-text('Lots of responses are coming in right now')", { timeout: 15000 }).catch(() => null);
      const words = alert ? await alert.textContent() : null;
      const resend = await frame.locator("button", { hasText: "Submit" }).isEnabled().catch(() => false);
      check(Boolean(words) && !(await frame.locator("text=Thanks").count()) && resend, "error: a refused send says so in the frame, claims nothing, and lets the visitor try again", words ?? "no form alert");
      await settle(600);
      const fits = await frame.evaluate(() => ({ scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight }));
      check(fits.scroll <= fits.client + 2, "error: the frame grows to show the message and the button, no inner scrollbar", JSON.stringify(fits));
      await page.screenshot({ path: path.join(OUT, "desktop-1366-light-error.png"), fullPage: true });
      await ctx.close();
    }
    // Taken offline: the frame says so, small, instead of a blank or a broken box.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await stubSupabase(ctx, { form: null });
      const page = await ctx.newPage();
      await page.goto(`${SITE}/`); const { el, frame } = await frameOf(page);
      await frame.waitForSelector("text=This form isn't available right now", { timeout: 20000 });
      await settle(500);
      const h = await el.evaluate((f) => f.getBoundingClientRect().height);
      check(h < 400, "offline: an unpublished form says it isn't available, in a small card", `${h}px`);
      await page.screenshot({ path: path.join(OUT, "desktop-1366-light-offline.png"), fullPage: true });
      await ctx.close();
    }
    // A success redirect moves the visitor's whole page, not the inside of the frame.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await stubSupabase(ctx, { form: { ...FORM, success_action_json: { message: "Thanks", redirect_url: `${SITE}/thanks` } } });
      const page = await ctx.newPage();
      await page.goto(`${SITE}/`); const { frame } = await frameOf(page);
      await frame.waitForSelector("#gf-name", { timeout: 20000 });
      await frame.fill("#gf-name", "Dana Reyes"); await frame.fill("#gf-email", "dana@example.com"); await settle(1700);
      await frame.locator("button", { hasText: "Submit" }).click();
      await page.waitForURL(`${SITE}/thanks`, { timeout: 15000 }).catch(() => {});
      check(page.url() === `${SITE}/thanks` && await page.locator("#thanks").count() === 1, "redirect: the next page replaces the visitor's page", page.url());
      await ctx.close();
    }
    // The booking calendar's tag is unchanged: it still frames /book/<slug> and is named for booking.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route((url) => url.host === SUPABASE, (route) => route.abort());
      const page = await ctx.newPage();
      await page.goto(`${SITE}/booking?utm_campaign=spring-advisory`);
      const el = await page.waitForSelector("iframe", { timeout: 15000 });
      const src = new URL(await el.getAttribute("src"));
      check(src.href === `${APP}/book/discovery-call` && await el.getAttribute("title") === "Book a time", "booking: the calendar's tag still frames its own page, unchanged", src.href);
      await ctx.close();
    }
  } finally {
    await browser?.close();
    await stopTree(vite);
    siteServer.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Frames: ${OUT}`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
