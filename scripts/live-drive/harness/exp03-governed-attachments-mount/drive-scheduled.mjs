// EXP03 chat scheduled email — render the REAL Solo PAIGE chat's email approval card for an email Paige scheduled
// for later (main.tsx ?send_at=): the When row and the "Schedule send" act, with 0 and 1 files, in the shell's PAIGE
// dock at 1366x768 (355px) and 1536x770 (400px), full width at 1366x768 and 390x844, light and dark, reduced
// motion, timezone America/Chicago. A control frame without send_at must show no When row and read "Approve".
// Every frame is MEASURED before it is labelled: When-row contrast on its composited ground, overflow, gold paints
// in the row, the act's label, Tab stops (the row adds none) and the face that loaded.
//
//   node scripts/live-drive/harness/exp03-governed-attachments-mount/drive-scheduled.mjs [--out dir] [--only substring]
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo chat and a real scheduled send are owed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "docs/evidence/ui-delivery/assets/exp03-chat-scheduled-email");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5197;
const LABEL = "harness render · not live";
const SEND_AT = "2026-11-03T15:00:00.000Z"; // 9:00 AM Tue, Nov 3 in America/Chicago (CST)
const WHEN = "Sends Tue, Nov 3, 9:00 AM CST"; // the shared label names the zone (review MAJOR 1)

const shots = [];
for (const theme of ["light", "dark"]) {
  for (const files of [0, 1]) {
    shots.push({ files, theme, w: 1366, h: 768, layout: "dock", when: true });
    shots.push({ files, theme, w: 1536, h: 770, layout: "dock", when: true });
    shots.push({ files, theme, w: 1366, h: 768, layout: "phone", when: true, tag: "wide" });
    shots.push({ files, theme, w: 390, h: 844, layout: "phone", when: true });
  }
  shots.push({ files: 0, theme, w: 1366, h: 768, layout: "dock", when: false, tag: "control" });
}

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

function measure() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const over = (fg, bg) => { const f = parse(fg), b = parse(bg); return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * f[3] + b[i] * (1 - f[3]))).join(",")})`; };
  const behind = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (parse(bg)[3] > 0) layers.push(bg); if (parse(bg)[3] >= 1) break; }
    return layers.reverse().reduce((acc, l) => over(l, acc), "rgb(255,255,255)"); };
  const ratio = (el) => { const bg = behind(el); const fg = over(getComputedStyle(el).color, bg); const [x, y] = [lum(fg), lum(bg)].sort((a, b) => b - a); return Number(((x + 0.05) / (y + 0.05)).toFixed(2)); };
  const tokenRgb = (t) => { const p = document.createElement("i"); p.style.color = `var(${t})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const key = (c) => parse(c).slice(0, 3).join(",");
  const goldKeys = new Set(["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map(tokenRgb).filter((c) => c && c !== "rgb(0, 0, 0)").map(key));
  const hueGold = (c) => { const [r0, g0, b0, a] = parse(c); if (a < 0.15) return false; const [r, g, b] = [r0, g0, b0].map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return false; const s = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return h >= 30 && h <= 52 && s >= 0.4 && l >= 0.3 && l <= 0.85; };
  const row = document.querySelector("[data-confirm-when]");
  const dt = row?.querySelector("dt"), dd = row?.querySelector("dd");
  const rowGold = row ? [row, ...row.querySelectorAll("*")].flatMap((n) => { const cs = getComputedStyle(n); return [cs.color, cs.backgroundColor, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null].filter(Boolean).filter((c) => parse(c)[3] > 0 && (goldKeys.has(key(c)) || hueGold(c))).map((c) => `${n.tagName}:${c}`); }) : [];
  const env = document.querySelector("[data-confirm-preview]");
  const act = [...document.querySelectorAll("button")].find((b) => /^(Approve|Schedule send)/.test(b.textContent.trim()));
  const ar = act?.getBoundingClientRect();
  const transcript = document.querySelector("#solo-paige-transcript");
  const lh = dd ? parseFloat(getComputedStyle(dd).lineHeight) || 18 : 18;
  const fam = getComputedStyle(dd ?? document.querySelector("textarea")).fontFamily; const first = fam.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return {
    font: { first, loaded: document.fonts.check(`14px "${first}"`) && [...document.fonts].some((f) => f.family.replace(/["']/g, "") === first && f.status === "loaded") },
    when: row ? { label: dt.textContent, value: dd.textContent, labelRatio: ratio(dt), valueRatio: ratio(dd), labelFont: getComputedStyle(dt).fontSize, valueFont: getComputedStyle(dd).fontSize, valueWeight: getComputedStyle(dd).fontWeight,
      valueLines: Math.round(dd.getBoundingClientRect().height / lh), overflow: row.scrollWidth > row.clientWidth + 1 || dd.getBoundingClientRect().right > (env?.getBoundingClientRect().right ?? Infinity) + 1, lastInList: row.parentElement?.lastElementChild === row } : null,
    rowGold,
    envelopeWidth: env ? Math.round(env.getBoundingClientRect().width) : null,
    cardOverflow: env ? env.scrollWidth > env.clientWidth + 1 : null,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    transcriptOverflowX: transcript ? transcript.scrollWidth > transcript.clientWidth + 1 : null,
    act: act ? { text: act.textContent.trim(), inView: ar.top >= 0 && ar.bottom <= innerHeight, background: getComputedStyle(act).backgroundColor, actRatio: ratio(act) } : null,
    summaryShown: document.body.innerText.includes("scheduled for 2026"),
  };
}

async function burnLabel(page) {
  return page.evaluate((LABEL) => {
    const el = document.createElement("div");
    el.setAttribute("data-harness-label", "");
    el.textContent = LABEL;
    Object.assign(el.style, { position: "fixed", left: "8px", bottom: "8px", zIndex: "2147483647", padding: "3px 10px", borderRadius: "999px", font: "600 12px/16px system-ui, sans-serif", letterSpacing: ".04em", background: "#111", color: "#fff", border: "1px solid #fff" });
    document.body.append(el);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: r.width > 40 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight && (top === el || el.contains(top)) };
  }, LABEL);
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `exp03c-${s.tag === "control" ? "control" : `files${s.files}`}-${s.theme}-${s.w}x${s.h}${s.tag === "wide" ? "-wide" : ""}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: s.w < 500, locale: "en-US", timezoneId: "America/Chicago" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    const tabs = [];
    try {
      const q = new URLSearchParams({ files: String(s.files), theme: s.theme, layout: s.layout, ...(s.when ? { send_at: SEND_AT } : {}) });
      await page.goto(`http://127.0.0.1:${PORT}/?${q}`, { timeout: 240_000 });
      await page.waitForSelector("textarea", { timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.locator("textarea").fill("Send Maya the spring proposal Tuesday at 9am.");
      await page.keyboard.press("Enter");
      await page.getByText("Spring proposal and site plan").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(700);
      await page.locator("[data-confirm-preview]").last().evaluate((el) => el.closest("li")?.parentElement?.parentElement?.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(300);
    } catch (e) { errors.push(`surface did not reach the expected state: ${String(e).slice(0, 240)}`); }
    const m = await page.evaluate(measure);
    const label = await burnLabel(page);
    if (!label.ok) errors.push("label not verifiably on screen");
    if (label.ok) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 70 });
    await page.evaluate(() => document.querySelector("[data-harness-label]")?.remove());
    if (s.layout === "dock") {
      await page.evaluate(() => document.querySelector("textarea")?.blur());
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, text: (a?.getAttribute("aria-label") ?? a?.textContent ?? "").trim().slice(0, 40), inRow: !!a?.closest("[data-confirm-when]") }; });
        tabs.push(f);
        if (/^(Approve|Schedule send)/.test(f.text)) break;
      }
    }
    const want = s.when ? "Schedule send" : "Approve";
    const checks = {
      fontLoaded: m.font.loaded, noPageOverflow: !m.pageOverflow, noTranscriptOverflowX: m.transcriptOverflowX !== true, noCardOverflow: m.cardOverflow !== true,
      act: m.act?.text === want, summaryNotRepeated: !m.summaryShown,
      ...(s.when ? {
        whenRow: !!m.when && m.when.label === "When" && m.when.value === WHEN && m.when.lastInList,
        aaText: !!m.when && m.when.labelRatio >= 4.5 && m.when.valueRatio >= 4.5,
        noWhenOverflow: !!m.when && !m.when.overflow,
        noGoldInRow: m.rowGold.length === 0,
      } : { noWhenRow: m.when === null }),
      ...(s.layout === "dock" ? { noTabStopInRow: tabs.length > 0 && tabs.every((t) => !t.inRow), tabReachesAct: tabs.some((t) => t.text.startsWith(want)) } : {}),
    };
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    if (!ok || !label.ok) failed = true;
    results[name] = { ok: ok && label.ok, files: s.files, theme: s.theme, viewport: `${s.w}x${s.h}`, layout: s.layout, sendAt: s.when ? SEND_AT : null, checks, ...m, tabs: tabs.length, errors };
    await ctx.close();
    console.log(name, ok && label.ok ? "OK" : "FAIL", JSON.stringify({ failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), when: m.when, act: m.act, env: m.envelopeWidth, gold: m.rowGold, tabs: tabs.length, errors: errors.slice(0, 2) }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
if (!only) fs.writeFileSync(path.join(out, "exp03c-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
