// Experience 04 E4-S3 — render the read links beside a client-standing answer in the Solo chat harness
// (solo.html), in both themes, at a desktop frame and a phone frame, and for a sub-account and a
// no-match read. Records MEASUREMENTS beside the pictures: each link's text and href, its computed
// colour (never gold), the lead line's contrast against the page, link target heights, and horizontal
// overflow. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the deployed, signed-in drive is owed.
//
//   node scripts/live-drive/harness/paige-chat-mount/record-links-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "scripts/live-drive/artifacts/exp04-e4s3-record-links");
fs.mkdirSync(out, { recursive: true });
const PORT = 5213;
const BASE = `http://127.0.0.1:${PORT}/solo.html`;
const shots = [];
// The Solo frame matrix: "PAIGE closed" is the full-width PAIGE workspace (page), "PAIGE open" the docked panel (drawer).
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const layout of ["page", "drawer"]) for (const theme of ["light", "dark"]) {
  shots.push({ name: `matrix-standing-${layout}-${theme}-${w}x${h}`, scenario: "standing", layout, theme, w, h });
}
for (const theme of ["light", "dark"]) {
  shots.push({ name: `standing-solo-desktop-${theme}`, scenario: "standing", theme, w: 1366, h: 900 });
  shots.push({ name: `standing-solo-phone-${theme}`, scenario: "standing", theme, w: 390, h: 844 });
  shots.push({ name: `standing-subaccount-desktop-${theme}`, scenario: "standing", tier: "sub", theme, w: 1366, h: 900 });
  shots.push({ name: `standing-nomatch-desktop-${theme}`, scenario: "standing-nomatch", theme, w: 1366, h: 900 });
}

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "solo.vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const q = new URLSearchParams({ scenario: s.scenario, theme: s.theme, layout: s.layout ?? "page", ...(s.tier ? { tier: s.tier } : {}) });
    await page.goto(`${BASE}?${q}`);
    await page.waitForSelector("textarea", { timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.locator("textarea").fill(s.scenario === "standing-nomatch" ? "Where does Northwind stand?" : "Where does The Kestrel Group stand?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4200);
    const nav = page.locator("[data-paige-record-links]");
    if (await nav.count()) await nav.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await page.waitForTimeout(200);
    const measured = await page.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255, 255, 255)"; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const nav = document.querySelector("[data-paige-record-links]");
      const lead = nav?.querySelector("span");
      const links = Array.from(nav?.querySelectorAll("a") ?? []).map((a) => {
        const r = a.getBoundingClientRect(); const c = getComputedStyle(a).color;
        return { text: a.textContent, href: a.getAttribute("href"), color: c, height: Math.round(r.height), contrast: Number(ratio(c, bgOf(a)).toFixed(2)) };
      });
      const steps = Array.from(document.querySelectorAll("[data-paige-turn-line]")).map((n) => n.textContent);
      return {
        nav: !!nav, role: nav?.getAttribute("role") ?? null,
        name: nav?.getAttribute("aria-labelledby") ? document.getElementById(nav.getAttribute("aria-labelledby"))?.textContent ?? null : null,
        lead: lead ? { text: lead.textContent, contrast: Number(ratio(getComputedStyle(lead).color, bgOf(lead)).toFixed(2)) } : null,
        links, steps,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    const gold = measured.links.filter((l) => /rgb\((2[0-9]{2}), (1[5-9][0-9]|2[0-2][0-9]), ([0-9]{1,2}|1[0-2][0-9])\)/.test(l.color));
    results[s.name] = { ...measured, goldLinks: gold.length, errors };
    await page.screenshot({ path: path.join(out, `${s.name}.png`) });
    await ctx.close();
    console.log(s.name, JSON.stringify({ nav: measured.nav, role: measured.role, name: measured.name, links: measured.links.map((l) => [l.text, l.href, l.height, l.contrast]), lead: measured.lead, overflowX: measured.overflowX, gold: gold.length, errors: errors.length }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
