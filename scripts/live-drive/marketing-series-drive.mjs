#!/usr/bin/env node
// Email series (E3), rendered for real at every Solo geometry.
//
// WHAT IT PROVES. It mounts the REAL GrowthHub (src/solo/growth2.tsx) through the marketing harness
// (scripts/live-drive/harness/marketing-mount, Supabase stubbed by name) and renders Marketing › Email's
// Automations panel (with series, and the first-use starters) and the series view in each state —
// draft, waiting for approval, running, paused, needs attention, stopped and a change being made — at the
// four Solo sizes, both themes, PAIGE docked and closed. For each frame it asserts: no page error, no
// harness crash, no horizontal overflow inside the scroll owner, nothing pushed past its right edge, no
// sideways document scroll, AA contrast on the series' small text, and gold only on the one approve act.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions, the database, or the authenticated production
// surface (§32.c). Those stay owed to a session that can drive the deployed app.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5226;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/marketing-series");
const REPO = path.resolve(import.meta.dirname, "../..");
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const POSTURES = ["docked", "closed"];
const VIEWS = [
  { key: "panel", query: "", mode: "populated" },
  { key: "panel-first", query: "", mode: "first" },
  { key: "draft", query: "&series=q-draft" },
  { key: "pending", query: "&series=q-pending" },
  { key: "running", query: "&series=q-running" },
  { key: "paused", query: "&series=q-paused" },
  { key: "blocked", query: "&series=q-blocked" },
  { key: "stopped", query: "&series=q-stopped" },
  { key: "change", query: "&series=q-change" },
];

function contentWidth(viewport, posture) {
  const overlay = viewport <= 1080;
  const rail = overlay ? 72 : 216;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  return Math.floor(viewport - rail - Math.max(440, viewport * 0.34));
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
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function open(page, view, theme) {
  await page.goto(`${BASE}?tab=email&theme=${theme}&mode=${view.mode ?? "populated"}${view.query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".campaigns-scroll, [data-harness-error]", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector(".ms-rows, .ms-starters, .ms-spine, [data-harness-error]"), null, { timeout: 15000 }).catch(() => {});
}
async function setContentWidth(page, width) {
  await page.addStyleTag({ content: `main.paige-solo{width:${width}px!important;max-width:${width}px!important}` });
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length === 0, null, { timeout: 5000 }).catch(() => {});
}
async function measure(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector(".campaigns-scroll");
    if (!scroll) return null;
    const box = scroll.getBoundingClientRect();
    const scrollers = [...scroll.querySelectorAll("*")].filter((el) => el !== scroll && ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
    const inScroller = (el) => scrollers.some((sc) => sc !== el && sc.contains(el));
    const pushed = [...scroll.querySelectorAll("*")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1 && !inScroller(el); })
      .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
    const ctx = document.createElement("canvas").getContext("2d");
    const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
    let worst = { ratio: 99, what: "" };
    for (const el of document.querySelectorAll(".ms-starters small, .ms-rows small, .ms-more, .ms-count, .ms-wait small, .ms-wait-chip, .ms-sum small, .ms-sum .is-none, .ms-cardstats, .ms-sub, .ms-funnel span, .ms-left small, .ms-switch small, .ms-always li, .ms-people small, .ms .me-hint, .ms .mo-note, .ms .mk-flag, .ms .me-kind, .ms .me-notice, .ms .me-facts dt, .ms .btn-g, .ms-waitnums")) {
      if (!el.getClientRects().length) continue;
      const fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${String(el.className) || el.tagName}:${el.textContent.trim().slice(0, 24)}` };
    }
    return {
      crashed: Boolean(document.querySelector("[data-harness-error]")),
      overflowX: scroll.scrollWidth - scroll.clientWidth, pushed,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      contrast: worst,
      gold: [...document.querySelectorAll(".campaigns-scroll .btn-g")].map((b) => b.textContent.trim()),
      drawn: { rows: document.querySelectorAll(".ms-rows li").length, starters: document.querySelectorAll(".ms-starters li").length, cards: document.querySelectorAll(".ms-spine > li").length,
        funnel: document.querySelectorAll(".ms-funnel li").length, review: Boolean(document.querySelector("#ms-review-h")), live: Boolean(document.querySelector("#ms-live-h")) },
    };
  });
}

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
    const warm = await browser.newPage(); await open(warm, VIEWS[0], "light"); await warm.close();
    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const posture of POSTURES) {
          const width = contentWidth(frame.width, posture);
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          for (const view of VIEWS) {
            const page = await ctx.newPage();
            const errors = [];
            page.on("pageerror", (e) => errors.push(String(e.message)));
            await open(page, view, theme);
            await setContentWidth(page, width);
            const id = `${theme}/${frame.name}/paige-${posture}@${width}px/${view.key}`;
            const m = await measure(page);
            check(Boolean(m) && !m.crashed, `${id}: renders`);
            if (m) {
              check(errors.length === 0, `${id}: no page errors`, errors[0] ?? "");
              check(m.overflowX <= 0, `${id}: no horizontal overflow in the scroll owner`, `overflow=${m.overflowX}px`);
              check(m.pushed.length === 0, `${id}: nothing pushed past the right edge`, m.pushed.join(","));
              check(!m.sideways, `${id}: document does not scroll sideways`);
              check(m.contrast.ratio >= 4.5, `${id}: series small text meets AA (4.5:1)`, `worst ${m.contrast.ratio} ${m.contrast.what}`);
              const goldOk = view.key === "pending" ? m.gold.length === 1 && m.gold[0] === "Approve and start" : m.gold.length === 0;
              check(goldOk, `${id}: gold only on the one approve act`, m.gold.join(" | "));
              const d = m.drawn;
              const want = { panel: d.rows === 3, "panel-first": d.starters === 3, draft: d.cards === 4 && !d.live, pending: d.review && d.cards === 3,
                running: d.live && d.funnel === 4 && d.cards === 3, paused: d.live, blocked: d.live, stopped: d.live, change: d.live && d.cards === 3 }[view.key];
              check(Boolean(want), `${id}: the state draws what it should`, JSON.stringify(d));
            }
            if (frame.name !== "1024x768" && (posture === "closed" || frame.name === "1366x768")) {
              await page.screenshot({ path: path.join(OUT, `${view.key}-${theme}-${frame.name}-${posture}.png`), fullPage: false });
              if (posture === "closed" && frame.name === "1536x770" && view.key !== "panel" && view.key !== "panel-first") {
                await page.evaluate(() => { const s = document.querySelector(".campaigns-scroll"); if (s) s.scrollTop = s.scrollHeight / 2.2; });
                await page.screenshot({ path: path.join(OUT, `${view.key}-${theme}-${frame.name}-${posture}-lower.png`) });
              }
            }
            await page.close();
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await stopTree(vite);
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
