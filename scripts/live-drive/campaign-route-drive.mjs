#!/usr/bin/env node
// Experience 03 S1b: where a campaign-attached form's leads go, rendered for real everywhere Marketing names it.
//
// WHAT IT PROVES. It mounts the REAL GrowthHub (src/solo/growth2.tsx) through the Marketing harness
// (scripts/live-drive/harness/marketing-mount) with only network reads stubbed; `?routes=campaign` gives the
// unrouted "Scorecard opt-in" form a campaign route (get_form_campaign_routes' shape). It renders the three
// places that say where that form's leads go — the Overview capture card, the form panel, the Analytics
// capture card — in both themes at the eight canonical Solo frames and a phone, and asserts for each: no page
// error, nothing spilling sideways, measured WCAG contrast of the stated destination, no gold, and the exact
// words. Frames land in artifacts/campaign-route.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions or the authenticated production surface (§32.c); the
// server rule is proven by supabase/tests/campaign_pipeline_routing.sql.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5227;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/campaign-route");
const REPO = path.resolve(import.meta.dirname, "../..");
// The content-column model the Solo shell hands Marketing (as marketing-views-drive.mjs and
// campaigns-nav-fit-drive.mjs, TenantCommandCenterShell.tsx:483): the eight canonical Solo frames with
// PAIGE docked open or closed, plus a phone.
function contentWidth(viewport, posture) {
  const overlay = viewport <= 1080;
  const rail = overlay ? 72 : 216;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  return Math.floor(viewport - rail - Math.max(440, viewport * 0.34));
}
const FRAMES = [
  ...[[1536, 770], [1366, 768], [1024, 768], [900, 1000]].flatMap(([width, height]) => ["closed", "open"].map((posture) => ({
    name: `${width}x${height}-paige-${posture}`, width, height, content: contentWidth(width, posture === "open" ? "docked" : "closed"),
  }))),
  { name: "phone-390", width: 390, height: 844, content: 390 },
];
const VIEWS = [
  { name: "overview-capture", tab: "overview", target: "#mov-capture", expect: ["Campaign: Advisory consults → Discovery call"], forbid: ["Not routed"] },
  { name: "form-panel", tab: "overview", open: true, target: '[role="dialog"]', expect: ["Campaign: Advisory consults → Discovery call. With no route of its own, this form files its leads in the pipeline of its campaign, Spring advisory intake."] },
  { name: "analytics-capture", tab: "analytics", target: ".mva-cap-row", row: "Scorecard opt-in", expect: ["Campaign: Advisory consults → Discovery call"], forbid: ["Not routed"] },
];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`);
}
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(PORT, "127.0.0.1");
  });
}
async function stopTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}
// node:http, NOT fetch: fetch honours HTTPS_PROXY and can return a relay page for a dead loopback port.
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probeOnce(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);
    browser = await chromium.launch(buildLaunchOptions());
    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const view of VIEWS) {
          const id = `${theme}/${frame.name}/${view.name}`;
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          await page.goto(`${BASE}?tab=${view.tab}&theme=${theme}&mode=populated&routes=campaign`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(view.tab === "analytics" ? ".mva-cap-row, [data-harness-error]" : "#mov-capture, [data-harness-error]", { timeout: 30000 });
          await page.addStyleTag({ content: `main.paige-solo{width:${Math.floor(frame.content)}px!important;max-width:${Math.floor(frame.content)}px!important}` });
          if (view.open) await page.locator("button.mov-cp", { hasText: "Scorecard opt-in" }).first().click();
          const target = view.row
            ? page.locator(view.target, { hasText: view.row }).first()
            : page.locator(view.target).first();
          await target.waitFor({ timeout: 8000 });
          await page.waitForTimeout(250);
          await target.scrollIntoViewIfNeeded();
          const text = ((await target.textContent()) ?? "").replace(/\s+/g, " ");
          const facts = await target.evaluate((sec) => {
            const scroller = sec.closest('[role="dialog"]') ?? document.querySelector("main.paige-solo") ?? document.body;
            const box = scroller.getBoundingClientRect();
            const ctx = document.createElement("canvas").getContext("2d");
            const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
            const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
            const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
            // The element that carries the destination words, wherever it sits.
            const carriers = [...sec.querySelectorAll("*")].filter((el) => el.children.length === 0 && /Campaign: /.test(el.textContent ?? ""));
            let worst = { ratio: 99, what: "" };
            for (const el of carriers) {
              const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(bgOf(el))].sort((x, y) => y - x);
              const ratio = (hi + 0.05) / (lo + 0.05);
              if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.className || el.tagName}:${el.textContent.trim().slice(0, 40)}` };
            }
            return {
              crashed: Boolean(document.querySelector("[data-harness-error]")),
              carriers: carriers.length,
              pushed: [...sec.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1; }).slice(0, 3).map((el) => String(el.className)),
              sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
              contrast: worst,
              gold: carriers.some((el) => /gold|champagne/i.test(getComputedStyle(el).color + String(el.className))),
            };
          });
          check(errors.length === 0 && !facts.crashed, `${id}: renders without error`, JSON.stringify({ errors }));
          check(!facts.sideways && facts.pushed.length === 0, `${id}: nothing spills sideways`, JSON.stringify(facts.pushed));
          check(facts.carriers > 0 && facts.contrast.ratio >= 4.5, `${id}: destination contrast ≥ 4.5:1 (worst ${facts.contrast.ratio})`, facts.contrast.what);
          check(!facts.gold, `${id}: no gold on a destination`);
          const missing = view.expect.filter((phrase) => !text.includes(phrase));
          check(missing.length === 0, `${id}: says where the leads go`, JSON.stringify({ missing, text: text.slice(0, 300) }));
          const leaked = (view.forbid ?? []).filter((phrase) => view.row ? text.includes(phrase) : text.includes(`Scorecard opt-in${phrase}`));
          check(leaked.length === 0, `${id}: does not call the form unrouted`, JSON.stringify(leaked));
          await target.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-${view.name}.png`) });
          await ctx.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await stopTree(vite);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Frames: ${OUT}`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
