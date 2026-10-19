// E09 Slice 1 — render the CUSTOMER portal conversation (/app/messages, ?topic=help) inside the real customer
// chrome in every state, both themes, desktop / tablet / phone, and MEASURE it: text contrast (AA 4.5:1 against
// the real composited background), the send control's non-text contrast (3:1), horizontal overflow, gold spent
// (none on the page; the chrome is measured and reported separately), touch targets >= 44px on the phone, the
// composer staying visible at the bottom, and page errors / failed responses.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in
// customer portal on the deployed app is owed to a capable session.
//
//   node scripts/live-drive/harness/portal-messages-customer-mount/messages-drive.mjs [--out dir] [--only name-substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-messages-customer");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5241;
// A fixed clock and zone so "Today" / "Yesterday" and every time label are reproducible frame to frame.
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";

const DESKTOP_STATES = ["populated", "empty", "help", "sending", "failed", "error", "norelationship", "multiple", "loading"];
const shots = [];
for (const state of DESKTOP_STATES) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 1440, h: 900, kind: "desktop" });
for (const state of ["populated", "empty", "help", "failed"]) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 390, h: 844, kind: "phone", phone: true });
for (const theme of ["light", "dark"]) shots.push({ state: "populated", theme, w: 1024, h: 768, kind: "tablet" });

const HELP_DRAFT = "The proposal link in your last email says it has expired. Could you send a fresh one before Thursday?";
const FAILED_HELP = "I can't sign in on my phone. The code email never arrives.";
const PLAIN = "Also, is 11:00 on Thursday still good for the review call?";

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

/** Bring each state to the moment worth framing, through the REAL UI (typing, clicking), never by injecting state. */
async function drive(page, s, notes) {
  const field = page.locator("#portal-message-body");
  const ready = async () => { await field.waitFor({ timeout: 30_000 }); await page.waitForFunction(() => !document.querySelector("#portal-message-body")?.disabled, null, { timeout: 30_000 }); };
  switch (s.state) {
    case "populated": await ready(); await page.locator('[role="log"]').waitFor(); break;
    case "empty": await ready(); await page.getByText("Start a conversation with Northwind Studio").waitFor(); break;
    case "help":
      await ready();
      await page.getByRole("heading", { name: "Contact your team" }).waitFor();
      notes.helpAutofocus = await page.evaluate(() => document.activeElement?.id === "portal-message-body");
      await field.fill(HELP_DRAFT);
      break;
    case "sending":
      await ready();
      await field.fill(PLAIN);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByText("Sending…").waitFor();
      break;
    case "failed": {
      // Help mode first: a definite refusal → "Edit and resend". Then back to the thread: a transport failure → "Retry".
      await ready();
      await field.fill(FAILED_HELP);
      await page.getByRole("button", { name: "Send request" }).click();
      await page.getByRole("button", { name: "Edit and resend" }).waitFor();
      await page.getByRole("link", { name: "All messages" }).click();
      await page.getByRole("heading", { name: "Messages", exact: true }).waitFor({ timeout: 10_000 });
      await ready();
      await field.fill(PLAIN);
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByRole("button", { name: "Retry" }).waitFor();
      break;
    }
    case "error": await page.getByText("We couldn't load your messages").waitFor({ timeout: 30_000 }); break;
    case "norelationship": await page.getByText("Messages aren't available on this account").waitFor({ timeout: 30_000 }); break;
    case "multiple": await page.getByText("Messaging for more than one business isn't available yet").waitFor({ timeout: 30_000 }); break;
    case "loading": await page.locator("section[aria-labelledby='messages-title'] [role='status']").first().waitFor({ state: "attached", timeout: 30_000 }); break;
  }
  // The chrome's brand resolves on its own read; wait for it to settle (no skeleton) unless the state never resolves it.
  await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
  await page.waitForTimeout(400);
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
  // Composite every translucent background layer from the element up to the first opaque one.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg()) ? "rgb(255,255,255)" : pageBg());
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => { const c = getComputedStyle(el).color; return alphaOf(c) < 1 ? blend(c, bg) : c; };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden";
  // Inactive controls are exempt from WCAG 1.4.3; they are listed, not graded.
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], textarea:disabled");

  const region = (name) => document.querySelector(`[data-harness-region="${name}"]`);
  const scopes = { page: region("page"), nav: document.querySelector('[data-harness-region="nav"] > div') };
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n);
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), inactive: inactive(n), size: getComputedStyle(n).fontSize };
  });
  const pageContrast = scopes.page ? contrastFor(scopes.page) : [];
  const navContrast = scopes.nav ? contrastFor(scopes.nav) : [];
  // The composer's placeholder is the only visible label while the field is empty.
  const ta = document.querySelector("#portal-message-body");
  if (ta && !ta.value && !ta.disabled) {
    const bg = bgOf(ta); const ph = getComputedStyle(ta, "::placeholder").color;
    pageContrast.push({ text: `(placeholder) ${ta.placeholder}`, ratio: ratio(alphaOf(ph) < 1 ? blend(ph, bg) : ph, bg), inactive: false, size: getComputedStyle(ta).fontSize });
  }
  const graded = (list) => list.filter((c) => !c.inactive);
  const min = (list) => (graded(list).length ? Math.min(...graded(list).map((c) => c.ratio)) : null);

  // Gold: every gold token the theme defines, resolved to rgb; any element painting one (any alpha) is gold spent.
  const probe = document.createElement("i"); document.body.append(probe);
  const goldTokens = ["--accent", "--gold", "--gold-light", "--gold-dark", "--accent-glow"];
  const golds = goldTokens.map((t) => { probe.style.color = `hsl(var(${t}))`; return parse(getComputedStyle(probe).color).slice(0, 3).join(","); });
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const goldIn = (root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag]")).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    if (n.nodeName === "svg" || n.closest("svg")) { if (isGold(cs.stroke) || isGold(cs.fill)) hits.push("icon"); }
    return hits.length ? [{ el: `${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.split(/\s+/).slice(0, 4).join(".") : ""}`, text: n.textContent.trim().slice(0, 30), hits }] : [];
  });

  // Touch targets: every visible interactive control in the page and the chrome.
  const targets = [...document.querySelectorAll('[data-harness-region] a, [data-harness-region] button, [data-harness-region] textarea, [data-harness-region] [role="button"]')]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only"))
    .map((n) => { const r = n.getBoundingClientRect(); return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width), region: n.closest("[data-harness-region]").dataset.harnessRegion }; });

  const scroller = scopes.page;
  const section = document.querySelector("section[aria-labelledby='messages-title']");
  const form = section?.querySelector("form");
  const sendBtn = form?.querySelector('button[type="submit"]');
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0 }; };
  const send = sendBtn ? (() => {
    const bg = bgOf(sendBtn); const around = bgOf(sendBtn.parentElement); const icon = sendBtn.querySelector("svg");
    const iconColor = icon ? getComputedStyle(icon).color : getComputedStyle(sendBtn).color;
    return { disabled: sendBtn.disabled, bg, iconRatio: ratio(iconColor, bg), boundaryRatio: ratio(bg, around), h: Math.round(sendBtn.getBoundingClientRect().height), w: Math.round(sendBtn.getBoundingClientRect().width), opacity: getComputedStyle(sendBtn).opacity };
  })() : null;

  // The newest item in the thread (a confirmed message or a pending send) must be readable above the sticky
  // composer once the page has scrolled to the end — not underneath it.
  const items = section ? [...section.querySelectorAll('[role="log"] ol > li:not([role="presentation"])')] : [];
  const last = items[items.length - 1];
  const newest = last && form ? (() => {
    const lr = last.getBoundingClientRect(), fr = form.getBoundingClientRect();
    const hit = document.elementFromPoint(lr.left + lr.width / 2, Math.min(lr.top + 12, innerHeight - 1));
    return { text: last.innerText.replace(/\s+/g, " ").slice(0, 60), top: Math.round(lr.top), bottom: Math.round(lr.bottom), composerTop: Math.round(fr.top),
      coveredPx: Math.max(0, Math.round(lr.bottom - fr.top)), scrollTop: Math.round(scroller.scrollTop), maxScroll: Math.round(scroller.scrollHeight - scroller.clientHeight), fullyHidden: lr.top >= fr.top - 1, topHitsComposer: !!hit?.closest("form") };
  })() : null;
  // Anything from the thread showing BELOW the composer (between it and the bottom of the page panel).
  const bleed = form && scroller ? (() => {
    const fr = form.getBoundingClientRect(), sr = scroller.getBoundingClientRect(); const found = new Set();
    for (let y = fr.bottom + 2; y < sr.bottom - 1; y += 4) for (let x = sr.left + 2; x < sr.right - 2; x += 16) {
      const el = document.elementFromPoint(x, y); const li = el?.closest('[role="log"] li'); if (li) found.add(li.innerText.replace(/\s+/g, " ").slice(0, 40));
    }
    return { gapPx: Math.round(sr.bottom - fr.bottom), showing: [...found] };
  })() : null;

  return {
    newest, bleed,
    heading: section?.querySelector("h1")?.textContent ?? null,
    pageText: section?.innerText.replace(/\s+/g, " ").slice(0, 600) ?? null,
    navText: scopes.nav?.innerText.replace(/\s+/g, " ").slice(0, 300) ?? null,
    contrastMin: min(pageContrast), lowPage: graded(pageContrast).filter((c) => c.ratio < 4.5),
    navContrastMin: min(navContrast), lowNav: graded(navContrast).filter((c) => c.ratio < 4.5),
    inactiveText: pageContrast.filter((c) => c.inactive).map((c) => `${c.text} (${c.ratio})`).slice(0, 6),
    goldPage: scopes.page ? goldIn(scopes.page) : [], goldNav: scopes.nav ? goldIn(scopes.nav) : [],
    // Horizontal overflow that a person can actually scroll: the document and the page scroller. The section's
    // own scrollWidth is reported, not graded — the composer's `-mx-1` bleeds 4px into the scroller's padding.
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false),
    widths: { doc: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, scroller: scroller ? [scroller.scrollWidth, scroller.clientWidth] : null, section: section ? [section.scrollWidth, section.clientWidth] : null },
    targets, composer: vis(form), send, textarea: ta ? { h: Math.round(ta.getBoundingClientRect().height), w: Math.round(ta.getBoundingClientRect().width), fontSize: getComputedStyle(ta).fontSize } : null,
    counter: document.querySelector("#portal-message-count")?.textContent ?? null,
    panels: [...document.querySelectorAll("[data-panel]")].map((p) => Math.round(p.getBoundingClientRect().width)),
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0 && getComputedStyle(t).visibility !== "hidden"; })(),
    opts,
  };
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `e09-customer-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], requestFailures = [], dialogs = [], notes = {};
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    // A missing favicon is the harness's, not the surface's; every other failed resource is an error.
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => requestFailures.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 160)));
    page.on("dialog", async (d) => { dialogs.push(`${d.type()}: ${d.message()}`); await d.accept(); });
    const query = new URLSearchParams({ state: s.state, theme: s.theme });
    if (s.state === "help" || s.state === "failed") query.set("topic", "help");
    await page.goto(`http://127.0.0.1:${PORT}/app/messages?${query}`);
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone });
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const composerOk = ["norelationship", "multiple"].includes(s.state) ? m.composer === null : !!m.composer?.inView;
    // WCAG 1.4.11: the send glyph must clear 3:1 against its fill. The fill's own edge against the page
    // (boundaryRatio) is reported, not graded: the glyph, not the fill, identifies the control.
    const sendOk = !m.send || m.send.disabled || m.send.iconRatio >= 3;
    const phoneControls = !s.phone || !m.send || (m.send.h >= 44 && m.send.w >= 44 && m.textarea.h >= 44);
    const newestOk = !m.newest || m.newest.coveredPx === 0;
    const bleedOk = !m.bleed || m.bleed.showing.length === 0;
    const pageOk = newestOk && bleedOk && !driveError && errors.length === 0 && m.lowPage.length === 0 && !m.overflowX && m.goldPage.length === 0 && smallTargets.filter((t) => t.region === "page").length === 0 && composerOk && sendOk && phoneControls && m.tag;
    // The chrome (AppNav) is measured with the same rules and reported on its own line: its findings are
    // product findings about AppNav, not about the Messages page, and are surfaced, never suppressed.
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav").length === 0;
    // Stickiness: from the top of a long thread the composer must still be on screen.
    let composerFromTop = null;
    if (m.composer && ["populated", "failed", "sending"].includes(s.state)) {
      composerFromTop = await page.evaluate(() => {
        const sc = document.querySelector('[data-harness-region="page"]'); const keep = sc.scrollTop; sc.scrollTop = 0;
        const r = document.querySelector("section[aria-labelledby='messages-title'] form").getBoundingClientRect();
        const res = { scrolled: keep > 0, inView: r.top >= 0 && r.bottom <= innerHeight + 0.5, bottom: Math.round(r.bottom) };
        sc.scrollTop = keep; return res;
      });
    }
    const stickyOk = composerFromTop === null || composerFromTop.inView;
    const ok = pageOk && stickyOk;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok, chromeOk, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, requestFailures, dialogs, notes, composerFromTop, smallTargets, ...m };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), navContrastMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 3),
      newest: m.newest, bleed: m.bleed, goldPage: m.goldPage.length, goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`), overflowX: m.overflowX, composer: m.composer, composerFromTop,
      send: m.send && { iconRatio: m.send.iconRatio, boundaryRatio: m.send.boundaryRatio, h: m.send.h, w: m.send.w, disabled: m.send.disabled }, textarea: m.textarea,
      smallTargets, errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), dialogs, notes, tag: m.tag,
    }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "e09-customer-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
