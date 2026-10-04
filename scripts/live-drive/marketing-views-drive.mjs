#!/usr/bin/env node
// Solo Marketing department views, rendered for real at every Solo geometry.
//
// WHAT IT PROVES. It mounts the REAL GrowthHub (src/solo/growth2.tsx) with only the Campaigns read,
// the owner-briefs read and the offers read stubbed (scripts/live-drive/harness/marketing-mount), and
// renders Overview, Campaigns, Lead capture and Analytics at the four Solo sizes, in both themes,
// with PAIGE docked, expanded and closed, at the content-column widths the shell actually hands this
// surface. For each frame it asserts: no page error, no harness crash, no horizontal overflow inside
// the scroll owner (.campaigns-scroll), no element pushed past its right edge, and no sideways
// document scroll. It also renders first-use, loading, error and read-only states.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions, or the authenticated production surface
// (§32.c). Those stay owed to a session that can drive the deployed app.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5224;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/marketing-views");
const REPO = path.resolve(import.meta.dirname, "../..");
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const POSTURES = ["docked", "wide", "closed"];
const TABS = ["overview", "campaigns", "lead-capture", "analytics"];

// Same model as campaigns-nav-fit-drive.mjs (TenantCommandCenterShell.tsx:483, verified there).
function contentWidth(viewport, posture) {
  const overlay = viewport <= 1080;
  const rail = overlay ? 72 : 216;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  const paige = posture === "wide" ? Math.max(620, viewport * 0.52) : Math.max(440, viewport * 0.34);
  return Math.floor(viewport - rail - paige);
}

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

async function open(page, { tab, theme = "light", mode = "populated" }) {
  await page.goto(`${BASE}?tab=${tab}&theme=${theme}&mode=${mode}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".campaigns-scroll, [data-harness-error]", { timeout: 30000 });
}
async function setContentWidth(page, width) {
  await page.addStyleTag({ content: `main.paige-solo{width:${width}px!important;max-width:${width}px!important}` });
  await page.waitForTimeout(150);
  // A width change crosses container queries, and .btn animates every property for 150ms. Measure
  // once those transitions have settled, not mid-collapse (the Overview lazily loads its charts in
  // the same window, so a fixed delay is not enough there).
  await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length === 0, null, { timeout: 5000 }).catch(() => {});
}
async function measure(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector(".campaigns-scroll");
    if (!scroll) return null;
    const box = scroll.getBoundingClientRect();
    // A child of a DECLARED horizontal scroller (overflow-x auto/scroll, e.g. the approved desk's
    // growth-loop track) is reachable by design, so it is not "pushed"; those scrollers are listed
    // separately so the exception is visible in the evidence, never silent.
    const scrollers = [...scroll.querySelectorAll("*")].filter((el) => el !== scroll && ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
    const inScroller = (el) => scrollers.some((sc) => sc !== el && sc.contains(el));
    const pushed = [...scroll.querySelectorAll("*")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1 && !inScroller(el); })
      .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    return {
      crashed: Boolean(document.querySelector("[data-harness-error]")),
      overflowX: scroll.scrollWidth - scroll.clientWidth,
      pushed,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      innerScrollers: scrollers.map((el) => String(el.className).split(" ")[0]),
      // WCAG contrast of the new small text against what is actually painted behind it.
      contrast: (() => {
        const ctx = document.createElement("canvas").getContext("2d");
        const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
        const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
        const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
        let worst = { ratio: 99, what: "" };
        for (const el of document.querySelectorAll(".mk-flag, .mk-row-main small, .mk-stat dt, .mk-stat span, .mk-view .mk-link, .mk-view .btn-g, .mo-stat h3, .mo-delta, .mo .mo-link, .mo-keys span, .mo-keys em, .mo-note, .mo-panel-head p, .mo-head p, .mo-task-main small, .mo-rank-name, .mo-next p, .mo-donut-center span, .mo-ask, .mo-readout")) {
          const fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
          const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (hi + 0.05) / (lo + 0.05);
          if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.className || el.tagName}:${el.textContent.trim().slice(0, 24)}` };
        }
        return worst;
      })(),
      // The Vibe Studio launcher must contain its own label (a collapsed launcher shows only the icon).
      launcherSpills: (() => { const b = document.querySelector(".campaigns-studio"); return b ? b.scrollWidth > b.clientWidth + 1 : false; })(),
      heading: document.querySelector(".campaigns-scroll h2, .campaigns-scroll .mk-command p, .campaigns-scroll .mo-head h2")?.textContent?.trim().slice(0, 60) ?? "",
    };
  });
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  const geometry = [];
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probeOnce(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);
    browser = await chromium.launch(buildLaunchOptions());
    const warm = await browser.newPage(); await open(warm, { tab: "overview" }); await warm.close();

    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const posture of POSTURES) {
          const width = contentWidth(frame.width, posture);
          // Reduced motion so the Overview charts paint their final state, not a frame of their entrance.
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          for (const tab of TABS) {
            const page = await ctx.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(String(e.message)));
            await open(page, { tab, theme });
            await setContentWidth(page, width);
            // The Overview's charts load lazily: wait until both donuts and the time chart have drawn.
            if (tab === "overview") await page.waitForFunction(() => document.querySelectorAll(".mo-donut .recharts-pie-sector").length > 0 && document.querySelector(".mo-chart-time .recharts-bar-rectangle"), null, { timeout: 15000 }).catch(() => {});
            const id = `${theme}/${frame.name}/paige-${posture}@${width}px/${tab}`;
            const m = await measure(page);
            check(Boolean(m) && !m.crashed, `${id}: renders`);
            if (m) {
              check(errors.length === 0, `${id}: no page errors`, errors[0] ?? "");
              check(m.overflowX <= 0, `${id}: no horizontal overflow in the scroll owner`, `overflow=${m.overflowX}px`);
              check(m.pushed.length === 0, `${id}: nothing pushed past the right edge`, m.pushed.join(","));
              check(!m.sideways, `${id}: document does not scroll sideways`);
              check(!m.launcherSpills, `${id}: the Vibe Studio launcher contains its label`);
              if (tab === "overview") {
                const drawn = await page.evaluate(() => ({ donuts: [...document.querySelectorAll(".mo-donut")].filter((d) => d.querySelector(".recharts-pie-sector")).length, bars: document.querySelectorAll(".mo-chart-time .recharts-bar-rectangle").length, line: Boolean(document.querySelector(".mo-chart-time .recharts-line-curve")) }));
                check(drawn.donuts === 2 && drawn.bars > 0 && drawn.line, `${id}: both donuts, the bars and the opportunities line are drawn`, JSON.stringify(drawn));
              }
              check(m.contrast.ratio >= 4.5, `${id}: new small text meets AA (4.5:1)`, `worst ${m.contrast.ratio} ${m.contrast.what}`);
              geometry.push({ id, width, overflowX: m.overflowX, innerScrollers: m.innerScrollers, worstContrast: m.contrast });
            }
            if (posture !== "wide" && frame.name !== "1024x768") {
              await page.screenshot({ path: path.join(OUT, `${tab}-${theme}-${frame.name}-${posture}.png`) });
            }
            await page.close();
          }
          await ctx.close();
        }
      }
    }

    // States, at the ordinary 1366 docked session, both themes.
    for (const theme of ["light", "dark"]) {
      for (const mode of ["first", "loading", "error", "readonly"]) {
        for (const tab of ["overview", "lead-capture", "analytics"]) {
          const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          await open(page, { tab, theme, mode });
          await setContentWidth(page, contentWidth(1366, "docked"));
          const id = `${theme}/state-${mode}/${tab}`;
          const m = await measure(page);
          check(Boolean(m) && !m.crashed && errors.length === 0, `${id}: renders without error`, errors[0] ?? "");
          if (m) check(m.overflowX <= 0 && !m.sideways, `${id}: no overflow`);
          const text = await page.evaluate(() => document.querySelector(".campaigns-scroll")?.textContent ?? "");
          if (mode === "error") check(/could not load/.test(text), `${id}: a failed read says so`);
          if (mode === "loading") check(await page.$(".campaigns-skeleton") !== null, `${id}: loading shows a skeleton`);
          if (mode === "readonly" && tab === "overview") check(!/Create campaign brief/.test(text), `${id}: no create act for a read-only member`);
          if (mode === "first" && tab === "overview") {
            check(/Nothing is being marketed yet/.test(text), `${id}: first use is guided`);
            check((await page.$$(".btn-g")).length === 1, `${id}: exactly one gold act`);
          }
          await page.screenshot({ path: path.join(OUT, `state-${mode}-${tab}-${theme}.png`) });
          await ctx.close();
        }
      }
    }

    // Keyboard: the Overview's act is reachable by Tab and shows a visible focus indicator.
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      await open(page, { tab: "overview" });
      let found = false;
      for (let i = 0; i < 40 && !found; i++) {
        await page.keyboard.press("Tab");
        found = await page.evaluate(() => document.activeElement?.textContent?.includes("Create campaign brief") ?? false);
      }
      check(found, "keyboard: Create campaign brief is reachable by Tab");
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
      check(ring, "keyboard: focused act shows a focus indicator");
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopTree(vite);
  }
  fs.writeFileSync(path.join(OUT, "geometry.json"), JSON.stringify(geometry, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1; else console.log(`frames written to ${OUT}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
