// Drives the EXP06 media block's truthful states on the Studio stage (the same GrowthBlocks the
// published page uses): a well-formed YouTube embed and the honest unavailable card for an
// unparseable URL, at Solo viewports. Structural harness over the stubbed door. NOT the live app.
//   node drive-media.mjs <outdir>
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "docs/evidence/ui-delivery/assets/exp06-media-block";
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
async function openPage(query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".vs-home");
  await page.locator(".vs-card", { hasText: "Referral workshop page" }).first().click({ timeout: 60000 });
  await page.waitForSelector(".vs-session");
  await page.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty, iframe"));
  return page;
}

// A well-formed embed: the sandboxed nocookie iframe sits inside the stage's preview.
for (const [w, h] of [[1536, 770], [900, 1000]]) {
  const p = await openPage("media=ok", w, h);
  // The page previews inside the stage's nested LivePreview frame; the embed iframe is lazy, so
  // assert on the DOM element inside each frame rather than on navigated frame URLs.
  let found = false;
  for (const f of p.frames()) {
    try {
      found = await f.evaluate(() => !!document.querySelector("iframe[src*='youtube-nocookie']"));
      if (found) break;
    } catch { /* frame not ready */ }
  }
  if (!found) errors.push(`ok ${w}x${h}: no nocookie embed element in any preview frame`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) errors.push(`ok ${w}x${h}: document overflow`);
  await shoot(p, `media-ok-${w}x${h}`);
  await p.close();
}

// The unparseable URL: the honest sentence replaces the video, and no iframe exists for it.
for (const [w, h] of [[1366, 768], [900, 1000]]) {
  const p = await openPage("media=broken", w, h);
  const texts = [];
  for (const f of p.frames()) {
    try { texts.push(await f.evaluate(() => document.body?.innerText ?? "")); } catch { /* frame not ready */ }
  }
  const all = texts.join(" ").replace(/\s+/g, " ");
  if (!all.includes("This video isn’t available right now.")) errors.push(`broken ${w}x${h}: honest sentence missing in any frame (got: ${all.slice(-200)})`);
  if (p.frames().some((f) => f.url().includes("youtube"))) errors.push(`broken ${w}x${h}: an embed frame rendered for the unparseable URL`);
  await shoot(p, `media-broken-${w}x${h}`);
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 1));
if (errors.length) process.exit(1);
