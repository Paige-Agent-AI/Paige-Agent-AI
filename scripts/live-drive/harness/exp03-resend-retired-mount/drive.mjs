// EXP03 (Resend retired) — render the owner's canonical inbox (exp03-resend-retired-mount) with one outbound
// email in each end state — Sent, Failed (a definitive SendGrid refusal) and Couldn't confirm (SendGrid's answer
// was lost, so it may already be in the client's inbox) — and drive Approve & send into an unconfirmed answer
// so the warning toast is on screen. Every frame is MEASURED before it is labelled: text contrast against the
// real composited background (AA 4.5:1) for the EXP03 elements (the pill, the don't-resend line, the toast) and
// for everything else on screen (reported), horizontal overflow, gold spent outside an act, the face that
// loaded, page errors, and the behaviour each state claims.
//
// Starts its own Vite (--host 127.0.0.1 --port 5199) and drives it in the same process — the sandbox reaps a
// server left running between shells (harness README).
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo inbox and a real SendGrid send are owed.
//
//   node scripts/live-drive/harness/exp03-resend-retired-mount/drive.mjs [--out dir] [--only substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/exp03-resend-retired");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5199;
const PILL = "Couldn't confirm";
const LINE = "Couldn't confirm this went out — don't resend.";
const TOAST = "We couldn't confirm it was sent — it may already be with them. Don't send it again until you've asked them.";
const LABEL = "harness render · not live";

const shots = [];
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ state: "thread", theme, w, h, paige });
for (const theme of ["light", "dark"]) shots.push({ state: "thread", theme, w: 390, h: 844, paige: "closed", phone: true });
for (const theme of ["light", "dark"]) shots.push({ state: "approve", theme, w: 1366, h: 768, paige: "closed" });
for (const theme of ["light", "dark"]) shots.push({ state: "approve", theme, w: 390, h: 844, paige: "closed", phone: true });

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

// Measured in the page. Returns contrast for every visible text run, tagging the EXP03 elements.
function measure({ PILL, LINE, TOAST }) {
  // A surface that never mounted is a failed frame with nothing to measure — never a crash that hides why.
  if (!document.querySelector("#tenant-shell-main")) return { mounted: false, font: { schibsted: false }, exp03: [], low: [], goldOutsideAct: [], goldElsewhere: [], warningInExp03: [], toasts: [], calls: [], counts: { pill: 0, line: 0, failed: 0, rawUnconfirmed: 0, approve: 0 }, overflowX: false };
  // Every computed colour is normalised through a 1×1 canvas: color-mix(in oklab, …) computes to an oklab()
  // string in this Chromium, which a channel regex would misread as near-black (a false 14:1 / 1.8:1).
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
  const transparent = (c) => !c || c === "transparent" || /rgba\(0, 0, 0, 0\)/.test(c) || alphaOf(c) === 0;
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
  const scopes = [document.querySelector("#tenant-shell-main"), ...document.querySelectorAll("[data-sonner-toast]")].filter(Boolean);
  const textEls = scopes.flatMap((sc) => [sc, ...sc.querySelectorAll("*")]).filter((n) => ownText(n) && visible(n) && inView(n));
  const disabled = (n) => !!n.closest("button:disabled, [aria-disabled='true'], fieldset:disabled");
  const kindOf = (n) => {
    const t = ownText(n);
    if (n.closest("[data-sonner-toast]")) return t === TOAST ? "toast" : "toast-other";
    if (t === PILL) return "pill-unconfirmed";
    if (t === LINE) return "line-unconfirmed";
    if (t === "Failed") return "pill-failed";
    if (/^sendgrid_/.test(t)) return "line-failed";
    if (t === "Sent") return "pill-sent";
    return null;
  };
  const contrast = textEls.filter((n) => !disabled(n)).map((n) => {
    const col = getComputedStyle(n).color;
    const worst = bgCandidates(n).map((bg) => ({ bg, r: ratio(over(col, bg), bg) })).sort((a, b) => a.r - b.r)[0];
    const cs = getComputedStyle(n);
    return { kind: kindOf(n), incidental: !!n.closest("[aria-hidden='true']"), text: ownText(n).slice(0, 60), ratio: worst.r, color: col, bg: worst.bg, size: cs.fontSize, weight: cs.fontWeight };
  });
  const exp03 = contrast.filter((c) => c.kind);
  const low = contrast.filter((c) => c.ratio < 4.5 && !c.incidental);

  // Gold outside an act: any paint equal to a resolved gold token (or in the gold hue band) on something that is
  // not a button drawn as an act (gold variant / gradient). The --warning token is semantic status, reported apart.
  const main = document.querySelector("#tenant-shell-main");
  const host = document.createElement("span"); host.style.color = "rgb(1, 2, 3)"; main.append(host);
  const resolve = (expr) => { const probe = document.createElement("i"); host.append(probe); probe.style.color = expr; const c = getComputedStyle(probe).color; probe.remove(); return c === "rgb(1, 2, 3)" ? null : c; };
  const tokenOf = (t) => resolve(`var(${t})`) ?? resolve(`hsl(var(${t}))`);
  const goldRgb = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep", "--gold", "--gold-dark", "--gold-light", "--accent"].map(tokenOf).filter(Boolean);
  const warningRgb = tokenOf("--warning"); const destructiveRgb = tokenOf("--destructive");
  host.remove();
  const strip = (c) => parse(c).slice(0, 3).map(Math.round).join(",");
  const goldKeys = new Set(goldRgb.map(strip));
  const hueGold = (c) => { if (alphaOf(c) < 0.15) return false; const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return false; const sat = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return h >= 30 && h <= 52 && sat >= 0.4 && l >= 0.3 && l <= 0.85; };
  const isGold = (c) => goldKeys.has(strip(c)) || hueGold(c);
  // The EXP03 elements' own boxes: each unconfirmed bubble (the pill's nearest ancestor that also holds the line)
  // and each toast. Gold inside them fails the frame; gold elsewhere is pre-existing inbox chrome, reported apart.
  const exp03Roots = [
    ...[...main.querySelectorAll("span")].filter((n) => ownText(n) === PILL).map((n) => { let a = n; while (a && !a.textContent.includes(LINE)) a = a.parentElement; return a; }),
    ...document.querySelectorAll("[data-sonner-toast]"),
  ].filter(Boolean);
  const inExp03 = (n) => exp03Roots.some((r) => r.contains(n));
  const goldEls = [...main.querySelectorAll("*"), ...document.querySelectorAll("[data-sonner-toast] *")].filter(visible).flatMap((n) => {
    const cs = getComputedStyle(n);
    const stops = /gradient/.test(cs.backgroundImage) ? (cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) : [];
    const paints = [ownText(n) ? cs.color : null, cs.backgroundColor, ...stops, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null].filter((c) => c && !transparent(c));
    const hit = paints.find(isGold); if (!hit) return [];
    const btn = n.closest("button");
    const act = btn && (/gold/.test(btn.className) || /gradient/.test(getComputedStyle(btn).backgroundImage));
    const draftCard = n.closest("div.rounded-xl") && /Paige drafted/.test(n.closest("div.rounded-xl").textContent);
    // A paint derived from the semantic --warning token (the StatePill warning class, incl. its color-mix toward ink)
    // is status, not gold; it is reported with its resolved colour so the amber-vs-champagne closeness stays visible.
    const warningClass = !!n.closest('[class*="--warning"]');
    const kind = act ? "act" : draftCard ? "draft-card" : (warningClass || (warningRgb && strip(hit) === strip(warningRgb))) ? "warning" : alphaOf(hit) < 0.2 ? "wash" : "decorative";
    return [{ kind, exp03: inExp03(n), text: (btn ?? n).textContent.trim().slice(0, 40), paint: hit, rgb: `rgb(${parse(hit).slice(0, 3).join(",")})` }];
  });
  // The unconfirmed elements' own colour family: is the line painted with --destructive (red) under an amber pill?
  const lineEl = [...main.querySelectorAll("p")].find((p) => p.textContent.trim() === LINE);
  const lineColor = lineEl ? getComputedStyle(lineEl).color : null;
  const pillEl = [...main.querySelectorAll("span")].find((s) => ownText(s) === PILL);
  const inbox = document.querySelector("[data-canonical-conversations]");
  const text = main.innerText;
  const count = (t) => text.split(t).length - 1;
  // innerText applies text-transform (the pills render uppercase), so the pill words are counted case-blind.
  const countCi = (t) => text.toLowerCase().split(t.toLowerCase()).length - 1;
  return {
    font: { schibsted: document.fonts.check('14px "Schibsted Grotesk"'), bodyFamily: getComputedStyle(pillEl ?? main).fontFamily.slice(0, 60) },
    exp03, low, textCount: contrast.length,
    gold: goldEls.length, goldOutsideAct: goldEls.filter((g) => g.kind === "decorative" && g.exp03), warningInExp03: goldEls.filter((g) => g.kind === "warning" && g.exp03).map((g) => `${g.text} ${g.rgb}`), goldElsewhere: goldEls.filter((g) => g.kind === "decorative" && !g.exp03).map((g) => `${g.text} ${g.paint}`), exp03Roots: exp03Roots.length, goldActs: [...new Set(goldEls.filter((g) => g.kind === "act").map((g) => g.text))],
    tokens: { warning: warningRgb, destructive: destructiveRgb },
    line: lineEl ? { rgb: `rgb(${parse(lineColor).slice(0, 3).join(",")})`, destructiveRgb: destructiveRgb && `rgb(${parse(destructiveRgb).slice(0, 3).join(",")})`, color: lineColor, isDestructive: !!destructiveRgb && strip(lineColor) === strip(destructiveRgb) || /text-destructive/.test(lineEl.className), className: lineEl.className } : null,
    pill: pillEl ? { rgb: `rgb(${parse(getComputedStyle(pillEl).color).slice(0, 3).join(",")})`, bgRgb: `rgba(${parse(getComputedStyle(pillEl).backgroundColor).join(",")})`, color: getComputedStyle(pillEl).color, bg: getComputedStyle(pillEl).backgroundColor, size: getComputedStyle(pillEl).fontSize, className: pillEl.className } : null,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || (inbox ? inbox.scrollWidth > inbox.clientWidth + 1 : false),
    counts: { pill: countCi(PILL) - countCi(LINE), line: count(LINE), failed: [...main.querySelectorAll("span")].filter((n) => ownText(n) === "Failed").length, rawUnconfirmed: count("delivery_unconfirmed"), approve: count("Approve & send") },
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => ({ type: t.getAttribute("data-type"), text: t.textContent.trim().slice(0, 140) })),
    calls: (window.__harness?.rpc ?? []).map((r) => r.name).filter((n) => n.startsWith("functions:")),
  };
}

// Burn the label AFTER every measurement, then prove it is on screen: non-zero box inside the viewport and the
// topmost element at its centre. A frame whose label cannot be proven visible is refused (harness README).
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

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `exp03-${s.state}-${s.theme}-${s.w}x${s.h}${s.phone ? "" : `-paige-${s.paige}`}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: !!s.phone });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/conversations?${new URLSearchParams({ state: s.state, theme: s.theme, paige: s.paige })}`, { timeout: 240_000 });
    const behaviour = {};
    try {
      await page.waitForSelector("[data-canonical-conversations]", { timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      // On a phone the inbox opens on the rail: open Jordan's thread the way an owner would.
      const thread = page.getByText("Walkthrough Thursday at 10", { exact: false }).or(page.getByText("Photos received", { exact: false })).first();
      if (!(await thread.isVisible().catch(() => false))) {
        await page.locator("[data-thread-key]").filter({ hasText: "Jordan Rivera" }).first().click();
      }
      if (s.state === "approve") {
        const approve = page.getByRole("button", { name: "Approve & send" });
        await approve.scrollIntoViewIfNeeded();
        await approve.click();
        await page.locator("[data-sonner-toast]").filter({ hasText: TOAST }).first().waitFor({ timeout: 10_000 });
        behaviour.toastShown = true;
        await page.getByText(LINE).first().waitFor({ timeout: 10_000 });
      }
      await page.getByText(LINE).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    } catch (e) {
      errors.push(`surface did not reach the expected state: ${String(e).slice(0, 240)}`);
    }
    const m = await page.evaluate(measure, { PILL, LINE, TOAST });
    const pill = m.exp03.filter((c) => c.kind === "pill-unconfirmed");
    const line = m.exp03.filter((c) => c.kind === "line-unconfirmed");
    const toast = m.exp03.filter((c) => c.kind === "toast");
    const checks = {
      pillShown: pill.length >= 1,
      lineShown: line.length >= 1,
      pillAA: pill.every((c) => c.ratio >= 4.5),
      lineAA: line.every((c) => c.ratio >= 4.5),
      toastAA: toast.every((c) => c.ratio >= 4.5),
      // The plain failure keeps "Failed"; the unconfirmed email never reads "Failed" and never shows the raw code.
      failedOnlyForTheRealFailure: m.counts.failed === 1,
      noRawUnconfirmedCode: m.counts.rawUnconfirmed === 0,
      toast: s.state === "approve" ? behaviour.toastShown === true && toast.length === 1 && m.toasts.every((t) => t.type === "warning") : m.toasts.length === 0,
      sendOnce: s.state === "approve" ? m.calls.filter((c) => c === "functions:send-message").length === 1 : m.calls.length === 0,
      noResendOffered: m.counts.approve === 0,
      noOverflow: !m.overflowX,
      goldOnlyOnAct: m.goldOutsideAct.length === 0,
      fontLoaded: m.font.schibsted,
    };
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    const label = await burnLabel(page);
    if (!label.ok) errors.push(`label not verifiably on screen: ${JSON.stringify(label)}`);
    if (!ok || !label.ok) failed = true;
    results[name] = { ok: ok && label.ok, viewport: `${s.w}x${s.h}`, theme: s.theme, paige: s.paige, state: s.state, checks, label, ...m, errors };
    if (label.ok) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 72 });
    await ctx.close();
    console.log(name, ok && label.ok ? "OK" : "FAIL", JSON.stringify({ pill: pill.map((c) => c.ratio), line: line.map((c) => `${c.ratio}@${c.color}`), toast: toast.map((c) => c.ratio), failedChecks: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), lowElsewhere: m.low.length, counts: m.counts, gold: m.goldOutsideAct.slice(0, 3), roots: m.exp03Roots, errors: errors.slice(0, 2) }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "exp03-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
