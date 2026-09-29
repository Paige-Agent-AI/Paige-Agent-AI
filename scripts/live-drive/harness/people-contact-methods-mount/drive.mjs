// Drives the People contact-methods harness: the Solo matrix (4 viewports × PAIGE closed/open), both
// themes, keyboard route, reduced motion and 200% zoom. Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/people-contact-methods-mount/vite.config.ts
import { chromium } from "playwright";
const out = "scripts/live-drive/artifacts/people-cm";
const base = "http://127.0.0.1:5214/";
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query}: ${e}`));
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('[data-cm-list="email"]');
  return page;
}
async function measure(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#trc-contact-editor-panel");
    const add = document.querySelector('[data-cm-add="phone"]');
    panel.scrollTop = panel.scrollHeight;
    const r = add.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      docScrollsY: document.documentElement.scrollHeight > innerHeight + 1,
      panelScrolls: panel.scrollHeight > panel.clientHeight,
      lastControlReachable: r.bottom <= p.bottom + 1 && r.top >= p.top - 1,
      rowsOverflowing: [...document.querySelectorAll(".cm-row")].filter((row) => row.scrollWidth > row.clientWidth + 1).length,
    };
  });
}
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const page = await open(`theme=dark&paige=${paige}`, w, h);
    const m = await measure(page);
    await page.evaluate(() => { document.querySelector("#trc-contact-editor-panel").scrollTop = 0; });
    const name = `solo-${w}x${h}-paige-${paige}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push({ name, ...m });
    await page.close();
  }
}
// Keyboard route: Tab from the last-name field through one secondary row, and the label list.
{
  const page = await open("theme=light", 1366, 768);
  await page.focus("#trc-first-name");
  const route = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    route.push(await page.evaluate(() => { const a = document.activeElement; return a.getAttribute("aria-label") || a.id || a.textContent?.trim().slice(0, 30); }));
  }
  await page.waitForTimeout(300); // let the .15s reveal finish before reading it
  const toolsVisibleOnFocus = await page.evaluate(() => getComputedStyle(document.activeElement.closest(".cm-row")?.querySelector(".cm-tools") ?? document.body).opacity);
  await page.focus('[data-cm-id="e2"] [data-cm-label]');
  await page.keyboard.press("Enter");
  await page.waitForSelector('[role="listbox"]');
  const listFocus = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  const relabelled = await page.evaluate(() => ({ label: document.querySelector('[data-cm-id="e2"] [data-cm-label]').textContent, focusBack: document.activeElement.hasAttribute("data-cm-label") }));
  const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + " " + getComputedStyle(document.activeElement).outlineColor);
  await page.screenshot({ path: `${out}/keyboard-light.png` });
  results.push({ name: "keyboard", route, toolsVisibleOnFocus, listFocus, relabelled, focusRing });
  await page.close();
}
// Reduced motion: make primary; the rows must not carry a transform transition.
{
  const page = await open("theme=dark", 1366, 768, { reducedMotion: "reduce" });
  await page.focus('[data-cm-id="e3"] .cm-mk');
  await page.keyboard.press("Enter");
  const transforms = await page.evaluate(() => [...document.querySelectorAll("[data-cm-id], [data-cm-orb]")].map((n) => n.style.transform).filter(Boolean).length);
  const top = await page.evaluate(() => document.querySelector('[data-cm-list="email"] [data-cm-id]').dataset.cmId);
  results.push({ name: "reduced-motion", inlineTransforms: transforms, topAfterMakePrimary: top });
  await page.close();
}
// 200% zoom ≈ half the CSS viewport at 1366×768.
{
  const page = await open("theme=dark", 683, 384);
  const m = await measure(page);
  await page.screenshot({ path: `${out}/zoom-200.png` });
  results.push({ name: "zoom-200", ...m });
  await page.close();
}
console.log(JSON.stringify({ results, errors }, null, 1));
await browser.close();
