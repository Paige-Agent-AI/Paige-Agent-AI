#!/usr/bin/env node
// Ads as its own Solo department (owner ruling 2026-10-10, INT-342 / ANT-15), rendered for real.
//
// WHAT IT PROVES. It mounts the REAL tenant shell (TenantCommandCenterShell, for an authenticated Solo
// account) around the REAL Ads route (src/solo/AdsWorkspace.tsx) and the REAL Marketing redirect, with
// only the network reads stubbed (scripts/live-drive/harness/ads-department-mount). At the four Solo sizes,
// both themes, navigation open and folded, it asserts:
//   - the rail reads Command Center · Operations · Clients · Marketing · Ads · Sales · Finance ·
//     Marketplace · Settings, with Ads lit;
//   - the command row names Ads;
//   - nothing overflows sideways.
// It also walks the flows:
//   - Marketing → Ads by the rail;
//   - every view by click and by address;
//   - an old /growth/ads?view= bookmark;
//   - the links out;
//   - the keyboard path to the rail item with a visible focus ring.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions, PAIGE's column, or the authenticated production
// surface (§32.c). Those stay owed to a session that can drive the deployed app.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5225;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/ads-department");
const REPO = path.resolve(import.meta.dirname, "../..");
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const RAIL = ["Command Center", "Operations", "Clients", "Marketing", "Ads", "Sales", "Finance", "Marketplace", "Settings"];
const VIEWS = [["Overview", "/solo/review/ads/overview"], ["Campaigns", "/solo/review/ads/campaigns"], ["Creative", "/solo/review/ads/creative"], ["Audiences", "/solo/review/ads/audiences"], ["Performance", "/solo/review/ads/performance"]];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  if (!ok) console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
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

async function open(page, { path: address = "/solo/review/ads", theme = "light", mode = "populated", folded = false }) {
  await page.addInitScript((fold) => { try { localStorage.setItem("paige.tenantShell.navExpanded", fold ? "false" : "true"); } catch { /* none */ } }, folded);
  await page.goto(`${BASE}?path=${encodeURIComponent(address)}&theme=${theme}&mode=${mode}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-tenant-destination], [data-harness-error]", { timeout: 30000 });
  await page.waitForTimeout(250);
}
const state = (page) => page.evaluate(() => ({
  crashed: Boolean(document.querySelector("[data-harness-error]")),
  path: document.body.dataset.harnessPath,
  rail: [...document.querySelectorAll("[data-tenant-destination]")].map((a) => a.textContent?.trim()),
  nav: document.querySelector("[data-nav]")?.getAttribute("data-nav") ?? null,
  adsTitle: document.querySelector('[data-tenant-destination="ads"]')?.getAttribute("title") ?? null,
  lit: document.querySelector('[data-tenant-destination][aria-current="page"]')?.textContent?.trim() ?? null,
  context: document.querySelector(".tcs-context strong")?.textContent?.trim() ?? null,
  pressed: document.querySelector('.mad [aria-pressed="true"]')?.textContent ?? null,
  strip: [...document.querySelectorAll(".campaigns-tabs [role=tab]")].map((t) => t.textContent?.trim()),
  sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollOverflow: (() => { const s = document.querySelector(".campaigns-scroll"); return s ? s.scrollWidth - s.clientWidth : null; })(),
  shellDark: document.querySelector(".tcs-nav-action")?.getAttribute("aria-label") === "Use Mineral theme",
  adsIcon: Boolean(document.querySelector('[data-tenant-destination="ads"] svg')),
  sameIcon: (() => { const a = document.querySelector('[data-tenant-destination="ads"] svg'); const m = document.querySelector('[data-tenant-destination="campaigns"] svg'); return Boolean(a && m && a.innerHTML === m.innerHTML); })(),
}));

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/ads-department-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probeOnce(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);
    browser = await chromium.launch(buildLaunchOptions());
    const warm = await browser.newPage(); await open(warm, {}); await warm.close();

    // Frames: four sizes × two themes × navigation open and folded, on the Ads Overview.
    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const folded of [false, true]) {
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          await open(page, { theme, folded });
          const id = `${theme}/${frame.name}/nav-${folded ? "folded" : "open"}`;
          const s = await state(page);
          check(!s.crashed && errors.length === 0, `${id}: renders without error`, errors[0] ?? "");
          check(s.nav === (folded ? "compact" : "expanded") && (folded ? s.adsTitle === "Ads" : s.adsTitle === null), `${id}: the rail is ${folded ? "folded, and the Ads icon carries its name" : "open"}`, JSON.stringify({ nav: s.nav, title: s.adsTitle }));
          check(s.rail.join("|") === RAIL.join("|"), `${id}: the rail puts Ads directly below Marketing`, s.rail.join("|"));
          check(s.lit === "Ads" && s.context === "Ads", `${id}: Ads is lit and named in the command row`, JSON.stringify({ lit: s.lit, context: s.context }));
          check(s.shellDark === (theme === "dark"), `${id}: the shell and the desk share the ${theme} theme`);
          check(s.adsIcon && !s.sameIcon, `${id}: Ads carries its own icon, distinct from Marketing's`);
          check(s.pressed === "Overview" && s.strip.length === 0, `${id}: the desk opens on Overview with no Marketing strip`, JSON.stringify({ pressed: s.pressed, strip: s.strip }));
          check(!s.sideways && (s.scrollOverflow ?? 0) <= 0, `${id}: nothing overflows sideways`, JSON.stringify({ sideways: s.sideways, overflow: s.scrollOverflow }));
          await page.screenshot({ path: path.join(OUT, `frame-${frame.name}-${folded ? "folded" : "open"}-${theme}.png`) });
          await ctx.close();
        }
      }
    }

    // Flows at the ordinary 1366 session, both themes.
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));

      // Marketing → Ads by the rail: Marketing has no Ads tab; the rail item opens the department.
      await open(page, { path: "/solo/review/growth/overview", theme });
      let s = await state(page);
      check(s.lit === "Marketing" && !s.strip.includes("Ads") && s.strip.length === 7, `${theme}/flow: Marketing is lit with seven tabs and no Ads tab`, JSON.stringify({ lit: s.lit, strip: s.strip }));
      await page.click('[data-tenant-destination="ads"]');
      await page.waitForSelector(".mad", { timeout: 15000 });
      s = await state(page);
      check(s.path === "/solo/review/ads" && s.lit === "Ads", `${theme}/flow: the rail's Ads opens the department`, JSON.stringify({ path: s.path, lit: s.lit }));

      // Every view by click: each is its own address and stays inside Ads.
      for (const [label, address] of VIEWS) {
        await page.locator(".mad .campaigns-segmented button", { hasText: label }).click();
        await page.waitForTimeout(120);
        s = await state(page);
        check(s.path === address && s.pressed === label && s.lit === "Ads", `${theme}/flow: ${label} opens at ${address}`, JSON.stringify({ path: s.path, pressed: s.pressed }));
        await page.screenshot({ path: path.join(OUT, `view-${label.toLowerCase()}-${theme}.png`) });
      }
      const creative = await page.evaluate(() => document.querySelectorAll(".mad-card").length);
      await page.locator(".mad .campaigns-segmented button", { hasText: "Creative" }).click();
      await page.waitForTimeout(120);
      check((await page.evaluate(() => document.querySelectorAll(".mad-card").length)) === 3, `${theme}/flow: Creative previews the three saved ads`, String(creative));

      // An old Marketing Ads bookmark opens the same view in Ads, lit as Ads.
      await open(page, { path: "/solo/review/growth/ads?view=creative&utm_source=mail", theme });
      await page.waitForSelector(".mad", { timeout: 15000 });
      s = await state(page);
      check(s.path === "/solo/review/ads/creative?utm_source=mail" && s.pressed === "Creative" && s.lit === "Ads" && s.strip.length === 0, `${theme}/flow: /growth/ads?view=creative opens Ads › Creative with its other query kept`, JSON.stringify(s));
      await page.screenshot({ path: path.join(OUT, `flow-legacy-bookmark-${theme}.png`) });

      // Links out land in the department that owns each piece.
      await open(page, { path: "/solo/review/ads/campaigns", theme });
      await page.getByRole("button", { name: "Open your campaign briefs" }).click();
      await page.waitForTimeout(200);
      s = await state(page);
      check(s.path === "/solo/review/growth/campaigns" && s.lit === "Marketing", `${theme}/flow: Open your campaign briefs goes to Marketing › Campaigns`, JSON.stringify({ path: s.path, lit: s.lit }));
      await open(page, { path: "/solo/review/ads", theme });
      await page.getByRole("button", { name: "Open Integrations" }).click();
      await page.waitForTimeout(150);
      s = await state(page);
      check(s.path === "/solo/review/settings/integrations" && s.lit === "Settings", `${theme}/flow: Open Integrations goes to Settings › Integrations`, JSON.stringify({ path: s.path, lit: s.lit }));
      check(errors.length === 0, `${theme}/flows: no page errors`, errors[0] ?? "");
      await ctx.close();
    }

    // Keyboard: the rail's Ads link is reachable by Tab, shows a focus indicator, and Enter opens it.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      await open(page, { path: "/solo/review/growth/overview" });
      let found = false;
      for (let i = 0; i < 40 && !found; i++) {
        await page.keyboard.press("Tab");
        found = await page.evaluate(() => document.activeElement?.getAttribute("data-tenant-destination") === "ads");
      }
      check(found, "keyboard: the rail's Ads item is reachable by Tab");
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none"; });
      check(ring, "keyboard: the focused Ads item shows a focus indicator");
      await page.screenshot({ path: path.join(OUT, "keyboard-ads-focus.png") });
      await page.keyboard.press("Enter");
      await page.waitForSelector(".mad", { timeout: 15000 }).catch(() => {});
      check((await state(page)).path === "/solo/review/ads", "keyboard: Enter on Ads opens the department");
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopTree(vite);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1; else console.log(`frames written to ${OUT}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
