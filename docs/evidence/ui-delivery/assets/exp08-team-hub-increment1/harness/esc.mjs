import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const p = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await p.goto("http://127.0.0.1:4791/?s=populated&theme=dark&vw=1024&vh=768&rail=72&paige=closed");
await p.waitForTimeout(500);
await p.evaluate(() => { window.__esc = []; window.addEventListener("keydown", (e) => { if (e.key === "Escape") window.__esc.push(e.defaultPrevented); }); });
await p.locator(".th-replies").first().evaluate((el) => { el.focus(); el.click(); }); await p.waitForTimeout(400);
const before = await p.evaluate(() => ({ focus: document.activeElement?.id, convInert: document.querySelector(".th-conv").hasAttribute("inert") }));
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
const after = await p.evaluate(() => ({ thread: Boolean(document.querySelector(".th-thread")), focus: document.activeElement?.className, shellSawPrevented: window.__esc, convInert: document.querySelector(".th-conv").hasAttribute("inert") }));
console.log(JSON.stringify({ before, after }));
await browser.close();
