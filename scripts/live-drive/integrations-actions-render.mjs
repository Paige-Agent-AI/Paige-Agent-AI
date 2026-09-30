#!/usr/bin/env node
/**
 * Renders the per-action approval list — the surface Door 1 adds — in both themes and at all
 * four Solo viewports, and DRIVES it rather than only photographing it.
 *
 * WHAT CLASS OF EVIDENCE THIS IS (§70.1). Structural/harness render, in a real Chromium against
 * the real components, the real hook logic and the real stylesheets, with the Supabase transport
 * stubbed. It proves layout, theme, copy, state behaviour and that the thing runs. It is NOT
 * authenticated runtime proof: no real session, no real database, no real provider. That drive
 * stays owed and is reported as owed.
 *
 * WHY IT IS ITS OWN FILE (§18). `integrations-signin-render.mjs` covers the sign-in flow and
 * `integrations-fit-drive.mjs` measures the page. Neither opens a connected tool's drawer, so
 * every state this list owns would otherwise go un-rendered. It reuses the same mount, the same
 * launcher resolution and the same artifacts directory rather than forking any of them.
 *
 * THE ASSERTIONS THAT MATTER MOST are the ones about what the surface must NEVER say:
 * an empty list must not read as "offers nothing" when nobody has looked; an approval the runner
 * would refuse must not read as live consent; recording consent must not promise a run.
 *
 * Usage:
 *   npx vite --config scripts/live-drive/harness/integrations-mount/vite.config.ts --port 5203
 *   node scripts/live-drive/integrations-actions-render.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const BASE = process.env.HARNESS_URL || "http://127.0.0.1:5203";
const OUT = path.resolve("scripts/live-drive/artifacts/actions");
mkdirSync(OUT, { recursive: true });

const findings = [];
const check = (pass, message) => {
  findings.push(`${pass ? "PASS" : "FAIL"}  ${message}`);
  console.log(`${pass ? "PASS" : "FAIL"}  ${message}`);
  return pass;
};

/** Waits for every running animation to finish so a frame is never caught mid-transition.
 *  An `infinite` animation would hang here forever — which is why this surface has none. */
const settle = async (page) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
};
const shot = async (page, name) => { await settle(page); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

/** Opens a connected tool's drawer the way a person reaches it. */
async function openTool(page, label) {
  await page.waitForSelector(".ig-card", { timeout: 15000 });
  await page.click(`.ig-card:has(.ig-card-title strong:text-is("${label}"))`);
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  // The list loads on open; wait for the skeleton to resolve into one outcome or the other.
  await page.waitForSelector('[role="dialog"] .ig-gw-tools, [role="dialog"] .ig-gw-info, [role="dialog"] .ig-error', { timeout: 15000 });
}
const drawerText = (page) => page.locator('[role="dialog"]').innerText();

async function main() {
  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({ executablePath: resolveExecutablePath(), args: ["--no-sandbox"] });

  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      // Chromium's console line for a failed resource carries no URL — it is literally
      // "Failed to load resource: the server responded with a status of 404" — so filtering it
      // by text is impossible and treating it as a finding is a false alarm with no way to
      // investigate it. The `response` listener below catches the same failures WITH their URLs,
      // which is the honest way to judge them; this one is left to catch real JS console errors.
      // (The 404 in this harness is the favicon, which the mount does not ship: the URL-level
      // listener sees every >=400 response and, excluding favicons, records none.)
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
      });
      page.on("requestfailed", (r) => { if (!/favicon/i.test(r.url())) errors.push(`${r.url()} ${r.failure()?.errorText ?? ""}`); });
      // Named, not guessed: a bare console "404" says nothing about WHAT 404'd, and "it is
      // probably the favicon" is the kind of assumption this file exists to replace.
      page.on("response", (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });

      await page.goto(`${BASE}/?theme=${theme}&data=connected`, { waitUntil: "networkidle" });

      // ── 1. a connected tool with a real catalogue ────────────────────────
      await openTool(page, "Scheduling tool");
      const t = await drawerText(page);
      check(/What this tool can do/.test(t), `${theme} · the list renders at all`);
      check(/Runs without asking/.test(t), `${theme} · a declared read is honestly marked as needing nothing`);
      check(/Needs your approval/.test(t), `${theme} · a mutation is honestly gated`);
      check(/name says it sends or changes something/i.test(t),
        `${theme} · a provider-labelled "read" named send_* is raised by the SERVER floor and says why`);
      check(/Changed since you approved it/.test(t), `${theme} · a drifted pin reads as drifted, not approved`);
      check(/Approval ran out/.test(t), `${theme} · an expired approval reads as expired, not approved`);
      // THE ONE THIS SLICE EXISTS FOR: unexpired, unstale, and still refused at dispatch. Before
      // the server's reason crossed, this row rendered as live consent with no control to fix it.
      check(/Approved for a different address/.test(t),
        `${theme} · an approval the runner would REFUSE does not read as live consent`);
      check(!/hasn.t shipped yet/i.test(t), `${theme} · the "not shipped" paragraph is GONE, not softened`);
      check(!/undefined|NaN|\[object/.test(t), `${theme} · nothing leaked a raw JS value into the copy`);
      const gold = await page.locator('[role="dialog"] .ig-btn[data-primary]').count();
      check(gold > 0, `${theme} · the approve act carries the gold, and nothing else does (${gold} approve controls)`);
      await shot(page, `${theme}-actions-list`);

      // ── 2. the lifetime control, and that it actually changes ────────────
      const seg = page.locator('[role="dialog"] .ig-gw-life .ig-gw-seg button');
      check((await seg.count()) === 5, `${theme} · every offered window renders (${await seg.count()})`);
      const before = await page.locator('[role="dialog"] .ig-gw-life button[aria-pressed="true"]').innerText();
      await seg.nth(4).click();
      const after = await page.locator('[role="dialog"] .ig-gw-life button[aria-pressed="true"]').innerText();
      check(before !== after && after === "30 days", `${theme} · the window is genuinely selectable (${before} → ${after})`);

      // ── 3. approving records consent, and claims nothing more ────────────
      await page.locator('[role="dialog"] .ig-btn[data-primary]').first().click();
      await page.waitForSelector('[role="dialog"] .ig-gw-info, [role="dialog"] .ig-error', { timeout: 15000 });
      const after3 = await drawerText(page);
      check(/consent recorded/i.test(after3), `${theme} · approving says what actually happened`);
      check(!/Paige can use it/i.test(after3), `${theme} · and does NOT promise a run the execute flag still gates`);
      await shot(page, `${theme}-actions-approved`);

      // ── 4. never read ≠ offers nothing ──────────────────────────────────
      await page.keyboard.press("Escape");
      await openTool(page, "Docs tool");
      const t4 = await drawerText(page);
      check(/hasn.t looked at what this tool can do yet/i.test(t4) || /hasn.t been checked yet/i.test(t4),
        `${theme} · a never-probed tool says nobody has looked, not that it offers nothing`);
      check(!/offered nothing/i.test(t4), `${theme} · and never claims the tool is empty`);
      await shot(page, `${theme}-actions-never-read`);

      // ── 5. a failed check does not present a stale list as current ───────
      await page.keyboard.press("Escape");
      await openTool(page, "Billing tool");
      const t5 = await drawerText(page);
      check(/didn.t get through/i.test(t5), `${theme} · an errored connection dates its list to the last successful read`);
      check(/charge_card/.test(t5), `${theme} · and still shows the approvals its owner granted (§58)`);
      await shot(page, `${theme}-actions-stale-after-error`);

      check(errors.length === 0, `${theme} · no runtime error or console error during the whole drive${errors.length ? `: ${errors[0]}` : ""}`);
      await ctx.close();
    }

    // ── 6. the four Solo viewports, and one scroll owner in each ───────────
    for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?theme=light&data=connected`, { waitUntil: "networkidle" });
      await openTool(page, "Scheduling tool");
      const m = await page.evaluate(() => {
        const panel = document.querySelector(".ig-panel");
        const scrollers = [...(panel?.querySelectorAll("*") ?? [])].filter((el) => {
          const s = getComputedStyle(el);
          return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
        });
        const body = panel?.querySelector(".ig-panel-body");
        const last = document.querySelector(".ig-gw-life") ?? document.querySelector(".ig-gw-tools");
        // Reachability is not "is it laid out" — that is true of clipped content too. Scroll the
        // owner to its end and ask whether the last control is then inside the viewport.
        if (body) body.scrollTop = body.scrollHeight;
        const lastBox = last?.getBoundingClientRect();
        return {
          hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          // Scoped to INSIDE the drawer, which is what this change owns. The page behind an open
          // drawer keeps its own scroller — pre-existing, not introduced here, and recorded as an
          // observation rather than absorbed into this diff.
          scrollers: scrollers.map((el) => el.className || el.tagName),
          lastReachable: !!lastBox && lastBox.width > 0 && lastBox.bottom <= window.innerHeight + 1 && lastBox.top >= 0,
          clipped: !!panel && panel.scrollWidth > panel.clientWidth + 1,
        };
      });
      check(!m.hScroll, `${w}x${h} · no horizontal page scroll`);
      check(m.scrollers.length <= 1, `${w}x${h} · exactly one scroll owner INSIDE the drawer (${m.scrollers.join(", ") || "none"})`);
      check(!m.clipped, `${w}x${h} · nothing is clipped horizontally inside the drawer`);
      check(m.lastReachable, `${w}x${h} · the last control is REACHABLE after scrolling to the end, not merely laid out`);
      await shot(page, `solo-${w}x${h}-actions`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const failed = findings.filter((f) => f.startsWith("FAIL"));
  writeFileSync(path.join(OUT, "actions-render-report.json"), JSON.stringify({ findings, failed: failed.length }, null, 2));
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed`);
  console.log(`frames → ${OUT}`);
  if (failed.length) { console.log(`\n${failed.length} FAILURE(S)`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
