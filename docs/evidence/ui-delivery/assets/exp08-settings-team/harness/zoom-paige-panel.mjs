// EXP08 PAIGE team-lifecycle tools: the "Paige team context" panel at 200% zoom (640×400 CSS px at device
// scale 2), both themes, and whether Tab reaches its one control with a visible ring. RENDERED-HARNESS.
import { chromium } from "playwright";
const OUT = process.env.OUT;
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const out = [];
for (const theme of ["light", "dark"]) {
  // 200% zoom on a 1280×800 window = a 640×400 CSS viewport at device scale 2.
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:4792/?${new URLSearchParams({ theme, s: "populated", viewer: "owner" })}`);
  await page.waitForSelector(".stw-paige"); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector(".stw-paige")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    lanes: getComputedStyle(document.querySelector(".stw-lanes")).gridTemplateColumns, motion: getComputedStyle(document.querySelector(".stw-paige")).animationName }));
  await page.screenshot({ path: `${OUT}/ev-zoom200-1280-paige-panel-${theme}.png` });
  // Keyboard: the panel's one control is "Open Paige"; Tab reaches it with a visible focus ring.
  let reached = false, outline = null;
  for (let i = 0; i < 60 && !reached; i++) { await page.keyboard.press("Tab"); reached = await page.evaluate(() => document.activeElement?.textContent === "Open Paige"); }
  if (reached) outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}`; });
  out.push({ theme, ...m, openPaigeReachedByTab: reached, focusOutline: outline });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out));
