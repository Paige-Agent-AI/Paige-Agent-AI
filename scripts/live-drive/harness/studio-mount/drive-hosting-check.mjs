// Drives the EXP06 hosting-check UI (WEB-05 wiring, PR "wire the host path's Check-hosting
// step"): in the REAL DomainGuidanceCard inside the harness's real .vs-studio overlay, the
// owner opens "Use my own address", clicks "Check hosting for this page", and the ONE dormant
// door's honest answer renders verbatim: "Hosting isn't switched on yet. Nothing was changed."
// The stub answers exactly what the real (dormant) growth-hosting-command returns today —
// refused + disabled + HOSTING_NOT_ENABLED, no approval minted.
// Structural harness: the real card, the real studio-data prepare path, the stubbed door.
// NOT the live app.   node drive-hosting-check.mjs   (serve first on STUDIO_HARNESS_PORT=5217)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = "docs/evidence/ui-delivery/assets/exp06-hosting-check";
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5217}/`;
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

async function open(query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector("details.vs-domain-card");
  await page.evaluate(() => { document.querySelector("details.vs-domain-card").open = true; });
  return page;
}

async function assertHostingAnswer(page, label) {
  const btn = await page.$("button.vs-link");
  if (!btn) throw new Error(`${label}: the Check hosting button is missing`);
  const text = await btn.textContent();
  if (!/Check hosting/i.test(text)) throw new Error(`${label}: unexpected button text ${text}`);
  await btn.click();
  await page.waitForSelector("[data-hosting-state]", { timeout: 5000 });
  const line = await page.$eval("[data-hosting-state]", (el) => ({ state: el.getAttribute("data-hosting-state"), text: el.textContent ?? "" }));
  if (line.state !== "disabled") errors.push(`${label}: expected the dormant disabled state, got ${line.state}`);
  if (!line.text.includes("Hosting isn't switched on yet. Nothing was changed.")) errors.push(`${label}: the door's sentence is not verbatim: ${line.text}`);
  if (/is live|went live/i.test(line.text)) errors.push(`${label}: a live claim appeared`);
  // The honest sentence must be ON SCREEN in the frame (the pop owns its scrolling: scroll it in).
  await page.evaluate(() => {
    const el = document.querySelector("[data-hosting-state]");
    el?.scrollIntoView({ block: "center" });
    const pop = document.querySelector(".vs-pop");
    if (pop) pop.scrollTop = Math.max(0, (el?.offsetTop ?? 0) - 120);
  });
}

// 1–4. The honest dormant answer at the four Solo viewports (closed dock).
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  const page = await open("domain=1", w, h);
  await assertHostingAnswer(page, `${w}x${h}`);
  await shoot(page, `hosting-check-${w}x${h}`);
  await page.close();
}

// 5. Dark theme survival.
{
  const page = await open("domain=1&theme=dark", 1366, 768);
  await assertHostingAnswer(page, "dark");
  await shoot(page, "hosting-check-1366x768-dark");
  await page.close();
}

// 6. The dock open beneath the overlay — geometry invariance re-asserted with the answer visible.
{
  const page = await open("domain=1&paige=open", 1366, 768);
  await assertHostingAnswer(page, "dock-open");
  const overlay = await page.$eval(".vs-studio", (s) => { const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { x: r.x, y: r.y, w: r.width, h: r.height, z: cs.zIndex }; });
  if (overlay.x !== 0 || overlay.y !== 0 || overlay.w !== 1366 || overlay.h !== 768 || Number(overlay.z) < 1) errors.push("dock-open: the studio overlay is not full-screen above the shell");
  await shoot(page, "hosting-check-1366x768-dock-open");
  await page.close();
}

console.log(JSON.stringify({ frames: results, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
