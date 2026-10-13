#!/usr/bin/env node
// Setup › Business profile › Business time zone (Experience 04 E4-S2), rendered for real.
//
// WHAT IT PROVES. The REAL Settings route, Solo shell, Setup and BusinessTimeZoneSetting with the
// production CSS, through the isolated Setup harness; only the Supabase client is a stub that answers
// the two time zone RPCs in memory (harness/setup-business-context-mount/time-zone-stub.ts). For each
// theme × the eight canonical Solo frames (PAIGE open and folded) + a phone, it renders every state
// (not set, set, admin read-only, unrecognised, read failed), then drives pick → confirm → save →
// read back, and asserts: no page error, nothing spilling sideways, measured WCAG contrast of every
// text in the section against what is painted behind it, no gold, the picker carrying the theme, and
// the exact words. One keyboard-only pass per theme proves the route from Tab to the saved notice.
// Frames land in artifacts/setup-business-time-zone.
//
// WHAT IT DOES NOT PROVE. Persistence, permissions or tenant isolation (the SQL proof owns those), or
// the authenticated production surface (§32.c: owed to the QA lane).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5226;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(import.meta.dirname, "artifacts/setup-business-time-zone");
const REPO = path.resolve(import.meta.dirname, "../..");
const ROUTE = "/solo/1971670/settings/setup/business-profile";
const FRAMES = [
  ...[[1536, 770], [1366, 768], [1024, 768], [900, 1000]].flatMap(([width, height]) => ["closed", "open"].map((paige) => ({ name: `${width}x${height}-paige-${paige}`, width, height, paige }))),
  { name: "phone-390", width: 390, height: 844, paige: "closed" },
];
const STATES = [
  { tz: "missing", expect: ["Business time zone", "Not set", "Due and overdue payment dates are on hold", "Set time zone"] },
  { tz: "configured", expect: ["Eastern Time · New York", "America/New_York", "there now", "Change"], forbid: ["Not set"] },
  { tz: "admin", expect: ["America/New_York", "Only the business owner can change this."], forbid: ["Set time zone", "Change"] },
  { tz: "invalid", expect: ["Saved time zone not recognised", "Set time zone"] },
  { tz: "readerror", expect: ["The business time zone could not be read. Nothing was changed.", "Retry"] },
];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  if (!ok) console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
}
const assertPortFree = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
  probe.once("listening", () => probe.close(resolve));
  probe.listen(PORT, "127.0.0.1");
});
async function stopTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}
// node:http, NOT fetch: fetch honours HTTPS_PROXY and can return a relay page for a dead loopback port.
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

/** Everything measured in the browser for one frame. */
const measure = (selector) => {
  const sec = document.querySelector(selector);
  if (!sec) return null;
  const ctx = document.createElement("canvas").getContext("2d");
  const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  // Composite translucent layers onto the first opaque ancestor, as the eye sees them.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a > 0.99) break; }
    let base = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    return base;
  };
  let worst = { ratio: 99, what: "" };
  for (const el of sec.querySelectorAll("*")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !el.getClientRects().length) continue;
    const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(bgOf(el))].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${String(el.className).slice(0, 30) || el.tagName}:${el.textContent.trim().slice(0, 30)}` };
  }
  const box = sec.getBoundingClientRect();
  const probe = document.createElement("i"); probe.style.color = "var(--pg-gold-core)"; sec.appendChild(probe);
  const gold = getComputedStyle(probe).color; probe.remove();
  return {
    crashed: Boolean(document.querySelector("[data-harness-error]")),
    text: sec.textContent.replace(/\s+/g, " "),
    pushed: [...sec.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).slice(0, 3).map((el) => String(el.className)),
    pageSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    contrast: worst,
    goldResolved: Boolean(gold) && gold !== "rgb(0, 0, 0)",
    gold: [...sec.querySelectorAll("*")].some((el) => { const st = getComputedStyle(el); return [st.color, st.backgroundColor, st.borderTopColor].includes(gold); }),
  };
};

async function open(page, frame, theme, tz) {
  await page.goto(`${BASE}${ROUTE}?theme=${theme}&tz=${tz}`, { waitUntil: "domcontentloaded" });
  await page.locator("#business-time-zone").waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".setup-tz[aria-busy=true]"), null, { timeout: 8000 });
  const fold = page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]');
  // Folding PAIGE hands focus back to the PAIGE command field on a 150ms timer (the shell's
  // contract); let it settle so the drive's keystrokes are not racing it.
  if (frame.paige === "closed" && await fold.isVisible()) { await fold.click(); await page.waitForTimeout(400); }
  await page.locator("#business-time-zone").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  return {
    paigeShown: await page.locator("#tenant-paige-workspace").isVisible().catch(() => false),
  };
}
async function frameChecks(page, id, errors, { expect = [], forbid = [] } = {}) {
  const facts = await page.evaluate(measure, "#business-time-zone");
  check(Boolean(facts) && errors.length === 0 && !facts.crashed, `${id}: renders without error`, JSON.stringify({ errors }));
  check(Boolean(facts) && facts.pushed.length === 0 && !facts.pageSideways, `${id}: nothing spills sideways`, JSON.stringify(facts?.pushed));
  check(Boolean(facts) && facts.contrast.ratio >= 4.5, `${id}: text contrast ≥ 4.5:1 (worst ${facts?.contrast.ratio})`, facts?.contrast.what);
  check(Boolean(facts) && facts.goldResolved && !facts.gold, `${id}: no gold in the section`);
  for (const words of expect) check(facts?.text.includes(words), `${id}: says "${words}"`);
  for (const words of forbid) check(!facts?.text.includes(words), `${id}: does not say "${words}"`);
  return facts;
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/setup-business-context-mount/time-zone.vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { ready = await probeOnce(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);
    browser = await chromium.launch(buildLaunchOptions());
    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const state of STATES) {
          const id = `${theme}/${frame.name}/${state.tz}`;
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          const shell = await open(page, frame, theme, state.tz);
          await frameChecks(page, id, errors, state);
          await page.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-${state.tz}.png`) });
          // At 1080px and below an open PAIGE is the shell's overlay over a dimmed page (by design), so
          // the content is not interactive there; the flow runs wherever the section can be reached.
          const overlaid = frame.width <= 1080 && frame.paige === "open";
          if (state.tz === "missing" && !overlaid) {
            // Pick → confirm → save → read back, with the mouse.
            await page.getByRole("button", { name: /Set time zone/ }).click();
            const picker = page.locator(".setup-tz__picker");
            await picker.waitFor();
            const pickerFacts = await page.evaluate(measure, ".setup-tz__picker");
            check(await picker.getAttribute("data-pg") === theme, `${id}: the picker carries the ${theme} theme`);
            check(Boolean(pickerFacts) && pickerFacts.contrast.ratio >= 4.5, `${id}: picker text contrast ≥ 4.5:1 (worst ${pickerFacts?.contrast.ratio})`, pickerFacts?.contrast.what);
            const pickerBox = await picker.boundingBox();
            check(Boolean(pickerBox) && pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= frame.width + 1, `${id}: the picker stays on screen`, JSON.stringify(pickerBox));
            await picker.getByPlaceholder("Find a city or time zone").fill("Chicago");
            await page.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-picking.png`) });
            await picker.locator("[cmdk-item]", { hasText: "Chicago" }).first().click();
            await page.locator(".setup-tz__confirm").waitFor();
            await frameChecks(page, `${id}/confirm`, errors, { expect: ["Save Central Time — America/Chicago?", "Messages to customers keep following each customer’s own verified time zone", "Save time zone", "Cancel"] });
            await page.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-confirm.png`) });
            await page.getByRole("button", { name: "Save time zone" }).click();
            await page.getByText("Saved and read back from your business record: America/Chicago.").waitFor({ timeout: 5000 });
            await frameChecks(page, `${id}/saved`, errors, { expect: ["Central Time · Chicago", "America/Chicago", "Saved and read back", "Change"], forbid: ["Not set"] });
            await page.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-saved.png`) });
          }
          results.push({ ok: true, name: `${id}: paige panel ${shell.paigeShown ? "shown" : "not shown"}`, detail: "" });
          await ctx.close();
        }
      }
      // Keyboard only, once per theme at the most common laptop frame.
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await open(page, { paige: "closed" }, theme, "missing");
      const id = `${theme}/keyboard`;
      const trigger = page.getByRole("button", { name: /Set time zone/ });
      await trigger.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      await page.waitForTimeout(300); // the shell animates the ring in
      const ring = await trigger.evaluate((el) => ({ focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
      check(ring.focused && ring.outline !== "none" && ring.width >= 2, `${id}: Tab reaches "Set time zone" with a visible ring`, JSON.stringify(ring));
      await page.keyboard.press("Enter");
      await page.locator(".setup-tz__picker").waitFor();
      check(await page.evaluate(() => document.activeElement?.getAttribute("placeholder")) === "Find a city or time zone", `${id}: Enter opens the picker with the search focused`);
      await page.keyboard.type("Denver");
      await page.keyboard.press("Enter");
      await page.locator(".setup-tz__confirm").waitFor();
      check(await page.evaluate(() => document.activeElement?.id) === "setup-tz-confirm-title", `${id}: focus moves to the confirmation`);
      await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
      check(await page.evaluate(() => document.activeElement?.textContent) === "Save time zone", `${id}: Tab, Tab reaches Save`);
      await page.keyboard.press("Enter");
      await page.getByText("Saved and read back from your business record: America/Denver.").waitFor({ timeout: 5000 });
      check(Boolean(await page.evaluate(() => document.activeElement?.textContent?.includes("Saved and read back"))), `${id}: focus lands on the saved notice`);
      check(errors.length === 0, `${id}: no page error`, JSON.stringify(errors));
      await page.screenshot({ path: path.join(OUT, `${theme}-keyboard-saved.png`) });
      await ctx.close();
    }
  } finally {
    await browser?.close();
    await stopTree(vite);
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`${results.length - failed.length}/${results.length} checks passed; frames in ${path.relative(REPO, OUT)}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
