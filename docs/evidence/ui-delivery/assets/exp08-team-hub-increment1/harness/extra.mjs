import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
// 200% zoom on a 1280x800 window = 640x400 CSS px; the shell rail is 60px at that width.
const zoom = await browser.newPage({ viewport: { width: 640, height: 400 } });
await zoom.goto("http://127.0.0.1:4791/?s=populated&theme=light&vw=640&vh=400&rail=60&row=58&paige=closed");
await zoom.waitForTimeout(500);
await zoom.locator("#th-conv-c-general").evaluate((el) => el.click()); await zoom.waitForTimeout(400);
const z = await zoom.evaluate(() => ({ hub: document.querySelector(".th-hub").getBoundingClientRect().width, view: document.querySelector(".th-grid").dataset.view, overflowX: document.documentElement.scrollWidth > innerWidth, streamScrolls: getComputedStyle(document.querySelector(".th-stream")).overflowY }));
await zoom.screenshot({ path: `${OUT}/ev-zoom200-1280-light.png` });
const rm = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
await rm.goto("http://127.0.0.1:4791/?s=populated&theme=dark&vw=1024&vh=768&rail=72&paige=closed");
await rm.waitForTimeout(500);
await rm.locator(".th-replies").first().evaluate((el) => el.click()); await rm.waitForTimeout(400);
const r = await rm.evaluate(() => ({ threadAnimation: getComputedStyle(document.querySelector(".th-thread")).animationName, btnTransition: getComputedStyle(document.querySelector(".th-btn")).transitionDuration }));
const nm = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await nm.goto("http://127.0.0.1:4791/?s=populated&theme=dark&vw=1024&vh=768&rail=72&paige=closed");
await nm.waitForTimeout(500);
await nm.locator(".th-replies").first().evaluate((el) => el.click()); await nm.waitForTimeout(100);
const n = await nm.evaluate(() => getComputedStyle(document.querySelector(".th-thread")).animationName);
// Keyboard: Tab from the search field reaches channel rows; Esc closes the thread back to its trigger.
await nm.keyboard.press("Escape"); await nm.waitForTimeout(200);
const afterEsc = await nm.evaluate(() => ({ thread: Boolean(document.querySelector(".th-thread")), focus: document.activeElement?.className }));
console.log(JSON.stringify({ zoom: z, reduced: r, normalAnimation: n, afterEsc }));
await browser.close();
