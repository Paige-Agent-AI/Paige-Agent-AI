// Experience 04 E4-S3 — render the Trust Compass notices (compass-mount) in both themes and MEASURE
// them (pass --before to label frames of the pre-change file): each notice's left border width (the 3px coloured side stripe is gone; every edge is the
// card's own hairline), its text contrast, the icon colour that still carries the tone, the
// "Person" label on a recorded person's row, horizontal overflow and page errors.
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the deployed, signed-in Trust Compass is owed.
//
//   node scripts/live-drive/harness/compass-mount/notices-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const prefix = argv.includes("--before") ? "compass-before-notices" : "compass-notices";
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "scripts/live-drive/artifacts/exp04-e4s3-compass");
fs.mkdirSync(out, { recursive: true });
const PORT = 5219;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const shots = [];
for (const variant of ["limits", "readonly"]) for (const theme of ["light", "dark"]) {
  shots.push({ name: `${prefix}-${variant}-${theme}`, variant, theme, w: 1366, h: 900 });
}
shots.push({ name: `${prefix}-limits-light-phone`, variant: "limits", theme: "light", w: 390, h: 844 });
shots.push({ name: `${prefix}-limits-dark-phone`, variant: "limits", theme: "dark", w: 390, h: 844 });

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
let failed = false;
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}?${new URLSearchParams({ variant: s.variant, theme: s.theme })}`);
    await page.waitForSelector(".paige-solo .card", { timeout: 30_000 });
    await page.waitForTimeout(700);
    const measured = await page.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255, 255, 255)"; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const notices = Array.from(document.querySelectorAll('.paige-solo .pg-body > .card[role="note"], .paige-solo .pg-body > .card[role="status"]'))
        .filter((n) => n.querySelector("svg")).map((n) => {
          const cs = getComputedStyle(n); const text = n.querySelector("span.sub"); const icon = n.querySelector("svg");
          return {
            role: n.getAttribute("role"), text: text?.textContent?.slice(0, 60) ?? "",
            borderLeft: cs.borderLeftWidth, borderTop: cs.borderTopWidth, borderLeftColor: cs.borderLeftColor, borderTopColor: cs.borderTopColor,
            textContrast: text ? Number(ratio(getComputedStyle(text).color, bgOf(text)).toFixed(2)) : null,
            iconColor: icon ? getComputedStyle(icon).color : null,
          };
        });
      const person = Array.from(document.querySelectorAll(".paige-solo span.sub")).some((n) => / · Person · performed and logged$/.test(n.textContent ?? ""));
      return { notices, person, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    const stripes = measured.notices.filter((n) => n.borderLeft !== n.borderTop || n.borderLeftColor !== n.borderTopColor);
    const lowContrast = measured.notices.filter((n) => n.textContrast !== null && n.textContrast < 4.5);
    const expected = s.variant === "limits" ? 3 : 2;
    // Notice text contrast is RECORDED, not gated here: the stripe removal did not touch the text colour
    // (the .sub ink on the card surface), so it measures the same before and after this change.
    const before = prefix.startsWith("compass-before");
    const ok = errors.length === 0 && !measured.overflowX && (before || stripes.length === 0) && measured.notices.length === expected && (before || measured.person);
    if (!ok) failed = true;
    results[s.name] = { ...measured, stripes: stripes.length, lowContrast: lowContrast.length, errors, ok };
    await page.screenshot({ path: path.join(out, `${s.name}.png`), fullPage: false });
    await ctx.close();
    console.log(s.name, ok ? "OK" : "FAIL", JSON.stringify({ notices: measured.notices.map((n) => [n.role, n.borderLeft, n.textContrast, n.iconColor]), person: measured.person, overflowX: measured.overflowX, errors: errors.length }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, `${prefix}-measurements.json`), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
