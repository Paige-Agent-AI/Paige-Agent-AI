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
// The Overview showroom and the pipeline lead funnel (owner rulings 2026-10-11), with the harness's
// fixture pictures, pipelines and server answers (harness/ads-department-mount/ads-fixtures.ts):
//   - every frame: the placements show the business's own pictures in rank order (featured, then most
//     won deals and leads, then newest) and the funnel draws the default pipeline from the server read;
//   - a showroom frame and a funnel frame at each size, both themes;
//   - a member sees samples only, with no upload or feature control;
//   - featuring a picture in Creative moves it to the first placement;
//   - uploading a picture files it into the library and it appears in the showroom;
//   - choosing another pipeline redraws the funnel; with the server read missing, the records fallback
//     draws and says so;
//   - Marketing › Analytics draws the same funnel.
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

async function open(page, { path: address = "/solo/review/ads", theme = "light", mode = "populated", folded = false, funnel = "" }) {
  await page.addInitScript((fold) => { try { localStorage.setItem("paige.tenantShell.navExpanded", fold ? "false" : "true"); } catch { /* none */ } }, folded);
  await page.goto(`${BASE}?path=${encodeURIComponent(address)}&theme=${theme}&mode=${mode}${funnel ? `&funnel=${funnel}` : ""}`, { waitUntil: "domcontentloaded" });
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
  pressed: document.querySelector('.campaigns-tabs[aria-label="Ads views"] [aria-selected="true"]')?.textContent ?? null,
  strip: [...document.querySelectorAll(".campaigns-tabs [role=tab]")].map((t) => t.textContent?.trim()),
  // The strip's geometry, compared against Marketing's: same height, same place, same type.
  navBox: (() => { const n = document.querySelector(".campaigns-nav"); const t = document.querySelector(".campaigns-tabs [role=tab]"); if (!n || !t) return null; const r = n.getBoundingClientRect(); const cs = getComputedStyle(t); return { top: Math.round(r.top), h: Math.round(r.height), font: cs.fontSize, weight: cs.fontWeight, icons: document.querySelectorAll(".campaigns-tabs [role=tab] svg").length }; })(),
  sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollOverflow: (() => { const s = document.querySelector(".campaigns-scroll"); return s ? s.scrollWidth - s.clientWidth : null; })(),
  shellDark: document.querySelector(".tcs-nav-action")?.getAttribute("aria-label") === "Use Mineral theme",
  adsIcon: Boolean(document.querySelector('[data-tenant-destination="ads"] svg')),
  sameIcon: (() => { const a = document.querySelector('[data-tenant-destination="ads"] svg'); const m = document.querySelector('[data-tenant-destination="campaigns"] svg'); return Boolean(a && m && a.innerHTML === m.innerHTML); })(),
}));

// The showroom and the funnel, as drawn.
const showroom = (page) => page.evaluate(() => ({
  frames: Object.fromEntries([...document.querySelectorAll(".asr-frame")].map((f) => [f.className.match(/asr-(feed|story|search|display)/)?.[1], { chip: f.querySelector(".asr-sample")?.textContent ?? null, label: f.getAttribute("aria-label"), visible: getComputedStyle(f).display !== "none", img: f.querySelector("img.asr-media")?.getAttribute("src") ?? null, loaded: (() => { const i = f.querySelector("img.asr-media"); return i ? i.complete && i.naturalWidth > 0 : null; })() }])),
  lede: document.querySelector(".asr-intro p")?.textContent ?? null,
  upload: Boolean(document.querySelector("[data-ads-upload]")),
  notice: document.querySelector(".asr-intro .mad-notice")?.textContent ?? null,
  funnel: document.querySelector(".plf")?.getAttribute("data-funnel-source") ?? null,
  pipeline: document.querySelector(".plf-picker strong")?.textContent ?? null,
  stages: [...document.querySelectorAll(".plf-stage")].map((li) => [li.querySelector(".plf-stage-t")?.firstChild?.textContent, li.querySelector(".plf-stage-n")?.textContent]),
  note: document.querySelector(".plf-note")?.textContent ?? null,
  adRows: [...document.querySelectorAll(".plf-table.is-ad tbody tr")].map((tr) => tr.querySelector("th")?.firstChild?.textContent),
}));
const waitFunnel = (page) => page.waitForSelector(".plf[data-funnel-source], .plf .plf-empty", { timeout: 15000 }).then(() => page.waitForTimeout(400));

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
          check(s.pressed === "Overview" && s.strip.join("|") === "Overview|Campaigns|Creative|Audiences|Performance", `${id}: the desk opens on Overview under the Ads department strip`, JSON.stringify({ pressed: s.pressed, strip: s.strip }));
          check(!s.sideways && (s.scrollOverflow ?? 0) <= 0, `${id}: nothing overflows sideways`, JSON.stringify({ sideways: s.sideways, overflow: s.scrollOverflow }));
          // The showroom shows the business's own pictures in rank order, and the funnel the default pipeline.
          await waitFunnel(page);
          const room = await showroom(page);
          check(room.frames.feed?.chip === "Featured" && room.frames.feed?.loaded === true && room.frames.story?.chip === "3 won · 11 leads" && room.frames.story?.loaded === true && room.frames.search?.label === "Search ad with your copy", `${id}: the placements show the business's own pictures, featured first, then by won deals and leads, and the saved ad copy`, JSON.stringify(room.frames));
          check(room.frames.display?.visible ? room.frames.display.chip === "1 won · 4 leads" && room.frames.display.loaded === true : true, `${id}: the display banner, where it shows, carries the third-ranked picture`, JSON.stringify(room.frames.display));
          check(room.funnel === "server" && room.pipeline === "Client intake" && room.stages.length === 5 && room.upload, `${id}: the funnel draws the default pipeline from the server read, and the owner can add a picture`, JSON.stringify({ funnel: room.funnel, pipeline: room.pipeline, stages: room.stages.length, upload: room.upload }));
          await page.screenshot({ path: path.join(OUT, `frame-${frame.name}-${folded ? "folded" : "open"}-${theme}.png`) });
          if (!folded) {
            await page.locator(".plf").scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            await page.screenshot({ path: path.join(OUT, `funnel-${frame.name}-${theme}.png`) });
          }
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
      const marketingNav = s.navBox;
      await page.click('[data-tenant-destination="ads"]');
      await page.waitForSelector(".mad", { timeout: 15000 });
      s = await state(page);
      check(s.path === "/solo/review/ads" && s.lit === "Ads", `${theme}/flow: the rail's Ads opens the department`, JSON.stringify({ path: s.path, lit: s.lit }));
      // Same standard as the other departments: the Ads strip sits where Marketing's does, at its height,
      // in its type, with an icon on every tab.
      check(Boolean(marketingNav && s.navBox) && s.navBox.top === marketingNav.top && s.navBox.h === marketingNav.h && s.navBox.font === marketingNav.font && s.navBox.weight === marketingNav.weight && s.navBox.icons === 5, `${theme}/flow: the Ads strip matches Marketing's strip (place, height, type, icons)`, JSON.stringify({ ads: s.navBox, marketing: marketingNav }));

      // Every view by click: each is its own address and stays inside Ads.
      for (const [label, address] of VIEWS) {
        await page.locator('.campaigns-tabs[aria-label="Ads views"] [role=tab]', { hasText: label }).click();
        await page.waitForTimeout(120);
        s = await state(page);
        check(s.path === address && s.pressed === label && s.lit === "Ads", `${theme}/flow: ${label} opens at ${address}`, JSON.stringify({ path: s.path, pressed: s.pressed }));
        await page.screenshot({ path: path.join(OUT, `view-${label.toLowerCase()}-${theme}.png`) });
      }
      const creative = await page.evaluate(() => document.querySelectorAll(".mad-card").length);
      await page.locator('.campaigns-tabs[aria-label="Ads views"] [role=tab]', { hasText: "Creative" }).click();
      await page.waitForTimeout(120);
      check((await page.evaluate(() => document.querySelectorAll(".mad-card").length)) === 3, `${theme}/flow: Creative previews the three saved ads`, String(creative));

      // An old Marketing Ads bookmark opens the same view in Ads, lit as Ads.
      await open(page, { path: "/solo/review/growth/ads?view=creative&utm_source=mail", theme });
      await page.waitForSelector(".mad", { timeout: 15000 });
      s = await state(page);
      check(s.path === "/solo/review/ads/creative?utm_source=mail" && s.pressed === "Creative" && s.lit === "Ads" && s.strip.join("|") === "Overview|Campaigns|Creative|Audiences|Performance", `${theme}/flow: /growth/ads?view=creative opens Ads › Creative with its tracking tag kept`, JSON.stringify(s));
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

    // Showroom and funnel flows at 1366, both themes.
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));

      // A member: samples in every placement, no upload or feature control, the funnel still readable.
      await open(page, { theme, mode: "readonly" });
      await waitFunnel(page);
      let room = await showroom(page);
      check(Object.values(room.frames).every((f) => f.chip === "Sample") && !room.upload && /owners and admins/.test(room.lede ?? ""), `${theme}/member: every placement is a sample and there is no upload`, JSON.stringify({ frames: room.frames, upload: room.upload }));
      await page.screenshot({ path: path.join(OUT, `showroom-member-${theme}.png`) });

      // Featuring a picture in Creative puts it in the first placement.
      await open(page, { path: "/solo/review/ads/creative", theme });
      await page.waitForSelector(".mad-mcard", { timeout: 15000 });
      const toggle = page.locator(".mad-mcard", { hasText: "Scorecard banner" }).locator("button[aria-pressed]");
      await toggle.click();
      await page.waitForTimeout(250);
      check((await toggle.getAttribute("aria-pressed")) === "true", `${theme}/creative: Feature in showroom switches on`);
      await page.screenshot({ path: path.join(OUT, `creative-featured-${theme}.png`) });
      await page.locator('.campaigns-tabs[aria-label="Ads views"] [role=tab]', { hasText: "Overview" }).click();
      await waitFunnel(page);
      room = await showroom(page);
      check(room.frames.feed?.label === "Feed post with your picture “Scorecard banner”" && room.frames.feed?.chip === "Featured" && room.frames.story?.chip === "Featured", `${theme}/flow: the newly featured picture takes the first placement`, JSON.stringify(room.frames));

      // Uploading a picture files it into the library and it appears in the showroom.
      await open(page, { theme });
      await waitFunnel(page);
      await page.setInputFiles("[data-ads-upload]", { name: "Summer intensive.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
      await page.waitForFunction(() => /is in your library/.test(document.querySelector(".asr-intro .mad-notice")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      room = await showroom(page);
      check(/“Summer intensive” is in your library\. Nothing was published\./.test(room.notice ?? "") && /Summer intensive/.test(room.frames.feed?.label ?? "") && room.frames.feed?.chip === "Just added", `${theme}/flow: an uploaded picture is filed and stands in the first placement`, JSON.stringify({ notice: room.notice, frames: room.frames }));
      await page.screenshot({ path: path.join(OUT, `showroom-uploaded-${theme}.png`) });

      // Choosing another pipeline redraws the funnel.
      await page.locator(".plf-picker-btn").click();
      await page.getByRole("option", { name: /Retainers/ }).click();
      await page.waitForTimeout(400);
      room = await showroom(page);
      check(room.pipeline === "Retainers" && room.stages.length === 2, `${theme}/flow: choosing Retainers redraws the funnel`, JSON.stringify({ pipeline: room.pipeline, stages: room.stages }));

      // With the server read not deployed, the records fallback draws and says so.
      await open(page, { theme, funnel: "missing" });
      await waitFunnel(page);
      room = await showroom(page);
      check(room.funnel === "records" && /isn’t available yet/.test(room.note ?? "") && room.stages.length === 5, `${theme}/flow: without the server read, the funnel counts the records it can read and says so`, JSON.stringify({ funnel: room.funnel, note: room.note, stages: room.stages }));
      await page.locator(".plf").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `funnel-fallback-${theme}.png`) });

      // Marketing › Analytics draws the same funnel over the same pipelines.
      await open(page, { path: "/solo/review/growth/analytics", theme });
      await waitFunnel(page);
      room = await showroom(page);
      check(room.funnel === "server" && room.pipeline === "Client intake" && room.stages.length === 5, `${theme}/flow: Marketing › Analytics draws the same pipeline funnel`, JSON.stringify({ funnel: room.funnel, pipeline: room.pipeline }));
      await page.locator(".plf").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `marketing-funnel-${theme}.png`) });
      check(errors.length === 0, `${theme}/showroom flows: no page errors`, errors[0] ?? "");
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
