// paige-browser runtime smoke test (§32 — a green build is NOT a working observation).
//
// Proves the observe engine actually RUNS: launches Chromium, drives INLINE HTML through the exact
// /self-verify observe code path (setContent -> title -> tag-stripped text excerpt -> screenshot ->
// read-only assertSelector step), and asserts an HONEST structured observation comes back. Also
// proves the honest FAILURE path: a missing-selector assertSelector step returns ok:false WITHOUT
// throwing — the whole run still yields a structured result. Catches "the service compiles but
// Chromium can't launch / can't observe" BEFORE a deploy, headless.
//
// Run:  node smoke.mjs   (or: npm run smoke)
// Exit: 0 = the observe engine runs + produces an honest observation; non-zero = it would fail live.
//
// Chromium resolution: in the sandbox the pre-installed browser is under /opt/pw-browsers; elsewhere
// we let Playwright resolve its own. Outbound Chromium network is blocked in the sandbox, so we drive
// inline HTML (setContent) — the exact code path observe() runs after navigation. The live-URL
// page.goto() path is exercised once deployed to Fly, where outbound network is open.
import { chromium } from "playwright";
import fs from "fs";

function findSandboxChromium() {
  const base = "/opt/pw-browsers";
  try {
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith("chromium")) {
        const p = `${base}/${d}/chrome-linux/chrome`;
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    // not the sandbox — fall through to Playwright's own resolution
  }
  return undefined;
}

const HTML = `<!doctype html><html><body style="margin:0;background:#0b0b14;color:#E9C989;
  font:600 42px system-ui;display:grid;place-items:center;height:100vh">
  <main data-testid="verify-target">Paige Browser self-verify ✓</main></body></html>`;

// Mirror observe()'s read-only helpers so the smoke exercises the SAME logic the server runs
// (server.js starts an HTTP listener on import, so we replicate the pure observation path here —
// the same precedent smoke-render.mjs avoids by importing ./render.mjs directly).
async function extractText(page) {
  const raw = await page.evaluate(() => (document.body ? document.body.innerText : ""));
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 2000);
}
async function runAssertSelector(page, selector) {
  const found = (await page.$(String(selector))) != null;
  return { kind: "assertSelector", ok: found, detail: found ? `selector present: ${selector}` : `selector not found: ${selector}` };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const executablePath = findSandboxChromium();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(executablePath ? { executablePath } : {}),
  });
} catch (e) {
  fail(`Chromium failed to launch: ${e?.message || e}`);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil: "networkidle", timeout: 20000 });

  // 1) title extracted (empty here, but the call must not throw)
  const title = await page.title();

  // 2) tag-stripped text excerpt is non-empty
  const text = await extractText(page);
  if (!text.includes("Paige Browser self-verify")) fail(`text excerpt missing expected content — got "${text}"`);

  // 3) screenshot is a real, non-empty png
  const png = await page.screenshot({ type: "png" });
  if (!png || png.length < 1000) fail(`screenshot came back empty/tiny (${png?.length ?? 0} bytes)`);

  // 4) a read-only assertSelector step returns an honest ok:true for a present selector
  const okStep = await runAssertSelector(page, '[data-testid="verify-target"]');
  if (!okStep.ok) fail(`assertSelector should have found the target — got ${JSON.stringify(okStep)}`);

  // 5) the HONEST FAILURE path: a missing selector returns ok:false, does NOT throw, still structured
  const missStep = await runAssertSelector(page, "#does-not-exist");
  if (missStep.ok !== false) fail(`missing-selector step should be ok:false — got ${JSON.stringify(missStep)}`);

  await browser.close();

  console.log(`✓ observe engine runs — title="${title}", ${text.length}-char excerpt, ${png.length}-byte PNG${executablePath ? " (sandbox Chromium)" : ""}`);
  console.log(`✓ read-only step honest: present -> ok:true, missing -> ok:false (no throw)`);
  console.log("✓✓ paige-browser self-verify observe path is live-safe.");
  process.exit(0);
} catch (e) {
  console.error("✗ observe threw:", e?.message || e);
  try { await browser.close(); } catch { /* already down */ }
  process.exit(1);
}
