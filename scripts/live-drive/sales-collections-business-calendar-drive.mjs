// Experience 04 E4-S3 PR beta (Track C1) — Collections "Overdue" on the business calendar, rendered through
// the real Sales workspace (harness/sales-collections, synthetic RPC doubles) for every business-calendar
// state, both themes, desktop and phone. MEASURES: the Overdue / Upcoming tiles (a held judgement is never
// a digit), the hold notice and its one action, the late-row marker, AA contrast of every new word, gold
// spent (none: this is navigation), horizontal overflow and page errors.
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo Collections board is owed.
//
//   node scripts/live-drive/sales-collections-business-calendar-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "scripts/live-drive/artifacts/exp04-e4s3-collections");
fs.mkdirSync(out, { recursive: true });
const PORT = 5293;
const shots = [];
for (const zone of ["configured", "missing", "admin", "invalid", "error"]) for (const theme of ["light", "dark"]) shots.push({ zone, theme, w: 1440, h: 900 });
for (const theme of ["light", "dark"]) shots.push({ zone: "configured", theme, w: 390, h: 1400, phone: true }, { zone: "missing", theme, w: 390, h: 1400, phone: true });
// The Solo frame matrix (ui-delivery evidence): four viewports × PAIGE closed / open × both themes, on hold.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ zone: "missing", theme, w, h, paige, matrix: true });

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(repo, "scripts/live-drive/harness/sales-collections/vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 90_000);
  });
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = s.matrix ? `beta-collections-matrix-${s.paige}-${s.theme}-${s.w}x${s.h}` : `beta-collections-${s.zone}-${s.theme}${s.phone ? "-phone" : ""}`;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/test-account/sales/payments?${new URLSearchParams({ view: "collections", zone: s.zone, theme: s.theme, paige: s.paige ?? "closed" })}`);
    await page.locator(".sc-facts article").first().waitFor({ timeout: 45_000 });
    await page.waitForFunction(() => ![...document.querySelectorAll(".sc-facts strong")].some((n) => n.textContent === "Checking…"), null, { timeout: 15_000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      // color-mix() computes to `color(srgb r g b [/ a])` with 0–1 channels; rgb() has 0–255 ones.
      const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
      const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255,255,255)"; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
      const tile = (label) => [...document.querySelectorAll(".sc-facts article")].find((a) => a.querySelector("small")?.textContent === label);
      const words = [...document.querySelectorAll(".sc-fact-note, .sc-calendar-notice p, .sc-calendar-notice button, .sc-overdue, .sc-coverage, .sc-facts strong")];
      const contrast = words.map((n) => ({ text: n.textContent.slice(0, 40), ratio: ratio(getComputedStyle(n).color, bgOf(n)) }));
      const button = document.querySelector(".sc-calendar-notice button");
      return {
        overdue: tile("Overdue")?.querySelector("strong")?.textContent ?? null,
        upcoming: tile("Upcoming")?.querySelector("strong")?.textContent ?? null,
        note: tile("Overdue")?.querySelector(".sc-fact-note")?.textContent ?? null,
        // The frozen hold note is said ONCE across the tiles (decision 7): never repeated on Upcoming.
        notes: [...document.querySelectorAll(".sc-facts .sc-fact-note")].map((n) => n.textContent),
        notice: document.querySelector("[data-business-calendar-notice] p")?.textContent ?? null,
        action: button?.textContent ?? null,
        actionBg: button ? getComputedStyle(button).backgroundColor : null,
        marker: document.querySelector(".sc-overdue")?.textContent ?? null,
        coverage: document.querySelector(".sc-coverage")?.textContent ?? null,
        aside: [...document.querySelectorAll(".sc-aside h3")].map((h) => h.textContent),
        pastDueWord: document.body.innerText.includes("Past due"),
        low: contrast.filter((c) => c.ratio < 4.5), contrastMin: Math.min(...contrast.map((c) => c.ratio)),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || (document.querySelector(".sc-workspace")?.scrollWidth ?? 0) > (document.querySelector(".sc-workspace")?.clientWidth ?? 0) + 1,
      };
    });
    const held = s.zone !== "configured";
    const expect = held
      ? m.overdue === "On hold" && m.upcoming === "On hold" && !!m.notice && m.marker === null && m.aside.includes("Open obligations by due date") && m.notes.length === 1
      : /^\d+$/.test(m.overdue ?? "") && /^\d+$/.test(m.upcoming ?? "") && m.notice === null && m.marker === "Overdue · 2026-10-10" && /Due dates follow your business calendar · Central Time \(Chicago\) · today [A-Z][a-z]{2} \d{1,2}, \d{4}\./.test(m.coverage ?? "") && !/America\/Chicago/.test(m.coverage ?? "");
    const action = s.zone === "missing" ? m.action === "Set your business time zone" : s.zone === "admin" ? m.action === "Open business time zone setting" : s.zone === "error" ? m.action === "Retry" : true;
    const ok = errors.length === 0 && expect && action && !m.pastDueWord && m.low.length === 0 && !m.overflowX;
    if (!ok) failed = true;
    results[name] = { ...m, errors, ok };
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: !!s.phone });
    // One frame that brings the register's late row into view (the tiles crop it out of the top frame).
    if (s.zone === "configured" && !s.phone && !s.matrix) {
      const row = page.locator(".sc-register-row", { has: page.locator(".sc-overdue") }).first();
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector(".sc-overdue")?.closest(".sc-register-row")?.scrollIntoView({ block: "center" }));
      const late = await row.evaluate((el) => { const o = el.querySelector(".sc-overdue"); const r = el.getBoundingClientRect(); const cs = getComputedStyle(o); return { text: o.textContent, color: cs.color, font: `${cs.fontSize}/${cs.fontWeight}`, inView: r.top >= 0 && r.bottom <= innerHeight }; });
      if (!late.inView || late.text !== "Overdue · 2026-10-10") { failed = true; results[name].ok = false; }
      results[`${name}-overdue-row`] = late;
      await page.screenshot({ path: path.join(out, `${name}-overdue-row.png`) });
      console.log(`${name}-overdue-row`, late.inView ? "OK" : "FAIL", JSON.stringify(late));
    }
    await ctx.close();
    console.log(name, ok ? "OK" : "FAIL", JSON.stringify({ overdue: m.overdue, upcoming: m.upcoming, note: m.note, action: m.action, marker: m.marker, contrastMin: m.contrastMin, low: m.low.slice(0, 2), overflowX: m.overflowX, errors: errors.slice(0, 2) }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "beta-collections-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
