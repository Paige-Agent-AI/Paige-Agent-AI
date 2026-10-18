// TEMPORARY native capture shooter — never committed.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";

const OUT = "docs/evidence/experience-01-foundation/comms-guidance-2026-10-17";
mkdirSync(OUT, { recursive: true });

// [name, width, height, onboarding(1=docked-open default closed? handled via click), theme]
const VIEWPORTS = [
  ["1536x770", 1536, 770], ["1366x768", 1366, 768], ["1024x768", 1024, 768], ["900x1000", 900, 1000],
];
const BASE = "http://127.0.0.1:4173/capture.html";

const browser = await chromium.launch();
const results = [];
async function shoot(page, file) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  results.push(file);
}
for (const [label, w, h] of VIEWPORTS) {
  for (const theme of ["dark", "light"]) {
    // CLOSED: onboarding docked, profile collapsed (next-steps hidden by design)
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${BASE}?theme=${theme}&onboarding=1`, { waitUntil: "domcontentloaded" });
    await shoot(page, `comms-${label}-${theme}-closed.png`);
    // OPEN: docked profile expanded; next-steps section visible with the four prompts + four handoffs
    await page.getByRole("button", { name: "Review profile" }).click();
    await shoot(page, `comms-${label}-${theme}-open.png`);
    await page.close();
  }
}
// keyboard pass on smallest closed frame: Tab reaches handoff buttons
const kpage = await browser.newPage({ viewport: { width: 320, height: 720 } });
await kpage.emulateMedia({ reducedMotion: "reduce" });
await kpage.goto(`${BASE}?theme=dark&onboarding=1`, { waitUntil: "domcontentloaded" });
await kpage.getByRole("button", { name: "Review profile" }).click().catch(() => {});
const focusTrail = [];
for (let i = 0; i < 14; i++) { await kpage.keyboard.press("Tab"); focusTrail.push(await kpage.evaluate(() => document.activeElement?.textContent || document.activeElement?.getAttribute("aria-label") || "")); }
writeFileSync(`${OUT}/comms-320-dark-keyboard.json`, JSON.stringify({ focusTrail }, null, 1));
await kpage.screenshot({ path: `${OUT}/comms-320x720-dark-keyboard.png` });
await kpage.close();
await browser.close();
console.log(JSON.stringify({ captured: results.length, files: results }, null, 1));
