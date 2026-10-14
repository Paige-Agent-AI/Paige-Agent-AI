// Experience 04 E4-S3 PR beta — render "Where {client} stands" (client-standing-mount) in every state and
// both themes, desktop and phone, and MEASURE it: text and pill contrast (AA 4.5:1), link target size on
// the phone, horizontal overflow, gold spent (must be none), the section's place in the record, and page
// errors. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo record is owed.
//
//   node scripts/live-drive/harness/client-standing-mount/standing-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "scripts/live-drive/artifacts/exp04-e4s3-client-standing");
fs.mkdirSync(out, { recursive: true });
const PORT = 5227;
const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const shots = [];
// Frames are tall enough to hold the whole section: the record scrolls beneath a sticky header, so a short
// frame would crop the section or catch the header over it.
for (const state of ["populated", "empty", "nozone", "refused", "error", "loading"]) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 1440, h: 1500 });
for (const theme of ["light", "dark"]) shots.push({ state: "populated", theme, w: 390, h: 1900, phone: true }, { state: "nozone", theme, w: 390, h: 1900, phone: true });
// The Solo frame matrix (ui-delivery evidence): four viewports × PAIGE closed / open × both themes.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ state: "populated", theme, w, h, paige, matrix: true });

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

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = s.matrix ? `beta-standing-matrix-${s.paige}-${s.theme}-${s.w}x${s.h}` : `beta-standing-${s.state}-${s.theme}${s.phone ? "-phone" : ""}`;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: !!s.phone });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // A missing favicon is the harness's, not the surface's; every other failed resource is an error.
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/people?${new URLSearchParams({ person: CLIENT, state: s.state, theme: s.theme, paige: s.paige ?? "closed" })}`);
    await page.waitForSelector("#client-standing", { timeout: 30_000 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      // color-mix() computes to `color(srgb r g b [/ a])` with 0–1 channels; rgb() has 0–255 ones.
      const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
      const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
      const bgOf = (el) => { let acc = null; for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!c || /rgba\(0, 0, 0, 0\)|transparent/.test(c)) continue; const p = parse(c); if (p.length > 3 && p[3] < 1) { acc = acc ? acc : c; continue; } return acc ? blend(acc, c) : c; } return "rgb(255,255,255)"; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
      const section = document.querySelector("#client-standing");
      const texts = [...section.querySelectorAll("h3, strong, span, dt, dd, small, p, a, button, li > span")].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.getClientRects().length);
      const contrast = texts.map((n) => ({ text: n.textContent.trim().slice(0, 40), ratio: ratio(getComputedStyle(n).color, bgOf(n)) }));
      const low = contrast.filter((c) => c.ratio < 4.5);
      const root = getComputedStyle(section);
      const golds = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map((v) => root.getPropertyValue(v).trim()).filter(Boolean);
      const probe = document.createElement("i"); document.body.append(probe);
      const goldRgb = golds.map((g) => { probe.style.color = g; return getComputedStyle(probe).color; }); probe.remove();
      const gold = [...section.querySelectorAll("*")].filter((n) => { const cs = getComputedStyle(n); return goldRgb.some((g) => cs.color === g || cs.backgroundColor === g || cs.borderTopColor === g || cs.outlineColor === g); }).length;
      const targets = [...section.querySelectorAll("a, button")].filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return { text: n.textContent.trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) }; });
      const first = document.querySelector(".trc-record-body")?.firstElementChild?.id ?? null;
      const scroller = section.closest(".trc-record-scroll");
      return {
        first, low, contrastMin: contrast.length ? Math.min(...contrast.map((c) => c.ratio)) : null, gold, targets,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false) || section.scrollWidth > section.clientWidth + 1,
        pills: [...section.querySelectorAll(".trc-standing-state span")].map((p) => ({ text: p.textContent, ratio: ratio(getComputedStyle(p).color, bgOf(p)) })),
        heading: section.querySelector("h3")?.textContent ?? null,
        linkColor: (() => { const a = section.querySelector("a"); return a ? getComputedStyle(a).color : null; })(),
        primary: getComputedStyle(section).getPropertyValue("--primary").trim(),
        text: section.innerText.slice(0, 400),
        // Decision 1: a row's name and its state share one line in the narrow pane (name left, state right),
        // and no width ever stacks the pill above the name as a kicker.
        sectionW: Math.round(section.getBoundingClientRect().width),
        rows: [...section.querySelectorAll(".trc-standing-row:not(.trc-standing-skeleton)")].filter((r) => r.getClientRects().length).map((r) => {
          const l = r.querySelector(".trc-standing-label").getBoundingClientRect(), p = r.querySelector(".trc-standing-state > span").getBoundingClientRect();
          const mid = (b) => (b.top + b.bottom) / 2;
          return { label: r.querySelector(".trc-standing-label").textContent, pillAbove: p.bottom <= l.top + 1, sameLine: Math.abs(mid(l) - mid(p)) < 8, pillRight: p.left > l.left, labelPx: getComputedStyle(r.querySelector(".trc-standing-label")).fontSize };
        }),
        // Decision 3: a held Overdue spans the money grid; sentence and link on their own lines; the arrow on the link's last line.
        held: (() => {
          const cell = section.querySelector(".trc-standing-money-wide"); if (!cell) return null;
          const dl = cell.parentElement.getBoundingClientRect(), c = cell.getBoundingClientRect();
          const sentence = cell.querySelector("dd > span").getBoundingClientRect(), link = cell.querySelector("dd a"), lr = link.getBoundingClientRect();
          const tail = link.querySelector(".trc-standing-link-tail").getBoundingClientRect(), arrow = link.querySelector("svg").getBoundingClientRect();
          const lines = link.getClientRects().length;
          return { spans: Math.abs(c.width - dl.width) < 2, ownLines: sentence.bottom <= lr.top + 8, linkLines: lines, arrowWithText: arrow.top >= tail.top - 2 && arrow.bottom <= tail.bottom + 2 && arrow.left >= tail.left, text: link.textContent };
        })(),
      };
    });
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44) : [];
    const narrow = m.sectionW <= 560;
    const rowsOk = m.rows.every((r) => !r.pillAbove && (!narrow || (r.sameLine && r.pillRight)));
    const heldOk = m.held === null ? s.state !== "nozone" : m.held.spans && m.held.ownLines && m.held.arrowWithText;
    const ok = errors.length === 0 && m.first === "client-standing" && !m.overflowX && m.gold === 0 && m.low.length === 0 && smallTargets.length === 0 && rowsOk && heldOk;
    if (!ok) failed = true;
    results[name] = { ...m, smallTargets, errors, ok };
    const box = await page.locator(".trc-client-record").boundingBox();
    // A matrix frame is the whole viewport as the owner sees it; the state frames are the record itself.
    await page.screenshot({ path: path.join(out, `${name}.png`), ...(s.matrix ? {} : { clip: box ?? undefined }) });
    if (!s.phone && s.state === "populated") await page.screenshot({ path: path.join(out, `${name}-workspace.png`), clip: { x: 0, y: 0, width: s.w, height: 1000 } });
    await ctx.close();
    console.log(name, ok ? "OK" : "FAIL", JSON.stringify({ sectionW: m.sectionW, rows: m.rows.map((r) => `${r.label}:${r.sameLine ? "1line" : "split"}${r.pillAbove ? ":PILL-ABOVE" : ""}`), held: m.held, link: m.linkColor, primary: m.primary, first: m.first, contrastMin: m.contrastMin, low: m.low.slice(0, 3), pills: m.pills, gold: m.gold, overflowX: m.overflowX, smallTargets, errors: errors.slice(0, 2) }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "beta-standing-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
