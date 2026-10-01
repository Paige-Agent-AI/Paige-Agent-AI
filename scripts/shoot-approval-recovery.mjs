#!/usr/bin/env node
/**
 * Screenshots the approval recovery states and measures what a screenshot cannot show on its own.
 *
 *   npm run build && npx vitest run src/solo/__render__/approval-recovery.render.test.tsx
 *   node scripts/shoot-approval-recovery.mjs
 *
 * Reads the two pages the render harness writes (the real Solo chat, driven through real frames,
 * with the compiled tokens) and writes, beside them:
 *   - one PNG per state per theme, and each card again at side-panel width;
 *   - render-results.json: whether the real faces loaded, the contrast of every line of text the
 *     recovery design added, whether any card overflows at side-panel width, and what the
 *     entrance does under reduced motion.
 *
 * PROOF CLASS: rendered harness. Not an authenticated runtime drive of Solo.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = "docs/evidence/ui-delivery/solo-approval-recovery";
const executablePath = process.env.PW_EXECUTABLE_PATH
  ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

/**
 * The Solo faces come from Google Fonts. Behind an intercepting proxy the bundled Chromium does not
 * trust the proxy's CA, so the stylesheet fails and every glyph falls back — which a screenshot
 * shows and `document.fonts.check` does not (it answers true for a face that was never declared).
 * Fetch the font requests with curl instead, which verifies TLS against the configured CA bundle,
 * and hand Chromium the real bytes. Certificate checks stay on everywhere.
 */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36";
const fontCache = new Map();
async function routeFonts(ctx) {
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    if (!fontCache.has(url)) fontCache.set(url, execFileSync("curl", ["-sS", "--fail", "-A", UA, url], { maxBuffer: 32 * 1024 * 1024 }));
    await route.fulfill({ status: 200, body: fontCache.get(url), contentType: url.includes("googleapis") ? "text/css" : "font/woff2" });
  });
}
const facesLoaded = (page) => page.evaluate(() => [...document.fonts]
  .filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/"/g, "")} ${f.weight}`)
  .filter((f, i, all) => all.indexOf(f) === i));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Runs in the page: WCAG contrast of an element's text against what is actually behind it. */
function measure(selectors) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const behind = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = rgba(getComputedStyle(n).backgroundColor);
      if (bg.a > 0) layers.push(bg);
    }
    return layers.reverse().reduce((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
  };
  const out = [];
  for (const [label, selector] of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const style = getComputedStyle(el);
      const fg = over(rgba(style.color), behind(el));
      const bg = behind(el);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const scene = el.closest("[data-scene]")?.getAttribute("data-scene");
      out.push({ label, scene, text: (el.textContent ?? "").trim().slice(0, 60), size: style.fontSize, weight: style.fontWeight,
        ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 });
    });
  }
  return out;
}

const TEXT = [
  ["heading", '[data-card-mode="report"] p.font-semibold'],
  ["card note", '[data-card-mode="report"] p[id]'],
  ["row summary", '[data-card-mode="report"] li > span > span:first-child'],
  ["row note", '[data-card-mode="report"] li span.block'],
  ["helper", '[data-card-mode="report"] .mt-3 > span'],
  ["ask again", '[data-card-mode="report"] button'],
  ["check link", '[data-card-mode="report"] a'],
  ["record", '[data-paige-message-id] div.rounded-full'],
  ["receipt heading", "[data-paige-crm-result] p.font-medium"],
];

const browser = await chromium.launch({ executablePath, proxy });
const results = { proofClass: "rendered harness — not an authenticated runtime drive", themes: {} };
try {
  mkdirSync(DIR, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const file = resolve(`${DIR}/approval-recovery.${theme}.html`);
    const r = (results.themes[theme] = {});

    // Wide: the Solo PAIGE workspace column.
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    await page.goto(`file://${file}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    r.faces = await facesLoaded(page);
    if (!r.faces.some((f) => f.startsWith("Schibsted Grotesk"))) throw new Error(`${theme}: the Solo face did not load (${r.faces.join(", ") || "none"})`);
    // Let the one entrance finish; the stills are the resting state.
    await page.waitForTimeout(400);
    const scenes = await page.$$("[data-scene]");
    r.shots = [];
    for (const scene of scenes) {
      const name = `${slug(await scene.getAttribute("data-scene"))}-${theme}.png`;
      await scene.screenshot({ path: `${DIR}/${name}` });
      r.shots.push(name);
    }
    r.contrast = await page.evaluate(measure, TEXT);
    r.cards = await page.evaluate(() => document.querySelectorAll('[role="group"]').length);
    await ctx.close();

    // Narrow: the side panel. Nothing may run off the side of a card.
    const narrow = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
    await routeFonts(narrow);
    const np = await narrow.newPage();
    await np.goto(`file://${file}`, { waitUntil: "networkidle" });
    await np.evaluate(() => document.fonts.ready);
    await np.waitForTimeout(400);
    r.narrowOverflow = await np.evaluate(() => [...document.querySelectorAll('[role="group"], [data-paige-crm-result]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.closest("[data-scene]")?.getAttribute("data-scene")));
    r.pageScrollsSideways = await np.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    // WCAG 1.4.10 reflow is judged at 320 CSS px: nothing may need a sideways scroll there either.
    await np.setViewportSize({ width: 320, height: 900 });
    r.reflow320 = await np.evaluate(() => ({
      overflowingCards: [...document.querySelectorAll('[role="group"], [data-paige-crm-result]')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.closest("[data-scene]")?.getAttribute("data-scene")),
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
    }));
    await np.setViewportSize({ width: 420, height: 900 });
    r.narrowShots = [];
    for (const card of await np.$$('[data-scene] [role="group"]')) {
      const scene = await card.evaluate((el) => el.closest("[data-scene]").getAttribute("data-scene"));
      const name = `side-panel-${slug(scene)}-${theme}.png`;
      await card.screenshot({ path: `${DIR}/${name}` });
      r.narrowShots.push(name);
    }
    await narrow.close();
  }

  // Reduced motion: the card and its seal must not animate for someone who asked for none.
  const rm = await browser.newContext({ viewport: { width: 900, height: 1000 }, reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`file://${resolve(`${DIR}/approval-recovery.light.html`)}`, { waitUntil: "load" });
  results.reducedMotionChecked = await rp.evaluate(() => document.querySelectorAll('[data-card-mode="report"]').length);
  results.reducedMotion = await rp.evaluate(() => [...document.querySelectorAll('[data-card-mode="report"], [data-card-mode="report"] svg')]
    .map((el) => getComputedStyle(el))
    .filter((s) => s.animationName !== "none")
    .map((s) => ({ name: s.animationName, duration: s.animationDuration })));
  await rm.close();
} finally {
  await browser.close();
}

// A check that matched nothing proved nothing: fail rather than report an empty list as clean.
for (const [theme, r] of Object.entries(results.themes)) {
  const measured = new Set(r.contrast.map((c) => c.label));
  const missing = TEXT.map(([label]) => label).filter((label) => !measured.has(label));
  if (missing.length) throw new Error(`${theme}: no element matched for ${missing.join(", ")}`);
  if (r.cards !== 9) throw new Error(`${theme}: only ${r.cards} cards rendered`);
}
if (results.reducedMotionChecked !== 8) throw new Error(`reduced motion checked only ${results.reducedMotionChecked} cards`);
writeFileSync(`${DIR}/render-results.json`, `${JSON.stringify(results, null, 2)}\n`);
const worst = Object.entries(results.themes).flatMap(([theme, r]) => r.contrast.map((c) => ({ theme, ...c })))
  .sort((a, b) => a.ratio - b.ratio).slice(0, 6);
console.log(JSON.stringify({ faces: Object.fromEntries(Object.entries(results.themes).map(([t, r]) => [t, r.faces])),
  lowestContrast: worst, narrowOverflow: Object.fromEntries(Object.entries(results.themes).map(([t, r]) => [t, r.narrowOverflow])),
  reducedMotion: results.reducedMotion }, null, 2));
