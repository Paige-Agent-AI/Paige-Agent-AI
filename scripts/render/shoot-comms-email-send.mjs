#!/usr/bin/env node
/**
 * INT-328 — screenshots the comms email-send render pages and measures what a picture can't show.
 *
 * Reproduce (repo root):
 *   npx vite build
 *   npx vitest run src/solo/__render__/confirm-email-preview.render.test.tsx \
 *                  src/pages/admin/conversations/governedSend.render.test.tsx
 *   node scripts/render/shoot-comms-email-send.mjs
 *
 * The vitest pass drives the REAL components (the Solo chat's approval card; the Conversations
 * inbox) and writes self-contained pages into the gitignored scripts/live-drive/artifacts/
 * comms-email-send/. This script shoots them at 1280, 360 and 320 CSS px, light and dark, into
 * docs/evidence/ui-delivery/comms-email-send/ and writes render-results.json beside the PNGs.
 *
 * PROOF CLASS: rendered harness — real component markup and real compiled CSS, network/tenant/
 * session stubbed. NOT an authenticated runtime drive of Solo, and nothing here sends an email.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = "scripts/live-drive/artifacts/comms-email-send";
const OUT = "docs/evidence/ui-delivery/comms-email-send";
const PAGES = ["confirm-email-preview", "conversations-governed-send"];
for (const name of PAGES) for (const theme of ["light", "dark"]) {
  if (!existsSync(`${SRC}/${name}.${theme}.html`)) {
    throw new Error(`${SRC}/${name}.${theme}.html is missing — run the build and the two render tests first (see header).`);
  }
}
mkdirSync(OUT, { recursive: true });

function chromiumPath() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  const root = "/opt/pw-browsers";
  if (existsSync(root)) {
    const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    if (dir && existsSync(`${root}/${dir}/chrome-linux/chrome`)) return `${root}/${dir}/chrome-linux/chrome`;
  }
  return undefined; // Playwright's own bundled browser
}
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36";

// The pages link Google Fonts. Fetch them once through curl (which honours the agent proxy) and
// serve them to the page, so the faces that ship are the faces in the shot.
const fontCache = new Map();
async function routeFonts(ctx) {
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    try {
      if (!fontCache.has(url)) fontCache.set(url, execFileSync("curl", ["-sS", "--fail", "-A", UA, url], { maxBuffer: 32 * 1024 * 1024 }));
      await route.fulfill({ status: 200, body: fontCache.get(url), contentType: url.includes("googleapis") ? "text/css" : "font/woff2" });
    } catch { await route.abort(); }
  });
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** WCAG contrast of each matched element's text against the layers actually behind it. */
function measure(selectors) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "rgba(0,0,0,0)"; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lum = ({ r, g, b }) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const behind = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const bg = rgba(getComputedStyle(n).backgroundColor); if (bg.a > 0) layers.push(bg); }
    return layers.reverse().reduce((acc, l) => over(l, acc), { r: 255, g: 255, b: 255, a: 1 }); };
  const out = [];
  for (const [label, selector] of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const s = getComputedStyle(el); const bg = behind(el); const fg = over(rgba(s.color), bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      out.push({ label, scene: el.closest("[data-scene]")?.getAttribute("data-scene"), text: (el.textContent ?? "").trim().slice(0, 48),
        size: s.fontSize, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 });
    });
  }
  return out;
}

const TEXT = {
  "confirm-email-preview": [
    ["label (To/From/Subject)", "[data-confirm-preview] dt"],
    ["recipient name", "[data-confirm-preview] dd span.font-medium"],
    ["recipient address", "[data-confirm-preview] dd span.text-muted-foreground"],
    ["sender / subject", "[data-confirm-preview] dd.text-foreground"],
    ["body", "[data-confirm-preview] [data-clamped]"],
    ["show full email", "[data-confirm-preview] button"],
    ["heading", '[data-card-mode="decide"] p.font-semibold'],
  ],
  "conversations-governed-send": [
    ["status pill", "[data-scene] .ml-auto > span"],
    ["don't-resend line", "[data-governed-send]"],
  ],
};

async function open(browser, file, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  await page.goto(`file://${resolve(file)}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return { ctx, page };
}

const sideways = (page) => page.evaluate(() => ({
  pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
  overflowing: [...document.querySelectorAll('[role="group"], [data-confirm-preview], [data-confirm-preview] dd, [data-scene] .frame > *')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.closest("[data-scene]")?.getAttribute("data-scene")),
}));

/** How wide the email actually is at this width, against the card it sits in. */
const envelopeWidth = (page) => page.evaluate(() => [...document.querySelectorAll("[data-confirm-preview]")].map((el) => {
  const card = el.closest("[data-card-mode]");
  return { scene: el.closest("[data-scene]")?.getAttribute("data-scene"), envelope: Math.round(el.getBoundingClientRect().width),
    card: card ? Math.round(card.getBoundingClientRect().width) : null, nestedBorderedBoxes: getComputedStyle(el).borderLeftWidth !== "0px" };
}));

const browser = await chromium.launch({ executablePath: chromiumPath(), proxy });
const results = { proofClass: "rendered harness — not an authenticated runtime drive", pages: {} };
try {
  for (const name of PAGES) {
    for (const theme of ["light", "dark"]) {
      const file = `${SRC}/${name}.${theme}.html`;
      const r = ((results.pages[name] ??= {})[theme] = { shots: [] });

      const desk = await open(browser, file, 1280);
      r.faces = await desk.page.evaluate(() => [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))]);
      await desk.page.screenshot({ path: `${OUT}/${name}-1280-${theme}.png`, fullPage: true });
      r.shots.push(`${name}-1280-${theme}.png`);
      for (const scene of await desk.page.$$("[data-scene]")) {
        const shot = `${slug(await scene.getAttribute("data-scene"))}-${theme}.png`;
        await scene.screenshot({ path: `${OUT}/${shot}` });
        r.shots.push(shot);
      }
      r.contrast = await desk.page.evaluate(measure, TEXT[name]);
      if (name === "confirm-email-preview") {
        r.envelopeAt1280 = await envelopeWidth(desk.page);
        r.clampedHeights = await desk.page.evaluate(() => [...document.querySelectorAll('[data-clamped="true"]')]
          .map((el) => ({ lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)), clipped: el.scrollHeight > el.clientHeight })));
        r.expandedRegion = await desk.page.evaluate(() => [...document.querySelectorAll('[data-clamped="false"][role="region"]')]
          .map((el) => ({ maxHeight: getComputedStyle(el).maxHeight, overflowY: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight })));
        // Gold is spent on Approve only: nothing inside an envelope may carry the accent.
        r.goldInsidePreview = await desk.page.evaluate(() => {
          const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
          return [...document.querySelectorAll("[data-confirm-preview], [data-confirm-preview] *")].filter((el) => {
            const s = getComputedStyle(el); return accent && [s.color, s.backgroundColor, s.borderTopColor].some((c) => c.includes(accent));
          }).length;
        });
      } else {
        // The governed rows carry no approve or edit control, in any scene but the plain draft.
        r.controlsByScene = await desk.page.evaluate(() => [...document.querySelectorAll("[data-scene]")].map((s) => ({
          scene: s.getAttribute("data-scene"),
          buttons: [...s.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter(Boolean),
          pills: [...s.querySelectorAll(".ml-auto > span")].map((p) => (p.textContent ?? "").trim()),
        })));
      }
      await desk.ctx.close();

      // Phone, then WCAG reflow width. Nothing may scroll sideways.
      for (const width of [360, 320]) {
        const phone = await open(browser, file, width);
        r[`at${width}`] = await sideways(phone.page);
        if (name === "confirm-email-preview") r[`envelopeAt${width}`] = await envelopeWidth(phone.page);
        await phone.page.screenshot({ path: `${OUT}/${name}-${width}-${theme}.png`, fullPage: true });
        r.shots.push(`${name}-${width}-${theme}.png`);
        await phone.ctx.close();
      }
    }
  }
  // Keyboard: the disclosure takes the indigo ring, not gold.
  const k = await open(browser, `${SRC}/confirm-email-preview.light.html`, 1280);
  results.focusRing = await k.page.evaluate(() => {
    const b = document.querySelector("[data-confirm-preview] button"); b.focus();
    const s = getComputedStyle(b); return { focusVisible: b.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      ring: getComputedStyle(document.body).getPropertyValue("--ring").trim() };
  });
  await k.ctx.close();
} finally {
  await browser.close();
}
for (const [name, themes] of Object.entries(results.pages)) for (const [theme, r] of Object.entries(themes)) {
  const measured = new Set(r.contrast.map((c) => c.label));
  const missing = TEXT[name].map(([l]) => l).filter((l) => !measured.has(l));
  if (missing.length) throw new Error(`${name} ${theme}: no element matched for ${missing.join(", ")}`);
}
writeFileSync(`${OUT}/render-results.json`, `${JSON.stringify(results, null, 2)}\n`);
const all = Object.entries(results.pages).flatMap(([n, t]) => Object.entries(t).flatMap(([theme, r]) => r.contrast.map((c) => ({ page: n, theme, ...c }))));
console.log(JSON.stringify({
  lowestContrast: all.sort((a, b) => a.ratio - b.ratio).slice(0, 6),
  sideways: Object.fromEntries(Object.entries(results.pages).map(([n, t]) => [n, Object.fromEntries(Object.entries(t).map(([th, r]) => [th, { at360: r.at360, at320: r.at320 }]))])),
  envelope: Object.fromEntries(Object.entries(results.pages["confirm-email-preview"]).map(([th, r]) => [th, { at1280: r.envelopeAt1280?.[0], at360: r.envelopeAt360?.[0], at320: r.envelopeAt320?.[0] }])),
  conversations: results.pages["conversations-governed-send"].light.controlsByScene,
  gold: Object.fromEntries(Object.entries(results.pages["confirm-email-preview"]).map(([t, r]) => [t, r.goldInsidePreview])),
  focus: results.focusRing,
}, null, 2));
