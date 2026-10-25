// Drives the EXP06 brand-context line (row 2) in the Studio session and frames it: the same
// anon-safe portal-brand read the published pages theme from, shown with honest missing states.
// Structural harness: real Studio components over the stubbed door + brand read. NOT the live app.
//   node drive-brand.mjs <outdir>
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "docs/evidence/ui-delivery/assets/exp06-brand-context";
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5216}/`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
const errors = [];
const results = [];

async function shoot(page, name) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    tag.dataset.harnessLabel = "1";
    document.body.append(tag);
  });
  const ok = await page.evaluate(() => { const r = document.querySelector("[data-harness-label]")?.getBoundingClientRect(); return !!r && r.height > 0 && r.bottom <= innerHeight; });
  if (!ok) throw new Error("label not on screen — refusing to write the frame");
  await page.screenshot({ path: `${out}/${name}.png` });
  results.push(name);
}
async function openSession(query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  await page.locator(".vs-card", { hasText: "New client intake" }).click();
  await page.waitForSelector(".vs-session");
  await page.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  // Narrow screens keep the chat (and the brand line inside it) in a closed drawer; open it the
  // way an owner does — the top-bar Chat toggle — before asserting/shooting the line.
  if (w <= 980) {
    const toggle = page.getByRole("button", { name: /Chat|Hide chat/ }).first();
    if (await toggle.isVisible()) await toggle.click();
  }
  // Attached, then box+visibility settled by our own predicate: this Edge/Playwright pair
  // intermittently answers "hidden" for elements whose computed style and box are plainly visible,
  // so the drive asserts what it actually observes instead of the engine's visibility cache.
  await page.waitForSelector(".vs-brand-line", { state: "attached" });
  await page.waitForFunction(() => {
    const el = document.querySelector(".vs-brand-line");
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.visibility === "visible" && cs.display !== "none" && r.width > 0 && r.height > 0;
  }, null, { timeout: 20000 });
  return page;
}

// Present brand (name + own color, no logo) at the two extreme Solo viewports + dark.
for (const [w, h] of [[1536, 770], [900, 1000]]) {
  const p = await openSession("publish=ready", w, h);
  const line = (await p.locator(".vs-brand-line").innerText()).replace(/\s+/g, " ");
  if (!line.includes("Northwind Studio") || !line.includes("your page color") || !line.includes("no logo yet")) errors.push(`present-brand line wrong: ${line}`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) errors.push(`present ${w}x${h}: document overflow`);
  await shoot(p, `brand-present-${w}x${h}`);
  await p.close();
}
{
  const p = await openSession("publish=ready&theme=dark", 1366, 768);
  await shoot(p, "brand-present-dark-1366x768");
  await p.close();
}

// Missing brand: every fact states its honest default and points at Setup.
for (const [w, h] of [[1366, 768], [900, 1000]]) {
  const p = await openSession("publish=ready&brand=none", w, h);
  const line = (await p.locator(".vs-brand-line").innerText()).replace(/\s+/g, " ");
  if (!line.includes("No business name yet — add it in Setup") || !line.includes("Paige's default page color")) errors.push(`missing-brand line wrong: ${line}`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) errors.push(`missing ${w}x${h}: document overflow`);
  await shoot(p, `brand-missing-${w}x${h}`);
  await p.close();
}

// Home carries no brand line (it belongs to the project's pages) — asserted, not framed.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${base}?publish=ready`);
  await page.waitForSelector(".vs-home");
  if (await page.locator(".vs-brand-line").count()) errors.push("brand line rendered on Studio home");
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 1));
if (errors.length) process.exit(1);
