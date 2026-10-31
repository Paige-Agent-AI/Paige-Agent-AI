#!/usr/bin/env node
// exp03-no-email-allowance-drive.mjs [outdir] — renders the REAL Marketing › Email screens through the existing marketing harness
// (scripts/live-drive/harness/marketing-mount, Supabase stubbed) in light and dark at 1366x768, PAIGE closed,
// reduced motion, and asserts per frame: renders, no page error, no daily-limit wording anywhere on the page,
// and the 24-hour count line where the dashboard shows it. Harness render only: not the authenticated app.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";
const REPO = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "artifacts/exp03-no-email-allowance"));
const PORT = 5241, BASE = `http://127.0.0.1:${PORT}/`;
const NO_LIMIT = /a day|-a-day|daily|limit|left in the last 24|send tomorrow|used up/i;
const VIEWS = [
  { key: "dashboard", query: "", scroll: "bottom" },
  { key: "editor-draft", query: "&campaign=c-draft", scroll: "reach" },
  { key: "series-pending", query: "&series=q-pending", scroll: "top" },
  { key: "series-running", query: "&series=q-running", scroll: "top" },
  { key: "series-draft", query: "&series=q-draft", scroll: "sender" },
];
const probe = () => new Promise((r) => { const q = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (s) => { s.resume(); r(s.statusCode === 200); }); q.on("error", () => r(false)); q.on("timeout", () => { q.destroy(); r(false); }); });
fs.mkdirSync(OUT, { recursive: true });
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
const results = [];
let browser;
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { ready = await probe(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
  if (!ready) throw new Error("harness did not start");
  const { chromium } = await resolvePlaywright();
  browser = await chromium.launch(buildLaunchOptions());
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    for (const view of VIEWS) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await page.goto(`${BASE}?tab=email&theme=${theme}&mode=populated${view.query}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".campaigns-scroll, [data-harness-error]", { timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.evaluate((how) => {
        const s = document.querySelector(".campaigns-scroll"); if (!s) return;
        if (how === "bottom") s.scrollTop = s.scrollHeight;
        if (how === "reach") document.querySelector(".me-reach")?.scrollIntoView({ block: "center" });
        if (how === "sender") [...document.querySelectorAll("small")].find((x) => /PAIGE’s sender/.test(x.textContent ?? ""))?.scrollIntoView({ block: "center" });
      }, view.scroll);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({
        crashed: Boolean(document.querySelector("[data-harness-error]")),
        text: document.querySelector("main")?.textContent ?? "",
        gold: [...document.querySelectorAll(".campaigns-scroll .btn-g")].map((b) => b.textContent.trim()),
      }));
      const id = `${theme}/${view.key}`;
      const limit = m.text.match(NO_LIMIT)?.[0] ?? null;
      results.push({ id, renders: !m.crashed, pageErrors: errors, limitWording: limit, gold: m.gold,
        countLine: view.key === "dashboard" ? /\d[\d,]* marketing emails? sent or sending in the last 24 hours\./.test(m.text) : null,
        senderLine: /PAIGE’s sender · opens and clicks reported/.test(m.text) });
      await page.screenshot({ path: path.join(OUT, `exp03-no-allowance-${view.key}-${theme}-1366x768.png`) });
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
fs.writeFileSync(path.join(OUT, "exp03-no-allowance-frames.json"), JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.renders || r.pageErrors.length || r.limitWording || r.countLine === false);
for (const r of results) console.log(`${bad.includes(r) ? "FAIL" : "ok  "} ${r.id} limit=${r.limitWording} gold=${JSON.stringify(r.gold)} count=${r.countLine} sender=${r.senderLine} errors=${r.pageErrors.length}`);
process.exit(bad.length ? 1 : 0);
