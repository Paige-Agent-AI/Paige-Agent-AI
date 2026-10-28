// EXP03 "approve now, send later" — render the owner's canonical inbox (exp03-scheduled-send-mount) with an
// approved governed email scheduled for tomorrow, drive its Cancel through every answer the door can give, and
// render the same email after its release grace has passed. Every frame is MEASURED before it is labelled: text
// contrast against the real composited background (AA 4.5:1) for the elements this change adds (the Scheduled
// pill, the "Sends <time>" line and its Cancel button, the Not sent pill and its reason line, the toasts, the thread
// list's "Scheduled · …" pill) and for everything else on screen (reported), horizontal overflow, gold spent
// outside an act, the face that loaded, page errors, and the behaviour each state claims. One extra pass drives
// the Cancel control by keyboard only.
//
// Starts its own Vite (--host 127.0.0.1 --port 5198) and drives it in the same process (harness README).
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo inbox is owed.
//
//   node scripts/live-drive/harness/exp03-scheduled-send-mount/drive.mjs [--out dir] [--only substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "docs/evidence/ui-delivery/assets/exp03-scheduled-send");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5198;
const LABEL = "harness render · not live";
const TZ = "America/Chicago";
const TOASTS = {
  ok: { type: "success", text: "Canceled — it won't be sent." },
  // Nothing going out is what the owner asked for: a plain toast() (sonner sets no data-type), not an error.
  already: { type: null, text: "Already canceled — it won't be sent." },
  didnt: { type: null, text: "It didn't go out." },
  toolate: { type: "error", text: "Too late — it's already on its way." },
  error: { type: "error", text: "Couldn't cancel it. Refresh the conversation to see where it stands." },
};
const NOT_SENT_LINES = {
  missed: "Nothing went out.",
  dnd: "Not sent — this person asked not to be contacted right now.",
  cancelled: "Canceled — it won't be sent.",
};

const shots = [];
// The scheduled state at every Solo record size × PAIGE closed/open × theme, plus phone width.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ state: "scheduled", act: "none", theme, w, h, paige });
const small = [[1366, 768, false], [390, 844, true]];
for (const [w, h, phone] of small) for (const theme of ["light", "dark"]) {
  shots.push({ state: "scheduled", act: "none", theme, w, h, paige: "closed", phone, skip: !phone });
  shots.push({ state: "notsent", act: "none", theme, w, h, paige: "closed", phone });
  shots.push({ state: "scheduled", act: "ok", theme, w, h, paige: "closed", phone });
  shots.push({ state: "scheduled", act: "toolate", theme, w, h, paige: "closed", phone });
}
for (const theme of ["light", "dark"]) shots.push({ state: "scheduled", act: "hang", theme, w: 1366, h: 768, paige: "closed" });
for (const act of ["already", "didnt", "error"]) shots.push({ state: "scheduled", act, theme: "light", w: 1366, h: 768, paige: "closed" });

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

// Measured in the page. Contrast for every visible text run, tagging the elements this change adds.
function measure() {
  if (!document.querySelector("#tenant-shell-main")) return { mounted: false, font: { schibsted: false }, tagged: [], low: [], goldOutsideAct: [], toasts: [], calls: [], counts: {}, overflowX: false };
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const parse = (c) => {
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; const v = [r, g, b, Number((a / 255).toFixed(3))];
    cache.set(c, v); return v;
  };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alphaOf = (c) => parse(c)[3];
  const over = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = alphaOf(fg); return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const layerColors = (n) => { const cs = getComputedStyle(n); const stops = /gradient/.test(cs.backgroundImage) ? (cs.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\))/g) ?? []) : []; return [cs.backgroundColor, ...stops].filter((c) => !transparent(c)); };
  const bgCandidates = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const cols = layerColors(n); if (!cols.length) continue; layers.push(cols); if (cols.every((c) => alphaOf(c) >= 1)) break; }
    let base = ["rgb(255,255,255)"];
    if (layers.length && layers[layers.length - 1].every((c) => alphaOf(c) >= 1)) base = layers.pop();
    else { const b = getComputedStyle(document.body).backgroundColor; if (!transparent(b)) base = [b]; }
    let acc = base;
    while (layers.length) { const top = layers.pop(); acc = top.flatMap((t) => acc.map((a) => over(t, a))).slice(0, 24); }
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const visible = (n) => { const r = n.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(n); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
  const inView = (n) => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const ownText = (n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim();
  const main = document.querySelector("#tenant-shell-main");
  const scopes = [main, ...document.querySelectorAll("[data-sonner-toast]")].filter(Boolean);
  const textEls = scopes.flatMap((sc) => [sc, ...sc.querySelectorAll("*")]).filter((n) => ownText(n) && visible(n) && inView(n));
  const kindOf = (n) => {
    const t = ownText(n);
    if (n.closest("[data-sonner-toast]")) return "toast";
    if (n.closest('[data-governed-send="scheduled"]')) return "cancel-control";
    if (/^Sends /.test(t)) return "sends-time";
    if (n.closest('[data-governed-send="not_sent"]')) return "notsent-line";
    if (t === "Scheduled") return "pill-scheduled";
    if (t === "Not sent") return "pill-notsent";
    if (t === "Canceled") return "pill-canceled";
    if (t === "Sending…") return "pill-sending";
    if (/^Scheduled ·/.test(t)) return "rail-scheduled";
    return null;
  };
  const contrast = textEls.map((n) => {
    const col = getComputedStyle(n).color;
    const worst = bgCandidates(n).map((bg) => ({ bg, r: ratio(over(col, bg), bg) })).sort((a, b) => a.r - b.r)[0];
    const cs = getComputedStyle(n);
    const disabled = !!n.closest("button:disabled, [aria-disabled='true']");
    // Opacity on an ancestor dims the text; fold it in so a dimmed control is measured as drawn.
    let op = 1; for (let a = n; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
    const drawn = op < 1 ? (() => { const fg = parse(over(col, worst.bg)); const b = parse(worst.bg); return ratio(`rgb(${[0, 1, 2].map((i) => Math.round(fg[i] * op + b[i] * (1 - op))).join(",")})`, worst.bg); })() : worst.r;
    return { kind: kindOf(n), disabled, incidental: !!n.closest("[aria-hidden='true']"), text: ownText(n).slice(0, 70), ratio: drawn, color: col, bg: worst.bg, size: cs.fontSize, weight: cs.fontWeight };
  });
  const tagged = contrast.filter((c) => c.kind);
  const low = contrast.filter((c) => c.ratio < 4.5 && !c.incidental && !c.disabled);

  // Gold outside an act (the same rule the resend-retired drive uses): a resolved gold token, or the gold hue
  // band, painted on something that is not a gold/gradient button — inside the scheduled/not-sent bubbles,
  // the toasts and the thread list's Scheduled pill.
  const host = document.createElement("span"); host.style.color = "rgb(1, 2, 3)"; main.append(host);
  const resolve = (expr) => { const probe = document.createElement("i"); host.append(probe); probe.style.color = expr; const c = getComputedStyle(probe).color; probe.remove(); return c === "rgb(1, 2, 3)" ? null : c; };
  const tokenOf = (t) => resolve(`var(${t})`) ?? resolve(`hsl(var(${t}))`);
  const goldRgb = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep", "--gold", "--gold-dark", "--gold-light", "--accent"].map(tokenOf).filter(Boolean);
  host.remove();
  const strip = (c) => parse(c).slice(0, 3).map(Math.round).join(",");
  const goldKeys = new Set(goldRgb.map(strip));
  const hueGold = (c) => { if (alphaOf(c) < 0.15) return false; const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return false; const sat = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return h >= 30 && h <= 52 && sat >= 0.4 && l >= 0.3 && l <= 0.85; };
  const isGold = (c) => goldKeys.has(strip(c)) || hueGold(c);
  const bubbleOf = (n) => { let a = n; for (let i = 0; i < 8 && a; i++) { if (/Scheduled|Not sent|Canceled|Sending…/.test(a.textContent) && a.querySelector("p, span") && a.getBoundingClientRect().height > 60) return a; a = a.parentElement; } return n; };
  const roots = [
    ...[...main.querySelectorAll("[data-governed-send]")].map(bubbleOf),
    ...[...main.querySelectorAll("span")].filter((n) => /^Scheduled ·/.test(ownText(n))),
    ...document.querySelectorAll("[data-sonner-toast]"),
  ];
  const inRoots = (n) => roots.some((r) => r.contains(n));
  const goldEls = [...main.querySelectorAll("*"), ...document.querySelectorAll("[data-sonner-toast] *")].filter(visible).flatMap((n) => {
    const cs = getComputedStyle(n);
    const stops = /gradient/.test(cs.backgroundImage) ? (cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) : [];
    const paints = [ownText(n) ? cs.color : null, cs.backgroundColor, ...stops, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null].filter((c) => c && !transparent(c));
    const hit = paints.find(isGold); if (!hit) return [];
    const btn = n.closest("button");
    const act = btn && (/gold/.test(btn.className) || /gradient/.test(getComputedStyle(btn).backgroundImage));
    return [{ act: !!act, inChange: inRoots(n), text: (btn ?? n).textContent.trim().slice(0, 40), rgb: `rgb(${parse(hit).slice(0, 3).join(",")})` }];
  });
  const cancelBtn = main.querySelector('[data-governed-send="scheduled"]');
  const sendsEl = [...main.querySelectorAll("span")].find((n) => /^Sends /.test(ownText(n)));
  const notSentLines = [...main.querySelectorAll('[data-governed-send="not_sent"]')].map((p) => p.textContent.trim());
  const inbox = document.querySelector("[data-canonical-conversations]");
  const text = main.innerText;
  const spans = [...main.querySelectorAll("span")];
  return {
    font: { schibsted: document.fonts.check('14px "Schibsted Grotesk"') },
    tagged, low, textCount: contrast.length,
    goldOutsideAct: goldEls.filter((g) => !g.act && g.inChange), goldActs: [...new Set(goldEls.filter((g) => g.act).map((g) => g.text))],
    sends: sendsEl ? { text: sendsEl.textContent.trim(), size: getComputedStyle(sendsEl).fontSize, lines: Math.round(sendsEl.getBoundingClientRect().height / parseFloat(getComputedStyle(sendsEl).lineHeight || "16")) } : null,
    cancel: cancelBtn ? { text: cancelBtn.textContent.trim(), ariaLabel: cancelBtn.getAttribute("aria-label"), disabled: cancelBtn.disabled, ariaBusy: cancelBtn.getAttribute("aria-busy"), opacity: getComputedStyle(cancelBtn).opacity, size: getComputedStyle(cancelBtn).fontSize, height: Math.round(cancelBtn.getBoundingClientRect().height), width: Math.round(cancelBtn.getBoundingClientRect().width) } : null,
    notSentLines,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || (inbox ? inbox.scrollWidth > inbox.clientWidth + 1 : false),
    counts: {
      pillScheduled: spans.filter((n) => ownText(n) === "Scheduled").length,
      pillNotSent: spans.filter((n) => ownText(n) === "Not sent").length,
      pillCanceled: spans.filter((n) => ownText(n) === "Canceled").length,
      pillSending: spans.filter((n) => ownText(n) === "Sending…").length,
      railScheduled: spans.filter((n) => /^Scheduled ·/.test(ownText(n))).length,
      rawCode: (text.match(/cancelled_by_owner|blocked_client_dnd|scheduled_release_missed|COMMS_EMAIL|CANCELLED_BY_OWNER/g) ?? []).length,
      approve: text.split("Approve & send").length - 1,
    },
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => ({ type: t.getAttribute("data-type"), text: t.textContent.trim().slice(0, 140) })),
    calls: (window.__harness?.rpc ?? []).filter((r) => r.name.startsWith("functions:")).map((r) => ({ name: r.name, args: r.args })),
  };
}

async function burnLabel(page) {
  return page.evaluate((LABEL) => {
    const el = document.createElement("div");
    el.setAttribute("data-harness-label", "");
    el.textContent = LABEL;
    Object.assign(el.style, { position: "fixed", left: "50%", top: "6px", transform: "translateX(-50%)", zIndex: "2147483647", padding: "3px 10px", borderRadius: "999px", font: "600 12px/16px system-ui, sans-serif", letterSpacing: ".04em", background: "#111", color: "#fff", border: "1px solid #fff" });
    document.body.append(el);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: r.width > 40 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight && (top === el || el.contains(top)), w: Math.round(r.width), h: Math.round(r.height) };
  }, LABEL);
}

async function openSurface(page, s) {
  await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/conversations?${new URLSearchParams({ state: s.state, cancel: s.act === "none" ? "ok" : s.act, theme: s.theme, paige: s.paige })}`, { timeout: 240_000 });
  await page.waitForSelector("[data-canonical-conversations]", { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  const thread = page.getByText("Walkthrough reminder", { exact: false }).first();
  if (!(await thread.isVisible().catch(() => false))) await page.locator("[data-thread-key]").filter({ hasText: "Jordan Rivera" }).first().click();
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    if (s.skip) continue;
    const name = `exp03s-${s.state}${s.act === "none" ? "" : `-cancel-${s.act}`}-${s.theme}-${s.w}x${s.h}${s.phone ? "" : `-paige-${s.paige}`}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: !!s.phone, timezoneId: TZ, locale: "en-US" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    const behaviour = {};
    try {
      await openSurface(page, s);
      if (s.act !== "none") {
        const cancel = page.locator('[data-governed-send="scheduled"]');
        await cancel.scrollIntoViewIfNeeded();
        await cancel.click();
        if (s.act === "hang") {
          await page.waitForFunction(() => document.querySelector('[data-governed-send="scheduled"]')?.disabled === true, null, { timeout: 5_000 });
          // A second click on the disabled control must not reach the door again.
          await cancel.click({ force: true }).catch(() => undefined);
          await page.waitForTimeout(300);
        } else {
          await page.locator("[data-sonner-toast]").filter({ hasText: TOASTS[s.act].text }).first().waitFor({ timeout: 10_000 });
          behaviour.toastShown = true;
          await page.waitForTimeout(400);
        }
      }
      const focus = page.locator('[data-governed-send]').last();
      if (await focus.count()) await focus.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    } catch (e) {
      errors.push(`surface did not reach the expected state: ${String(e).slice(0, 240)}`);
    }
    const m = await page.evaluate(measure);
    const tag = (k) => m.tagged.filter((c) => c.kind === k);
    const doorCalls = m.calls.filter((c) => c.name === "functions:comms-email-command");
    const checks = { noOverflow: !m.overflowX, goldOnlyOnAct: m.goldOutsideAct.length === 0, fontLoaded: m.font.schibsted, noRawCode: m.counts.rawCode === 0, noApprove: m.counts.approve === 0, noOtherFunctions: m.calls.every((c) => c.name === "functions:comms-email-command") };
    const aa = (k) => tag(k).filter((c) => !c.disabled).every((c) => c.ratio >= 4.5);
    if (s.state === "scheduled" && s.act === "none") Object.assign(checks, {
      pillScheduled: m.counts.pillScheduled === 1,
      cancelShown: !!m.cancel && m.cancel.text === "Cancel" && /^Cancel the email scheduled for .+$/.test(m.cancel.ariaLabel ?? "") && !m.cancel.disabled && m.cancel.opacity === "1",
      sendsShown: !!m.sends && /^Sends \w{3}, \w{3} \d+, \d+:\d\d [AP]M(?: [A-Z]{2,5})?$/.test(m.sends.text), railInFuture: m.tagged.some((c) => c.kind === "rail-scheduled" && /^Scheduled · in /.test(c.text)),
      railScheduled: m.counts.railScheduled === 1, noDoorCall: doorCalls.length === 0,
      pillAA: aa("pill-scheduled"), cancelAA: aa("cancel-control"), sendsAA: aa("sends-time"), railAA: aa("rail-scheduled"),
    });
    if (s.state === "notsent") Object.assign(checks, {
      twoNotSentPills: m.counts.pillNotSent === 2, noCancel: !m.cancel, noScheduledPill: m.counts.pillScheduled === 0, railNotScheduled: m.counts.railScheduled === 0,
      lines: JSON.stringify(m.notSentLines) === JSON.stringify([NOT_SENT_LINES.dnd, NOT_SENT_LINES.missed]),
      pillAA: aa("pill-notsent"), lineAA: aa("notsent-line"),
    });
    if (s.act === "hang") Object.assign(checks, { disabledWhilePending: !!m.cancel?.disabled && m.cancel.ariaBusy === "true" && m.cancel.text === "Canceling…" && m.cancel.opacity === "1", oneDoorCall: doorCalls.length === 1, noToast: m.toasts.length === 0 });
    if (s.act !== "none" && s.act !== "hang") {
      const want = TOASTS[s.act];
      Object.assign(checks, {
        toast: behaviour.toastShown === true && m.toasts.length === 1 && m.toasts[0].type === want.type && m.toasts[0].text.includes(want.text),
        oneDoorCall: doorCalls.length === 1 && JSON.stringify(Object.keys(doorCalls[0].args).sort()) === JSON.stringify(["cancel", "expected_tenant_id", "operation_id"]),
        toastAA: aa("toast"),
        // After the answer the thread re-reads: a closed send reads Not sent with its line; too-late reads Sending…;
        // an unverified cancel leaves it Scheduled with Cancel enabled again.
        after: s.act === "toolate" ? m.counts.pillSending === 1 && !m.cancel && m.counts.railScheduled === 0
          : s.act === "error" ? m.counts.pillScheduled === 1 && !!m.cancel && !m.cancel.disabled
          : s.act === "didnt" ? m.counts.pillNotSent === 1 && m.counts.pillCanceled === 0 && !m.cancel && m.counts.railScheduled === 0 && JSON.stringify(m.notSentLines) === JSON.stringify([NOT_SENT_LINES.missed])
          // ok / already: the owner's cancel reads as a neutral Canceled pill, never the red Not sent.
          : m.counts.pillCanceled === 1 && m.counts.pillNotSent === 0 && !m.cancel && m.counts.railScheduled === 0 && JSON.stringify(m.notSentLines) === JSON.stringify([NOT_SENT_LINES.cancelled]),
      });
    }
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    const label = await burnLabel(page);
    if (!label.ok) errors.push(`label not verifiably on screen: ${JSON.stringify(label)}`);
    if (!ok || !label.ok) failed = true;
    results[name] = { ok: ok && label.ok, viewport: `${s.w}x${s.h}`, theme: s.theme, paige: s.paige, state: s.state, act: s.act, checks, label, ...m, errors };
    if (label.ok) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 62 });
    await ctx.close();
    console.log(name, ok && label.ok ? "OK" : "FAIL", JSON.stringify({ failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), tagged: m.tagged.map((c) => `${c.kind}:${c.ratio}`), low: m.low.length, cancel: m.cancel, lines: m.notSentLines, toasts: m.toasts, gold: m.goldOutsideAct.slice(0, 2), errors: errors.slice(0, 2) }));
  }

  // Keyboard: Tab from the top of the page to the Cancel control, then Enter.
  if (!only || "keyboard".includes(only)) for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US" });
    const page = await ctx.newPage();
    const kb = { theme, tabs: null, reached: false };
    try {
      await openSurface(page, { state: "scheduled", act: "ok", theme, paige: "closed" });
      await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
      for (let i = 1; i <= 250; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.getAttribute("data-governed-send") === "scheduled")) { kb.tabs = i; kb.reached = true; break; }
      }
      if (kb.reached) {
        Object.assign(kb, await page.evaluate(() => {
          const el = document.activeElement; const cs = getComputedStyle(el);
          return { tag: el.tagName, type: el.getAttribute("type"), focusVisible: el.matches(":focus-visible"), boxShadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, outlineColor: cs.outlineColor, outlineOffset: cs.outlineOffset, text: el.textContent.trim() };
        }));
        kb.roleNameMatches = await page.getByRole("button", { name: /^Cancel the email scheduled for .+$/ }).count();
        kb.accessibleName = await page.locator('[data-governed-send="scheduled"]').evaluate((el) => el.getAttribute("aria-label") ?? el.textContent.trim());
        kb.visibleText = await page.locator('[data-governed-send="scheduled"]').evaluate((el) => el.textContent.trim());
        const box = await page.locator('[data-governed-send="scheduled"]').boundingBox();
        const label = await burnLabel(page);
        if (box && label.ok) await page.screenshot({ path: path.join(out, `exp03s-keyboard-focus-${theme}-1366x768.jpg`), type: "jpeg", quality: 80, clip: { x: Math.max(0, box.x - 380), y: Math.max(0, box.y - 140), width: Math.min(box.width + 520, 1366 - Math.max(0, box.x - 380)), height: 200 } });
        await page.evaluate(() => document.querySelector("[data-harness-label]")?.remove());
        await page.keyboard.press("Enter");
        await page.locator("[data-sonner-toast]").filter({ hasText: TOASTS.ok.text }).first().waitFor({ timeout: 10_000 });
        kb.enterCancelled = true;
        await page.waitForTimeout(400);
        kb.focusAfter = await page.evaluate(() => { const el = document.activeElement; return { tag: el?.tagName, inComposer: !!el?.closest('[data-composer-writing-surface="true"]'), placeholder: el?.getAttribute?.("placeholder") ?? null, focusVisible: !!el?.matches?.(":focus-visible") }; });
      }
    } catch (e) { kb.error = String(e).slice(0, 240); }
    // The indicator that actually paints: the class asks for a 2px box-shadow ring with outline-none, but the computed
    // style decides — a visible outline OR a non-transparent box-shadow counts, and which one painted is recorded.
    kb.indicator = kb.outline && !/^none/.test(kb.outline) && !/ 0px$/.test(kb.outline) ? "outline" : /rgba\(0, 0, 0, 0\)/.test(kb.boxShadow ?? "none") || kb.boxShadow === "none" ? "none" : "box-shadow";
    const okKb = kb.reached && kb.focusVisible && kb.indicator !== "none" && kb.roleNameMatches === 1 && kb.enterCancelled === true && kb.focusAfter?.tag === "TEXTAREA" && kb.focusAfter.inComposer === true;
    if (!okKb) failed = true;
    results[`keyboard-${theme}`] = { ok: okKb, ...kb };
    console.log(`keyboard-${theme}`, okKb ? "OK" : "FAIL", JSON.stringify(kb));
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
if (!only) fs.writeFileSync(path.join(out, "exp03s-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
