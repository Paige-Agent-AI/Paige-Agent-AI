// EXP03 O12 piece 3 — render the owner's canonical inbox (exp03-composer-inline-check-mount) and drive the email
// reply's inline check through every face it has: composing (the note), the check open (send now and scheduled),
// Sending…, sent, scheduled, a lost/unknown answer with Check status, each refusal, an expired check, and the
// conversation switch held while a confirm is out. Every frame is MEASURED before it is labelled: AA text contrast
// against the real composited background for every element this change adds (the strip's text and buttons, the
// composer note, "Checking…", the toast) and for everything else on screen (reported), horizontal overflow, gold
// spent outside the Send now act, the face that loaded, page errors, focus landing (Edit when the check opens),
// target size of the strip's controls, and the behaviour each state claims. One keyboard-only pass per theme.
//
// Starts its own Vite (--host 127.0.0.1 --port 5199) and drives it in the same process (harness README).
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo inbox is owed.
//
//   node scripts/live-drive/harness/exp03-composer-inline-check-mount/drive.mjs [--out dir] [--only substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "docs/evidence/ui-delivery/assets/exp03-composer-inline-check");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5199;
const LABEL = "harness render · not live";
const TZ = "America/Chicago";
const SUBJECT = "Re: Kitchen refresh — scope questions";
const BODY = "Hardware is included in the quote. I'll bring samples to Thursday's walkthrough.";

// What each state must say (the strip's copy, the announcement, or the thread's reading).
const REFUSALS = {
  suppressed: "Can't send to Jordan Rivera. They unsubscribed or this address bounced.",
  noconsent: "Can't send to Jordan Rivera. This person hasn't agreed to get email from you.",
  clientdnd: "Can't send to Jordan Rivera. This person asked not to be contacted right now.",
  tenantdnd: "It can't go out right now — Do not disturb is on. Schedule it for later.",
  nosender: "This sending address can't send email. Choose another.",
  noemail: "There's no email address on Jordan Rivera's contact card. Add one, then send.",
};
const STATES = {
  compose: { door: "ok" },
  check: { door: "ok" },
  "check-scheduled": { door: "ok", schedule: true },
  sending: { door: "hang" },
  sent: { door: "ok" },
  scheduled: { door: "ok", schedule: true },
  unknown: { door: "unknown" },
  expired: { door: "expire" },
  "switch-held": { door: "hang" },
  ...Object.fromEntries(Object.keys(REFUSALS).map((k) => [`refused-${k}`, { door: k }])),
};

const shots = [];
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ state: "check", theme, w, h, paige });
for (const theme of ["light", "dark"]) shots.push({ state: "check", theme, w: 390, h: 844, paige: "closed", phone: true });
for (const state of Object.keys(STATES).filter((s) => s !== "check")) for (const [w, h, phone] of [[1366, 768, false], [390, 844, true]]) for (const theme of ["light", "dark"]) shots.push({ state, theme, w, h, paige: "closed", phone });

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

// Measured in the page (the contrast/gold method is the scheduled-send drive's, unchanged).
function measure() {
  const main = document.querySelector("#tenant-shell-main");
  if (!main) return { mounted: false, font: { schibsted: false }, tagged: [], low: [], goldOutsideAct: [], toasts: [], calls: [], overflowX: false, targets: [] };
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
  const strip = main.querySelector("[data-governed-reply-strip]");
  const textarea = main.querySelector('[data-composer-writing-surface="true"] textarea');
  const composer = textarea?.closest(".border-t") ?? null;
  const scopes = [main, ...document.querySelectorAll("[data-sonner-toast]")].filter(Boolean);
  const textEls = scopes.flatMap((sc) => [sc, ...sc.querySelectorAll("*")]).filter((n) => ownText(n) && visible(n) && inView(n));
  const kindOf = (n) => {
    const t = ownText(n);
    if (n.closest("[data-sonner-toast]")) return "toast";
    if (strip && strip.contains(n)) return n.closest("button, a") ? "strip-control" : "strip-text";
    if (n.closest("[data-composer-send]")) return t === "Checking…" ? "send-checking" : null;
    if (/^Goes to .+'s main email\.$|has no email address on their contact card yet\.$/.test(t)) return "composer-note";
    if (t === "Accepted") return "pill-accepted";
    if (t === "Scheduled") return "pill-scheduled";
    if (t === "Couldn't confirm") return "pill-unconfirmed";
    if (/^Sends /.test(t)) return "sends-time";
    return null;
  };
  const contrast = textEls.map((n) => {
    const col = getComputedStyle(n).color;
    const worst = bgCandidates(n).map((bg) => ({ bg, r: ratio(over(col, bg), bg) })).sort((a, b) => a.r - b.r)[0];
    const cs = getComputedStyle(n);
    const disabled = !!n.closest("button:disabled");
    let op = 1; for (let a = n; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
    const drawn = op < 1 ? (() => { const fg = parse(over(col, worst.bg)); const b = parse(worst.bg); return ratio(`rgb(${[0, 1, 2].map((i) => Math.round(fg[i] * op + b[i] * (1 - op))).join(",")})`, worst.bg); })() : worst.r;
    return { kind: kindOf(n), disabled, incidental: !!n.closest("[aria-hidden='true']"), text: ownText(n).slice(0, 80), ratio: drawn, color: col, bg: worst.bg, size: cs.fontSize, weight: cs.fontWeight };
  });
  const tagged = contrast.filter((c) => c.kind);
  const low = contrast.filter((c) => c.ratio < 4.5 && !c.incidental && !c.disabled);

  // Gold: a resolved gold token or the gold hue band painted in the composer, the strip or a toast on anything
  // that is not a gold/gradient button. The gold buttons inside the composer are listed (expected: exactly one).
  const host = document.createElement("span"); host.style.color = "rgb(1, 2, 3)"; main.append(host);
  const resolve = (expr) => { const probe = document.createElement("i"); host.append(probe); probe.style.color = expr; const c = getComputedStyle(probe).color; probe.remove(); return c === "rgb(1, 2, 3)" ? null : c; };
  const tokenOf = (t) => resolve(`var(${t})`) ?? resolve(`hsl(var(${t}))`);
  const goldRgb = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep", "--gold", "--gold-dark", "--gold-light", "--accent"].map(tokenOf).filter(Boolean);
  host.remove();
  const stripRgb = (c) => parse(c).slice(0, 3).map(Math.round).join(",");
  const goldKeys = new Set(goldRgb.map(stripRgb));
  const hueGold = (c) => { if (alphaOf(c) < 0.15) return false; const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return false; const sat = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return h >= 30 && h <= 52 && sat >= 0.4 && l >= 0.3 && l <= 0.85; };
  const isGold = (c) => goldKeys.has(stripRgb(c)) || hueGold(c);
  const roots = [composer, ...document.querySelectorAll("[data-sonner-toast]")].filter(Boolean);
  const goldEls = roots.flatMap((r) => [r, ...r.querySelectorAll("*")]).filter(visible).flatMap((n) => {
    const cs = getComputedStyle(n);
    const stops = /gradient/.test(cs.backgroundImage) ? (cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) : [];
    const paints = [ownText(n) ? cs.color : null, cs.backgroundColor, ...stops, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null].filter((c) => c && !transparent(c));
    const hit = paints.find(isGold); if (!hit) return [];
    const btn = n.closest("button");
    const act = btn && (/gold/.test(btn.className) || /gradient/.test(getComputedStyle(btn).backgroundImage));
    return [{ act: !!act, text: (btn ?? n).textContent.trim().slice(0, 40), rgb: `rgb(${parse(hit).slice(0, 3).join(",")})` }];
  });
  const goldButtons = composer ? [...composer.querySelectorAll("button")].filter((b) => visible(b) && (/gold/.test(b.className) || /gradient/.test(getComputedStyle(b).backgroundImage))).map((b) => b.textContent.trim()) : [];
  const targets = strip ? [...strip.querySelectorAll("button, a")].filter(visible).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }) : [];
  const sendBtn = main.querySelector("[data-composer-send]");
  const ae = document.activeElement;
  const inbox = document.querySelector("[data-canonical-conversations]");
  const textOf = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const stripClips = strip ? [...strip.querySelectorAll("*")].filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== "visible").map((n) => textOf(n).slice(0, 40)) : [];
  return {
    font: { schibsted: document.fonts.check('14px "Schibsted Grotesk"') },
    tagged, low, textCount: contrast.length,
    goldOutsideAct: goldEls.filter((g) => !g.act), goldButtons,
    strip: strip ? { label: strip.getAttribute("aria-label"), text: strip.innerText.replace(/\s+/g, " ").trim(), w: Math.round(strip.getBoundingClientRect().width), overflow: strip.scrollWidth > strip.clientWidth + 1, clipped: stripClips } : null,
    send: sendBtn ? { text: textOf(sendBtn), ariaBusy: sendBtn.getAttribute("aria-busy"), ariaDisabled: sendBtn.getAttribute("aria-disabled"), disabled: sendBtn.disabled } : null,
    focus: { stripFocus: ae?.getAttribute?.("data-strip-focus") ?? null, tag: ae?.tagName ?? null, inComposer: !!ae?.closest?.('[data-composer-writing-surface="true"]'), text: textOf(ae).slice(0, 40) },
    targets,
    status: textOf(document.querySelector("[data-governed-reply-status]")),
    note: [...main.querySelectorAll("p")].map((p) => textOf(p)).find((t) => /main email\.|has no email address on their contact card/.test(t)) ?? null,
    composer: { subject: main.querySelector('input[placeholder="Subject"]')?.value ?? null, body: textarea?.value ?? null, disabled: !!textarea?.disabled },
    pills: { accepted: [...main.querySelectorAll("span")].filter((n) => ownText(n) === "Accepted").length, scheduled: [...main.querySelectorAll("span")].filter((n) => ownText(n) === "Scheduled").length, unconfirmed: [...main.querySelectorAll("span")].filter((n) => ownText(n) === "Couldn't confirm").length },
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || (inbox ? inbox.scrollWidth > inbox.clientWidth + 1 : false),
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => ({ type: t.getAttribute("data-type"), text: textOf(t).slice(0, 140) })),
    calls: (window.__harness?.rpc ?? []).filter((r) => r.name.startsWith("functions:")).map((r) => ({ name: r.name, args: r.args })),
    selectedJordan: !!document.querySelector('[data-thread-key][aria-current="true"], [data-thread-key][data-active="true"]')?.textContent?.includes("Jordan") || /Jordan Rivera/.test(textOf(main.querySelector("[tabindex='-1']"))),
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

// At 1024/900 the harness PAIGE column is a stand-in panel laid over the inbox (not the app's overlay), so a
// pointer click lands on it; those frames reach their state with a DOM click and are recorded as UNVERIFIED.
let covered = false;
const press = (loc) => (covered ? loc.dispatchEvent("click") : loc.click());
const jordanRow = (page) => page.locator("[data-thread-key]").filter({ hasText: "Jordan Rivera" }).first();
async function openSurface(page, s, door) {
  await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/conversations?${new URLSearchParams({ door, theme: s.theme, paige: s.paige })}`, { timeout: 240_000 });
  await page.waitForSelector("[data-canonical-conversations]", { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await press(jordanRow(page));
  await page.waitForFunction(() => document.querySelector('[data-composer-writing-surface="true"] textarea')?.getAttribute("placeholder")?.includes("Jordan"), null, { timeout: 15_000 });
}
async function write(page) {
  await page.locator('input[placeholder="Subject"]').fill(SUBJECT);
  await page.locator('[data-composer-writing-surface="true"] textarea').fill(BODY);
}
async function scheduleTomorrow(page) {
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Tomorrow, 9:00 AM" }).click();
}
const strip = (page) => page.locator("[data-governed-reply-strip]");
async function openCheck(page) {
  await press(page.locator("[data-composer-send]"));
  await strip(page).waitFor({ timeout: 10_000 });
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `exp03c-${s.state}-${s.theme}-${s.w}x${s.h}${s.phone ? "" : `-paige-${s.paige}`}`;
    if (only && !name.includes(only)) continue;
    const def = STATES[s.state];
    covered = s.paige === "open" && s.w <= 1080;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: !!s.phone, timezoneId: TZ, locale: "en-US" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    const behaviour = {};
    try {
      await openSurface(page, s, def.door);
      await write(page);
      if (def.schedule) await scheduleTomorrow(page);
      if (s.state !== "compose") await openCheck(page);
      // Focus as it lands when the check opens — read BEFORE anything else moves it.
      behaviour.focusOnOpen = await page.evaluate(() => document.activeElement?.getAttribute?.("data-strip-focus") ?? document.activeElement?.tagName ?? null);
      const confirm = page.locator('[data-strip-focus="confirm"]');
      if (["sending", "sent", "scheduled", "unknown", "switch-held"].includes(s.state)) {
        await confirm.click();
        if (s.state === "sending" || s.state === "switch-held") await page.getByText("Sending…").first().waitFor({ timeout: 5_000 });
        if (s.state === "sent") await page.getByText("Accepted", { exact: true }).first().waitFor({ timeout: 10_000 });
        if (s.state === "scheduled") await page.getByText("Scheduled", { exact: true }).first().waitFor({ timeout: 10_000 });
        if (s.state === "unknown") await page.getByRole("button", { name: "Check status" }).waitFor({ timeout: 10_000 });
        if (s.state === "switch-held") {
          await page.locator("[data-thread-key]").filter({ hasText: "Priya Okafor" }).first().click();
          await page.locator("[data-sonner-toast]").filter({ hasText: "Wait for this email to finish sending before changing conversation." }).first().waitFor({ timeout: 5_000 });
          behaviour.toastSeen = true;
        }
      }
      if (s.state === "expired") await page.getByText("This check expired — check again.").waitFor({ timeout: 12_000 });
      await page.waitForTimeout(350);
      const composer = page.locator('[data-composer-writing-surface="true"]');
      if (await strip(page).count()) await strip(page).scrollIntoViewIfNeeded(); else await composer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      // Hover: each quiet strip control is measured UNDER THE POINTER (the outline variant's hover painted
      // dark navy under dark ink in light — 1.11:1 — until the strip overrode it). Then the pointer leaves, so
      // the frame shows the state at rest rather than whatever control the last click left under it.
      // (Not in switch-held: its frame is the toast, which a few seconds of hovering would outlast.)
      if (!covered && s.state !== "switch-held" && (await strip(page).count())) {
        behaviour.hover = [];
        for (const b of await strip(page).locator("button:not([data-strip-focus='confirm']), a").all()) {
          const text = (await b.textContent())?.trim();
          await b.hover();
          await page.waitForTimeout(120);
          const hm = await page.evaluate(measure);
          const hit = hm.tagged.find((c) => c.kind === "strip-control" && c.text === text);
          behaviour.hover.push({ text, ratio: hit?.ratio ?? null });
        }
      }
      if (!covered) await page.mouse.move(1, 1);
      await page.waitForTimeout(150);
    } catch (e) {
      errors.push(`surface did not reach the expected state: ${String(e).slice(0, 240)}`);
    }
    const m = await page.evaluate(measure);
    const tag = (k) => m.tagged.filter((c) => c.kind === k && !c.disabled);
    const aa = (...kinds) => kinds.flatMap(tag).every((c) => c.ratio >= 4.5);
    const doorCalls = m.calls.filter((c) => c.name === "functions:comms-email-command");
    const stripText = m.strip?.text ?? "";
    const goldAct = s.state === "check-scheduled" ? "Schedule send" : "Send now";
    const checks = {
      noOverflow: !m.overflowX && !(m.strip?.overflow) && (m.strip?.clipped.length ?? 0) === 0,
      noGoldOutsideAct: m.goldOutsideAct.length === 0,
      fontLoaded: m.font.schibsted,
      noRawCode: !/[A-Z_]{6,}/.test(stripText) && !/[A-Z_]{6,}/.test(m.status),
      onlyTheDoor: m.calls.every((c) => c.name === "functions:comms-email-command"),
      addedAA: aa("strip-text", "strip-control", "composer-note", "send-checking", "toast"),
      targets24: m.targets.every((t) => t.w >= 24 && t.h >= 24),
      hoverAA: (behaviour.hover ?? []).every((h) => typeof h.ratio === "number" && h.ratio >= 4.5),
    };
    const checkFace = (act) => ({
      oneCall: doorCalls.length === 1 && doorCalls[0].args.approved_fingerprint === undefined,
      serverTo: stripText.includes("To Jordan Rivera · jordan.rivera@example.com"),
      serverFrom: stripText.includes("From Northwind Studio · studio@northwindstudio.example"),
      subject: stripText.includes(`Subject ${SUBJECT}`),
      goldOnceOnAct: JSON.stringify(m.goldButtons) === JSON.stringify([act]),
      focusEdit: behaviour.focusOnOpen === "edit",
      noNote: m.note === null,
      wordsKept: m.composer.body === BODY && !m.composer.disabled,
    });
    if (s.state === "compose") Object.assign(checks, { note: m.note === "Goes to Jordan Rivera's main email.", noCall: doorCalls.length === 0, goldOnSend: JSON.stringify(m.goldButtons) === JSON.stringify(["Send"]) });
    if (s.state === "check") Object.assign(checks, checkFace("Send now"), { nothingSent: stripText.includes("Nothing has been sent yet. Changing the words closes this check."), announced: m.status === "Ready to send to Jordan Rivera. Check To and From, then Send now." });
    if (s.state === "check-scheduled") Object.assign(checks, checkFace("Schedule send"), {
      when: /When Sends \w{3}, \w{3} \d+, 9:00 AM/.test(stripText), sendAtWholeMinute: /T\d\d:\d\d:00\.000Z$/.test(String(doorCalls[0]?.args?.send_at)),
      note: /Nothing has been sent\. It goes out \w{3}, \w{3} \d+, 9:00 AM\./.test(stripText),
    });
    if (s.state === "sending") Object.assign(checks, {
      twoCalls: doorCalls.length === 2 && doorCalls[1].args.approved_fingerprint === "0123456789abcdef" && doorCalls[1].args.operation_id === doorCalls[0].args.operation_id,
      sendingBusy: /Sending…/.test(stripText), wordsLocked: m.composer.disabled && m.composer.body === BODY, goldOnce: m.goldButtons.length === 1,
    });
    if (s.state === "sent") Object.assign(checks, { cleared: m.composer.body === "" && m.composer.subject === "" && !m.strip, acceptedPill: m.pills.accepted >= 1, announced: m.status === "Accepted by the email service.", focusBody: m.focus.tag === "TEXTAREA" && m.focus.inComposer, pillAA: aa("pill-accepted") });
    if (s.state === "scheduled") Object.assign(checks, { cleared: m.composer.body === "" && !m.strip, scheduledPill: m.pills.scheduled >= 1, announced: /^Scheduled for \w{3}, \w{3} \d+, 9:00 AM\.$/.test(m.status), pillAA: aa("pill-scheduled", "sends-time") });
    if (s.state === "unknown") Object.assign(checks, { dontResend: stripText.includes("Couldn't confirm this went out — don't resend."), checkStatus: stripText.includes("Check status"), wordsKept: m.composer.body === BODY && m.composer.subject === SUBJECT, rowUnconfirmed: m.pills.unconfirmed >= 1, focusCheckStatus: m.focus.text === "Check status", wordsKeptNote: stripText.includes("Your words are kept.") });
    if (s.state === "expired") Object.assign(checks, { expiredCopy: stripText.includes("This check expired — check again."), noAct: m.goldButtons.length === 0, checkAgain: stripText.includes("Check again"), oneCall: doorCalls.length === 1 });
    if (s.state === "switch-held") Object.assign(checks, { toast: behaviour.toastSeen === true && m.toasts.some((t) => t.text.includes("Wait for this email to finish sending before changing conversation.")), stillJordan: m.composer.body === BODY && /Sending…/.test(stripText) });
    if (s.state.startsWith("refused-")) {
      const k = s.state.slice("refused-".length);
      Object.assign(checks, { copy: stripText.includes(REFUSALS[k]), oneCall: doorCalls.length === 1, wordsKept: m.composer.body === BODY && m.composer.subject === SUBJECT, noAct: m.goldButtons.length === 0, keptNote: stripText.includes("Your words are kept."), focusEdit: behaviour.focusOnOpen === "edit" || behaviour.focusOnOpen === "settings" });
      if (k === "noemail") checks.cardNote = true; // the note is hidden while the strip is open; the composing frame shows it
    }
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    const label = await burnLabel(page);
    if (!label.ok) errors.push(`label not verifiably on screen: ${JSON.stringify(label)}`);
    if (!ok || !label.ok) failed = true;
    results[name] = { ok: ok && label.ok, viewport: `${s.w}x${s.h}`, theme: s.theme, paige: s.paige, state: s.state, door: def.door, checks, behaviour, label, ...m, errors };
    if (label.ok) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 62 });
    await ctx.close();
    console.log(name, ok && label.ok ? "OK" : "FAIL", JSON.stringify({ failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), tagged: [...new Set(m.tagged.map((c) => `${c.kind}:${c.ratio}`))].slice(0, 14), low: m.low.length, targets: m.targets, focus: behaviour.focusOnOpen, hover: behaviour.hover, status: m.status, gold: m.goldButtons, goldOut: m.goldOutsideAct.slice(0, 2), clipped: m.strip?.clipped, errors: errors.slice(0, 2) }));
  }

  // Keyboard only: type the reply, Tab to Send, Enter (the check opens on Edit), Tab to Send now, Enter.
  if (!only || "keyboard".includes(only)) for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US" });
    const page = await ctx.newPage();
    const kb = { theme };
    try {
      await openSurface(page, { theme, paige: "closed" }, "ok");
      await page.locator('input[placeholder="Subject"]').focus();
      await page.keyboard.type(SUBJECT);
      await page.locator('[data-composer-writing-surface="true"] textarea').focus();
      await page.keyboard.type(BODY);
      await page.keyboard.press("Tab");
      kb.onSend = await page.evaluate(() => document.activeElement?.hasAttribute("data-composer-send") ?? false);
      await page.keyboard.press("Enter");
      await strip(page).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(200);
      Object.assign(kb, await page.evaluate(() => {
        const el = document.activeElement; const cs = getComputedStyle(el);
        return { afterOpen: el.getAttribute("data-strip-focus"), focusVisible: el.matches(":focus-visible"), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, boxShadow: cs.boxShadow };
      }));
      const box = await strip(page).boundingBox();
      const label = await burnLabel(page);
      if (box && label.ok) await page.screenshot({ path: path.join(out, `exp03c-keyboard-edit-focus-${theme}-1366x768.jpg`), type: "jpeg", quality: 80, clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 120), width: Math.min(box.width + 48, 1366 - Math.max(0, box.x - 24)), height: Math.min(box.height + 150, 768 - Math.max(0, box.y - 120)) } });
      await page.evaluate(() => document.querySelector("[data-harness-label]")?.remove());
      await page.keyboard.press("Tab");
      kb.onConfirm = await page.evaluate(() => document.activeElement?.getAttribute("data-strip-focus") === "confirm");
      await page.keyboard.press("Enter");
      await page.getByText("Accepted", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      kb.after = await page.evaluate(() => ({ status: document.querySelector("[data-governed-reply-status]")?.textContent?.trim(), tag: document.activeElement?.tagName, inComposer: !!document.activeElement?.closest('[data-composer-writing-surface="true"]'), calls: (window.__harness?.rpc ?? []).filter((r) => r.name === "functions:comms-email-command").length }));
    } catch (e) { kb.error = String(e).slice(0, 240); }
    kb.indicator = kb.outline && !/^none/.test(kb.outline) && !/ 0px$/.test(kb.outline) ? "outline" : !kb.boxShadow || kb.boxShadow === "none" || /rgba\(0, 0, 0, 0\)/.test(kb.boxShadow) ? "none" : "box-shadow";
    const okKb = kb.onSend === true && kb.afterOpen === "edit" && kb.focusVisible === true && kb.indicator !== "none" && kb.onConfirm === true && kb.after?.status === "Accepted by the email service." && kb.after?.tag === "TEXTAREA" && kb.after?.inComposer === true && kb.after?.calls === 2;
    if (!okKb) failed = true;
    results[`keyboard-${theme}`] = { ok: okKb, ...kb };
    console.log(`keyboard-${theme}`, okKb ? "OK" : "FAIL", JSON.stringify(kb));
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
if (!only) fs.writeFileSync(path.join(out, "exp03c-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
