#!/usr/bin/env node
// Hover contrast of the shared outline and ghost buttons, measured UNDER THE POINTER, light and dark.
//
// Why: the outline and ghost variants of src/components/ui/button.tsx hovered to --secondary, which is defined
// only in :root (dark navy) and redefined by no theme scope — so in light, hovering any of them put dark text
// on a dark fill. The owner approved the platform-wide fix (2026-10-27: "Yes", answering "Want me to fix it
// everywhere?"). This drive measures the same buttons before and after, on three surfaces:
//   1. the Conversations composer toolbar (Attach · Dictate · Draft with Paige · Schedule) and the inline check strip,
//   2. the Conversations thread header (ghost icon actions),
//   3. Solo Settings destinations that render outline/ghost buttons (Security & data · Integrations · Connections · Team).
//
// Every outline/ghost button found on the page is hovered with the real pointer; its text colour is measured
// against the composited background under it (the scheduled-send drive's method). Icon-only buttons carry no
// text; their glyph is drawn in currentColor, so the same ratio is reported and flagged `icon` (AA for a
// non-text glyph is 3:1; the owner's bar here is 4.5:1 and both are reported).
//
//   node scripts/live-drive/harness/exp03-composer-inline-check-mount/hover-measure.mjs --label before --out <file.json>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const label = arg("--label") ?? "run";
const outFile = path.resolve(repo, arg("--out") ?? `docs/evidence/ui-delivery/assets/exp03-composer-inline-check/exp03c-hover-${label}.json`);
const SUBJECT = "Re: Kitchen refresh — scope questions";
const BODY = "Hardware is included in the quote. I'll bring samples to Thursday's walkthrough.";

function startVite(config, port) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", config, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 90_000);
  });
}
const stop = (child) => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } };

// Tags every visible outline/ghost Button (old or new classes) with data-hm=<index>; returns their descriptors.
function tagButtons(scopeSel) {
  const scope = scopeSel ? document.querySelector(scopeSel) : document.body;
  if (!scope) return [];
  for (const n of document.querySelectorAll("[data-hm]")) n.removeAttribute("data-hm");
  const out = [];
  const visible = (n) => { const r = n.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(n); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  for (const b of scope.querySelectorAll("button, a")) {
    const t = (b.getAttribute("class") ?? "").split(/\s+/);
    const outline = t.includes("bg-transparent") && t.includes("hover:border-primary/40");
    const ghost = !outline && t.includes("hover:shadow-sm") && t.includes("hover:text-foreground") && !t.includes("bg-secondary") && !t.includes("bg-primary");
    if (!outline && !ghost) continue;
    if (!visible(b) || b.disabled) continue;
    const i = out.length;
    b.setAttribute("data-hm", String(i));
    const text = (b.textContent ?? "").replace(/\s+/g, " ").trim();
    out.push({ i, variant: outline ? "outline" : "ghost", name: text || b.getAttribute("aria-label") || b.getAttribute("title") || "(unnamed)", icon: !text });
  }
  return out;
}

function measureOne(i) {
  const el = document.querySelector(`[data-hm="${i}"]`);
  if (!el) return null;
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data].map((v, k) => (k === 3 ? v / 255 : v)); };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alphaOf = (c) => parse(c)[3];
  const over = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = alphaOf(fg); return `rgb(${[0, 1, 2].map((k) => Math.round(f[k] * a + b[k] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const layerColors = (n) => { const cs = getComputedStyle(n); const stops = /gradient/.test(cs.backgroundImage) ? (cs.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\))/g) ?? []) : []; return [cs.backgroundColor, ...stops].filter((c) => !transparent(c)); };
  const layers = [];
  for (let n = el; n; n = n.parentElement) { const cols = layerColors(n); if (!cols.length) continue; layers.push(cols); if (cols.every((c) => alphaOf(c) >= 1)) break; }
  let base = ["rgb(255,255,255)"];
  if (layers.length && layers[layers.length - 1].every((c) => alphaOf(c) >= 1)) base = layers.pop();
  else { const b = getComputedStyle(document.body).backgroundColor; if (!transparent(b)) base = [b]; }
  let acc = base;
  while (layers.length) { const top = layers.pop(); acc = top.flatMap((t) => acc.map((a) => over(t, a))).slice(0, 24); }
  const fgRaw = getComputedStyle(el).color;
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const ratios = acc.map((bg) => ratio(alphaOf(fgRaw) < 1 ? over(fgRaw, bg) : fgRaw, bg));
  const worst = Math.min(...ratios);
  return { ratio: worst, fg: fgRaw, bg: acc[ratios.indexOf(worst)], hovered: el.matches(":hover") };
}

// A few hovered controls are also photographed (tight crops of a harness render, not live) so the hover can be SEEN.
const SHOOT = new Set(["Schedule", "Draft with Paige", "Labels", "Sign out", "Copy message"]);
const assets = path.resolve(repo, "docs/evidence/ui-delivery/assets/exp03-composer-inline-check");
let surfaceKey = "";
async function shoot(page, loc, b) {
  const box = await loc.boundingBox();
  if (!box) return null;
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - 28), y = Math.max(0, box.y - 20);
  const clip = { x, y, width: Math.min(vp.width - x, box.width + 56), height: Math.min(vp.height - y, box.height + 40) };
  const file = path.join(assets, `exp03c-hover-${label}-${surfaceKey}-${b.name.toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
  await page.screenshot({ path: file, clip, animations: "disabled", caret: "hide" });
  return path.relative(repo, file);
}

async function measureAll(page, scopeSel) {
  await page.mouse.move(1, 1);
  const buttons = await page.evaluate(tagButtons, scopeSel ?? null);
  const res = [];
  for (const b of buttons) {
    const loc = page.locator(`[data-hm="${b.i}"]`);
    try { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.hover({ timeout: 5000 }); } catch (e) { res.push({ ...b, ratio: null, note: `could not hover: ${String(e).split("\n").slice(0, 3).join(" ").slice(0, 300)}` }); continue; }
    await page.waitForTimeout(260); // the variant's colour transition is 150ms
    const m = await page.evaluate(measureOne, b.i);
    if (SHOOT.has(b.name) && !res.some((x) => x.name === b.name && x.shot)) b.shot = await shoot(page, loc, b);
    const rest = await (async () => { await page.mouse.move(1, 1); await page.waitForTimeout(220); return page.evaluate(measureOne, b.i); })();
    res.push({ ...b, hover: m, rest: rest ? { ratio: rest.ratio, bg: rest.bg } : null });
  }
  return res;
}

const vites = [
  await startVite(path.join(here, "vite.config.ts"), 5199),
  await startVite(path.resolve(here, "../settings-mount/vite.config.ts"), 5202),
];
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = { label, measuredAt: new Date().toISOString(), viewport: "1366x768", surfaces: {} };
try {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, reducedMotion: "reduce", timezoneId: "America/Chicago", locale: "en-US" });
    const page = await ctx.newPage();
    // 1 + 2. Conversations: composer (written, so every toolbar control is enabled) and the thread header.
    await page.goto(`http://127.0.0.1:5199/solo/42/clients/conversations?${new URLSearchParams({ door: "ok", theme, paige: "closed" })}`, { timeout: 240_000 });
    await page.waitForSelector("[data-canonical-conversations]", { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("[data-thread-key]").filter({ hasText: "Jordan Rivera" }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-composer-writing-surface="true"] textarea')?.getAttribute("placeholder")?.includes("Jordan"), null, { timeout: 15_000 });
    await page.locator('input[placeholder="Subject"]').fill(SUBJECT);
    await page.locator('[data-composer-writing-surface="true"] textarea').fill(BODY);
    surfaceKey = `conversations-${theme}`;
    results.surfaces[surfaceKey] = await measureAll(page, "[data-canonical-conversations]");
    await page.locator("[data-composer-send]").click();
    await page.locator("[data-governed-reply-strip]").waitFor({ timeout: 10_000 });
    surfaceKey = `check-strip-${theme}`;
    results.surfaces[surfaceKey] = await measureAll(page, "[data-governed-reply-strip]");
    // 3. Solo Settings destinations.
    for (const dest of ["security-data", "integrations", "connections", "team"]) {
      await page.goto(`http://127.0.0.1:5202/solo/1971670/settings/${dest}?theme=${theme}`, { timeout: 240_000 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.fonts.ready);
      surfaceKey = `settings-${dest}-${theme}`;
      const r = dest === "security-data" ? await measureAll(page, null) : await (async () => { const keep = new Set(SHOOT); SHOOT.clear(); try { return await measureAll(page, null); } finally { keep.forEach((n) => SHOOT.add(n)); } })();
      if (r.length) results.surfaces[`settings-${dest}-${theme}`] = r;
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  vites.forEach(stop);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
for (const [k, list] of Object.entries(results.surfaces)) {
  const seen = new Set();
  const uniq = list.map((b) => `${b.variant}:${b.name.slice(0, 24)}=${b.hover?.ratio ?? "n/a"}${b.icon ? "(icon)" : ""}`).filter((x) => !seen.has(x) && seen.add(x));
  console.log(`${k}: ${uniq.join(" | ")}`);
}
console.log("wrote", path.relative(repo, outFile));
