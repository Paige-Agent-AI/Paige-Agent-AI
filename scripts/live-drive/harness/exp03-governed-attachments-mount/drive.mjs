// EXP03 governed attachments — render the REAL Solo PAIGE chat's email approval card (exp03-governed-attachments-mount)
// with 0 (control), 1, 3 (one very long name) and 10 files, in the shell's PAIGE dock at 1366x768 and full width at
// 390x844, light and dark, reduced motion. Every frame is MEASURED before it is labelled: the new File(s) row's text
// contrast against its real composited background, overflow of the row and the card, gold or a gold-hued paint in
// the row, the list's accessible name and its accessibility tree, the paperclip hidden from assistive tech, the
// Tab stops (the row must add none), whether Approve stays reachable, and the face that loaded.
//
// Starts its own Vite (--host 127.0.0.1 --port 5197) and drives it in the same process (harness README).
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo chat and a real send are owed.
//
//   node scripts/live-drive/harness/exp03-governed-attachments-mount/drive.mjs [--out dir] [--only substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "docs/evidence/ui-delivery/assets/exp03-governed-attachments");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5197;
const LABEL = "harness render · not live";

const shots = [];
for (const files of [0, 1, 3, 10]) for (const theme of ["light", "dark"]) {
  shots.push({ files, theme, w: 1366, h: 768, layout: "dock" });
  shots.push({ files, theme, w: 390, h: 844, layout: "phone" });
}
// The widest common dock (26vw at 1536 = 400px) for the long-name case.
for (const theme of ["light", "dark"]) shots.push({ files: 3, theme, w: 1536, h: 770, layout: "dock" });

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
  const row = document.querySelector("[data-confirm-attachments]");
  const card = row?.closest("[role='group'], section, article, [data-paige-confirm]") ?? document.querySelector("[data-paige-message-id]:last-of-type");
  const tokenRgb = (t) => { const p = document.createElement("i"); p.style.color = `var(${t})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const golds = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map(tokenRgb).filter((c) => c && c !== "rgb(0, 0, 0)");
  const key = (c) => parse(c).slice(0, 3).join(",");
  const goldKeys = new Set(golds.map(key));
  const hueGold = (c) => { const [r0, g0, b0, a] = parse(c); if (a < 0.15) return false; const [r, g, b] = [r0, g0, b0].map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return false; const s = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return h >= 30 && h <= 52 && s >= 0.4 && l >= 0.3 && l <= 0.85; };
  const rowGold = row ? [row, ...row.querySelectorAll("*")].flatMap((n) => { const cs = getComputedStyle(n); return [cs.color, cs.backgroundColor, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null].filter(Boolean).filter((c) => parse(c)[3] > 0 && (goldKeys.has(key(c)) || hueGold(c))).map((c) => `${n.tagName}:${c}`); }) : [];
  const dt = row?.querySelector("dt"), dd = row?.querySelector("dd"), ul = row?.querySelector("ul");
  const items = row ? [...row.querySelectorAll("li")].map((li) => {
    const [name, size] = li.querySelectorAll("span.block");
    const svg = li.querySelector("svg");
    const lr = li.getBoundingClientRect(), nr = name.getBoundingClientRect(), sr = size.getBoundingClientRect(), dr = dd.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(name).lineHeight) || 16;
    return { name: name.textContent, size: size.textContent, nameRatio: ratio(name), sizeRatio: ratio(size), nameFont: getComputedStyle(name).fontSize, nameLines: Math.round(nr.height / lh),
      overflow: li.scrollWidth > li.clientWidth + 1 || nr.right > dr.right + 1 || sr.right > dr.right + 1, iconHidden: svg?.getAttribute("aria-hidden") === "true", iconColor: svg ? getComputedStyle(svg).color : null, height: Math.round(lr.height) };
  }) : [];
  const approve = [...document.querySelectorAll("button")].find((b) => /^Approve/.test(b.textContent.trim()));
  const ar = approve?.getBoundingClientRect();
  const transcript = document.querySelector("#solo-paige-transcript");
  return {
    font: (() => { const el = document.querySelector("[data-confirm-attachments] li span") ?? document.querySelector("textarea"); const fam = getComputedStyle(el).fontFamily; const first = fam.split(",")[0].trim().replace(/^["']|["']$/g, ""); return { family: fam.slice(0, 80), first, loaded: document.fonts.check(`14px "${first}"`) && [...document.fonts].some((f) => f.family.replace(/["']/g, "") === first && f.status === "loaded") }; })(),
    row: row ? { label: dt.textContent, labelRatio: ratio(dt), labelFont: getComputedStyle(dt).fontSize, ariaLabel: ul.getAttribute("aria-label"), count: items.length, rowOverflow: row.scrollWidth > row.clientWidth + 1 } : null,
    items,
    rowGold,
    cardOverflow: card ? card.scrollWidth > card.clientWidth + 1 : null,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    transcriptOverflowX: transcript ? transcript.scrollWidth > transcript.clientWidth + 1 : null,
    approve: approve ? { text: approve.textContent.trim(), inView: ar.top >= 0 && ar.bottom <= innerHeight, top: Math.round(ar.top), bottom: Math.round(ar.bottom) } : null,
    summaryShown: document.body.innerText.includes("— with "),
    storagePath: /governed\/|comms-email-attachments|\/storage\/|tenant-/.test(row?.textContent ?? ""),
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
    const name = `exp03a-files${s.files}-${s.theme}-${s.w}x${s.h}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: s.layout === "phone", locale: "en-US" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    let aria = null; const tabs = [];
    try {
      await page.goto(`http://127.0.0.1:${PORT}/?${new URLSearchParams({ files: String(s.files), theme: s.theme, layout: s.layout })}`, { timeout: 240_000 });
      await page.waitForSelector("textarea", { timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.locator("textarea").fill("Send Maya the spring proposal and the site plan.");
      await page.keyboard.press("Enter");
      await page.getByText("Spring proposal and site plan").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(700);
      if (s.files > 0) {
        aria = await page.locator("[data-confirm-attachments]").ariaSnapshot();
        await page.locator("[data-confirm-attachments]").scrollIntoViewIfNeeded();
      } else {
        await page.getByText("Spring proposal and site plan").last().scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(300);
    } catch (e) { errors.push(`surface did not reach the expected state: ${String(e).slice(0, 240)}`); }
    const m = await page.evaluate(measure);
    // Frames first (before the keyboard pass moves focus and scroll), labelled after measurement.
    const label = await burnLabel(page);
    if (!label.ok) errors.push("label not verifiably on screen");
    if (label.ok) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 62 });
    // The docked list is taller than the transcript for 3+ files: a second frame with the transcript scrolled
    // to Approve shows the end of the list and the act together.
    if (label.ok && s.files >= 3 && s.layout === "dock") {
      await page.getByRole("button", { name: "Approve" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `${name}-approve.jpg`), type: "jpeg", quality: 62 });
    }
    await page.evaluate(() => document.querySelector("[data-harness-label]")?.remove());
    // Keyboard: Tab from the composer through the card; the File(s) row must add no stop of its own.
    if (s.layout === "dock") {
      await page.evaluate(() => document.querySelector("textarea")?.blur());
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, text: (a?.getAttribute("aria-label") ?? a?.textContent ?? "").trim().slice(0, 40), inRow: !!a?.closest("[data-confirm-attachments]") }; });
        tabs.push(f);
        if (/^Approve/.test(f.text)) break;
      }
    }
    const checks = {
      fontLoaded: m.font.loaded, noPageOverflow: !m.pageOverflow, noTranscriptOverflowX: m.transcriptOverflowX !== true, noCardOverflow: m.cardOverflow !== true,
      approveFound: !!m.approve,
      ...(s.files === 0 ? { noRow: m.row === null } : {
        row: !!m.row && m.row.count === s.files && m.row.label === (s.files === 1 ? "File" : "Files") && m.row.ariaLabel === (s.files === 1 ? "1 file attached" : `${s.files} files attached`),
        aaText: m.items.every((i) => i.nameRatio >= 4.5 && i.sizeRatio >= 4.5) && m.row.labelRatio >= 4.5,
        noItemOverflow: m.items.every((i) => !i.overflow) && !m.row.rowOverflow,
        iconsHidden: m.items.every((i) => i.iconHidden),
        sizesReadable: m.items.every((i) => /^\d+(\.\d)? (KB|MB)$|^\d+ bytes?$/.test(i.size)),
        noGoldInRow: m.rowGold.length === 0, noStoragePath: !m.storagePath,
        ariaNamesList: typeof aria === "string" && aria.includes(`list "${s.files === 1 ? "1 file attached" : `${s.files} files attached`}"`) && !/img/.test(aria),
      }),
      ...(s.layout === "dock" ? { noTabStopInRow: tabs.length > 0 && tabs.every((t) => !t.inRow), tabReachesApprove: tabs.some((t) => /^Approve/.test(t.text)) } : {}),
    };
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    if (!ok || !label.ok) failed = true;
    results[name] = { ok: ok && label.ok, files: s.files, theme: s.theme, viewport: `${s.w}x${s.h}`, layout: s.layout, checks, ...m, aria, tabs, errors };
    await ctx.close();
    console.log(name, ok && label.ok ? "OK" : "FAIL", JSON.stringify({ font: m.font, failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), row: m.row, items: m.items.map((i) => `${i.size}|${i.nameRatio}/${i.sizeRatio}|lines${i.nameLines}${i.overflow ? "|OVERFLOW" : ""}`), approve: m.approve, gold: m.rowGold, tabs: tabs.length, errors: errors.slice(0, 2) }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
if (!only) fs.writeFileSync(path.join(out, "exp03a-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
