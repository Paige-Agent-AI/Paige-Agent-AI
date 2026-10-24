import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// Reflow at 200% zoom and reduced motion for the increment-2 layers (Team work panel, preview).
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const base = "http://127.0.0.1:4791/?s=populated";
// 200% zoom on a 1280x800 window = 640x400 CSS px; the shell rail is 60px at that width.
const zoom = await browser.newPage({ viewport: { width: 640, height: 400 } });
await zoom.goto(`${base}&theme=light&vw=640&vh=400&rail=60&row=58&paige=closed`);
await zoom.waitForTimeout(500);
await zoom.locator("button[aria-label='Team work']").click(); await zoom.waitForTimeout(500);
const zw = await zoom.evaluate(() => ({ hub: document.querySelector(".th-hub").getBoundingClientRect().width, work: document.querySelector(".th-work").getBoundingClientRect().width, overflowX: document.documentElement.scrollWidth > innerWidth, bodyScrolls: getComputedStyle(document.querySelector(".th-work-body")).overflowY }));
await zoom.screenshot({ path: `${OUT}/ev-zoom200-1280-work-light.png` });
await zoom.locator("button[aria-label='Back']").click(); await zoom.waitForTimeout(300);
await zoom.locator("#th-conv-c-general").click(); await zoom.waitForTimeout(400);
await zoom.locator("textarea[role=combobox]").click();
await zoom.keyboard.type("Send the Brightline welcome packet");
await zoom.locator("button[aria-label='PAIGE commands']").click(); await zoom.waitForTimeout(300);
await zoom.locator("[role=option]", { hasText: "Draft a task" }).first().click(); await zoom.waitForTimeout(500);
const zp = await zoom.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth, preview: Boolean(document.querySelector(".th-preview")), gridCols: getComputedStyle(document.querySelector(".th-pv-grid")).gridTemplateColumns }));
await zoom.screenshot({ path: `${OUT}/ev-zoom200-1280-taskpreview-light.png` });
const motion = async (reducedMotion) => {
  const p = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion });
  await p.goto(`${base}&theme=dark&vw=1024&vh=768&rail=72&paige=closed`);
  await p.waitForTimeout(500);
  await p.locator("button[aria-label='Team work']").click(); await p.waitForTimeout(50);
  const work = await p.evaluate(() => getComputedStyle(document.querySelector(".th-work")).animationName);
  await p.locator("button[aria-label='Close team work']").click(); await p.waitForTimeout(300);
  await p.locator("textarea[role=combobox]").click(); await p.keyboard.type("/"); await p.waitForTimeout(100);
  const pop = await p.evaluate(() => getComputedStyle(document.querySelector(".th-pop")).animationName);
  await p.keyboard.press("Enter"); await p.waitForTimeout(50);
  const preview = await p.evaluate(() => getComputedStyle(document.querySelector(".th-preview")).animationName);
  await p.close();
  return { work, pop, preview };
};
const reduced = await motion("reduce");
const normal = await motion("no-preference");
console.log(JSON.stringify({ zoomWork: zw, zoomPreview: zp, reduced, normal }));
await browser.close();
