#!/usr/bin/env node
// The Marketing tab strip (formerly Campaigns): the owner's nine tabs (2026-10-04), none of them lost.
//
// WHY THIS EXISTS. A masthead removal moved the truth-key legend into `.campaigns-nav`, where it
// was hidden by a VIEWPORT media query while the space it ate belonged to a container ~500px
// narrower than the viewport — the Solo shell gives this surface
// `viewport - 216px rail - max(340px, 26vw) PAIGE`. On a 1440x900 session that pushed
// "Performance" off the right edge of the strip; at 1366 and 1280 it took "Social" too. The tabs
// were still technically scrollable, but with overlay scrollbars nothing said so, and three of six
// primary destinations looked as though they did not exist. It shipped to production and no gate
// caught it, because the surface's own harness mounts `SalesOps` alone and never renders the nav
// inside the shell's real geometry. This script is that missing gate.
//
// WHAT IT PROVES AND WHAT IT DOES NOT. It renders the REAL `GrowthHub` with only the network read
// stubbed, at the four Solo sizes, in both palettes, with PAIGE both open and closed — so it proves
// the six-tab lock, that no tab is clipped when the strip has room, that EVERY tab can be brought
// into view when it does not, and that the selected tab is never left off screen. It does NOT
// prove the authenticated production surface: §32.c stays owed to a session that can drive the
// deployed app, and this harness must never be reported as having discharged it.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5214;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/campaigns-nav-fit");
const REPO = path.resolve(import.meta.dirname, "../..");

const TABS = ["Overview", "Campaigns", "Audience", "Content", "Social", "Email", "Ads", "Lead capture", "Analytics"];

// The four widths every Solo surface is proved at.
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];

/**
 * The content column this surface actually gets.
 *
 * The base grid is `tenant-command-center-shell.css:1-6` —
 * `216px | minmax(0,1fr) | minmax(340px, 26vw)` — but SOLO OVERRIDES the PAIGE column in
 * `TenantCommandCenterShell.tsx:483`, and modelling the base grid here tested widths that do not
 * occur. Corrected against the component (Codex review on #881, verified against the source):
 *
 *   docked  → minmax(440px, 34vw)     the ordinary Solo session
 *   wide    → minmax(620px, 52vw)     PAIGE expanded — the NARROWEST real content column
 *   closed  → 0px                      PAIGE folded away
 *   overlay → 0px, AND the rail compacts to 72px (`:426-433`, `setNavExpanded(false)`),
 *             forced for every viewport ≤1080px, so PAIGE floats above instead of taking a column
 *
 * The first model subtracted `max(340, 26vw)` at every width and never compacted the rail, so it
 * claimed 920px at 1536 where the real docked column is 798px, and 468px at 1024 where the real
 * overlay leaves 952px. Both numbers were fiction: one easier than production, one harsher.
 */
const RAIL_EXPANDED = 216;
const RAIL_COMPACT = 72;
const PAIGE_OVERLAY_MAX = 1080;

/** Every PAIGE posture a Solo owner can actually put the shell in. */
const POSTURES = ["docked", "wide", "closed"];

function contentWidth(viewport, posture) {
  // Below the breakpoint the shell forces the overlay AND compacts the rail, whatever the
  // posture — PAIGE stops taking a column at all.
  const overlay = viewport <= PAIGE_OVERLAY_MAX;
  const rail = overlay ? RAIL_COMPACT : RAIL_EXPANDED;
  if (overlay || posture === "closed") return Math.floor(viewport - rail);
  const paige = posture === "wide"
    ? Math.max(620, viewport * 0.52)
    : Math.max(440, viewport * 0.34);
  return Math.floor(viewport - rail - paige);
}

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
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
  const gone = () => { try { process.kill(-child.pid, 0); return false; } catch { return true; } };
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* group already gone */ }
  try { process.kill(child.pid, "SIGTERM"); } catch { /* child already gone */ }
  for (let i = 0; i < 20 && !gone(); i++) await new Promise((r) => setTimeout(r, 100));
  if (!gone()) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* raced with exit */ }
    try { process.kill(child.pid, "SIGKILL"); } catch { /* raced with exit */ }
  }
}

/** Wait for THE SURFACE, never for network idleness — this sandbox cannot reach Google Fonts. */
async function open(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main.paige-solo", { timeout: 30000 });
}

/** Constrain the mount to the shell's real content column. The harness has no rail or PAIGE dock. */
async function setContentWidth(page, width) {
  await page.evaluate((px) => {
    let style = document.getElementById("shell-column");
    if (!style) {
      style = document.createElement("style");
      style.id = "shell-column";
      document.head.appendChild(style);
    }
    style.textContent = `main.paige-solo{width:${px}px!important;max-width:${px}px!important;justify-self:start}`;
  }, width);
  await page.waitForTimeout(120);
}

/** Everything the assertions need about the strip, read from the live DOM in one pass. */
async function measureNav(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".campaigns-tabs");
    const nav = document.querySelector(".campaigns-nav");
    const legend = document.querySelector(".campaigns-truth-key");
    if (!strip || !nav) return null;
    const stripBox = strip.getBoundingClientRect();
    const buttons = [...strip.querySelectorAll('[role="tab"]')];
    const inside = (el) => {
      const b = el.getBoundingClientRect();
      return b.left >= stripBox.left - 1 && b.right <= stripBox.right + 1;
    };
    const legendShown = legend ? getComputedStyle(legend).display !== "none" : false;
    const labelCentre = buttons[0]
      ? buttons[0].getBoundingClientRect().top + buttons[0].getBoundingClientRect().height / 2
      : null;
    const legendCentre = legendShown && legend
      ? legend.getBoundingClientRect().top + legend.getBoundingClientRect().height / 2
      : null;
    return {
      navWidth: Math.round(nav.getBoundingClientRect().width),
      tabs: buttons.map((b) => b.textContent.trim()),
      overflowing: strip.scrollWidth > strip.clientWidth + 1,
      clipped: buttons.filter((b) => !inside(b)).map((b) => b.textContent.trim()),
      legendShown,
      // A stretched legend in an `align-items:stretch` row sat 14px above the baseline every
      // other child of that row shares.
      legendOffset: legendCentre === null || labelCentre === null
        ? null : Math.abs(Math.round(legendCentre - labelCentre)),
      selected: strip.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() ?? null,
      selectedVisible: (() => {
        const el = strip.querySelector('[role="tab"][aria-selected="true"]');
        return el ? inside(el) : false;
      })(),
      documentScrollsSideways:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

/**
 * Reachability, proved rather than assumed. A strip that scrolls is fine; a tab you cannot get to
 * is not. Each tab is scrolled into view in turn and must land fully inside the strip.
 */
async function everyTabReachable(page) {
  return page.evaluate((expected) => {
    const strip = document.querySelector(".campaigns-tabs");
    const buttons = [...strip.querySelectorAll('[role="tab"]')];
    const unreachable = [];
    for (const button of buttons) {
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
      const box = strip.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      if (b.left < box.left - 1 || b.right > box.right + 1) unreachable.push(button.textContent.trim());
    }
    strip.scrollLeft = 0;
    return { unreachable, count: buttons.length, expected: expected.length };
  }, TABS);
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });

  const vite = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "--config",
    "scripts/live-drive/harness/catalog-mount/vite.config.ts", "--port", String(PORT), "--strictPort",
  ], { cwd: REPO, stdio: "ignore", detached: true });

  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    // node:http, NOT fetch: fetch honours HTTPS_PROXY and can return a 200 relay page while
    // nothing is listening on loopback at all.
    const probeOnce = () => new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      ready = await probeOnce();
      if (!ready) await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);

    browser = await chromium.launch(buildLaunchOptions());

    // Vite optimises dependencies on the first real page load and can drop in-flight requests
    // while it does. Warm it once, unmeasured.
    const warm = await browser.newContext();
    const warmPage = await warm.newPage();
    await open(warmPage);
    await warm.close();

    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        for (const posture of POSTURES) {
          const width = contentWidth(frame.width, posture);
          const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height } });
          const page = await ctx.newPage();
          const pageErrors = [];
          page.on("pageerror", (e) => pageErrors.push(String(e.message)));
          await open(page);
          if (theme === "dark") { await page.click("[data-theme-toggle]"); await page.waitForTimeout(420); }
          await setContentWidth(page, width);

          const id = `${theme}/${frame.name}/paige-${posture}@${width}px`;
          const nav = await measureNav(page);

          check(Boolean(nav), `${id}: nav mounted`);
          if (!nav) { await ctx.close(); continue; }

          check(pageErrors.length === 0, `${id}: no page errors`, pageErrors[0] ?? "");

          // The locked tab structure, in order. Nothing about this fix may change it.
          check(
            nav.tabs.join("|") === TABS.join("|"),
            `${id}: Marketing tab lock intact`, nav.tabs.join("|"),
          );

          // THE REGRESSION. When the strip has room, nothing may sit outside it.
          if (!nav.overflowing) {
            check(
              nav.clipped.length === 0,
              `${id}: no tab clipped while the strip has room`,
              nav.clipped.length ? `clipped=${nav.clipped.join(",")}` : `nav=${nav.navWidth}px`,
            );
          } else {
            // Six tabs genuinely cannot fit a 344px column. Scrolling is the design; being unable
            // to reach a tab is not.
            check(true, `${id}: strip scrolls by necessity`, `nav=${nav.navWidth}px`);
          }

          // Reachable either way, overflowing or not.
          const reach = await everyTabReachable(page);
          check(
            reach.unreachable.length === 0,
            `${id}: every tab reachable`,
            reach.unreachable.length ? `unreachable=${reach.unreachable.join(",")}` : `${reach.count} tabs`,
          );

          // The legend may never be the reason a tab is off screen.
          check(
            !(nav.legendShown && nav.clipped.length > 0),
            `${id}: legend never costs a tab its place`,
            `legend=${nav.legendShown ? "shown" : "hidden"} clipped=${nav.clipped.length}`,
          );

          // When it IS shown it sits on the row's shared baseline.
          if (nav.legendShown) {
            check(
              nav.legendOffset !== null && nav.legendOffset <= 2,
              `${id}: legend aligned with the tab labels`, `offset=${nav.legendOffset}px`,
            );
          }

          check(!nav.documentScrollsSideways, `${id}: document does not scroll sideways`);

          // Selecting a tab must leave it visible — including one that starts off screen.
          await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('.campaigns-tabs [role="tab"]')];
            buttons[buttons.length - 1].click();
          });
          await page.waitForTimeout(200);
          const after = await measureNav(page);
          check(
            after.selected === TABS[TABS.length - 1],
            `${id}: last tab selects`, String(after.selected),
          );
          check(
            after.selectedVisible,
            `${id}: the selected tab is on screen after selecting it`,
          );

          if (posture === "docked" && theme === "light") {
            await page.screenshot({ path: path.join(OUT, `${frame.name}.png`) });
          }
          await ctx.close();
        }
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopTree(vite);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) console.log(`  ${f.name}  ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`frames written to ${OUT}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
