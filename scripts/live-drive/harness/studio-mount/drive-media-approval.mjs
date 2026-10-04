// Drives the Vibe Studio harness for the v2b media-approval frames: the image-approval banner in a
// project's chat and the pending list under "Images & video", for the person who asked and for
// another admin, in both app themes. Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts [--port N]
// Then:         node scripts/live-drive/harness/studio-mount/drive-media-approval.mjs <outDir> <prefix> <variant,...> [baseUrl]
//   variants: 1 (the pre-v2b stub), mine, theirs, theirs-unnamed
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [out = "scripts/live-drive/artifacts/media-approval", prefix = "after", variantArg = "mine,theirs", base = "http://127.0.0.1:5216/"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];

async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on("pageerror", (e) => errors.push(`${query}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  return page;
}

for (const variant of variantArg.split(",")) {
  for (const theme of ["light", "dark"]) {
    const q = `theme=${theme}&approval=${variant}`;
    // 1. The banner in the project's chat.
    {
      const page = await open(q);
      await page.locator(".vs-card", { hasText: "New client intake" }).click();
      await page.waitForSelector(".vs-approval");
      await page.waitForTimeout(250);
      const card = page.locator(".vs-approval").first();
      results.push({
        frame: `${prefix}-banner-${variant}-${theme}`,
        text: (await card.innerText()).replace(/\s+/g, " ").trim(),
        buttons: await card.locator("button").allInnerTexts(),
      });
      await label(page);
      await page.screenshot({ path: `${out}/${prefix}-banner-${variant}-${theme}-1366x768.png` });
      await card.screenshot({ path: `${out}/${prefix}-banner-${variant}-${theme}-card.png` });
      // Keyboard: the first control in the card is reachable and its action is named.
      const first = card.locator("button").first();
      await first.focus();
      results.push({ frame: `${prefix}-banner-${variant}-${theme}`, focused: await page.evaluate(() => document.activeElement?.textContent?.trim()) });
      await page.close();
    }
    // 2. The pending list under Images & video.
    {
      const page = await open(q);
      await page.getByRole("button", { name: "Images & video" }).click();
      const section = page.locator('section[aria-label="Awaiting approval"]');
      await section.waitFor();
      await page.waitForTimeout(250);
      results.push({
        frame: `${prefix}-media-${variant}-${theme}`,
        text: (await section.innerText()).replace(/\s+/g, " ").trim(),
        buttons: await section.locator("button").allInnerTexts(),
      });
      await label(page);
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${prefix}-media-${variant}-${theme}-1366x768.png` });
      await section.screenshot({ path: `${out}/${prefix}-media-${variant}-${theme}-section.png` });
      await page.close();
    }
  }
}
// The Solo matrix (4 viewports × PAIGE closed/open) on the new variant — another admin's view —
// with the chat drawer opened where the viewport makes it a drawer, so the card is on screen.
if (prefix === "after") {
  for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    for (const paige of ["closed", "open"]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => errors.push(`matrix ${w}x${h}: ${e}`));
      await page.goto(`${base}?theme=light&paige=${paige}&approval=theirs`);
      await page.waitForSelector(".vs-home");
      await page.locator(".vs-card", { hasText: "New client intake" }).click();
      await page.waitForSelector(".vs-approval", { state: "attached" });
      const toggle = page.locator(".vs-chat-toggle");
      if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const card = document.querySelector(".vs-approval");
        const r = card?.getBoundingClientRect();
        const decline = [...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Decline")?.getBoundingClientRect();
        return {
          docOverflowX: document.documentElement.scrollWidth - innerWidth,
          cardOnScreen: !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          declineTarget: decline ? { w: Math.round(decline.width), h: Math.round(decline.height) } : null,
        };
      });
      results.push({ frame: `solo-${w}x${h}-paige-${paige}`, ...m });
      await label(page);
      await page.screenshot({ path: `${out}/solo-${w}x${h}-paige-${paige}.png` });
      await page.close();
    }
  }
  // Reduced motion: the card has no motion of its own; confirm it renders identically.
  const rm = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await rm.goto(`${base}?theme=light&approval=theirs`);
  await rm.waitForSelector(".vs-home");
  await rm.locator(".vs-card", { hasText: "New client intake" }).click();
  await rm.waitForSelector(".vs-approval");
  results.push({ frame: "reduced-motion", animations: await rm.evaluate(() => document.querySelector(".vs-approval")?.getAnimations({ subtree: true }).length ?? -1) });
  // 200% zoom equivalent: half-width viewport at the same CSS, the card must still fit its column.
  await rm.setViewportSize({ width: 683, height: 768 });
  const t = rm.locator(".vs-chat-toggle");
  if (await t.isVisible() && (await t.getAttribute("aria-expanded")) === "false") await t.click();
  await rm.waitForTimeout(200);
  results.push({ frame: "reflow-683", ...(await rm.evaluate(() => { const r = document.querySelector(".vs-approval")?.getBoundingClientRect(); return { docOverflowX: document.documentElement.scrollWidth - innerWidth, cardFits: !!r && r.right <= innerWidth && r.left >= 0 }; })) });
  await label(rm);
  await rm.screenshot({ path: `${out}/reflow-683x768-theirs.png` });
  await rm.close();
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
if (errors.length) process.exitCode = 1;
