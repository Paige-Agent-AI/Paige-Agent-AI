#!/usr/bin/env node
// Solo Marketing › Overview interactions, driven with a real mouse and keyboard.
//
// WHAT IT PROVES. On the REAL GrowthHub (scripts/live-drive/harness/marketing-mount, only network reads
// stubbed), in both themes: the dashboard plays its entrance on arrival and skips it under reduced
// motion; hovering a bar or a donut slice shows its values; hovering a slice lights its legend row and
// hovering a legend row lights the slice; dragging the range handle zooms the time chart; Tab plus the
// arrow keys steps day by day with a readout and Enter opens the day's leads; clicking a slice opens
// its tab; "Ask PAIGE" sends a question built from the page's own figures.
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
// A point on the ring, 20° clockwise from 12 o'clock: inside the first slice whenever it spans more
// than 20°. A ring's bounding-box centre is its hole, so the mouse must aim at the ring itself.
async function ringPoint(locator) {
  const box = await locator.locator("svg.recharts-surface").boundingBox();
  const radius = (Math.min(box.width, box.height) / 2) * 0.85;
  const angle = (20 * Math.PI) / 180;
  return { x: box.x + box.width / 2 + radius * Math.sin(angle), y: box.y + box.height / 2 - radius * Math.cos(angle) };
}
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
      // Entrance: the cards are animating on arrival.
      await page.waitForSelector(".mo-stat");
      const entering = await page.evaluate(() => document.querySelector(".mo-stat").getAnimations().length);
      check(entering > 0, `${theme}: the dashboard plays its entrance on arrival`);
      await page.waitForFunction(() => document.querySelectorAll(".mo-donut .recharts-pie-sector").length > 0 && document.querySelector(".mo-chart-time .recharts-bar-rectangle"), null, { timeout: 15000 });
      await page.waitForTimeout(1600); // let the chart entrance finish so hover lands on settled marks

      // Mouse: hover a bar.
      const bar = page.locator(".mo-chart-time .recharts-bar-rectangle").nth(20);
      await bar.hover();
      await page.waitForTimeout(150);
      const barTip = await page.locator(".mo-chart-time .mo-tip").textContent().catch(() => "");
      check(/Leads\s*\d+/.test(barTip ?? "") && /Became opportunities/.test(barTip ?? ""), `${theme}: hovering a bar shows that day's leads and opportunities`, barTip ?? "none");

      // Mouse: hover a source slice → tooltip and the matching legend row light up.
      const sourceDonut = page.locator(".mo-donut").first();
      const onSource = await ringPoint(sourceDonut);
      await page.mouse.move(onSource.x, onSource.y, { steps: 4 });
      await page.waitForTimeout(150);
      const sliceTip = await sourceDonut.locator(".mo-tip").textContent().catch(() => "");
      const lit = await page.locator(".mo-keys").first().locator("button.is-active").count();
      check(Boolean(sliceTip) && lit === 1, `${theme}: hovering a slice shows its value and lights its legend row`, `tip=${sliceTip} lit=${lit}`);

      // Mouse: hover a legend row → the ring's centre names that slice.
      await page.mouse.move(5, 5);
      const row = page.locator(".mo-keys").first().locator("button").nth(1);
      const rowLabel = (await row.locator("span").textContent())?.trim();
      await row.hover();
      await page.waitForTimeout(100);
      const centre = await sourceDonut.locator(".mo-donut-center").textContent();
      check(Boolean(rowLabel) && centre?.includes(rowLabel), `${theme}: hovering a legend row puts that source in the ring's centre`, `row=${rowLabel} centre=${centre}`);

      // Drag: pull the range handle's left traveller to the right.
      const barsBefore = await page.locator(".mo-chart-time .recharts-bar-rectangle").count();
      const traveller = page.locator(".mo-chart-time .recharts-brush-traveller").first();
      const box = await traveller.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 260, box.y + box.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);
      }
      const readout = await page.locator("#mo-time-readout").textContent();
      const barsAfter = await page.locator(".mo-chart-time .recharts-bar-rectangle").count();
      check(Boolean(box) && /^Showing /.test(readout ?? "") && barsAfter < barsBefore, `${theme}: dragging the range handle zooms the chart`, `readout=${readout} bars ${barsBefore}→${barsAfter}`);

      // Keys: Tab into the chart, step with the arrows, Enter opens the day's leads.
      await page.locator(".mo-chart-time").focus();
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowLeft");
      const stepped = await page.locator("#mo-time-readout").textContent();
      check(/: \d+ leads?, \d+ became/.test(stepped ?? ""), `${theme}: the arrow keys step day by day with a readout`, stepped ?? "none");
      // While zoomed, exactly one visible bar is lit: the day the readout names.
      const litBars = await page.evaluate(() => [...document.querySelectorAll(".mo-chart-time .recharts-bar-rectangle path")].filter((path) => (path.getAttribute("fill-opacity") ?? "1") === "1").length);
      check(litBars === 1, `${theme}: while zoomed, the keyboard lights exactly the day it names`, `lit=${litBars}`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      check(await page.locator('[data-campaigns-view="capture"]').count() === 1, `${theme}: Enter on a day opens Lead capture`);

      // Back to Overview: clicking a status slice opens Campaigns; Ask PAIGE sends a grounded question.
      await page.goto(`${BASE}?tab=overview&theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll(".mo-donut .recharts-pie-sector").length > 1, null, { timeout: 15000 });
      await page.waitForTimeout(1600);
      await page.locator(".mo-ask").first().click();
      const asks = await page.evaluate(() => window.__asks);
      // The harness has no Solo shell or chat, so this proves the question is built and sent; that the
      // shell puts it in PAIGE's composer is proven in PaigeAIChat.composerScope.test.tsx.
      check(asks.length === 1 && /leads/.test(asks[0]) && /Do not invent/.test(asks[0]), `${theme}: Ask PAIGE sends a question built from the page's own figures`, asks[0] ?? "none");
      const onStatus = await ringPoint(page.locator(".mo-donut").nth(1));
      await page.mouse.click(onStatus.x, onStatus.y);
      await page.waitForTimeout(200);
      check(await page.locator('[data-campaigns-view="campaigns"]').count() === 1, `${theme}: clicking a campaign-status slice opens Campaigns`);
      // Mouse: clicking a bar opens Lead capture.
      await page.goto(`${BASE}?tab=overview&theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector(".mo-chart-time .recharts-bar-rectangle"), null, { timeout: 15000 });
      await page.waitForTimeout(1600);
      await page.locator(".mo-chart-time .recharts-bar-rectangle path").nth(25).click({ force: true });
      await page.waitForTimeout(200);
      check(await page.locator('[data-campaigns-view="capture"]').count() === 1, `${theme}: clicking a bar opens Lead capture`);
      check(errors.length === 0, `${theme}: no page errors`, errors[0] ?? "");
      await ctx.close();
    }

    // Reduced motion: no entrance.
    const calm = await browser.newContext({ viewport: { width: 1320, height: 1000 }, reducedMotion: "reduce" });
    const quiet = await calm.newPage();
    await quiet.goto(`${BASE}?tab=overview`, { waitUntil: "domcontentloaded" });
    await quiet.waitForSelector(".mo-stat");
    check(await quiet.evaluate(() => document.querySelector(".mo-stat").getAnimations().length) === 0, "reduced motion: no entrance animation");
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
