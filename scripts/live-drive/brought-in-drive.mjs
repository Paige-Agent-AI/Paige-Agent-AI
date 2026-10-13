#!/usr/bin/env node
// Campaigns › dossier › campaign map › Brought in (Experience 03 S1d-1), rendered for real.
//
// WHAT IT PROVES. It mounts the REAL GrowthHub (src/solo/growth2.tsx) through the Marketing harness
// (scripts/live-drive/harness/marketing-mount) with only network reads stubbed — the leads read by
// leads-supabase-stub.ts — opens the Spring campaign's dossier and renders the map's Brought in lane in every state
// (populated owner, member, no leads with forms attached, no leads and no form, read failed, and — S1d-2 — the
// per-lead list opened by an owner and by a member), in both
// themes, at the eight canonical Solo frames (PAIGE open and closed) and a phone. For each frame it asserts: no page error, no harness crash,
// nothing spilling sideways out of the dossier, measured WCAG contrast of the section's text against what
// is painted behind it, and the exact words that state must say. Frames land in artifacts/brought-in.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions or the authenticated production surface (§32.c);
// the server rules are proven by supabase/tests/campaign_lead_attribution.sql.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5224;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/brought-in");
const REPO = path.resolve(import.meta.dirname, "../..");
// The content-column model the Solo shell hands Marketing (as marketing-views-drive.mjs and
// campaigns-nav-fit-drive.mjs, TenantCommandCenterShell.tsx:483): the eight canonical Solo frames with
// PAIGE docked open or closed, plus a phone.
function contentWidth(viewport, posture) {
  const overlay = viewport <= 1080;
  const rail = overlay ? 72 : 216;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  return Math.floor(viewport - rail - Math.max(440, viewport * 0.34));
}
const FRAMES = [
  ...[[1536, 770], [1366, 768], [1024, 768], [900, 1000]].flatMap(([width, height]) => ["closed", "open"].map((posture) => ({
    name: `${width}x${height}-paige-${posture}`, width, height, content: contentWidth(width, posture === "open" ? "docked" : "closed"),
  }))),
  { name: "phone-390", width: 390, height: 844, content: 390 },
];
const STATES = [
  { mode: "populated", query: "", expect: ["Brought in", "What came of it", "7leads credited to this campaign", "5opportunities · open Sales", "—No figure:Revenue lives in Sales", "2 leads on this campaign’s forms also fit another campaign, so they aren’t counted here."], forbid: ["won", "$"] },
  { mode: "readonly", query: "", expect: ["7leads credited to this campaign", "5opportunities"], forbid: ["Renée Okafor"] },
  { mode: "populated", query: "&leads=empty", name: "empty", forbid: ["open Sales"], expect: ["0leads credited to this campaign", "0opportunities—No figure:", "No leads yet. A lead is credited when someone fills in this campaign’s form or arrives by its tagged link."] },
  { mode: "populated", query: "&leads=noform", name: "noform", expect: ["No leads yet. Attach a live form people sign up on, or share the campaign’s tagged link, and leads are credited as they arrive."] },
  { mode: "populated", query: "&leads=error", name: "error", expect: ["The leads this campaign brought in couldn’t load.", "Try again"], forbid: ["0leads"] },
  // S1d-2 (owner-approved 2026-10-12): the per-lead list, opened under the counts. Names come from the server only.
  { mode: "populated", query: "", name: "open-owner", open: true, expect: ["Hide the leads", "Stages are in Client pipeline, in Sales.", "Renée Okafor", "Being saved as a contact", "Campaign form, tagged link · Discovery call request"], forbid: ["Owners and admins see who each lead is.", "$"] },
  { mode: "readonly", query: "", name: "open-member", open: true, expect: ["Hide the leads", "A lead", "Owners and admins see who each lead is."], forbid: ["Renée Okafor", "Marcus Lindqvist", "Being saved as a contact", "Not saved as a contact"] },
];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`);
}
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(PORT, "127.0.0.1");
  });
}
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

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
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
          const id = `${theme}/${frame.name}/${state.name ?? state.mode}`;
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, reducedMotion: "reduce" });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          // The dossier is opened from the list, which the harness reads in its populated shape.
          await page.goto(`${BASE}?tab=campaigns&theme=${theme}&mode=${state.mode}${state.query}`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(".campaigns-scroll, [data-harness-error]", { timeout: 30000 });
          await page.addStyleTag({ content: `main.paige-solo{width:${Math.floor(frame.content)}px!important;max-width:${Math.floor(frame.content)}px!important}` });
          await page.locator(".pf-row", { hasText: "Spring advisory intake" }).locator("button", { hasText: "Open dossier" }).first().click();
          const section = page.locator(".dw .cc-out");
          await section.waitFor({ timeout: 8000 });
          await page.waitForFunction(() => !document.querySelector(".dw .cc-out .campaigns-skeleton"), null, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(150);
          if (!state.open) {
            const closed = section.locator(".cl-toggle");
            const shown = await closed.count();
            check(state.name === "empty" || state.name === "noform" || state.name === "error" ? shown === 0 : shown === 1 && await closed.getAttribute("aria-expanded") === "false" && await section.locator(".cl-row").count() === 0,
              `${id}: the lead list stays closed until asked (and is absent with no leads)`);
          } else {
            const toggle = section.locator(".cl-toggle");
            // Keyboard: reach the toggle from the element before it, see its ring, and open it with Enter.
            await toggle.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
            await page.waitForTimeout(300);
            const ring = await toggle.evaluate((el) => ({ focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
            check(ring.focused && ring.outline !== "none" && ring.width >= 2, `${id}: the lead list toggle is reached by keyboard and shows its focus ring`, JSON.stringify(ring));
            await page.keyboard.press("Enter");
            await page.waitForTimeout(150);
            const rows = await section.locator(".cl-row").count();
            check(await toggle.getAttribute("aria-expanded") === "true" && rows === 7 && await page.locator(`#${await toggle.getAttribute("aria-controls")}`).count() === 1,
              `${id}: Enter opens the newest leads, announced as expanded`, JSON.stringify({ rows }));
            check(await section.locator(".cl-row :is(button, a, input, select, textarea, [tabindex], [role=button], [role=link])").count() === 0, `${id}: the rows are read only`);
          }
          await section.scrollIntoViewIfNeeded();
          const text = ((await section.textContent()) ?? "").replace(/\s+/g, " ");
          const facts = await page.evaluate(() => {
            const sec = document.querySelector(".dw .cc-out");
            const dw = document.querySelector(".dw");
            if (!sec || !dw) return null;
            const box = dw.getBoundingClientRect();
            const ctx = document.createElement("canvas").getContext("2d");
            const rgb = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
            const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
            const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
            let worst = { ratio: 99, what: "" };
            for (const el of sec.querySelectorAll("h5, .cc-h span, .cc-outv dt, .cc-outv dd, .cc-lnk, .cc-foot, .cc-empty, .cl-toggle, .cl-in, .cl-n, .cl-when, .cl-via, .cl-state")) {
              const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(bgOf(el))].sort((x, y) => y - x);
              const ratio = (hi + 0.05) / (lo + 0.05);
              if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.className || el.tagName}:${el.textContent.trim().slice(0, 30)}` };
            }
            return {
              crashed: Boolean(document.querySelector("[data-harness-error]")),
              sideways: dw.scrollWidth > dw.clientWidth + 1,
              pushed: [...sec.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1; }).slice(0, 3).map((el) => String(el.className)),
              contrast: worst,
              // Gold is the act colour (§11): no text, fill or border in the lane may resolve to it.
              gold: (() => {
                const probe = document.createElement("i"); probe.style.color = "var(--gold)"; sec.appendChild(probe);
                const gold = getComputedStyle(probe).color; probe.remove();
                if (!gold || gold === "rgb(0, 0, 0)") return true; // the token didn't resolve: fail loudly, not silently
                return [...sec.querySelectorAll("*")].some((el) => { const st = getComputedStyle(el); return [st.color, st.backgroundColor, st.borderTopColor].includes(gold) || /gold|champagne/i.test(String(el.className)); });
              })(),
            };
          });
          check(Boolean(facts) && errors.length === 0 && !facts.crashed, `${id}: renders without error`, JSON.stringify({ errors, crashed: facts?.crashed }));
          check(Boolean(facts) && !facts.sideways && facts.pushed.length === 0, `${id}: nothing spills out of the dossier`, JSON.stringify(facts?.pushed));
          check(Boolean(facts) && facts.contrast.ratio >= 4.5, `${id}: section text contrast ≥ 4.5:1 (worst ${facts?.contrast.ratio})`, facts?.contrast.what);
          check(Boolean(facts) && !facts.gold, `${id}: no gold in the lane`);
          const missing = state.expect.filter((phrase) => !text.includes(phrase));
          check(missing.length === 0, `${id}: says what this state must say`, JSON.stringify({ missing, text: text.slice(0, 400) }));
          const leaked = (state.forbid ?? []).filter((phrase) => /^\w+$/.test(phrase) ? new RegExp(`\\b${phrase}\\b`, "i").test(text) : text.includes(phrase));
          check(leaked.length === 0, `${id}: shows nothing this viewer may not see`, JSON.stringify(leaked));
          await section.screenshot({ path: path.join(OUT, `${theme}-${frame.name}-${state.name ?? state.mode}.png`) });
          if (!state.name && state.mode === "populated") {
            // Keyboard: the Sales link is reached by Tab from the element before it and shows its focus ring.
            const link = section.locator(".cc-lnk");
            await link.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
            await page.waitForTimeout(300);
            const ring = await link.evaluate((el) => ({ focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
            check(ring.focused && ring.outline !== "none" && ring.width >= 2, `${id}: open Sales is reached by keyboard and shows its focus ring`, JSON.stringify(ring));
          }
          if (state.name === "error") {
            // Keyboard: reach the one control from the element before it, see its focus ring, and press it.
            const retry = section.locator("button", { hasText: "Try again" });
            await retry.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
            // .paige-solo .btn transitions every property for 150ms, outline included: measure once settled.
            await page.waitForTimeout(300);
            const ring = await retry.evaluate((el) => ({ focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
            check(ring.focused && ring.outline !== "none" && ring.width >= 2, `${id}: Try again is reached by keyboard and shows its focus ring`, JSON.stringify(ring));
            await page.keyboard.press("Enter");
            await page.waitForTimeout(150);
            check(await section.locator("[role=alert]").count() === 1, `${id}: pressing it retries (the stub keeps failing, so the alert stays)`);
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await stopTree(vite);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Frames: ${OUT}`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
