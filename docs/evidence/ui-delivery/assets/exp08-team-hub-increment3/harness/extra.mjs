import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// Reduced motion for the chip pulse, Esc keeping the chips, and the keyboard path to the paperclip and Remove.
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const base = "http://127.0.0.1:4791/?s=populated&theme=dark&vw=1366&vh=768&rail=72&row=66&paige=closed&pw=0&me=owner";
const run = async (reducedMotion) => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion });
  await page.goto(base); await page.waitForTimeout(600);
  await page.evaluate(() => { window.__thFates = { "hold.png": "hold-check" }; });
  await page.locator(".th-conv input[type=file]").first().setInputFiles([{ name: "hold.png", mimeType: "image/png", buffer: Buffer.alloc(10, 32) }, { name: "ok.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10, 32) }]);
  await page.waitForTimeout(600);
  const pulse = await page.evaluate(() => getComputedStyle(document.querySelector(".th-att[data-state=checking] .th-att-glyph")).animationName);
  // Esc in the composer must not discard the chips.
  await page.locator(".th-conv textarea[role=combobox]").click();
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  const chipsAfterEsc = await page.evaluate(() => document.querySelectorAll(".th-conv .th-att").length);
  // Keyboard: from the textarea, Tab walks the chip controls and the composer row; record the order and the focus ring.
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { label: (el.getAttribute("aria-label") ?? el.tagName).slice(0, 40), focusVisible: el.matches(":focus-visible"), outline: cs.outlineStyle }; }));
  }
  // Remove by keyboard: focus the ready chip's Remove and press Enter.
  await page.locator(".th-conv button[aria-label='Remove ok.pdf']").focus();
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const afterRemove = await page.evaluate(() => [...document.querySelectorAll(".th-conv .th-att-name")].map((el) => el.textContent));
  const discards = await page.evaluate(() => (window.__thFileLog ?? []).filter((e) => e.action === "discard").length);
  await page.close();
  return { pulse, chipsAfterEsc, tabOrder: order, afterRemove, discardCalls: discards };
};
const out = { reduced: await run("reduce"), normal: await run("no-preference") };
writeFileSync(resolve(HERE, "extra-report.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
