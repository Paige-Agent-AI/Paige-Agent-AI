// EXP07 row 9 — channel readiness, driven on the marketing-mount harness: the Social tab renders
// each channel's connection state from the SAME governed presence read that reports the handles —
// connected (label + verified-at + the consent-not-publish sentence), needs_reauth, and the honest
// on-record-not-connected absence. Reach stays ABSENT in every state (a connection grants no
// figure). The panel foot adapts its truth when a connection exists, and an unreadable read
// (?social=0) claims nothing. Four Solo viewports × PAIGE closed/open. Harness — NOT live.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(root, "docs/evidence/ui-delivery/assets/exp07-readiness");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.EXP07_READINESS_PORT || 5229);
const BASE = `http://127.0.0.1:${PORT}/`;

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore", detached: true });
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

let browser;
const frames = [];
const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name, detail }); if (!ok) console.log(`FAIL  ${name}  ${detail}`); };

const label = async (page) => {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
};
const shoot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function openTab(page, { paige = "closed", theme = "light", social = "" } = {}) {
  await page.goto(`${BASE}?tab=social&theme=${theme}&paige=${paige}${social ? `&social=${social}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector(".social-page", { timeout: 60_000 });
  // The unreadable mode (?social=0) honestly renders no channels panel at all — only the not-read
  // state — so the readiness selectors are awaited only when rows are served.
  if (!social) await page.waitForSelector(".social-channel-readiness, .social-panel-foot", { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function main() {
  for (let i = 0; i < 40 && !(await probeOnce()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await probeOnce())) throw new Error("harness did not come up");
  browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ── The 8 Solo frames: the Social tab with live readiness states ──
  for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    for (const paige of ["closed", "open"]) {
      const name = `solo-${w}x${h}-paige-${paige}`;
      await page.setViewportSize({ width: w, height: h });
      await openTab(page, { paige });
      const body = await page.locator(".social-page").innerText();
      check(body.includes("consent to read the account, not to publish"), `${name} the connected sentence states what a connection grants and does not`);
      check(body.includes("sign in again"), `${name} needs_reauth speaks its state`);
      check(body.includes("On record, not connected"), `${name} the no-connection absence is said, not hidden`);
      check(body.includes("Northfield Coaching (main)"), `${name} the connected identity's label renders`);
      check(/Last verified/.test(body), `${name} the verified-at date renders`);
      // Reach stays absent in EVERY state — the contract the truth layer pins.
      const figures = await page.locator(".social-channel-metric .social-figure").allInnerTexts();
      check(figures.every((f) => !/\d/.test(f)), `${name} no channel shows an audience figure (a connection grants none)`);
      const ox = await overflow(page);
      check(ox <= 0, `${name} no horizontal overflow`, `overflowX=${ox}`);
      await label(page);
      await shoot(page, name);
      frames.push({ frame: name, overflowX: ox });
    }
  }

  // ── The foot adapts its truth when a connection exists (still claims no posting) ──
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTab(page);
  const foots = await page.locator(".social-panel-foot").allInnerTexts();
  const channelsFoot = foots.find((f) => f.includes("consent to read the account"));
  check(Boolean(channelsFoot && channelsFoot.includes("posting stays off")), "the panel foot's truth adapts to a connection (and still says posting is off)", JSON.stringify(foots).slice(0, 160));

  // ── The unreadable read claims nothing ──
  await openTab(page, { social: "0" });
  const unread = await page.locator("body").innerText();
  check(unread.includes("has not been read") && unread.includes("nothing on this page claims anything"), "an unread presence read claims nothing about accounts or connections", "");
  await label(page);
  await shoot(page, "unread-1366x768");

  // ── A dark-theme frame ──
  await openTab(page, { theme: "dark" });
  await label(page);
  await shoot(page, "solo-1366x768-paige-closed-dark");

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ frames, results, pageErrors: errors }, null, 2));
  console.log(`${results.length - failed}/${results.length} checks passed${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}; ${frames.length} frames captured to ${OUT}`);
  process.exit(failed || errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* ignore */ }
  try { process.platform === "win32" && spawn("taskkill", ["/F", "/T", "/PID", String(vite.pid)], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
});
