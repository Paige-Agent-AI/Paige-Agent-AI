// Drives the Vibe Studio harness for the step start/finish lifecycle in "What Paige did": a step
// that opens as "running" mid-turn, the same row closed as "done", and the running row again with
// prefers-reduced-motion: reduce. Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
// Then:         node scripts/live-drive/harness/studio-mount/drive-step-lifecycle.mjs <outDir> [theme]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [out = "scripts/live-drive/artifacts/step-lifecycle", theme = "dark"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5216}/`;
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
// The row's glyph as drawn: which svg is displayed, and whether it is turning.
const rowState = (page) => page.$$eval(".vs-steps li", (lis) => lis.map((li) => {
  const glyph = li.firstElementChild;
  const shown = [...glyph.querySelectorAll("svg"), ...(glyph.tagName === "svg" ? [glyph] : [])]
    .filter((svg) => getComputedStyle(svg).display !== "none")
    .map((svg) => ({ cls: svg.getAttribute("class"), animation: getComputedStyle(svg).animationName }));
  return { status: li.dataset.status, label: glyph.getAttribute("aria-label"), text: li.querySelector(":scope > span:not(.vs-step-busy)")?.firstChild?.textContent, color: getComputedStyle(glyph).color, shown };
}));

async function run(name, reducedMotion, closeIt) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${base}?theme=${theme}&stream=lifecycle`);
  await page.waitForSelector(".vs-home");
  await page.locator(".vs-card", { hasText: "New client intake" }).click();
  await page.waitForSelector(".vs-session");
  await page.fill("#vs-chat-input", "Add a question about budget");
  await page.keyboard.press("Enter");
  await page.waitForSelector('.vs-steps li[data-status="running"]');
  await page.waitForTimeout(300);
  results.push({ name: `${name}-running`, rows: await rowState(page) });
  await label(page);
  await page.locator(".vs-steps").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-running.png` });
  if (closeIt) {
    await page.evaluate(() => window.__releaseStep());
    await page.waitForFunction(() => [...document.querySelectorAll(".vs-msg-paige")].some((m) => m.textContent.includes("budget for this")));
    await page.waitForTimeout(300);
    results.push({ name: `${name}-done`, rows: await rowState(page) });
    await page.screenshot({ path: `${out}/${name}-done.png` });
  }
  await page.close();
}

// The Solo matrix (4 viewports × PAIGE closed/open): the running row mid-turn, with the chat drawer
// opened where the viewport makes it a drawer, measuring document overflow and whether the row is on
// screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
async function matrix() {
  for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    for (const paige of ["closed", "open"]) {
      const name = `solo-${w}x${h}-paige-${paige}`;
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
      await page.goto(`${base}?theme=${theme}&paige=${paige}&stream=lifecycle`);
      await page.waitForSelector(".vs-home");
      await page.locator(".vs-card", { hasText: "New client intake" }).click();
      await page.waitForSelector(".vs-session");
      const toggle = page.locator(".vs-chat-toggle");
      if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await page.fill("#vs-chat-input", "Add a question about budget");
      await page.keyboard.press("Enter");
      await page.waitForSelector('.vs-steps li[data-status="running"]');
      await page.locator('.vs-steps li[data-status="running"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const r = document.querySelector('.vs-steps li[data-status="running"]').getBoundingClientRect();
        return {
          docOverflowX: document.documentElement.scrollWidth - innerWidth,
          rowOnScreen: r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        };
      });
      results.push({ name, ...m });
      await label(page);
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.close();
    }
  }
}

await run("studio-steps", "no-preference", true);
await run("studio-steps-reduced-motion", "reduce", false);
await matrix();
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
