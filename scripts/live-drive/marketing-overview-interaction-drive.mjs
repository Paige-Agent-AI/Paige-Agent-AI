#!/usr/bin/env node
// Solo Marketing › Overview interactions, driven with a real mouse and keyboard.
//
// WHAT IT PROVES. On the REAL GrowthHub (scripts/live-drive/harness/marketing-mount, only network reads
// stubbed), in both themes, for the INT-342 Overview (owner-approved 2026-10-10): the chain draws its
// links on arrival and skips that under reduced motion; hovering the lead-flow chart shows that day's
// count; Tab plus the arrow keys step day by day with a tooltip and a spoken readout; the broken link's
// "Route it" opens that form's panel; a capture-point card opens its panel; the capture filter narrows
// the gallery; "Ask PAIGE" sends a question built from the page's own figures.
//
// WHAT IT DOES NOT PROVE. Real data or the authenticated production surface (§32.c).
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5224;
const BASE = `http://127.0.0.1:${PORT}/`;
const REPO = path.resolve(import.meta.dirname, "../..");
const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const probe = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

const portFree = () => new Promise((resolve) => { const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true))).listen(PORT, "127.0.0.1"); });

async function main() {
  if (!(await portFree())) throw new Error(`Port ${PORT} is already in use.`);
  const server = spawn("npx", ["vite", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts"], { cwd: REPO, detached: true, stdio: "ignore" });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probe(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error("Harness server did not start.");
    const { chromium } = await resolvePlaywright();
    browser = await chromium.launch(buildLaunchOptions());

    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1320, height: 1300 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await page.addInitScript(() => { window.__asks = []; window.addEventListener("paige:open", (event) => window.__asks.push(event.detail?.prompt ?? "")); });
      await page.goto(`${BASE}?tab=overview&theme=${theme}`, { waitUntil: "domcontentloaded" });
      // Entrance: the chain's links draw on arrival — the one authored motion.
      await page.waitForSelector(".mov-ln");
      const entering = await page.evaluate(() => document.querySelector(".mov-ln").getAnimations().length);
      check(entering > 0, `${theme}: the chain draws its links on arrival`);
      await page.waitForTimeout(1600);

      // Mouse: hover the lead-flow chart.
      const svg = page.locator(".mov-chart svg");
      const box = await svg.boundingBox();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 });
      await page.waitForTimeout(120);
      const tip = await page.locator(".mov-tip").textContent().catch(() => "");
      check(/ · \d+ leads?$/.test(tip ?? ""), `${theme}: hovering the chart shows that day's leads`, tip ?? "none");
      check(await page.locator(".mov-xh").count() === 1, `${theme}: hovering draws the crosshair`);
      await page.mouse.move(2, 2);

      // Keys: Tab to the chart, step with the arrows; the readout is announced.
      await svg.focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      const spoken = await page.locator(".mov-chart [aria-live]").textContent();
      check(/: \d+ leads?$/.test(spoken ?? ""), `${theme}: the arrow keys step day by day with a spoken readout`, spoken ?? "none");
      const ring = await svg.evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
      check(ring, `${theme}: the focused chart shows a focus indicator`);

      // Ask PAIGE sends a question built from the page's own figures.
      await page.getByRole("button", { name: "Ask PAIGE" }).click();
      const asks = await page.evaluate(() => window.__asks);
      // The harness has no Solo shell or chat, so this proves the question is built and sent; that the
      // shell puts it in PAIGE's composer is proven in PaigeAIChat.composerScope.test.tsx.
      check(asks.length === 1 && /leads/.test(asks[0]) && /does not record visits, spend, reach or revenue/.test(asks[0]), `${theme}: Ask PAIGE sends a question built from the page's own figures`, asks[0] ?? "none");

      // The broken link: Route it opens the unrouted form's panel.
      await page.getByRole("button", { name: "Route it" }).first().click();
      await page.waitForSelector(".campaigns-drawer", { timeout: 5000 }).catch(() => {});
      const panel = await page.textContent(".campaigns-drawer").catch(() => "");
      check(/Scorecard opt-in/.test(panel ?? "") && /Not routed/.test(panel ?? ""), `${theme}: Route it opens the unrouted form's panel`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);

      // Filter: Pages narrows the gallery to pages; a page card opens its own details.
      await page.locator('#mov-capture [aria-pressed]', { hasText: "Pages" }).click();
      const kinds = await page.evaluate(() => [...document.querySelectorAll("#mov-capture .mov-cp-s")].map((el) => el.textContent));
      check(kinds.length > 0 && kinds.every((k) => /^Page · /.test(k ?? "")), `${theme}: the Pages filter shows only pages`, kinds.join(","));
      await page.locator("button.mov-cp").first().click();
      const details = await page.textContent(".campaigns-drawer").catch(() => "");
      check(/Through the form on this page/.test(details ?? ""), `${theme}: a page card opens its details`);
      await page.keyboard.press("Escape");
      check(errors.length === 0, `${theme}: no page errors`, errors[0] ?? "");
      await ctx.close();
    }

    // Reduced motion: no entrance.
    const calm = await browser.newContext({ viewport: { width: 1320, height: 1000 }, reducedMotion: "reduce" });
    const quiet = await calm.newPage();
    await quiet.goto(`${BASE}?tab=overview`, { waitUntil: "domcontentloaded" });
    await quiet.waitForSelector(".mov-ln");
    check(await quiet.evaluate(() => [...document.querySelectorAll(".mov-ln, .mov-line")].every((el) => el.getAnimations().length === 0)), "reduced motion: no entrance animation");
    await calm.close();
  } finally {
    await browser?.close();
    try { process.kill(-server.pid, "SIGKILL"); } catch { /* gone */ }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
