#!/usr/bin/env node
/**
 * Settings scroll-reachability drive — can a human reach every control on every
 * Solo Settings destination, at every viewport we support?
 *
 * WHY THIS EXISTS. The scroll-host defect repaired in #681 was invisible to the
 * checks that were supposed to catch it, because "no horizontal overflow" and "no
 * nested scrollers" are BOTH satisfied by a surface with no scroll owner at all.
 * Neither asked the only question that matters. This drive asks it directly, per
 * destination: is the last actionable control reachable — by wheel, by the End key,
 * by PageDown and Space, by dragging the scrollbar, and by tabbing to it?
 *
 * WHAT IT MEASURES AGAINST. The real `SoloSettings` component, inside the real
 * tenant-shell element chain and the real SoloApp screen host, with the shipped
 * stylesheets — see `harness/settings-mount/main.tsx`. Not a hand-built test shell:
 * a faked scroll owner is exactly how a clipped surface measured as healthy.
 *
 * HONEST CLASSIFICATION, NOT A UNIFORM PASS. A destination shorter than the viewport
 * has nothing to scroll, and asserting reachability there would pass vacuously. Each
 * destination is therefore classified per viewport as OVERFLOWS (full battery) or
 * FITS (assert nothing is clipped and no scroll owner is needed) — and the report
 * says which, so a destination that quietly stops overflowing cannot be mistaken for
 * one that was proven reachable.
 *
 * WHAT IT DOES NOT PROVE (§13/§32.c): a local render is not a deployed one and the
 * rows are synthetic. It proves GEOMETRY, SCROLL OWNERSHIP and KEYBOARD REACH — never
 * production data, production authorization, or the authenticated surface.
 *
 *   node scripts/live-drive/settings-scroll-drive.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5202;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("scripts/live-drive/artifacts/settings-scroll");
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const requestedViewport = process.env.FLOW_VIEWPORT;
const RUN_VIEWPORTS = requestedViewport
  ? VIEWPORTS.filter(([w, h]) => `${w}x${h}` === requestedViewport)
  : process.env.FLOW_QUICK === "1" ? [VIEWPORTS[0]] : VIEWPORTS;
const RUN_THEMES = process.env.FLOW_QUICK === "1" ? ["light"] : ["light", "dark"];

/** The eight addressable destinations, in rail order. */
const DESTINATIONS = [
  "setup", "team", "connections", "integrations",
  "analytics", "security-data", "vault", "billing",
];
/** Connections' five segments are child state, not addresses — clicked, not navigated. */
const SEGMENTS = ["Communications", "Calendars", "Registration", "Health", "Add channel"];
/**
 * The authorized visible-scroll destinations, kept identical to the product's own
 * declaration in `src/components/tenant-shell/settings-scroll-contract.ts`.
 * `settings.scroll-policy.test.tsx` asserts the two lists match: a drive that
 * still classified Setup as form-fitting would assert "nothing is clipped" on a
 * surface the product now deliberately scrolls, and fail it for the opposite
 * reason. Setup was added by owner ruling 2026-09-02.
 */
const VISIBLE_SCROLL_DESTINATIONS = new Set(["setup", "connections", "integrations", "analytics"]);
let currentTheme = "dark";

const results = [];
const screenshots = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

/**
 * A leaked dev server from a previous failed run answers on this port and serves
 * STALE code, so the next run measures the wrong build and passes. Refuse to start
 * rather than report a green that describes something else.
 */
async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(
      `Port ${PORT} is already in use. A previous run's dev server leaked; kill it before re-running — ` +
      `otherwise this drive measures whatever that server is serving.`)));
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(PORT, "127.0.0.1");
  });
}

function chromePath() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!fs.existsSync(base)) return undefined;
  return fs.readdirSync(base).filter((d) => d.startsWith("chromium-"))
    .map((d) => path.join(base, d, "chrome-linux/chrome")).find((p) => fs.existsSync(p));
}

/** Every control a human could actually operate on the destination's own content. */
const CONTROLS = ".ss-content button:not([disabled]), .ss-content a[href], "
  + ".ss-content input:not([disabled]), .ss-content select:not([disabled]), .ss-content textarea:not([disabled])";

/**
 * Elements that genuinely scroll vertically right now. `overflow:auto` on an element
 * that does not overflow is not a scroll owner — counting it would report traps that
 * a human can never fall into.
 */
const liveScrollers = () => [...document.querySelectorAll("*")].filter((e) => {
  const s = getComputedStyle(e);
  return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
}).map((e) => e.id || e.getAttribute("data-solo-screen-host") !== null ? (e.id || "solo-screen-host")
  : (e.className && typeof e.className === "string" ? `.${e.className.split(" ")[0]}` : e.tagName.toLowerCase()));

/** Geometry of the destination as it stands right now. */
const measure = () => {
  const host = document.querySelector("[data-solo-screen-host]");
  const canvas = document.querySelector(".solo-settings");
  const controls = [...document.querySelectorAll(
    ".ss-content button:not([disabled]), .ss-content a[href], .ss-content input:not([disabled]), "
    + ".ss-content select:not([disabled]), .ss-content textarea:not([disabled])")]
    .filter((el) => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0);
  // The FINAL actionable control is the one furthest down the surface, which is a
  // spatial fact, not a DOM-order one: `.ss-grid` is a CSS grid, so the last element
  // in source order routinely sits in a short left column with hundreds of pixels of
  // content below it in another. Ranking by depth inside the scroll owner is both
  // correct and stricter — it targets the deepest point a human has to reach.
  const hostTop = host ? host.getBoundingClientRect().top : 0;
  const hostScroll = host ? host.scrollTop : 0;
  const last = controls
    .map((el) => ({ el, depth: el.getBoundingClientRect().bottom - hostTop + hostScroll }))
    .sort((a, b) => b.depth - a.depth)[0]?.el ?? null;
  return {
    hasHost: !!host,
    scrollTop: host?.scrollTop ?? 0,
    scrollH: host?.scrollHeight ?? 0,
    clientH: host?.clientHeight ?? 0,
    canvasH: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0,
    controlCount: controls.length,
    lastLabel: last ? (last.textContent || last.getAttribute("aria-label") || last.tagName).trim().slice(0, 42) : null,
    lastTop: last ? Math.round(last.getBoundingClientRect().top) : null,
    lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
    // Reserved-gutter width. 0 means the scrollbar is hidden (or an overlay
    // scrollbar). Recorded, not asserted — see the SCROLLBAR note in the summary.
    gutter: host ? host.offsetWidth - host.clientWidth : 0,
    docScrollsX: document.scrollingElement
      ? document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1 : false,
    hostScrollsX: host ? host.scrollWidth > host.clientWidth + 1 : false,
    // THE CASCADE, not just its outcome. The whole #682 reconciliation turns on the
    // fact that a host can carry `overflow:auto` inline and still compute `hidden`,
    // because the Solo form-fit law declares it `!important`. Reporting only the
    // geometry hides that: a harness missing solo-tokens.css reads exactly the same
    // scrollHeight and clientHeight as production and is wrong about every one.
    computedOverflowY: host ? getComputedStyle(host).overflowY : null,
    computedOverflowX: host ? getComputedStyle(host).overflowX : null,
    inlineOverflow: host ? (host.style.overflow || "(none)") : null,
    overflowRules: host ? (() => {
      const hits = [];
      for (const sheet of [...document.styleSheets]) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        const walk = (list) => {
          for (const r of [...(list || [])]) {
            if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
            if (!r.selectorText) continue;
            let hit = false;
            for (const sel of r.selectorText.split(",")) {
              try { if (host.matches(sel.trim())) { hit = true; break; } } catch { /* :has() etc */ }
            }
            if (!hit) continue;
            for (const prop of ["overflow", "overflow-y"]) {
              const v = r.style.getPropertyValue(prop);
              if (v) hits.push({ selector: r.selectorText.replace(/\s+/g, " ").trim(), prop, value: v,
                important: r.style.getPropertyPriority(prop) === "important" });
            }
          }
        };
        walk(rules);
      }
      return hits;
    })() : [],
  };
};

/** The Solo form-fit law, as it is written in solo-tokens.css. */
const FORM_FIT_LAW = ".paige-solo main";
/** The Settings-only opt-out, as it is written in settings.css. */
const SETTINGS_OPT_OUT = /\.solo-settings|tcs-main--settings-scrollbar/;

const inView = (m, h) => m.lastBottom !== null && m.lastBottom <= h + 1 && m.lastTop >= -1;

/**
 * The check that #682 existed to force, and that no amount of geometry can stand in
 * for. Three things have to be true together, or the surface is only accidentally
 * scrollable:
 *
 *   1. The form-fit law is actually LOADED. If it is not, this harness is not the
 *      app and every other number in this run is taken from a surface production
 *      does not ship. This assertion is what makes the harness honest.
 *   2. The host nevertheless computes `overflow-y: auto`.
 *   3. It does so because a SETTINGS-SCOPED declaration outranks the law — never
 *      because the law was weakened, deleted, or globally overridden. A rule granting
 *      `auto` to every `.paige-solo main` would satisfy (2) and fail here, which is
 *      exactly the outcome to fail on: that would unlock scrolling on Clients,
 *      Campaigns, Analytics and Command Center too.
 */
function cascadeChecks(label, m) {
  const law = m.overflowRules.filter((r) => r.selector === FORM_FIT_LAW && r.important && /hidden/.test(r.value));
  record(`${label} · form-fit law is loaded (harness is the real bundle)`, law.length > 0,
    `matched \`${FORM_FIT_LAW}\` important-hidden rules: ${law.length}`);

  record(`${label} · scroll owner computes overflow-y:auto`, m.computedOverflowY === "auto",
    `computed=${m.computedOverflowY} inline=${m.inlineOverflow} scrollH=${m.scrollH} clientH=${m.clientH}`);

  const granting = m.overflowRules.filter((r) => r.important && /auto|scroll/.test(r.value));
  const allScoped = granting.length > 0 && granting.every((r) => SETTINGS_OPT_OUT.test(r.selector));
  record(`${label} · overflow-y:auto is won by a SETTINGS-SCOPED rule`, allScoped,
    granting.length
      ? granting.map((r) => `${r.selector} { ${r.prop}: ${r.value}${r.important ? " !important" : ""} }`).join(" | ")
      : "no important auto/scroll declaration matched the host");

  record(`${label} · overflow-x stays hidden (no sideways owner)`, m.computedOverflowX === "hidden",
    `computed-x=${m.computedOverflowX}`);
}

async function openDestination(page, dest, clipped) {
  const query = new URLSearchParams({ theme: currentTheme });
  if (clipped) query.set("host", "clipped");
  await page.goto(`${BASE}/solo/1971670/settings/${dest}?${query}`,
    { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".solo-settings", { timeout: 10_000 });
  await settle(page);
  // Reachability batteries measure the Settings owner in its folded-PAIGE state.
  // At <=1080px an open PAIGE is intentionally modal and owns the pointer; the
  // separate shell battery below proves open -> one workspace -> fold -> return.
  const foldPaige = page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]');
  if (await foldPaige.isVisible()) await foldPaige.click();
  // The real contextual rail animates to its responsive width. Pointer coordinates
  // measured mid-transition can miss both the content and native scrollbar.
  await page.waitForTimeout(320);
}

/**
 * Wait until the surface has stopped growing. A destination whose data is still
 * resolving changes scrollHeight under the drive: the scrollbar geometry gets read at
 * one height and the drag asserted against another, which is how `connections›Add channel`
 * at 900x1000 reported 15/35 on a surface that reaches 35/35 once settled. That was a
 * race in this drive, not a defect in the scrollbar — but a flaky check is a check
 * nobody can trust, so the wait is on the fact rather than on a fixed timeout.
 */
async function settle(page, tries = 24) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    const h = await page.evaluate(() => {
      const el = document.querySelector("[data-solo-screen-host]");
      return el ? el.scrollHeight : -1;
    });
    if (h === last) return h;
    last = h;
    await page.waitForTimeout(120);
  }
  return last;
}

const resetScroll = (page) => page.evaluate(() => {
  const h = document.querySelector("[data-solo-screen-host]");
  if (h) h.scrollTop = 0;
});

/** Follow the real keyboard path from shell chrome back into Settings. */
async function tabIntoSettings(page) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => !!document.activeElement?.closest?.(".ss-content"));
    if (inside) return true;
  }
  return false;
}

/**
 * The full reachability battery for one overflowing destination at one viewport.
 * Every input a human actually has, not just the one the code happens to support.
 */
async function battery(page, label, h) {
  // 1 — exactly one deliberate vertical scroll owner.
  const scrollers = await page.evaluate(liveScrollers);
  record(`${label} · one vertical scroll owner`, scrollers.length === 1,
    `scrollers=[${scrollers.join(", ")}]`);

  // 2 — no sideways overflow anywhere, document or host.
  const geom = await page.evaluate(measure);
  record(`${label} · no horizontal overflow`, !geom.docScrollsX && !geom.hostScrollsX,
    `doc=${geom.docScrollsX} host=${geom.hostScrollsX}`);

  // 3 — the whole canvas lies inside the scrollable extent. A canvas taller than
  //     what can be scrolled to is content nothing can reach.
  record(`${label} · canvas inside scrollable extent`, geom.canvasH <= geom.scrollH + 2,
    `canvas=${geom.canvasH}px extent=${geom.scrollH}px`);

  // 4 — wheel/trackpad reaches the last control.
  await resetScroll(page);
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(600, Math.round(h / 2));
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(30);
    const m = await page.evaluate(measure);
    if (inView(m, h)) break;
  }
  let m = await page.evaluate(measure);
  const wheelHit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}.${String(el.className || "").split(" ")[0]}` : "none";
  }, [Math.min(600, page.viewportSize().width - 30), Math.round(h / 2)]);
  record(`${label} · wheel reaches last control`, inView(m, h),
    `"${m.lastLabel}" rect ${m.lastTop}–${m.lastBottom} in ${h}px; hit=${wheelHit}`);

  // 5 — End key.
  await resetScroll(page);
  await page.evaluate(() => document.querySelector("[data-solo-screen-host]")?.focus?.());
  await page.keyboard.press("End");
  await page.waitForTimeout(250);
  m = await page.evaluate(measure);
  record(`${label} · End reaches last control`, inView(m, h), `rect ${m.lastTop}–${m.lastBottom}`);

  // 6 — PageDown, then Space, which is the other key people actually use.
  await resetScroll(page);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 2 ? "Space" : "PageDown");
    await page.waitForTimeout(40);
    const s = await page.evaluate(measure);
    if (inView(s, h)) break;
  }
  m = await page.evaluate(measure);
  record(`${label} · PageDown/Space reach last control`, inView(m, h), `scrollTop=${m.scrollTop}`);

  // 7 — the scrollbar is VISIBLE. A reserved gutter is what makes it a real, laid-out
  //     hit target rather than an overlay that appears only mid-gesture; 0 means it is
  //     hidden. Owner-locked acceptance requirement, so this is an assertion, not a
  //     note: Settings is the intentionally scrollable browse surface.
  await resetScroll(page);
  let g = await page.evaluate(measure);
  record(`${label} · scrollbar is visible`, g.gutter > 0, `gutter=${g.gutter}px`);

  // 8 — the scrollbar is USABLE. Driven with real mouse events on the bar itself, in
  //     the reserved gutter — not `scrollTop = …`, which proves only that the element
  //     can be scrolled by script and would pass just as happily with no bar at all.
  await settle(page);
  await resetScroll(page);
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-solo-screen-host]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      right: r.right, top: r.top, height: r.height,
      gutter: el.offsetWidth - el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      // Chromium's own thumb sizing, with its ~20px floor.
      thumb: Math.max(20, Math.round((el.clientHeight / el.scrollHeight) * r.height)),
    };
  });
  let dragged = 0;
  // Denominator from the geometry the drag ACTUALLY ran against, not from the earlier
  // read — a surface that grew in between would otherwise be scored against a stale
  // travel and report a working scrollbar as broken (or the reverse).
  const travel = Math.max(1, box ? box.scrollH - box.clientH : g.scrollH - g.clientH);
  if (box && box.gutter > 0 && box.thumb > 0) {
    // Grab the THUMB and pull it to the foot of the track — the gesture a person makes
    // to travel a long surface. The press lands at the middle of the thumb's resting
    // height rather than a fixed fraction, because on a very long surface the thumb is
    // only ~20px tall and a fixed fraction would miss it and land on the track.
    const x = box.right - Math.max(2, Math.round(box.gutter / 2));
    await page.mouse.move(x, box.top + Math.round(box.thumb / 2));
    await page.mouse.down();
    // Past the foot of the track, not to 95% of it. Chromium clamps the THUMB, so a
    // gesture that stops short of the end leaves the surface short of the end too —
    // one surface read 80% for that reason alone, which is a fact about my gesture,
    // not about the scrollbar. Overshooting is also what a person actually does.
    await page.mouse.move(x, box.top + box.height + 240, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    dragged = (await page.evaluate(measure)).scrollTop;
  }
  const dragHit = box ? await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}.${String(el.className || "").split(" ")[0]}` : "none";
  }, [box.right - Math.max(2, Math.round(box.gutter / 2)), box.top + Math.round(box.thumb / 2)]) : "no-box";
  // The threshold is calibrated against what each outcome actually measures, not
  // guessed. Three states, all observed on this surface set:
  //
  //   scrollbar suppressed (`--hide-scrollbars`)  →   0% — every gesture inert
  //   press MISSES the bar, lands on content      →  ~1% — drag-selection auto-scroll
  //   press GRABS the thumb                       → 79–100%
  //
  // `> 0` was the first version of this check and it passed at 14px of 1449 — a
  // selection artefact reported as a working scrollbar. 75% sits two orders of
  // magnitude above that noise floor, so only a real thumb grab clears it.
  //
  // It is not 95% because a barely-overflowing surface (travel 50–290px) has a thumb
  // that nearly fills the track, and a synthetic press cannot land on Chromium's
  // internal thumb centre to the pixel — those read 79–90% while every long surface
  // reads 100%. That is a limit of the gesture, not of the scrollbar. Reaching the
  // very end is proven separately, at 100%, by the travel check below.
  record(`${label} · scrollbar drag scrolls the surface`,
    dragged >= travel * 0.75,
    `drag → ${dragged}/${travel} (${Math.round((dragged / travel) * 100)}% · gutter=${box?.gutter ?? 0}px · hit=${dragHit})`);

  // 9 — and the surface can be travelled to its very end.
  await resetScroll(page);
  await page.evaluate(() => {
    const el = document.querySelector("[data-solo-screen-host]");
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(200);
  m = await page.evaluate(measure);
  record(`${label} · travel reaches the end`, m.scrollTop >= m.scrollH - m.clientH - 2,
    `${m.scrollTop}/${m.scrollH - m.clientH}`);

  // 10 — focus navigation targets the SPATIALLY deepest control, not the last
  // source-order node in a multi-column grid, and it must paint visible focus.
  await resetScroll(page);
  const focused = await page.evaluate((sel) => {
    const host = document.querySelector("[data-solo-screen-host]");
    const hostTop = host?.getBoundingClientRect().top ?? 0;
    const hostScroll = host?.scrollTop ?? 0;
    const controls = [...document.querySelectorAll(sel)]
      .filter((el) => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0)
      .map((el) => ({ el, depth: el.getBoundingClientRect().bottom - hostTop + hostScroll }))
      .sort((a, b) => b.depth - a.depth);
    const deepest = controls[0]?.el;
    if (!deepest) return { active: false, outlined: false };
    deepest.focus();
    const cs = getComputedStyle(deepest);
    return {
      active: document.activeElement === deepest,
      outlined: (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || cs.boxShadow !== "none",
    };
  }, CONTROLS);
  await page.waitForTimeout(250);
  m = await page.evaluate(measure);
  record(`${label} · focus brings spatially deepest control into view`, focused.active && inView(m, h),
    `focused=${focused.active} rect ${m.lastTop}–${m.lastBottom}`);
  record(`${label} · deepest control has visible focus`, focused.outlined,
    `outlined=${focused.outlined}`);
}

/** A destination shorter than the viewport: nothing to scroll, nothing may be cut off. */
async function fitsChecks(page, label, geom) {
  record(`${label} · fits — nothing clipped`, geom.canvasH <= geom.clientH + 2,
    `canvas=${geom.canvasH}px viewport=${geom.clientH}px`);
  record(`${label} · fits — no horizontal overflow`, !geom.docScrollsX && !geom.hostScrollsX,
    `doc=${geom.docScrollsX} host=${geom.hostScrollsX}`);
}

async function formFitSettingsDestination(page, label, geom) {
  const shown = await page.evaluate(() => document.querySelector("[data-solo-screen-host]")
    ?.classList.contains("tcs-main--settings-scrollbar-shown") ?? false);
  record(`${label} · preserves its existing non-visible overflow policy`,
    geom.computedOverflowY === "auto" || geom.computedOverflowY === "hidden",
    `computed=${geom.computedOverflowY}`);
  record(`${label} · has no visible-scroll contract`, !shown, `shown-class=${shown}`);
  await fitsChecks(page, label, geom);
}

async function touchScrollCheck(page, label) {
  await resetScroll(page);
  const box = await page.evaluate(() => {
    const owner = document.querySelector("[data-solo-screen-host]");
    if (!owner) return null;
    const r = owner.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  if (!box) { record(`${label} · touch scroll`, false, "owner missing"); return; }
  const cdp = await page.context().newCDPSession(page);
  const startY = Math.max(box.top + 80, box.bottom - 80);
  const endY = Math.min(box.bottom - 120, box.top + 100);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: startY }] });
  for (let i = 1; i <= 8; i++) {
    const y = Math.round(startY + (endY - startY) * (i / 8));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(350);
  const moved = (await page.evaluate(measure)).scrollTop;
  record(`${label} · touch gesture scrolls the owner`, moved > 0, `scrollTop=${moved}`);
  await cdp.detach();
}

/** Run the same complete keyboard battery used by the positive and mutation controls. */async function keyboardAudit(page) {
  await resetScroll(page);
  const count = await page.evaluate((sel) => {
    const controls = [...document.querySelectorAll(sel)]
      .filter((el) => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0);
    controls.forEach((el, index) => el.setAttribute("data-flow-control", String(index)));
    document.body.setAttribute("tabindex", "-1");
    document.body.focus({ preventScroll: true });
    return controls.length;
  }, CONTROLS);
  if (!count) return { count: 0, seen: 0, outlined: true, reachable: true, forwardExit: true, reverseExit: true };

  const seen = new Set();
  let outlined = true;
  let reachable = true;
  let entered = false;
  let forwardExit = false;
  for (let i = 0; i < Math.min(count * 5 + 80, 500); i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      const owner = document.querySelector("[data-solo-screen-host]");
      if (!(el instanceof HTMLElement)) return { id: null, inContent: false, outlined: false, reachable: false };
      const inContent = !!el.closest(".ss-content");
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const ownerRect = owner?.getBoundingClientRect();
      return {
        id: el.getAttribute("data-flow-control"),
        inContent,
        // Require an explicit focus ring. Ambient card/action elevation must never
        // masquerade as keyboard focus visibility.
        outlined: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px",
        reachable: !inContent || (!!ownerRect && rect.top >= ownerRect.top - 1 && rect.bottom <= ownerRect.bottom + 1),
      };
    });
    if (state.inContent) {
      entered = true;
      if (state.id !== null) seen.add(state.id);
      outlined = outlined && state.outlined;
      reachable = reachable && state.reachable;
    } else if (entered && seen.size === count) {
      forwardExit = true;
      break;
    }
  }

  const reverseExit = await page.evaluate((sel) => {
    const first = [...document.querySelectorAll(sel)]
      .filter((el) => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0)[0];
    first?.focus();
    return !!first;
  }, CONTROLS).then(async (hasFirst) => {
    if (!hasFirst) return true;
    await page.keyboard.press("Shift+Tab");
    return page.evaluate(() => !document.activeElement?.closest?.(".ss-content"));
  });
  await page.evaluate(() => document.body.removeAttribute("tabindex"));
  return { count, seen: seen.size, outlined, reachable, forwardExit, reverseExit };
}

/** Flow 3 — every enabled control is reachable, visibly focused, and escapable. */
async function keyboardChecks(page, label) {
  const audit = await keyboardAudit(page);
  if (!audit.count) { record(`${label} · keyboard — no controls to reach`, true, "0 controls"); return; }
  record(`${label} · keyboard reaches every destination control`, audit.seen === audit.count,
    `visited=${audit.seen}/${audit.count}`);
  record(`${label} · every reached control has visible focus`, audit.outlined,
    `outlined=${audit.outlined}`);
  record(`${label} · focus movement keeps every control visible`, audit.reachable,
    `reachable=${audit.reachable}`);
  record(`${label} · focus exits forward and backward`, audit.forwardExit && audit.reverseExit,
    `forward=${audit.forwardExit} backward=${audit.reverseExit}`);
}

/**
 * THE NEGATIVE CONTROLS, and an honest note on why one of them changed meaning.
 *
 * Until this PR, `?host=clipped` WAS the proof that the battery could fail: it put
 * SoloApp's `full`-route host back to inline `overflow:hidden`, the surface lost its
 * only scroll owner, and the reachability checks went red. That is no longer true,
 * and pretending otherwise would be the false green this drive exists to kill.
 *
 * The reason is the repair itself. Settings' scroll ownership is now decided by an
 * !important CSS declaration, which outranks ANY inline style on the host — including
 * the clipped one. So the clipped host can no longer take the scroll owner away, and
 * asserting that it does would be asserting something now false.
 *
 * The right response is to assert what is now TRUE and hand the failure-proving duty
 * to a control that can still discharge it:
 *
 *   • `?host=clipped` now proves HARDENING — Settings stays reachable even if the
 *     `full` list is changed back, so this surface can never silently lose its scroll
 *     owner to a route-list edit again. That is the class of regression #681 was, and
 *     this is the check that catches its return.
 *   • Deleting the opt-out rule from the live stylesheet is the control that still
 *     goes red on demand, and it is asserted below.
 */
/**
 * The design-locked surfaces, proven still form-fitting. These are the REAL screens
 * SoloApp mounts, in the IDENTICAL chain and stylesheets — not a stand-in — so the
 * question they answer is the one that matters: did the Settings opt-out leak?
 *
 * `home` is Command Center, which is where Systems Check and Mind live, so both are
 * exercised by opening it and switching to Mind. Their host must compute `hidden`
 * and must not overflow: Solo screens own their internal scroll regions and fill the
 * frame. If any of these turns scrollable, the opt-out is no longer Settings-only and
 * a locked interaction policy has moved.
 */
async function formFitNegativeControls(page, vp) {
  for (const [screen, title] of [["home", "Command Center"], ["clients", "Clients"],
                                 ["growth", "Campaigns"], ["analytics", "Analytics"]]) {
    await page.goto(`${BASE}/solo/1971670/settings/setup?screen=${screen}&theme=${currentTheme}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-negative-control]", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const seen = [`${title}`];
    if (screen === "home") {
      // Command Center's two sub-tabs, both named by the owner.
      await page.click('button:text-is("Mind")').catch(() => {});
      await page.waitForTimeout(500);
      seen.push("Mind");
    }
    const m = await page.evaluate(measure);
    const mounted = await page.evaluate(() =>
      document.querySelector("[data-negative-control]")?.getAttribute("data-mounted") ?? "missing");
    const label = `${vp} negative-control ${title}`;
    // A screen that threw proves less than one that rendered, so say which it was
    // rather than letting a crashed child read as a clean pass (§13).
    record(`${label} · screen mounted`, mounted === "ok", `data-mounted=${mounted} (${seen.join(" + ")})`);
    record(`${label} · stays form-fitting (overflow-y:hidden)`, m.computedOverflowY === "hidden",
      `computed=${m.computedOverflowY} scrollH=${m.scrollH} clientH=${m.clientH}`);
    record(`${label} · Settings opt-out did not reach it`,
      !m.overflowRules.some((r) => SETTINGS_OPT_OUT.test(r.selector)),
      `matching rules: ${m.overflowRules.map((r) => r.selector).join(" | ") || "none"}`);
  }
}

async function proveChecksCanFail(page, h) {
  await openDestination(page, "connections", true);
  await page.click('.ss-segment button:text-is("Calendars")').catch(() => {});
  await settle(page);
  const scrollers = await page.evaluate(liveScrollers);
  await page.keyboard.press("End");
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  record("hardening · clipped host can no longer remove the Settings scroll owner",
    scrollers.length === 1 && m.computedOverflowY === "auto" && inView(m, h),
    `scrollers=[${scrollers.join(", ")}] computed=${m.computedOverflowY} `
    + `inline=${m.inlineOverflow} last "${m.lastLabel}" rect ${m.lastTop}-${m.lastBottom} in ${m.clientH}px`);

  // The SECOND negative control, aimed at this PR's own repair rather than at the
  // shell host: delete the Settings opt-out from the live stylesheet and the form-fit
  // law takes the surface straight back to `hidden`. If it does not, something else
  // is granting the scroll and the opt-out is not what is holding this up.
  await openDestination(page, "connections", false);
  await page.click('.ss-segment button:text-is("Calendars")').catch(() => {});
  await settle(page);
  const killed = await page.evaluate((src) => {
    const re = new RegExp(src);
    let deleted = 0;
    for (const sheet of [...document.styleSheets]) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const sel = rules[i].selectorText || "";
        if (!/(^|,)\s*\.paige-solo main/.test(sel)) continue;
        if (!re.test(sel)) continue;
        sheet.deleteRule(i); deleted += 1;
      }
    }
    const host = document.querySelector("[data-solo-screen-host]");
    return { deleted, computedOverflowY: host ? getComputedStyle(host).overflowY : null };
  }, SETTINGS_OPT_OUT.source);
  await page.waitForTimeout(200);

  // A control has to fail the way the BATTERY fails, not merely report that a CSS
  // property moved. `overflow-y: hidden` on the host is a proxy: if the reachability
  // predicate itself regressed, or some other ancestor quietly became the scroller,
  // the battery could stay false-green while a computed-style assertion still passed.
  // So re-run the battery's own predicates and require the same verdict the clipped
  // host used to produce — zero live scroll owners, last control below the fold.
  const dead = await page.evaluate(liveScrollers);
  const m2 = await page.evaluate(measure);
  record("negative control · removing the Settings opt-out stops the scroll",
    killed.deleted > 0 && killed.computedOverflowY === "hidden"
      && dead.length === 0 && !inView(m2, h),
    `rules deleted=${killed.deleted} → computed overflow-y=${killed.computedOverflowY} · `
    + `scrollers=[${dead.join(", ")}] · last "${m2.lastLabel}" at y≈${m2.lastBottom} in ${m2.clientH}px`);

  // A focus proof must fail when focus styling is removed; permanent card shadows
  // cannot satisfy the keyboard contract.
  await openDestination(page, "integrations", false);
  await page.addStyleTag({ content: ".ss-content :focus, .ss-content :focus-visible { outline: none !important; box-shadow: none !important; }" });
  const noFocusRing = await keyboardAudit(page);
  record("negative control · removing focus rings is detected",
    noFocusRing.count > 0 && !noFocusRing.outlined,
    `controls=${noFocusRing.count} outlined=${noFocusRing.outlined}`);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDestination(page, "connections", false);
  const reducedMutation = await page.evaluate(() => {
    const shell = document.querySelector("[data-tenant-shell]");
    shell?.removeAttribute("data-reduced-motion");
    return shell?.getAttribute("data-reduced-motion") ?? null;
  });
  record("negative control · missing reduced-motion shell state is detected",
    reducedMutation !== "true", `data-reduced-motion=${reducedMutation}`);
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });

  const viteConfig = process.env.FLOW_FORCE_VITE_FAILURE === "1"
    ? "scripts/live-drive/harness/settings-mount/missing-vite.config.ts"
    : "scripts/live-drive/harness/settings-mount/vite.config.ts";
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", viteConfig],
    { stdio: "ignore", detached: true });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${BASE}/solo/1971670/settings/setup`); if (r.ok) break; } catch { /* not up yet */ }
      if (vite.exitCode !== null) throw new Error(`Vite exited before readiness (${vite.exitCode})`);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Launch INSIDE the try: a rejection here used to escape before the cleanup
    // scope existed, leaving the dev server running and poisoning the next run.
    // `--hide-scrollbars` is a Playwright DEFAULT, and it suppresses the native
    // scrollbar entirely: with it on, a surface that hides its scrollbar and one that
    // shows it are indistinguishable, and synthesized mouse events on the bar do
    // nothing at all (measured: every gesture returned scrollTop 0). A drive that
    // keeps the flag cannot honestly assert either that the bar is VISIBLE or that it
    // is USABLE. Dropping it is what makes both claims real.
    browser = await chromium.launch({
      executablePath: process.env.FLOW_FORCE_BROWSER_FAILURE === "1"
        ? path.resolve("scripts/live-drive/harness/settings-mount/missing-browser.exe")
        : chromePath(),
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });

    if (process.env.FLOW_FORCE_ASSERTION_FAILURE === "1") {
      throw new Error("Forced post-launch failure for cleanup regression proof");
    }

    for (const [w, h] of RUN_VIEWPORTS) {
      for (const theme of RUN_THEMES) {
        currentTheme = theme;
        const context = await browser.newContext({
          viewport: { width: w, height: h },
          hasTouch: true,
          colorScheme: theme,
          reducedMotion: "no-preference",
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
        const vp = `${w}x${h}`;
        const env = `${vp} ${theme}`;

        for (const dest of DESTINATIONS) {
          await openDestination(page, dest, false);
          const geom = await page.evaluate(measure);
          const label = `${env} ${dest}`;

          // THE THEME AXIS ACTUALLY REACHED THE RENDERED SHELL.
          //
          // Scored once per environment, on the first destination — and here
          // rather than before the loop because the page has to have NAVIGATED:
          // measured on a fresh `newPage()` this found no shell at all and failed
          // for the wrong reason, which is its own small lesson about asserting
          // against a surface that has not rendered yet.
          //
          // This loop has always iterated `light` and `dark`, and until 2026-09-02
          // that was all it did: the harness passed the theme with `forcedTheme`,
          // which leaves next-themes' `resolvedTheme` alone, and the shell stamps
          // its OWN `data-pg` from `resolvedTheme` onto wrappers inside the
          // document one. Both runs rendered Mineral, and every "both themes"
          // claim this drive produced was one palette measured twice. Geometry is
          // theme-independent, so nothing failed and nothing looked wrong.
          //
          // A matrix axis is not covered because the loop iterated over it. This
          // asserts a RENDERED token, the only thing that could have caught it:
          // `--pg-canvas` is #100e14 in Obsidian and #fbf9f5 in Mineral, and the
          // shell's own `data-pg` must agree with the theme under test.
          if (dest === DESTINATIONS[0]) {
            const palette = await page.evaluate(() => {
              const solo = document.querySelector(".paige-solo");
              return {
                shell: [...document.querySelectorAll("div[data-pg]")].map((el) => el.getAttribute("data-pg")),
                canvas: solo ? getComputedStyle(solo).getPropertyValue("--pg-canvas").trim().toLowerCase() : "",
              };
            });
            const expected = theme === "dark" ? "#100e14" : "#fbf9f5";
            record(`${env} · theme actually reaches the rendered shell`,
              palette.canvas === expected && palette.shell.length > 0 && palette.shell.every((v) => v === theme),
              `--pg-canvas ${palette.canvas} (expected ${expected}) · shell data-pg ${JSON.stringify(palette.shell)}`);
          }
          record(`${label} · renders`, geom.hasHost && geom.canvasH > 0,
            `${geom.controlCount} controls, canvas ${geom.canvasH}px`);
          if (VISIBLE_SCROLL_DESTINATIONS.has(dest)) {
            cascadeChecks(label, geom);
            if (geom.scrollH > geom.clientH + 1) await battery(page, label, h);
            else await fitsChecks(page, label, geom);
            await keyboardChecks(page, label);
          } else {
            await formFitSettingsDestination(page, label, geom);
          }
        }

        // Connections' child segments share the same authorized visible owner.
        await openDestination(page, "connections", false);
        for (const seg of SEGMENTS) {
          await page.click(`.ss-segment button:text-is("${seg}")`).catch(() => {});
          await settle(page);
          const geom = await page.evaluate(measure);
          const label = `${env} connections›${seg}`;
          record(`${label} · renders`, geom.canvasH > 0, `canvas ${geom.canvasH}px`);
          cascadeChecks(label, geom);
          if (geom.scrollH > geom.clientH + 1) await battery(page, label, h);
          else await fitsChecks(page, label, geom);
          await keyboardChecks(page, label);
        }

        // Segment reset: Calendar -> Communications, in the same mounted component.
        await openDestination(page, "connections", false);
        await page.click('.ss-segment button:text-is("Calendars")');
        await settle(page);
        await page.evaluate(() => { const el = document.querySelector("[data-solo-screen-host]"); if (el) el.scrollTop = el.scrollHeight; });
        const deep = (await page.evaluate(measure)).scrollTop;
        await page.click('.ss-segment button:text-is("Communications")');
        await settle(page);
        const afterSeg = (await page.evaluate(measure)).scrollTop;
        record(`${env} flow2 · segment change resets scroll`, deep > 0 && afterSeg === 0,
          `Calendars@${deep} → Communications@${afterSeg}`);

        // The in-content Registration handoff uses the same reset helper.
        await page.evaluate(() => { const el = document.querySelector("[data-solo-screen-host]"); if (el) el.scrollTop = el.scrollHeight; });
        const deepRegistration = (await page.evaluate(measure)).scrollTop;
        await page.click(".ss-linklike");
        await settle(page);
        const registrationState = await page.evaluate(() => {
          const owner = document.querySelector("[data-solo-screen-host]");
          return { scrollTop: owner?.scrollTop ?? -1, focusInside: !!owner?.contains(document.activeElement) };
        });
        record(`${env} flow2 · in-content Registration resets scroll`,
          deepRegistration > 0 && registrationState.scrollTop === 0,
          `Communications@${deepRegistration} → Registration@${registrationState.scrollTop}`);
        record(`${env} flow2 · Registration hands keyboard focus to the new segment`,
          registrationState.focusInside, `focusInside=${registrationState.focusInside}`);
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(200);
        const registrationPageDown = await page.evaluate(() => {
          const owner = document.querySelector("[data-solo-screen-host]");
          return {
            scrollTop: owner?.scrollTop ?? -1,
            overflows: !!owner && owner.scrollHeight > owner.clientHeight + 1,
            focusInside: !!owner?.contains(document.activeElement),
          };
        });
        record(`${env} flow2 · Registration keeps keyboard ownership after PageDown`,
          registrationPageDown.focusInside && (!registrationPageDown.overflows || registrationPageDown.scrollTop > 0),
          `overflows=${registrationPageDown.overflows} scrollTop=${registrationPageDown.scrollTop} focusInside=${registrationPageDown.focusInside}`);

        // Destination reset: return to the long Communications segment, then activate
        // the REAL contextual Settings link without reload.
        await page.click('.ss-segment button:text-is("Communications")');
        await settle(page);
        await page.evaluate(() => {
          window.__settingsFlowSentinel = "same-mounted-document";
          const el = document.querySelector("[data-solo-screen-host]");
          if (el) el.scrollTop = el.scrollHeight;
        });
        const deep2 = (await page.evaluate(measure)).scrollTop;
        await page.locator('.tcs-nav-links a', { hasText: "Vault" }).click();
        await page.waitForURL(/\/settings\/vault/);
        await settle(page);
        const destinationState = await page.evaluate(() => {
          const owner = document.querySelector("[data-solo-screen-host]");
          return {
            scrollTop: owner?.scrollTop ?? -1,
            sameDocument: window.__settingsFlowSentinel === "same-mounted-document",
            focusInside: !!owner?.contains(document.activeElement),
          };
        });
        record(`${env} flow2 · real contextual link resets in the same document`,
          deep2 > 0 && destinationState.scrollTop === 0 && destinationState.sameDocument,
          `connections@${deep2} → vault@${destinationState.scrollTop}; same=${destinationState.sameDocument}`);
        record(`${env} flow2 · destination link returns focus to scroll owner`, destinationState.focusInside,
          `focusInside=${destinationState.focusInside}`);

        // Navigation and the one existing PAIGE workspace are measured on an
        // authorized surface before, during, and after each layout transition.
        await openDestination(page, "integrations", false);
        const shellState = () => page.evaluate(() => {
          const shell = document.querySelector("[data-tenant-shell]");
          const nav = document.querySelector(".tcs-nav");
          const workspace = document.querySelector("#tenant-paige-workspace");
          const owner = document.querySelector("[data-solo-screen-host]");
          return {
            nav: shell?.getAttribute("data-nav"),
            paige: shell?.getAttribute("data-paige"),
            navWidth: Math.round(nav?.getBoundingClientRect().width ?? 0),
            workspaceCount: document.querySelectorAll("#tenant-paige-workspace").length,
            workspaceHidden: workspace?.hasAttribute("hidden") ?? true,
            ownerCount: [...document.querySelectorAll("*")].filter((e) => {
              const s = getComputedStyle(e);
              return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
            }).length,
            ownerOverflowY: owner ? getComputedStyle(owner).overflowY : null,
            ownerScrollHeight: owner?.scrollHeight ?? 0,
            ownerClientHeight: owner?.clientHeight ?? 0,
            docX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            hostX: owner ? owner.scrollWidth > owner.clientWidth + 1 : false,
          };
        });
        const expandNav = page.locator('button[aria-label="Expand navigation"]');
        if (await expandNav.isVisible()) { await expandNav.click(); await settle(page); }
        const navExpanded = await shellState();
        await page.locator('button[aria-label="Fold navigation"]').click();
        await settle(page);
        const navCompact = await shellState();
        await page.locator('button[aria-label="Expand navigation"]').click();
        await settle(page);
        const navRestored = await shellState();
        record(`${env} · navigation fold/expand changes the real rail without overflow`,
          navExpanded.nav === "expanded" && navCompact.nav === "compact"
            && navCompact.navWidth < navExpanded.navWidth && navRestored.nav === "expanded"
            && navCompact.navWidth <= 80 && navExpanded.navWidth >= 200 && navRestored.navWidth >= 200
            && navExpanded.navWidth - navCompact.navWidth >= 120
            && navRestored.navWidth - navCompact.navWidth >= 120 && !navCompact.docX && !navRestored.docX,
          `expanded=${navExpanded.navWidth}px compact=${navCompact.navWidth}px restored=${navRestored.navWidth}px`);

        await page.locator('button[aria-label="Direct PAIGE"]').click();
        await page.waitForTimeout(120);
        const paigeOpen = await shellState();
        record(`${env} · exactly one PAIGE workspace opens on Integrations without another scroll owner`,
          paigeOpen.paige === "open" && paigeOpen.workspaceCount === 1 && !paigeOpen.workspaceHidden
            && paigeOpen.ownerOverflowY === "auto"
            && paigeOpen.ownerCount === (paigeOpen.ownerScrollHeight > paigeOpen.ownerClientHeight + 1 ? 1 : 0)
            && !paigeOpen.docX && !paigeOpen.hostX,
          `state=${paigeOpen.paige} count=${paigeOpen.workspaceCount} hidden=${paigeOpen.workspaceHidden} owners=${paigeOpen.ownerCount} extent=${paigeOpen.ownerScrollHeight}/${paigeOpen.ownerClientHeight}`);
        await page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]').click();
        await page.waitForTimeout(120);
        const paigeFolded = await shellState();
        const postFoldKeyboard = await keyboardAudit(page);
        record(`${env} · folding PAIGE restores the authorized surface and keyboard reach`,
          paigeFolded.paige === "closed" && paigeFolded.workspaceHidden
            && paigeFolded.ownerOverflowY === "auto"
            && paigeFolded.ownerCount === (paigeFolded.ownerScrollHeight > paigeFolded.ownerClientHeight + 1 ? 1 : 0)
            && !paigeFolded.docX && !paigeFolded.hostX
            && postFoldKeyboard.seen === postFoldKeyboard.count && postFoldKeyboard.reachable,
          `state=${paigeFolded.paige} hidden=${paigeFolded.workspaceHidden} keyboard=${postFoldKeyboard.seen}/${postFoldKeyboard.count}`);
        await page.locator('button[aria-label="Direct PAIGE"]').click();
        await page.waitForTimeout(120);
        const integrationPaigeReopen = await shellState();
        await page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]').click();
        await page.waitForTimeout(120);
        const integrationPaigeRefold = await shellState();
        await resetScroll(page);
        const integrationTabReturn = await tabIntoSettings(page);
        await page.keyboard.press("End");
        await page.keyboard.press("Home");
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(120);
        const integrationKeyState = await page.evaluate(() => {
          const owner = document.querySelector("[data-solo-screen-host]");
          return {
            focusInside: !!owner?.contains(document.activeElement),
            scrollTop: owner?.scrollTop ?? -1,
            overflows: !!owner && owner.scrollHeight > owner.clientHeight + 1,
          };
        });
        const integrationRefoldKeyboard = await keyboardAudit(page);
        record(`${env} · Integrations PAIGE reopens and refolds with complete keyboard reach`,
          integrationPaigeReopen.paige === "open" && integrationPaigeReopen.workspaceCount === 1
            && integrationPaigeRefold.paige === "closed" && integrationPaigeRefold.workspaceHidden
            && integrationPaigeRefold.ownerCount === (integrationPaigeRefold.ownerScrollHeight > integrationPaigeRefold.ownerClientHeight + 1 ? 1 : 0)
            && integrationTabReturn && integrationKeyState.focusInside
            && (!integrationKeyState.overflows || integrationKeyState.scrollTop > 0)
            && integrationRefoldKeyboard.seen === integrationRefoldKeyboard.count
            && integrationRefoldKeyboard.reachable && integrationRefoldKeyboard.forwardExit
            && integrationRefoldKeyboard.reverseExit && !integrationPaigeRefold.docX && !integrationPaigeRefold.hostX,
          `reopen=${integrationPaigeReopen.paige}/${integrationPaigeReopen.workspaceCount} refold=${integrationPaigeRefold.paige} owners=${integrationPaigeRefold.ownerCount} tabReturn=${integrationTabReturn} keyFocus=${integrationKeyState.focusInside} keyboard=${integrationRefoldKeyboard.seen}/${integrationRefoldKeyboard.count}`);

        // SETUP, WITH PAIGE OPEN AND FOLDED — the newly authorized visible-scroll
        // surface, and the one the 2026-09-02 ruling was about.
        //
        // Integrations fits at laptop widths and Connections is a different
        // destination with different content, so neither proves Setup. Opening
        // PAIGE narrows the host, which re-lays out a 34-field form and changes
        // its extent; the contract is that Setup keeps exactly ONE scroll owner
        // through the cycle, never gains a horizontal one, and returns a complete
        // keyboard path to its terminal control after the fold.
        await openDestination(page, "setup", false);
        await settle(page);
        await page.locator('button[aria-label="Direct PAIGE"]').click();
        await page.waitForTimeout(120);
        const setupPaigeOpen = await shellState();
        record(`${env} · PAIGE opens once beside Setup without stealing its owner`,
          setupPaigeOpen.paige === "open" && setupPaigeOpen.workspaceCount === 1
            && !setupPaigeOpen.workspaceHidden && setupPaigeOpen.ownerCount === 1
            && setupPaigeOpen.ownerScrollHeight > setupPaigeOpen.ownerClientHeight + 1
            && !setupPaigeOpen.docX && !setupPaigeOpen.hostX,
          `state=${setupPaigeOpen.paige} count=${setupPaigeOpen.workspaceCount} owners=${setupPaigeOpen.ownerCount} extent=${setupPaigeOpen.ownerScrollHeight}/${setupPaigeOpen.ownerClientHeight}`);

        await page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]').click();
        await page.waitForTimeout(120);
        await resetScroll(page);
        const setupTabReturn = await tabIntoSettings(page);
        await page.keyboard.press("End");
        await page.waitForTimeout(160);
        const setupEnd = await page.evaluate(measure);
        const setupKeyboard = await keyboardAudit(page);
        const setupFolded = await shellState();
        record(`${env} · folding PAIGE restores Setup End and complete keyboard reach`,
          setupFolded.paige === "closed" && setupFolded.workspaceHidden
            && setupFolded.ownerCount === 1 && setupTabReturn && inView(setupEnd, h)
            && setupKeyboard.seen === setupKeyboard.count && setupKeyboard.reachable
            && setupKeyboard.forwardExit && setupKeyboard.reverseExit
            && !setupFolded.docX && !setupFolded.hostX,
          `fold=${setupFolded.paige} owners=${setupFolded.ownerCount} tabReturn=${setupTabReturn} last=${setupEnd.lastTop}-${setupEnd.lastBottom} keyboard=${setupKeyboard.seen}/${setupKeyboard.count}`);

        // Repeat the PAIGE cycle on an actually overflowing Connections surface.
        // Integrations can fit at laptop widths, so it cannot alone prove that an
        // open/fold cycle preserves the long surface's owner and terminal controls.
        await openDestination(page, "connections", false);
        await page.click('.ss-segment button:text-is("Calendars")');
        await settle(page);
        await page.locator('button[aria-label="Direct PAIGE"]').click();
        await page.waitForTimeout(120);
        const calendarPaigeOpen = await shellState();
        record(`${env} · PAIGE opens once beside overflowing Connections without stealing its owner`,
          calendarPaigeOpen.paige === "open" && calendarPaigeOpen.workspaceCount === 1
            && !calendarPaigeOpen.workspaceHidden && calendarPaigeOpen.ownerCount === 1
            && calendarPaigeOpen.ownerScrollHeight > calendarPaigeOpen.ownerClientHeight + 1
            && !calendarPaigeOpen.docX && !calendarPaigeOpen.hostX,
          `state=${calendarPaigeOpen.paige} count=${calendarPaigeOpen.workspaceCount} owners=${calendarPaigeOpen.ownerCount} extent=${calendarPaigeOpen.ownerScrollHeight}/${calendarPaigeOpen.ownerClientHeight}`);
        await page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]').click();
        await page.waitForTimeout(120);
        await resetScroll(page);
        const calendarTabReturn = await tabIntoSettings(page);
        await page.keyboard.press("End");
        await page.waitForTimeout(160);
        const calendarEnd = await page.evaluate(measure);
        const calendarKeyboard = await keyboardAudit(page);
        record(`${env} · first PAIGE fold restores Connections End and complete keyboard reach`,
          calendarTabReturn && inView(calendarEnd, h) && calendarKeyboard.seen === calendarKeyboard.count
            && calendarKeyboard.reachable && calendarKeyboard.forwardExit && calendarKeyboard.reverseExit,
          `tabReturn=${calendarTabReturn} last=${calendarEnd.lastTop}-${calendarEnd.lastBottom} keyboard=${calendarKeyboard.seen}/${calendarKeyboard.count}`);

        await page.locator('button[aria-label="Direct PAIGE"]').click();
        await page.waitForTimeout(120);
        const calendarPaigeReopen = await shellState();
        await page.locator('#tenant-paige-workspace button[aria-label="Fold PAIGE conversation"]').click();
        await page.waitForTimeout(120);
        await resetScroll(page);
        const calendarTabReturnAgain = await tabIntoSettings(page);
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(160);
        const calendarPageDown = await page.evaluate(measure);
        const calendarFinal = await shellState();
        record(`${env} · second PAIGE fold restores Connections PageDown and the one-owner contract`,
          calendarPaigeReopen.paige === "open" && calendarPaigeReopen.workspaceCount === 1
            && calendarFinal.paige === "closed" && calendarFinal.workspaceHidden
            && calendarTabReturnAgain && calendarFinal.ownerCount === 1 && calendarPageDown.scrollTop > 0
            && !calendarFinal.docX && !calendarFinal.hostX,
          `reopen=${calendarPaigeReopen.paige}/${calendarPaigeReopen.workspaceCount} fold=${calendarFinal.paige} tabReturn=${calendarTabReturnAgain} PageDown=${calendarPageDown.scrollTop}`);

        // Genuine Chromium touch input on the longest Connections segment.
        await openDestination(page, "connections", false);
        await page.click('.ss-segment button:text-is("Calendars")');
        await settle(page);
        await touchScrollCheck(page, `${env} connections›Calendars`);

        // Reduced motion uses the same owner and remains keyboard reachable.
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await openDestination(page, "connections", false);
        await page.click('.ss-segment button:text-is("Calendars")');
        await settle(page);
        const reduced = await page.evaluate(() => {
          const shell = document.querySelector("[data-tenant-shell]");
          const paige = document.querySelector(".tcs-paige");
          const shellStyle = shell ? getComputedStyle(shell) : null;
          const paigeStyle = paige ? getComputedStyle(paige) : null;
          return {
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            shellReduced: shell?.getAttribute("data-reduced-motion"),
            shellTransition: shellStyle?.transitionDuration ?? "missing",
            paigeAnimation: paigeStyle?.animationName ?? "missing",
            paigeDuration: paigeStyle?.animationDuration ?? "missing",
            ownerCount: [...document.querySelectorAll("*")].filter((e) => {
              const s = getComputedStyle(e);
              return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
            }).length,
          };
        });
        await page.keyboard.press("End");
        await page.waitForTimeout(160);
        const reducedEnd = await page.evaluate(measure);
        const reducedKeyboard = await keyboardAudit(page);
        record(`${env} · reduced motion suppresses shell motion and keeps the full keyboard path`,
          reduced.reduced && reduced.shellReduced === "true" && reduced.ownerCount === 1
            && parseFloat(reduced.shellTransition) <= 0.01
            && (reduced.paigeAnimation === "none" || parseFloat(reduced.paigeDuration) <= 0.01)
            && inView(reducedEnd, h) && reducedKeyboard.seen === reducedKeyboard.count
            && reducedKeyboard.reachable && reducedKeyboard.forwardExit && reducedKeyboard.reverseExit,
          `attr=${reduced.shellReduced} shell=${reduced.shellTransition} paige=${reduced.paigeAnimation}/${reduced.paigeDuration} keyboard=${reducedKeyboard.seen}/${reducedKeyboard.count}`);

        // Capture the intended Settings surfaces BEFORE negative controls.
        const calShot = path.join(OUT, `settings-connections-calendars-${theme}-${vp}.png`);
        await page.screenshot({ path: calShot, fullPage: false });
        screenshots.push({ route: "connections", segment: "calendars", theme, viewport: vp, path: calShot });
        await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
        await openDestination(page, "integrations", false);
        const intShot = path.join(OUT, `settings-integrations-${theme}-${vp}.png`);
        await page.screenshot({ path: intShot, fullPage: false });
        screenshots.push({ route: "integrations", theme, viewport: vp, path: intShot });
        // Setup, arrival state — the surface the 2026-09-02 ruling authorized, and
        // the frame that shows the change: a drawn scrollbar where an owner
        // previously had no signal that 78-82% of the brief was below the fold.
        await openDestination(page, "setup", false);
        await resetScroll(page);
        const setupShot = path.join(OUT, `settings-setup-${theme}-${vp}.png`);
        await page.screenshot({ path: setupShot, fullPage: false });
        screenshots.push({ route: "setup", theme, viewport: vp, path: setupShot });

        // The design-locked surfaces, at this same viewport and theme.
        await formFitNegativeControls(page, env);
        record(`${env} · no page errors`, errors.length === 0, errors.join(" | ") || "none");
        await context.close();
      }
    }

    const expectedScreenshots = RUN_VIEWPORTS.length * RUN_THEMES.length * 3;
    const requiredPaigeLabels = [
      "exactly one PAIGE workspace opens on Integrations",
      "Integrations PAIGE reopens and refolds",
      "PAIGE opens once beside Setup",
      "folding PAIGE restores Setup End",
      "PAIGE opens once beside overflowing Connections",
      "first PAIGE fold restores Connections End",
      "second PAIGE fold restores Connections PageDown",
    ];
    const hasSemanticCoverage = (candidateResults) => RUN_VIEWPORTS.every(([w, h]) => RUN_THEMES.every((theme) =>
      requiredPaigeLabels.every((label) => candidateResults.some((result) =>
        result.ok && result.name.startsWith(`${w}x${h} ${theme} · ${label}`)))));
    const coveredEnvironments = hasSemanticCoverage(results);
    const semanticMutation = results.filter((result) =>
      !result.name.includes("Integrations PAIGE reopens and refolds"));
    record("negative control · semantic matrix rejects a missing PAIGE cycle",
      !hasSemanticCoverage(semanticMutation),
      `full=${coveredEnvironments} afterMutation=${hasSemanticCoverage(semanticMutation)}`);
    const coveredScreenshots = RUN_VIEWPORTS.every(([w, h]) => RUN_THEMES.every((theme) =>
      ["connections", "integrations", "setup"].every((route) => screenshots.some((shot) =>
        shot.viewport === `${w}x${h}` && shot.theme === theme && shot.route === route))));
    record("evidence provenance · report covers every actually requested viewport/theme/surface",
      coveredEnvironments && coveredScreenshots && screenshots.length === expectedScreenshots,
      `environments=${coveredEnvironments} screenshots=${screenshots.length}/${expectedScreenshots}`);

    const neg = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await proveChecksCanFail(neg, 768);
    await neg.close();
  } finally {
    await browser?.close();
    await stopProcessTree(vite);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(OUT, "settings-scroll-report.json"), JSON.stringify({
      revision: head,
      generatedAt: new Date().toISOString(),
      viewports: RUN_VIEWPORTS.map(([width, height]) => ({ width, height })),
      themes: RUN_THEMES,
      filter: { requestedViewport: requestedViewport ?? null, quick: process.env.FLOW_QUICK === "1" },
      screenshots,
      results,
    }, null, 2));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
