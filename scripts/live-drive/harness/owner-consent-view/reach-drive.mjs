// E09 Slice 6 — render "How {client} can be reached" on the REAL Solo client record (under "Files for
// {client}", which Documents placed under "Shared with {client}"), in each state, both themes, desktop (1440x900) and phone (390x844), and MEASURE the section: text
// contrast (AA), gold (none: this is a read-only view), touch targets >= 44px on the phone, overflow, clipped
// text, page errors and any request that tried to leave the machine. It also reads what the owner is told off the
// rendered page — every row, who set it, that the section is read-only by design (no switch, no checkbox), and
// that the one staff control is linked in Conversations.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in Solo
// record against the real read on a seeded test tenant is owed to a capable session.
//
//   node scripts/live-drive/harness/owner-consent-view/reach-drive.mjs [--out dir] [--only substr]
//   node .../reach-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-owner-consent-view");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5362;
const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) for (const state of ["mixed", "paused", "reported", "business", "defaults", "refused", "error", "loading"]) for (const kind of ["desktop", "phone"]) shots.push({ state, theme, kind });
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_REACH_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const SECTION = ".trc-reach";

async function drive(page, s, n) {
  const section = page.locator(SECTION);
  await section.waitFor({ timeout: 30_000 });
  if (s.state === "loading") await section.locator(".trc-reach-skeleton").first().waitFor({ timeout: 10_000 });
  else if (s.state === "refused" || s.state === "error") await section.locator(".trc-reach-state").waitFor({ timeout: 30_000 });
  else await section.locator(".trc-reach-row").first().waitFor({ timeout: 30_000 });
  n.rows = await section.locator(".trc-reach-row").evaluateAll((rs) => rs.filter((r) => r.querySelector("dt")).map((r) => `${r.querySelector("dt").textContent} = ${r.querySelector("dd").innerText.replace(/\s+/g, " ").trim()}`));
  n.controls = await section.locator('input, [role="switch"], [role="checkbox"], select').count();
  n.links = await section.locator("a").evaluateAll((as) => as.map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`));
  n.text = clean(await section.innerText());
  n.order = await page.evaluate(() => [...(document.querySelector(".trc-record-body")?.children ?? [])].slice(0, 4).map((c) => c.querySelector("h3")?.textContent || c.id || c.className));
  n.footer = clean(await page.locator(".trc-record-footer").innerText().catch(() => ""));
  await section.evaluate((el) => {
    const scroller = el.closest(".trc-record-scroll") ?? document.scrollingElement;
    const head = document.querySelector(".trc-record-head, .trc-record-header");
    const offset = head ? head.getBoundingClientRect().height + 8 : 8;
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
  });
  await page.waitForTimeout(300);
}

const FOOT = "What Jordan turns off stays off until they turn it back on. Texts come on only from a START reply, a sign-up form, or consent your business records itself, which shows as Set by your business. You can pause email or texts in Conversations, and lift any pause Jordan didn’t set.";
function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  want(n.controls === 0, `the section is read-only by design, but it has ${n.controls} control(s)`);
  want(!/\bcoach|credit|funding\b/i.test(n.text ?? ""), "§2 wording in the section");
  // Documents (main, Slice 4) put "Files for {client}" directly under "Shared with"; this section follows it.
  want(n.order?.[2] === "Files for Jordan Rivera" && n.order?.[3] === "How Jordan Rivera can be reached", `section not directly under Files for: ${JSON.stringify(n.order)}`);
  want(!/do-not-contact flag|consent flag/.test(n.footer ?? ""), `footer still repeats the flags: ${n.footer}`);
  if (s.state === "mixed") {
    want(eq(n.rows, [
      "Email = Off Set by the client · Oct 12, 2026",
      "Texts = On Set by their START reply · Oct 9, 2026",
      "Updates and offers = Not subscribed Set by the client · Oct 12, 2026",
      "Shared Paige context = Allowed by the client · it has no effect yet Oct 14, 2026",
      "Portal = Joined",
      "Do not contact (marketing) = Off",
      "Do not disturb = On · Paige holds emails and texts while the hold lasts",
    ]), `rows ${JSON.stringify(n.rows)}`);
    want((n.links ?? []).includes(`Open Conversations -> /solo/42/clients/conversations?contact=${CLIENT}`), `links ${JSON.stringify(n.links)}`);
    want((n.text ?? "").includes(FOOT), "the footer is not the literally-true explanation (business pause, D1, D7)");
  }
  if (s.state === "paused") {
    want(eq(n.rows.slice(0, 3), ["Email = Paused Set by your business · Oct 15, 2026", "Texts = Not set up · no START reply on record, so texts are held", "Updates and offers = Paused Set by your business · Oct 15, 2026"]), `rows ${JSON.stringify(n.rows)}`);
    want(n.rows.includes("Portal = Not joined yet") && n.rows.includes("Do not contact (marketing) = On · left out of marketing email"), `rows ${JSON.stringify(n.rows)}`);
  }
  if (s.state === "reported") {
    want(n.rows[0] === "Email = Off · they reported email as spam Oct 3, 2026 Only they can turn it back on.", `reported row "${n.rows[0]}"`);
    want(!/delivery/i.test(n.text ?? ""), "a spam report reads as a delivery problem");
  }
  if (s.state === "business") {
    want(n.rows[1] === "Texts = On Set by your business · Sep 28, 2026" && n.rows[2] === "Updates and offers = Subscribed Set by your business · Sep 28, 2026", `D7 rows ${JSON.stringify(n.rows.slice(1, 3))}`);
  }
  if (s.state === "defaults") want(n.rows[0] === "Email = On" && n.rows[1] === "Texts = No phone number on file", `rows ${JSON.stringify(n.rows)}`);
  if (s.state === "refused") want(/Only the business owner or an admin can see how Jordan Rivera can be reached\./.test(n.text ?? "") && n.rows.length === 0, `refused "${n.text}"`);
  if (s.state === "error") want(/couldn’t check how Jordan Rivera can be reached/.test(n.text ?? "") && /Try again/.test(n.text ?? "") && n.rows.length === 0, `error "${n.text}"`);
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    const pageBg = getComputedStyle(document.body).backgroundColor;
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg) ? "rgb(255,255,255)" : pageBg);
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => {
    const c = getComputedStyle(el).color, p = parse(c), a = (p.length > 3 ? p[3] : 1) * opacityOf(el);
    return a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : c;
  };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden], [aria-hidden='true']");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled, fieldset:disabled");
  const section = document.querySelector(".trc-reach");
  const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((o) => o.getClientRects().length);
  const roots = [section, ...overlays].filter(Boolean);
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrast = roots.flatMap((root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  }));
  const graded = contrast.filter((c) => !c.inactive);
  // A switch is a non-text control: its track border/fill must reach 3:1 against what it sits on (WCAG 1.4.11).
  const switches = section ? [...section.querySelectorAll('[role="switch"]')].filter((e) => e.getClientRects().length).map((e) => {
    const cs = getComputedStyle(e), around = bgOf(e.parentElement);
    const edge = !transparent(cs.backgroundColor) ? blend(cs.backgroundColor, around) : cs.borderTopColor;
    return { label: e.getAttribute("aria-label"), state: e.getAttribute("aria-checked"), ratio: ratio(edge, around), disabled: e.disabled };
  }) : [];

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const tokens = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map((t) => getComputedStyle(section ?? document.documentElement).getPropertyValue(t).trim()).filter(Boolean);
  const golds = [...tokens.map((t) => { probe.style.color = t; return getComputedStyle(probe).color; }),
    ...["--accent", "--gold", "--gold-dark"].map((t) => { probe.style.color = `hsl(var(${t}))`; return getComputedStyle(probe).color; })]
    .map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const gold = roots.flatMap((root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    return hits.length ? [{ el: n.tagName.toLowerCase(), cls: String(n.className).slice(0, 40), text: n.textContent.trim().slice(0, 30), hits }] : [];
  }));

  // Same measurement as the customer drive (portal-progress-customer-mount/progress-drive.mjs hitIn).
  const extendedHit = (n) => {
    const r = n.getBoundingClientRect();
    const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    if (getComputedStyle(n).position === "static") return box;
    const ext = { ...box };
    const cs = getComputedStyle(n), bw = (side) => parseFloat(cs[`border${side}Width`]) || 0;
    const pad = { top: r.top + bw("Top"), bottom: r.bottom - bw("Bottom"), left: r.left + bw("Left"), right: r.right - bw("Right") };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      ext.top = Math.min(ext.top, pad.top + t); ext.bottom = Math.max(ext.bottom, pad.bottom - b);
      ext.left = Math.min(ext.left, pad.left + l); ext.right = Math.max(ext.right, pad.right - rt);
    }
    if (ext.top === box.top && ext.bottom === box.bottom && ext.left === box.left && ext.right === box.right) return box;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const lands = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === n || n.contains(h)); };
    const inView = ext.top >= 0 && ext.bottom <= innerHeight && ext.left >= 0 && ext.right <= innerWidth;
    return inView && lands(cx, ext.top + 0.5) && lands(cx, ext.bottom - 0.5) && lands(ext.left + 0.5, cy) && lands(ext.right - 0.5, cy) ? ext : box;
  };
  const targets = roots.flatMap((root) => [...root.querySelectorAll('a, button, input, select, textarea, [role="switch"]')]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      // A control inside a <label> is hit anywhere on the label: that is its target. Otherwise its own box,
      // plus an absolutely positioned ::before/::after (the sheet's Close reaches 44px this way), counted only
      // when real hit tests at the extension's outer edges land on the control.
      const label = n.closest("label");
      const hit = label ? label.getBoundingClientRect() : extendedHit(n);
      const r = n.getBoundingClientRect();
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(hit.bottom - hit.top), w: Math.round(hit.right - hit.left), drawn: `${Math.round(r.width)}x${Math.round(r.height)}` };
    }));

  const scroller = section?.closest(".trc-record-scroll");
  const clipped = roots.flatMap((root) => [...root.querySelectorAll("h2,h3,p,span,strong,a,button,label")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  const spill = section ? [...section.querySelectorAll(".trc-reach-row")].filter((row) => {
    const rr = row.getBoundingClientRect();
    return [...row.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > rr.right + 1);
  }).map((r) => r.textContent.trim().slice(0, 40)) : [];
  return {
    contrastMin: graded.length ? Math.min(...graded.map((c) => c.ratio)) : null,
    low: graded.filter((c) => c.ratio < c.need), switches, lowSwitch: switches.filter((sw) => !sw.disabled && sw.ratio < 3),
    gold, targets, clipped, spill,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false) || (section ? section.scrollWidth > section.clientWidth + 1 : false)
      || overlays.some((o) => o.scrollWidth > o.clientWidth + 1 || o.getBoundingClientRect().right > innerWidth + 1),
    sectionW: section ? Math.round(section.getBoundingClientRect().width) : null,
    font: section ? getComputedStyle(section.querySelector("h3") ?? section).fontFamily : null,
    // Which face actually painted: a declared-and-loaded @font-face for the first family, or the fallback.
    fontLoaded: section ? [...document.fonts].some((f) => f.status === "loaded" && getComputedStyle(section.querySelector("h3") ?? section).fontFamily.split(",")[0].replace(/"/g, "").trim() === f.family.replace(/"/g, "")) : null,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.bottom <= innerHeight + 1 && getComputedStyle(t).visibility !== "hidden"; })(),
    phone: opts.phone,
  };
}

async function warm(browser) {
  // The first request makes Vite optimise every dependency of the real page; wait it out once, unmeasured.
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { timeout: 240_000, waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(1000); await ctx.close();
}

async function runShots(browser, shots, label = "") {
  await warm(browser);
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-reach-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "America/Chicago", locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(new Date("2026-10-18T15:30:00Z"));
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/people?${new URLSearchParams({ person: CLIENT, consent: s.state, theme: s.theme })}`, { timeout: 240_000, waitUntil: "domcontentloaded" });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    // Measure and frame only once every face the page asked for has loaded (a fallback face reflows text).
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measureInPage, { phone: !!s.phone });
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const expectations = driveError ? [] : unmet(s, notes);
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0 && m.lowSwitch.length === 0
      && !m.overflowX && m.gold.length === 0 && m.clipped.length === 0 && m.spill.length === 0 && smallTargets.length === 0 && m.tag;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok, expectations, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), switches: m.switches.map((x) => `${x.state}:${x.ratio}`), lowSwitch: m.lowSwitch,
      gold: m.gold.slice(0, 3), overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, sectionW: m.sectionW, font: m.font, fontLoaded: m.fontLoaded,
      errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
    }));
  }
  return { results, failed };
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
let exitCode = 0;
try {
  if (!selftest) {
    const vite = await startVite(null);
    try {
      const { results, failed } = await runShots(browser, allShots());
      fs.writeFileSync(path.join(out, "e09-reach-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("mixed", "desktop"), caught: (r) => r.gold.length > 0 },
      { mutant: "contrast", shot: base("mixed", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "overflow", shot: base("mixed", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "target", shot: base("mixed", "phone"), caught: (r) => r.smallTargets.length > 0 },
      { mutant: "writable", shot: base("mixed", "desktop"), caught: (r) => r.expectations.some((e) => /read-only/.test(e)) },
    ];
    const verdicts = [];
    for (const c of controls) {
      const vite = await startVite(c.mutant);
      try {
        const { results } = await runShots(browser, [c.shot], `-MUTANT-${c.mutant}`);
        const r = Object.values(results)[0];
        const caught = !!r && !r.ok && c.caught(r);
        verdicts.push({ mutant: c.mutant, caught, ok: r?.ok, driveError: r?.driveError ?? null });
        if (!caught) exitCode = 1;
      } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } await new Promise((res) => setTimeout(res, 800)); }
    }
    fs.writeFileSync(path.join(out, "e09-reach-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
