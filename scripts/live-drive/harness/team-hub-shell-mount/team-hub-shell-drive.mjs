// EXP08 A2a — the Team Hub task card's "Open delivery work" link and the inert approval card, measured inside
// the REAL SoloApp shell (see main.tsx). Closes the Codex P1 on #3029: the A2a evidence rendered Team Hub in a
// stand-in shell and left seven of eight SOLO records UNVERIFIED.
//
// Serve first:  npx vite --config scripts/live-drive/harness/team-hub-shell-mount/vite.config.ts
// Then:         node scripts/live-drive/harness/team-hub-shell-mount/team-hub-shell-drive.mjs
//
// Every number is measured BEFORE the "harness render · not live" label is burned in, and a frame is refused
// if its label is not verifiably on screen. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE · NOT AUTHENTICATED.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const OUT = process.env.OUT ?? "docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2a-shell";
const BASE = process.env.HARNESS_URL ?? "http://127.0.0.1:5297";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const TENANTS = { a: { key: "a", account: "3855", name: "Harbor Lane Studio" }, b: { key: "b", account: "4120", name: "Juniper Row Consulting" } };
const report = { generated: new Date().toISOString(), harness: `${BASE} (scripts/live-drive/harness/team-hub-shell-mount, real SoloApp)`, label: "harness render · not live", records: [], states: [], interactions: [], failures: [] };
const fail = (what) => { report.failures.push(what); console.error(`FAIL ${what}`); };

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: opts.dsf ?? 1, reducedMotion: opts.reducedMotion ?? "no-preference" });
  const page = await context.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) page.__errors.push(m.text().slice(0, 300)); });
  return page;
}

async function paigeState(page) { return page.evaluate(() => document.querySelector("[data-tenant-shell][data-paige]")?.getAttribute("data-paige")); }
/** The shell's own controls: the "Direct PAIGE" command field opens it, Escape (the shell's fold) closes it. */
async function setPaige(page, want) {
  for (let i = 0; i < 2 && (await paigeState(page)) !== want; i += 1) {
    if (want === "open") await page.locator("[data-tenant-paige-command]").click();
    else { await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur()); await page.keyboard.press("Escape"); }
    await page.waitForTimeout(450);
  }
  const got = await paigeState(page);
  if (got !== want) fail(`PAIGE did not reach ${want} (is ${got})`);
  return got;
}

async function openTeamHub(page, { tenant, theme, tr = "read", paige = "closed" }) {
  await page.goto(`${BASE}/solo/${tenant.account}/team-hub?theme=${theme}&tr=${tr}${tenant.key === "b" ? "&tenant=b" : ""}`);
  await page.waitForSelector(".th-hub .th-list", { timeout: 60000 });
  await setPaige(page, "closed");
  await page.locator(".th-list .th-conv-item", { hasText: /^daily-management$/ }).first().click();
  await page.waitForSelector(".th-src .th-src-foot", { timeout: 15000 });
  await page.waitForTimeout(600);
  if (paige === "open") await setPaige(page, "open");
  await page.mouse.move(1, 1);
  await page.waitForTimeout(250);
}

/** Geometry of the link, measured where it is: scroll owner, every clipping ancestor, cover, page overflow. */
const MEASURE = () => {
  const describe = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.hasAttribute?.("data-solo-screen-host") ? "[data-solo-screen-host]" : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}` : null;
  const link = document.querySelector(".th-src a.th-src-open");
  const card = document.querySelector(".th-src");
  const shell = document.querySelector("[data-tenant-shell][data-paige]");
  const host = document.querySelector("[data-solo-screen-host]");
  const doc = document.documentElement;
  const out = {
    url: location.pathname,
    paige: shell?.getAttribute("data-paige"), paigeOverlay: Boolean(document.querySelector(".tcs-paige-backdrop")) && getComputedStyle(shell).getPropertyValue("--tcs-paige").trim() === "0px",
    nav: shell?.getAttribute("data-nav"),
    pageOverflowXpx: doc.scrollWidth - doc.clientWidth, pageOverflowYpx: doc.scrollHeight - doc.clientHeight,
    screenHost: host ? { overflow: getComputedStyle(host).overflowY, scrolls: host.scrollHeight > host.clientHeight + 1, w: Math.round(host.clientWidth), h: Math.round(host.clientHeight) } : null,
    href: link?.getAttribute("href") ?? null, linkText: link?.innerText.trim() ?? null,
    cardText: card?.innerText.replace(/\s+/g, " ").trim().slice(0, 240) ?? null,
  };
  if (!link) return out;
  const scrollables = [];
  for (let el = link.parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) scrollables.push(describe(el));
  }
  // The element that WOULD scroll the link (overflow auto/scroll), whether or not the content overflows it now.
  let designated = null;
  for (let el = link.parentElement; el && !designated; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) designated = el;
  out.scrollOwner = describe(designated) ?? "none";
  out.scrollOwnerOverflowing = designated ? designated.scrollHeight > designated.clientHeight + 1 : false;
  out.scrollableAncestors = scrollables;
  const visibility = () => {
    const r = link.getBoundingClientRect();
    const clippedBy = [];
    for (let el = link.parentElement; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = el.getBoundingClientRect();
      if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) clippedBy.push(describe(el));
    }
    const inViewport = r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, inViewport, clippedBy, fullyVisible: inViewport && clippedBy.length === 0,
      coveredBy: hit && (hit === link || link.contains(hit)) ? null : describe(hit) };
  };
  out.initial = visibility();
  // Scroll the owner away from the link (to the oldest message), then bring it back the way a reader would:
  // proves the link is reached THROUGH the real scroll owner, not merely that it happened to be on screen.
  if (designated && out.scrollOwnerOverflowing) { designated.scrollTop = 0; out.scrolledAway = visibility(); }
  link.scrollIntoView({ block: "nearest", inline: "nearest" });
  out.afterScrollIntoView = visibility();
  const s = getComputedStyle(link);
  // The declared style (.th-link + .th-src-open): ink, underlined, 12px/600. Resolved against the live tokens.
  const probe = document.createElement("span");
  probe.style.color = "var(--pg-ink)"; link.parentElement.append(probe);
  const ink = getComputedStyle(probe).color; probe.style.color = "var(--pg-gold-core)"; const goldCore = getComputedStyle(probe).color; probe.remove();
  out.linkStyle = { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, ink, goldCore, underline: s.textDecorationLine, transition: `${s.transitionProperty} ${s.transitionDuration}` };
  out.linkStyleOk = s.color === ink && s.color !== goldCore && s.fontSize === "12px" && s.fontWeight === "600" && s.textDecorationLine === "underline";
  const ap = document.querySelector(".th-ap");
  out.approval = ap ? {
    heading: ap.querySelector("[aria-label]:not(.th-ap)")?.getAttribute("aria-label") ?? null,
    refusalHeadingPresent: Boolean(ap.querySelector('[aria-label="Approval not available here"]')),
    buttons: [...ap.querySelectorAll("button")].map((b) => b.innerText.trim() || b.getAttribute("aria-label")),
    approveDrawn: [...ap.querySelectorAll("button")].some((b) => /approve/i.test(b.innerText)),
    text: ap.innerText.replace(/\s+/g, " ").trim(),
  } : null;
  return out;
};

async function burnLabel(page) {
  await page.evaluate((text) => {
    const tag = document.createElement("div");
    tag.setAttribute("data-harness-label", "");
    tag.textContent = text;
    Object.assign(tag.style, { position: "fixed", left: "50%", bottom: "4px", transform: "translateX(-50%)", zIndex: "2147483647", padding: "2px 10px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.92)", pointerEvents: "none" });
    document.body.append(tag);
  }, report.label);
  const ok = await page.evaluate(() => { const r = document.querySelector("[data-harness-label]")?.getBoundingClientRect(); return Boolean(r && r.width > 20 && r.height > 8 && r.bottom <= innerHeight && r.top >= 0); });
  if (!ok) throw new Error("harness label is not verifiably on screen; refusing to write the frame");
}
async function shoot(page, name) { await burnLabel(page); await page.screenshot({ path: resolve(OUT, `${name}.png`) }); return `${name}.png`; }

/** Tab from the top of the document until the link has focus; reports the count and the ring. */
async function tabTo(page, max = 260) {
  await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press("Tab");
  for (let n = 1; n <= max; n += 1) {
    const on = await page.evaluate(() => document.activeElement?.matches?.(".th-src a.th-src-open") ?? false);
    if (on) {
      const ring = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); const r = a.getBoundingClientRect();
        return { focusVisible: a.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow,
          inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; });
      return { tabs: n, ...ring };
    }
    await page.keyboard.press("Tab");
  }
  return { tabs: null, reached: false };
}

// ── The eight SOLO records (4 viewports × PAIGE closed/open), tenant a and tenant b, dark; light for 1366 and 900 on tenant a.
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const runs = [];
for (const tenant of [TENANTS.a, TENANTS.b]) for (const [w, h] of VIEWPORTS) for (const paige of ["closed", "open"]) runs.push({ tenant, w, h, paige, theme: "dark" });
for (const [w, h] of [[1366, 768], [900, 1000]]) for (const paige of ["closed", "open"]) runs.push({ tenant: TENANTS.a, w, h, paige, theme: "light" });
for (const run of runs) {
  const page = await newPage({ width: run.w, height: run.h });
  await openTeamHub(page, run);
  const m = await page.evaluate(MEASURE);
  const keyboard = await tabTo(page);
  if (m.paigeOverlay) {
    // With the PAIGE overlay open the hub sits behind it. Record whether a focused link is obscured, then fold
    // PAIGE with the shell's own Escape and record that the link is uncovered again.
    keyboard.obscuredWhenFocused = await page.evaluate(() => { const a = document.activeElement; if (!a?.matches?.(".th-src a.th-src-open")) return null; const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(hit === a || a.contains(hit)); });
    await setPaige(page, "closed");
    keyboard.afterEscapeFold = await page.evaluate(() => { const a = document.querySelector(".th-src a.th-src-open"); const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { paige: document.querySelector("[data-tenant-shell][data-paige]")?.getAttribute("data-paige"), uncovered: hit === a || a.contains(hit) }; });
    await setPaige(page, "open");
  }
  const name = `shell-${run.tenant.account}-${run.w}x${run.h}-paige-${run.paige}-${run.theme}`;
  await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); });
  const frame = await shoot(page, name);
  const expected = `/solo/${run.tenant.account}/operations/work`;
  if (m.href !== expected) fail(`${name}: href ${m.href} != ${expected}`);
  if (m.pageOverflowXpx > 0) fail(`${name}: page overflows horizontally by ${m.pageOverflowXpx}px`);
  if (!m.afterScrollIntoView?.inViewport || m.afterScrollIntoView?.clippedBy.length) fail(`${name}: link not reachable/visible after scrollIntoView`);
  if (keyboard.tabs == null) fail(`${name}: Tab never reached the link`);
  if (!m.linkStyleOk) fail(`${name}: link style is not the declared ink/underline/12px/600: ${JSON.stringify(m.linkStyle)}`);
  if (m.scrolledAway && m.scrolledAway.fullyVisible) fail(`${name}: scrolling the owner away did not move the link (owner is not the real scroller)`);
  if (m.paigeOverlay && !keyboard.afterEscapeFold?.uncovered) fail(`${name}: folding PAIGE did not uncover the link`);
  if (!m.approval?.refusalHeadingPresent || m.approval?.approveDrawn) fail(`${name}: approval card is not the honest refusal`);
  report.records.push({ name, frame, tenant: run.tenant.name, account: run.tenant.account, viewport: `${run.w}x${run.h}`, paigeRequested: run.paige, theme: run.theme, ...m, keyboard, errors: page.__errors });
  await page.context().close();
}

// ── Task-card read states at 1366×768, PAIGE closed, both themes: read (link), failed (link), unreadable (no link).
for (const tr of ["read", "failed", "unreadable"]) for (const theme of ["dark", "light"]) {
  const page = await newPage({ width: 1366, height: 768 });
  await openTeamHub(page, { tenant: TENANTS.a, theme, tr });
  const m = await page.evaluate(MEASURE);
  const name = `shell-state-${tr}-1366-${theme}`;
  if ((tr === "unreadable") !== (m.href == null)) fail(`${name}: link presence wrong for ${tr} (href ${m.href})`);
  await page.evaluate(() => document.querySelector(".th-src")?.scrollIntoView({ block: "nearest" }));
  report.states.push({ name, frame: await shoot(page, name), read: tr, theme, href: m.href, cardText: m.cardText, errors: page.__errors });
  await page.context().close();
}

// ── Enter on the focused link navigates to Operations → Work for the CURRENT tenant; Back returns to Team Hub.
{
  const page = await newPage({ width: 1366, height: 768 });
  await openTeamHub(page, { tenant: TENANTS.a, theme: "dark" });
  const kb = await tabTo(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ url: location.pathname + location.search, screen: document.querySelector("[data-solo-screen-host]")?.innerText.replace(/\s+/g, " ").trim().slice(0, 200), title: document.querySelector(".tcs-context, [class*=tcs-context]")?.innerText.replace(/\s+/g, " ").trim().slice(0, 80) }));
  const frame = await shoot(page, "shell-enter-operations-work-1366-dark");
  if (after.url.split("?")[0] !== "/solo/3855/operations/work") fail(`Enter navigated to ${after.url}`);
  await page.goBack();
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({ url: location.pathname, hub: Boolean(document.querySelector(".th-hub .th-list")) }));
  report.interactions.push({ name: "keyboard-enter-opens-operations-work", keyboard: kb, after, frame, back, errors: page.__errors });
  await page.context().close();
}

// ── Workspace switch a → b: the shell's own redirect moves the address; Team Hub remounts; the link carries 4120.
{
  const page = await newPage({ width: 1366, height: 768 });
  await openTeamHub(page, { tenant: TENANTS.a, theme: "dark" });
  const before = await page.evaluate(() => document.querySelector(".th-src a.th-src-open")?.getAttribute("href"));
  await page.evaluate(() => window.__harnessSwitchTenant("b"));
  await page.waitForTimeout(80);
  const staleRightAfter = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.includes("/3855/")));
  await page.waitForTimeout(1500);
  const redirected = await page.evaluate(() => location.pathname);
  // Back to Team Hub through the shell's own rail link for the new account.
  await page.locator('a[href^="/solo/4120/team-hub"]').first().click();
  await page.waitForSelector(".th-hub .th-list", { timeout: 20000 });
  await page.locator(".th-list .th-conv-item", { hasText: /^daily-management$/ }).first().click();
  await page.waitForSelector(".th-src .th-src-foot", { timeout: 15000 });
  await page.waitForTimeout(500);
  const afterSwitch = await page.evaluate(() => ({ url: location.pathname, href: document.querySelector(".th-src a.th-src-open")?.getAttribute("href"), account: document.querySelector("[data-tenant-shell]")?.innerText.match(/JUNIPER ROW CONSULTING|HARBOR LANE STUDIO/i)?.[0], stale: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.includes("/3855/")) }));
  const frame = await shoot(page, "shell-switch-a-to-b-1366-dark");
  const kb = await tabTo(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const landed = await page.evaluate(() => location.pathname);
  if (before !== "/solo/3855/operations/work" || afterSwitch.href !== "/solo/4120/operations/work" || afterSwitch.stale.length || landed !== "/solo/4120/operations/work") fail(`workspace switch: before ${before}, after ${afterSwitch.href}, stale ${afterSwitch.stale}, landed ${landed}`);
  report.interactions.push({ name: "workspace-switch-a-to-b", before, staleRightAfter, redirected, afterSwitch, keyboard: kb, landed, frame, errors: page.__errors });
  await page.context().close();
}

// ── 200% zoom at 1366×768: a 683×384 CSS-px viewport at device scale 2 (the browser's 200% zoom of 1366×768).
for (const paige of ["closed"]) for (const theme of ["dark", "light"]) {
  const page = await newPage({ width: 683, height: 384 }, { dsf: 2 });
  await openTeamHub(page, { tenant: TENANTS.a, theme, paige });
  const m = await page.evaluate(MEASURE);
  const kb = await tabTo(page);
  const name = `shell-zoom200-1366x768-paige-${paige}-${theme}`;
  await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); document.querySelector(".th-src a.th-src-open")?.scrollIntoView({ block: "nearest" }); });
  if (m.pageOverflowXpx > 0) fail(`${name}: horizontal page scroll ${m.pageOverflowXpx}px`);
  if (!m.afterScrollIntoView?.fullyVisible) fail(`${name}: link not fully visible after scrollIntoView`);
  report.interactions.push({ name: `zoom-200-${theme}`, frame: await shoot(page, name), ...m, keyboard: kb, errors: page.__errors });
  await page.context().close();
}

// ── Reduced motion: the preference reaches the page; nothing on the card or the link animates.
{
  const page = await newPage({ width: 1366, height: 768 }, { reducedMotion: "reduce" });
  await openTeamHub(page, { tenant: TENANTS.a, theme: "dark" });
  const rm = await page.evaluate(() => {
    const link = document.querySelector(".th-src a.th-src-open");
    const card = document.querySelector(".th-src");
    const running = document.getAnimations().filter((a) => a.playState === "running").map((a) => { const t = a.effect?.target; return t ? `${t.tagName.toLowerCase()}.${String(t.className).split(" ")[0]}` : "?"; });
    return { prefersReduced: matchMedia("(prefers-reduced-motion: reduce)").matches, runningAnimations: running,
      onCardOrLink: running.filter((r) => r.includes("th-src")), linkTransition: `${getComputedStyle(link).transitionProperty} ${getComputedStyle(link).transitionDuration}`,
      cardAnimation: getComputedStyle(card).animationName };
  });
  await page.locator(".th-src a.th-src-open").hover();
  await page.waitForTimeout(100);
  const hover = await page.evaluate(() => ({ running: document.getAnimations().filter((a) => a.playState === "running").length }));
  if (!rm.prefersReduced || rm.onCardOrLink.length) fail("reduced motion: preference not applied or the card animates");
  report.interactions.push({ name: "reduced-motion", ...rm, hover, frame: await shoot(page, "shell-reduced-motion-1366-dark"), errors: page.__errors });
  await page.context().close();
}

writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
console.log(`records ${report.records.length}, states ${report.states.length}, interactions ${report.interactions.length}, failures ${report.failures.length}`);
process.exit(report.failures.length ? 1 : 0);
