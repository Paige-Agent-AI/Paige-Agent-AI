// Drives the form intake harness: the Solo matrix (4 viewports × PAIGE closed/open), both themes,
// a save, keyboard reach and reduced motion. Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/form-intake-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "scripts/live-drive/artifacts/form-intake";
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:5215/";
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", left: "8px", bottom: "6px", zIndex: "999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query}: ${e}`));
  await page.goto(`${base}?${query}`);
  await page.getByRole("button", { name: "Details" }).first().click();
  await page.waitForSelector(".campaigns-drawer .intake-section");
  return page;
}
async function measure(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".campaigns-drawer-body");
    const drawer = document.querySelector(".campaigns-drawer");
    const last = [...document.querySelectorAll(".campaigns-drawer .sub")].at(-1);
    body.scrollTop = body.scrollHeight;
    const r = last.getBoundingClientRect(), b = body.getBoundingClientRect(), d = drawer.getBoundingClientRect();
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      drawerWithinViewport: d.left >= 0 && d.right <= innerWidth + 1,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      lastSubmissionReachable: r.bottom <= b.bottom + 1,
      bodyOverflowX: body.scrollWidth - body.clientWidth,
    };
  });
}
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const page = await open(`theme=light&paige=${paige}`, w, h);
    const m = await measure(page);
    await page.evaluate(() => { document.querySelector(".campaigns-drawer-body").scrollTop = 0; });
    const name = `solo-${w}x${h}-paige-${paige}`;
    await label(page);
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push({ name, ...m });
    await page.close();
  }
}
// Dark theme at the common laptop width.
{
  const page = await open("theme=dark&paige=open", 1366, 768);
  results.push({ name: "dark-1366x768", ...(await measure(page)) });
  await page.evaluate(() => { document.querySelector(".campaigns-drawer-body").scrollTop = 0; });
  await label(page);
  await page.screenshot({ path: `${out}/dark-1366x768-paige-open.png` });
  await page.close();
}
// Save through the real component; the stub records the exact payload.
{
  const page = await open("theme=light", 1366, 768);
  await page.selectOption(".intake-route select >> nth=1", "s-call");
  await page.fill("#intake-email", "alerts@yourbusiness.example");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForSelector(".intake-status.is-ok");
  results.push({ name: "save", payload: await page.evaluate(() => window.__intakeSaves), status: await page.textContent(".intake-status") });
  // Keyboard: from the close button, Tab reaches the switch, both selects, the email and the first submission.
  await page.focus(".campaigns-drawer header button");
  const route = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    route.push(await page.evaluate(() => { const a = document.activeElement; return a.getAttribute("role") || a.id || a.tagName.toLowerCase(); }));
  }
  results.push({ name: "keyboard", route });
  // Shift+Tab from the close button wraps to the last control Tab can actually reach — never to a
  // button hidden inside a collapsed submission.
  await page.focus(".campaigns-drawer header button");
  await page.keyboard.press("Shift+Tab");
  results.push({ name: "shift-tab-wrap", focused: await page.evaluate(() => { const a = document.activeElement; return { text: a.textContent?.trim().slice(0, 40), insideDrawer: !!a.closest(".campaigns-drawer"), hiddenInClosedDetails: !!a.closest("details:not([open])") && a.tagName !== "SUMMARY" }; }) });
  await page.close();
}
// Member: read-only, no inputs, no address shown.
{
  const page = await open("theme=light&member=1", 1366, 768);
  results.push({ name: "member", inputs: await page.locator(".campaigns-drawer input, .campaigns-drawer select, .campaigns-drawer [role=switch]").count(), showsAddress: (await page.textContent(".campaigns-drawer")).includes("hello@yourbusiness.example") });
  await page.close();
}
// Reduced motion: the switch transition is removed.
{
  const page = await open("theme=light", 1366, 768, { reducedMotion: "reduce" });
  results.push({ name: "reduced-motion", switchTransition: await page.evaluate(() => getComputedStyle(document.querySelector(".intake-switch")).transitionDuration) });
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 1));
if (errors.length) process.exit(1);
