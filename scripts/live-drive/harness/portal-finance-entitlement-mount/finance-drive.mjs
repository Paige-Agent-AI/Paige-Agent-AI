// E09 F2 — frames the customer Home and bell for a business that is not finance-entitled and one that is, and
// MEASURES what each shows and reads. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE: class-3 evidence (structural /
// rendered), never authenticated runtime proof (§70.1).
//   node scripts/live-drive/harness/portal-finance-entitlement-mount/finance-drive.mjs --out <dir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-finance-entitlement");
fs.mkdirSync(out, { recursive: true });
const PORT = 5251;
const FINANCE_READS = ["credit_report_uploads", "funding_journey_applications", "credit_alerts", "credit_factor_scores"];
const FINANCE_HREFS = ["/app/credit", "/app/funding", "/app/funding-journey", "/app/financial-profile", "/app/business"];
const FINANCE_WORDS = /\bcredit\b|\bfunding\b|reports on file|payment history|utilization|credit age|credit mix|inquiries/i;

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: process.env,
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 90_000);
  });
}

const shots = [];
for (const business of ["fresh", "funding-off", "funding-on"]) {
  for (const theme of ["light", "dark"]) {
    for (const [kind, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) shots.push({ business, theme, kind, w, h });
  }
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const vite = await startVite();
const results = [];
let failed = false;
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", locale: "en-US",
      ...(s.kind === "phone" ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      errors.push(`blocked ${route.request().url().slice(0, 100)}`);
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${PORT}/app?${new URLSearchParams({ business: s.business, theme: s.theme })}`, { timeout: 180_000 });
    await page.getByRole("heading", { name: "Welcome Back" }).waitFor({ timeout: 60_000 });
    await page.getByText("Getting Started").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.evaluate(async () => { await document.fonts.ready; });
    const name = `f2-home-${s.business}-${s.theme}-${s.kind}-${s.w}`;
    const m = await page.evaluate(({ hrefs, words }) => {
      const pageRegion = document.querySelector('[data-harness-region="page"]');
      const text = pageRegion?.innerText ?? "";
      return {
        reads: window.__harnessReads,
        financeLinks: hrefs.filter((h) => document.querySelector(`a[href="${h}"]`)),
        pageWords: (text.match(new RegExp(words.source, "gi")) ?? []).map((x) => x.toLowerCase()),
        checklistDocs: [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Upload Your First Document")),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5,
        tag: !!document.querySelector("[data-harness-tag]"),
      };
    }, { hrefs: FINANCE_HREFS, words: FINANCE_WORDS });
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
    // The page panel scrolls inside the shell; frame the whole Home too.
    const pane = page.locator('[data-harness-region="page"]');
    const tall = await pane.evaluate((el) => { el.style.height = `${el.scrollHeight}px`; el.style.overflow = "visible"; return el.scrollHeight; });
    await page.setViewportSize({ width: s.w, height: Math.max(s.h, tall + 120) });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, `${name}-full.png`), fullPage: true });
    await page.setViewportSize({ width: s.w, height: s.h });
    await pane.evaluate((el) => { el.style.height = ""; el.style.overflow = ""; });
    // The bell, opened.
    const bell = page.getByRole("button", { name: /^Notifications/ }).first();
    let bellText = "";
    if (await bell.count()) {
      await bell.click();
      await page.getByText("Notifications", { exact: true }).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(250);
      bellText = await page.locator('[role="menu"]').first().innerText().catch(() => "");
      // The open menu must fit the viewport (it is fixed-positioned, so the page's own overflow cannot show it).
      const box = await page.locator('[role="menu"]').first().boundingBox();
      if (!box || box.x < 0 || box.x + box.width > s.w + 0.5) errors.push(`bell menu leaves the viewport ${JSON.stringify(box)}`);
      await page.screenshot({ path: path.join(out, `f2-bell-${s.business}-${s.theme}-${s.kind}-${s.w}.png`) });
      await page.keyboard.press("Escape");
    }
    const entitled = s.business === "funding-on";
    const financeRead = FINANCE_READS.filter((t) => m.reads.includes(t));
    const unmet = [];
    if (entitled) {
      if (financeRead.length !== FINANCE_READS.length) unmet.push(`entitled business did not read ${FINANCE_READS.filter((t) => !financeRead.includes(t))}`);
      if (!m.pageWords.includes("reports on file")) unmet.push("entitled: no Credit tile");
      if (!/Credit Alerts/i.test(bellText)) unmet.push("entitled: bell has no credit alerts");
    } else {
      if (financeRead.length) unmet.push(`not entitled but read ${financeRead}`);
      if (m.financeLinks.length) unmet.push(`not entitled but links ${m.financeLinks}`);
      if (m.pageWords.length) unmet.push(`not entitled but the Home says ${[...new Set(m.pageWords)]}`);
      if (/credit/i.test(bellText)) unmet.push("not entitled but the bell mentions credit");
    }
    if (!m.checklistDocs) unmet.push("Getting Started has no document step");
    if (m.overflowX) unmet.push("horizontal overflow");
    if (!m.tag) unmet.push("no harness label");
    if (errors.length) unmet.push(...errors);
    if (!bellText) unmet.push("bell not found/opened");
    results.push({ name, unmet, financeRead, financeLinks: m.financeLinks, pageWords: [...new Set(m.pageWords)], bell: bellText.replace(/\s+/g, " ").slice(0, 120) });
    console.log(`${unmet.length ? "FAIL" : "ok  "} ${name}${unmet.length ? `  ${unmet.join("; ")}` : ""}`);
    if (unmet.length) failed = true;
    await ctx.close();
  }
} finally {
  try { process.kill(-vite.pid); } catch { /* already gone */ }
  await browser.close();
}
fs.writeFileSync(path.join(out, "f2-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
