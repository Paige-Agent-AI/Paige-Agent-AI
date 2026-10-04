// Drives the Studio Publish panel through the one publish door (V2b) and frames every state.
// Structural harness: the real Vibe Studio, Publish panel and studio-data door calls over a stubbed
// `functions.invoke("growth-publish-command")` (supabase-stub.ts, `?publish=<mode>`). NOT the live app.
//   node drive-publish.mjs after  <outdir>   — every door state + the panel at the four Solo viewports, both themes
//   node drive-publish.mjs before <outdir>   — the panel at the four Solo viewports on the pre-V2b code (run with
//                                              the origin/main PublishPanel/studio-data/stub swapped in)
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const mode = process.argv[2] === "before" ? "before" : "after";
const out = process.argv[3] || `scripts/live-drive/artifacts/studio-publish-${mode}`;
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5216}/`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];

async function shoot(page, name) {
  await page.evaluate((m) => {
    const tag = document.createElement("div");
    tag.textContent = `harness render · not live${m === "before" ? " · before (origin/main)" : ""}`;
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    tag.dataset.harnessLabel = "1";
    document.body.append(tag);
  }, mode);
  const ok = await page.evaluate(() => { const r = document.querySelector("[data-harness-label]")?.getBoundingClientRect(); return !!r && r.height > 0 && r.bottom <= innerHeight; });
  if (!ok) throw new Error("label not on screen — refusing to write the frame");
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  await page.locator(".vs-card", { hasText: "New client intake" }).click();
  await page.waitForSelector(".vs-session");
  await page.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  return page;
}
const panelText = (page) => page.locator(".vs-pop").innerText();
const doorCalls = (page) => page.evaluate(() => window.__studioCalls.filter((c) => c.fn === "invoke:growth-publish-command").map((c) => c.args));
const directRpcs = (page) => page.evaluate(() => window.__studioCalls.filter((c) => /publish/.test(c.fn) && !c.fn.startsWith("invoke:")).map((c) => c.fn));
async function openPanel(page, label = "Publish") {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForSelector(".vs-pop");
}
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector(".vs-checks-skel"));
  await page.waitForTimeout(120);
}
async function geometry(page) {
  return page.evaluate(() => {
    const pop = document.querySelector(".vs-pop").getBoundingClientRect();
    return { docOverflowX: document.documentElement.scrollWidth - innerWidth, panelInView: pop.left >= 0 && pop.right <= innerWidth && pop.top >= 0 && pop.bottom <= innerHeight, panel: { w: Math.round(pop.width), h: Math.round(pop.height) } };
  });
}

// The panel at the four Solo viewports, both app themes (the Studio keeps its own ink stage either
// way; the app theme and PAIGE dock sit under the full-screen overlay).
for (const theme of ["light", "dark"]) {
  for (const [w, h] of VIEWPORTS) {
    for (const paige of theme === "light" ? ["closed", "open"] : ["open"]) {
      const page = await open(`theme=${theme}&paige=${paige}`, w, h);
      await openPanel(page);
      if (mode === "after") await settled(page); else await page.waitForTimeout(250);
      const name = theme === "light" ? `solo-${w}x${h}-paige-${paige}` : `panel-dark-${w}x${h}`;
      results.push({ name, ...(await geometry(page)) });
      await shoot(page, mode === "before" ? `before-${theme}-${w}x${h}${theme === "light" ? `-paige-${paige}` : ""}` : name);
      await page.close();
    }
  }
}

if (mode === "after") {
  // Checking: the server hasn't answered yet.
  {
    const page = await open("theme=light&publish=slow", 1366, 768);
    await openPanel(page);
    await page.waitForTimeout(300);
    results.push({ name: "checking", status: await page.locator(".vs-pop-status").innerText(), publishDisabled: await page.getByRole("button", { name: "Checking…" }).isDisabled(), doorCalls: await doorCalls(page) });
    await shoot(page, "state-checking-1366x768");
    await page.close();
  }
  // Ready → publish → It's live, with the address the door read back.
  {
    const page = await open("theme=light", 1366, 768);
    await openPanel(page);
    await settled(page);
    results.push({ name: "ready", focused: await page.evaluate(() => document.activeElement?.textContent), text: await panelText(page) });
    await shoot(page, "state-ready-1366x768");
    await page.getByRole("button", { name: "Publish now" }).click();
    await page.waitForSelector(".vs-pop h2:text(\"It's live\")");
    results.push({ name: "published", link: await page.textContent(".vs-pop a"), focused: await page.evaluate(() => document.activeElement?.textContent), doorCalls: await doorCalls(page), directRpcs: await directRpcs(page) });
    await shoot(page, "state-published-1366x768");
    await page.close();
  }
  // Each door answer, framed.
  for (const [m, name, act] of [
    ["blocked", "state-blocked", null],
    ["off", "state-off", null],
    ["forbidden", "state-forbidden", null],
    ["refused", "state-stale-recheck", "Publish now"],
    ["unverified", "state-unverified", "Publish now"],
    ["noaddress", "state-noaddress", "Publish now"],
  ]) {
    const page = await open(`theme=light&publish=${m}`, 1366, 768);
    await openPanel(page);
    await page.waitForTimeout(400);
    if (act) { await page.getByRole("button", { name: act }).click(); await page.waitForTimeout(800); }
    results.push({ name, text: await panelText(page), liveHeading: await page.locator(".vs-pop h2:text(\"It's live\")").count(), publishButtons: await page.getByRole("button", { name: /^Publish (now|changes)$/ }).count(), doorCalls: await doorCalls(page), focused: await page.evaluate(() => document.activeElement?.textContent) });
    await shoot(page, `${name}-1366x768`);
    if (m === "refused") {
      // The owner's second click is the fresh approval; it lands.
      await page.getByRole("button", { name: "Publish now" }).click();
      await page.waitForSelector(".vs-pop h2:text(\"It's live\")");
      results.push({ name: "stale-then-live", doorCalls: await doorCalls(page) });
    }
    await page.close();
  }
  // Live: unpublish prepared on open; a funnel that uses it blocks it before any click.
  {
    const page = await open("theme=light&publish=live-blocked", 1366, 768);
    await openPanel(page, "Live · Manage");
    await page.waitForTimeout(400);
    results.push({ name: "live-blocked", text: await panelText(page), unpublishDisabled: await page.getByRole("button", { name: "Unpublish" }).isDisabled(), doorCalls: await doorCalls(page) });
    await shoot(page, "state-live-blocked-1366x768");
    await page.close();
  }
  // Live → Unpublish → "Take it offline?" inline → redeemed.
  {
    const page = await open("theme=light&publish=live", 1366, 768);
    await openPanel(page, "Live · Manage");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Unpublish" }).click();
    results.push({ name: "unpublish-confirm", text: await panelText(page), focused: await page.evaluate(() => document.activeElement?.textContent) });
    await shoot(page, "state-unpublish-confirm-1366x768");
    await page.keyboard.press("Escape"); // steps back out of the confirm, not the panel
    results.push({ name: "unpublish-esc", confirmGone: (await page.locator(".vs-pop-confirm").count()) === 0, panelOpen: await page.locator(".vs-pop").count() });
    await page.getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("button", { name: "Take it offline" }).click();
    await page.waitForSelector(".vs-notice");
    results.push({ name: "unpublished", notice: await page.textContent(".vs-notice"), panelOpen: await page.locator(".vs-pop").count(), doorCalls: await doorCalls(page) });
    await page.close();
  }
  // Keyboard: Tab order inside the ready panel; Esc closes it and returns focus to Publish.
  {
    const page = await open("theme=light", 1366, 768);
    await openPanel(page);
    await settled(page);
    const route = [await page.evaluate(() => document.activeElement?.textContent)];
    for (let i = 0; i < 2; i += 1) { await page.keyboard.press("Tab"); route.push(await page.evaluate(() => document.activeElement?.textContent)); }
    await page.keyboard.press("Escape");
    results.push({ name: "keyboard", route, panelOpen: await page.locator(".vs-pop").count(), focusBack: await page.evaluate(() => document.activeElement?.textContent) });
    await page.close();
  }
  // Reduced motion: the checking rows hold still.
  {
    const page = await open("theme=light&publish=slow", 1366, 768, { reducedMotion: "reduce" });
    await openPanel(page);
    await page.waitForTimeout(300);
    results.push({ name: "reduced-motion", moving: await page.evaluate(() => [...document.querySelectorAll(".vs-pop *")].filter((e) => { const cs = getComputedStyle(e); return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.01; }).length) });
    await page.close();
  }
  // 200% zoom equivalent: the panel at half the CSS viewport still fits and wraps.
  {
    const page = await open("theme=light&publish=blocked", 683, 384);
    await openPanel(page);
    await page.waitForTimeout(400);
    results.push({ name: "zoom-200", ...(await geometry(page)) });
    await shoot(page, "state-blocked-zoom200-683x384");
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify({ mode, results, errors }, null, 1));
if (errors.length) process.exit(1);
