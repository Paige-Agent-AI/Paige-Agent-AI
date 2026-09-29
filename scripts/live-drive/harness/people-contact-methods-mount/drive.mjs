// Drives the People contact-methods harness: the Solo matrix (4 viewports × PAIGE closed/open), both
// themes, keyboard route, reduced motion and 200% zoom. Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/people-contact-methods-mount/vite.config.ts
import { chromium } from "playwright";
const out = "scripts/live-drive/artifacts/people-cm";
const base = "http://127.0.0.1:5214/";
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
// Burned into every frame AFTER measuring, so a frame pasted anywhere still says what it is.
async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "8px", bottom: "6px", zIndex: "99", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query}: ${e}`));
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('[data-ctm-list="email"]');
  return page;
}
async function measure(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#trc-contact-editor-panel");
    const add = document.querySelector('[data-ctm-add="phone"]');
    panel.scrollTop = panel.scrollHeight;
    const r = add.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      docScrollsY: document.documentElement.scrollHeight > innerHeight + 1,
      panelScrolls: panel.scrollHeight > panel.clientHeight,
      lastControlReachable: r.bottom <= p.bottom + 1 && r.top >= p.top - 1,
      rowsOverflowing: [...document.querySelectorAll(".ctm-row")].filter((row) => row.scrollWidth > row.clientWidth + 1).length,
    };
  });
}
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const page = await open(`theme=dark&paige=${paige}`, w, h);
    const m = await measure(page);
    await page.evaluate(() => { document.querySelector("#trc-contact-editor-panel").scrollTop = 0; });
    const name = `solo-${w}x${h}-paige-${paige}`;
    await label(page);
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
  const toolsVisibleOnFocus = await page.evaluate(() => getComputedStyle(document.activeElement.closest(".ctm-row")?.querySelector(".ctm-tools") ?? document.body).opacity);
  await page.focus('[data-ctm-id="e2"] [data-ctm-label]');
  await page.keyboard.press("Enter");
  await page.waitForSelector('[role="listbox"]');
  const listFocus = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  const relabelled = await page.evaluate(() => ({ label: document.querySelector('[data-ctm-id="e2"] [data-ctm-label]').textContent, focusBack: document.activeElement.hasAttribute("data-ctm-label") }));
  const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + " " + getComputedStyle(document.activeElement).outlineColor);
  await label(page);
  await page.screenshot({ path: `${out}/keyboard-light.png` });
  results.push({ name: "keyboard", route, toolsVisibleOnFocus, listFocus, relabelled, focusRing });
  await page.close();
}
// Reduced motion: make primary; the rows must not carry a transform transition.
{
  const page = await open("theme=dark", 1366, 768, { reducedMotion: "reduce" });
  await page.focus('[data-ctm-id="e3"] .ctm-mk');
  await page.keyboard.press("Enter");
  const transforms = await page.evaluate(() => [...document.querySelectorAll("[data-ctm-id], [data-ctm-orb]")].map((n) => n.style.transform).filter(Boolean).length);
  const top = await page.evaluate(() => document.querySelector('[data-ctm-list="email"] [data-ctm-id]').dataset.ctmId);
  // The new-row fade and the label-list reveal are measured, not assumed: their computed animation.
  await page.click('[data-ctm-add="email"]');
  const newRowAnimation = await page.evaluate(() => getComputedStyle(document.querySelector(".ctm-row.is-new") ?? document.body).animationName);
  await page.click('[data-ctm-id="e1"] [data-ctm-label]');
  const listAnimation = await page.evaluate(() => getComputedStyle(document.querySelector(".ctm-lb")).animationName);
  results.push({ name: "reduced-motion", inlineTransforms: transforms, topAfterMakePrimary: top, newRowAnimation, listAnimation });
  await page.close();
}
// Control: with motion allowed the same two animations DO run, so the reduced-motion reading means something.
{
  const page = await open("theme=dark", 1366, 768);
  await page.click('[data-ctm-add="email"]');
  const newRowAnimation = await page.evaluate(() => getComputedStyle(document.querySelector(".ctm-row.is-new") ?? document.body).animationName);
  await page.click('[data-ctm-id="e1"] [data-ctm-label]');
  const listAnimation = await page.evaluate(() => getComputedStyle(document.querySelector(".ctm-lb")).animationName);
  results.push({ name: "motion-control", newRowAnimation, listAnimation });
  await page.close();
}
// 200% zoom ≈ half the CSS viewport at 1366×768.
{
  const page = await open("theme=dark", 683, 384);
  const m = await measure(page);
  await label(page);
  await page.screenshot({ path: `${out}/zoom-200.png` });
  results.push({ name: "zoom-200", ...m });
  await page.close();
}
// State frames: themes, make-primary, label list, refusal, first use, read-only record.
for (const [query, name, act] of [
  ["theme=dark", "editor-dark"], ["theme=light", "editor-light"], ["theme=light&view=empty", "editor-empty-light"],
  ["theme=dark", "editor-made-primary", async (p) => { await p.hover('[data-ctm-id="e3"]'); await p.click('[aria-label="Make primary: accounts@reyesbuild.co"]'); await p.waitForTimeout(700); }],
  ["theme=dark", "editor-label-open", async (p) => { await p.click('[data-ctm-id="e1"] [data-ctm-label]'); await p.waitForTimeout(250); }],
  ["theme=dark&taken=jordan@northbeam.example", "editor-taken", async (p) => {
    // A person adds an address that another contact in the workspace already holds, then saves.
    await p.click('[data-ctm-add="email"]');
    await p.keyboard.type("jordan@northbeam.example");
    for (const t of ["Business context", "Relationship & consent"]) await p.click(`[role="tab"]:has-text("${t}")`);
    await p.click('button:has-text("Save changes")');
    await p.waitForSelector(".ctm-row.has-err");
    results.push({ name: "taken-refusal", onRow: await p.evaluate(() => document.querySelector(".ctm-row.has-err input")?.value), focused: await p.evaluate(() => document.activeElement?.closest(".ctm-row.has-err") !== null) });
  }],
  ["theme=light&view=record", "record-light"],
]) {
  const page = await open(query, 1440, 900);
  if (act) await act(page);
  await label(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}
console.log(JSON.stringify({ results, errors }, null, 1));
await browser.close();
