// Drives the Team → a person → contact methods dialog and the Setup representative-phone picker:
// the Solo matrix (4 viewports × PAIGE closed/open), both themes, the admin-sees-owner state, the
// keyboard route, reduced motion and 200% zoom. Structural harness — NOT the live app.
// Serve first (both):
//   npx vite --config scripts/live-drive/harness/team-mount/vite.config.ts
//   npx vite --config scripts/live-drive/harness/setup-business-context-mount/vite.config.ts
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const out = process.env.OUT || "scripts/live-drive/artifacts/team-cm";
mkdirSync(out, { recursive: true });
const team = "http://127.0.0.1:5202/";
const setup = "http://127.0.0.1:5213/solo/1971670/settings/setup/people-email";
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "8px", bottom: "6px", zIndex: "999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function openMember(query, w, h, who = "Antonio Martinez", opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query}: ${e}`));
  await page.goto(`${team}?${query}`);
  await page.getByRole("button", { name: new RegExp(who) }).first().click();
  await page.waitForSelector(".stw-contact [data-ctm-list], .stw-contact .ctm-editor");
  await page.mouse.move(2, 2);
  return page;
}
async function measure(page) {
  return page.evaluate(() => {
    const modal = document.querySelector(".stw-modal");
    const save = [...document.querySelectorAll(".stw-contact button")].find((b) => b.textContent.trim() === "Save contact details");
    const last = save ?? document.querySelector(".stw-contact .ctm-row:last-child");
    last.scrollIntoView({ block: "nearest" });
    const r = last.getBoundingClientRect(), m = modal.getBoundingClientRect();
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      modalWithinViewport: m.left >= 0 && m.right <= innerWidth + 1 && m.top >= 0 && m.bottom <= innerHeight + 1,
      modalScrolls: modal.scrollHeight > modal.clientHeight,
      lastControlReachable: r.bottom <= m.bottom + 1 && r.top >= m.top - 1,
      rowsOverflowing: [...document.querySelectorAll(".stw-contact .ctm-row")].filter((row) => row.scrollWidth > row.clientWidth + 1).length,
    };
  });
}
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const page = await openMember(`theme=dark&paige=${paige}`, w, h);
    const m = await measure(page);
    await page.evaluate(() => { document.querySelector(".stw-modal").scrollTop = 0; });
    const name = `solo-${w}x${h}-paige-${paige}`;
    await label(page);
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push({ name, ...m });
    await page.close();
  }
}
// States: yourself (light), an admin opening the owner (read only), an owner opening a teammate with none.
for (const [name, query, who] of [["team-self-light", "theme=light", "Antonio Martinez"], ["team-admin-sees-owner-light", "theme=light&as=admin", "Antonio Martinez"], ["team-teammate-empty-dark", "theme=dark", "Maya Chen 1"]]) {
  const page = await openMember(query, 1366, 900, who);
  const state = await page.evaluate(() => ({ inputs: document.querySelectorAll(".stw-contact input").length, lock: document.querySelector(".stw-contact-lock")?.textContent ?? null, heading: document.querySelector("#stw-contact-h")?.textContent }));
  await label(page);
  await (await page.$(".stw-modal")).screenshot({ path: `${out}/${name}.png` });
  results.push({ name, ...state });
  await page.close();
}
// Keyboard route inside the contact section, from the heading onward, and a save round trip.
{
  const page = await openMember("theme=light", 1366, 900);
  await page.focus('[id^="ctm-value-o-e1"]');
  const route = [];
  for (let i = 0; i < 9; i += 1) {
    route.push(await page.evaluate(() => { const a = document.activeElement; return a.getAttribute("aria-label") || a.id || a.textContent?.trim().slice(0, 30); }));
    await page.keyboard.press("Tab");
  }
  // Measured on a control reached by Tab, where :focus-visible actually applies.
  const ring = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return `${a.getAttribute("aria-label") || a.id}: ${s.outlineStyle} ${s.outlineColor}`; });
  await page.click('[data-ctm-add="phone"]');
  await page.keyboard.type("+1 404 555 0101");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await page.waitForSelector(".stw-contact-msg");
  const saved = await page.textContent(".stw-contact-msg");
  const phones = await page.$$eval('.stw-contact [data-ctm-list="phone"] input', (n) => n.map((i) => i.value));
  results.push({ name: "keyboard-and-save", route, ring, saved, phones });
  await label(page);
  await (await page.$(".stw-modal")).screenshot({ path: `${out}/team-saved-light.png` });
  await page.close();
}
// Reduced motion: opening the dialog and making a secondary primary run nothing.
{
  const page = await openMember("theme=dark", 1366, 768, "Antonio Martinez", { reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Make primary: owner@northstar.example/ }).click();
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  const inlineTransforms = await page.$$eval(".stw-contact .ctm-row", (n) => n.filter((r) => r.style.transform).length);
  results.push({ name: "reduced-motion", running, inlineTransforms });
  await page.close();
}
// 200% zoom: half the CSS pixels.
{
  const page = await openMember("theme=dark", 683, 384);
  results.push({ name: "zoom-200", ...(await measure(page)) });
  await label(page);
  await page.screenshot({ path: `${out}/zoom-200.png` });
  await page.close();
}
// Setup → representative phone: both themes, pick by click and by arrow key.
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("pageerror", (e) => errors.push(`setup ${theme}: ${e}`));
  await page.goto(`${setup}?theme=${theme}`);
  await page.getByRole("button", { name: "Edit business context", exact: true }).click();
  await page.waitForSelector('input[name="setup-rep-phone"]');
  const before = await page.$$eval('input[name="setup-rep-phone"]', (n) => n.map((r) => ({ checked: r.checked, disabled: r.disabled })));
  await page.locator('label[for="setup-rep-phone-rep-p2"]').click();
  const picked = await page.$$eval('input[name="setup-rep-phone"]', (n) => n.map((r) => r.checked));
  await page.keyboard.press("ArrowUp");
  const arrowed = await page.$$eval('input[name="setup-rep-phone"]', (n) => n.map((r) => r.checked));
  results.push({ name: `setup-representative-${theme}`, before, picked, arrowed, docOverflowX: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) });
  await label(page);
  await (await page.$(".setup-field:has(#setup-rep-phone-h)")).screenshot({ path: `${out}/setup-representative-${theme}.png` });
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 1));
