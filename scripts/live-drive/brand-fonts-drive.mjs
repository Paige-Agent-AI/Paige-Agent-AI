#!/usr/bin/env node
// Evidence drive for P1 "real workspace brand fonts" (docs/evidence/ui-delivery/workspace-brand-fonts.md).
//
//   node scripts/live-drive/brand-fonts-drive.mjs pages   <dist> <outDir> [label]
//   node scripts/live-drive/brand-fonts-drive.mjs landing <baseDist> <headDist> <outDir>
//   node scripts/live-drive/brand-fonts-drive.mjs picker  <outDir>        (needs the harness dev server:
//        npx vite --config scripts/live-drive/harness/brand-font-mount/vite.config.ts)
//
// pages   — a PRODUCTION vite build's /render-frame with a synthetic payload in three library brand fonts
//           (plus the classic Poppins). Records, at the moment the frame says ready: the computed family of
//           h1/h2/body text, every FontFace's status, and which font files were requested. Only the app's
//           own origin is served (from <dist>, with the Vercel SPA rewrite); every other host is aborted
//           and recorded, so a tenant page provably requests no remote font.
// landing — the §28-frozen landing (`/`) from the base build and the head build at 1440, compared pixel
//           by pixel (base is captured twice first, to measure the page's own run-to-run noise).
// picker  — the harness mount of the real PortalStudio: the four Solo viewports, PAIGE closed and open,
//           the list open in both themes, a selection, and the exact set_tenant_brand payload.
//
// Synthetic data only (§63). A harness/local render is not the deployed surface (§32.c).
import fs from "node:fs";
import path from "node:path";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const [mode, ...args] = process.argv.slice(2);
const { chromium } = await resolvePlaywright();
const launch = () => chromium.launch({ headless: true, executablePath: resolveExecutablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] });
const ORIGIN = "http://paige.test";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".txt": "text/plain", ".glb": "model/gltf-binary", ".ico": "image/x-icon" };

async function serveDist(ctx, dist, log) {
  await ctx.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { log.aborted.push(url.host + url.pathname); return route.abort(); }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    if (url.pathname.startsWith("/fonts/")) log.fonts.push(url.pathname);
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
}

const BLOCKS = [
  { type: "hero", title: "Advice that compounds, quarter after quarter", subtitle: "A planning studio for owners who want their numbers, their team and their calendar pointing the same way.", cta_label: "Book an intro call", cta_href: "#apply" },
  { type: "feature_grid", title: "What changes in the first ninety days", items: [
    { title: "A plan you can read in a minute", body: "One page, revisited every month, with the three decisions that matter." },
    { title: "Numbers you trust", body: "Cash, pipeline and capacity in the same view, every Monday." },
    { title: "A team that knows the priority", body: "Every person sees what moves this quarter and what can wait." },
  ] },
  { type: "stats", items: [{ value: "42", label: "owners advised" }, { value: "9 yrs", label: "average client tenure" }, { value: "3", label: "decisions a month" }] },
  { type: "testimonial", items: [{ quote: "We finally stopped arguing about what to do next. The plan answers it.", author: "Harness client", role: "Studio owner" }] },
  { type: "faq", title: "Questions owners ask first", items: [{ question: "How fast do we start?", answer: "Within a week of the intro call." }, { question: "Can my team join?", answer: "Yes — the quarterly session is built for it." }] },
  { type: "cta", title: "Ready when you are", body: "One call to see whether it fits.", cta_label: "Book an intro call", cta_href: "#apply" },
];
const PAGES = [
  { key: "literata", font: "Literata", primary: "#1E3A34", accent: "#C8893B", name: "Harbor Planning Studio" },
  { key: "bodoni-moda", font: "Bodoni Moda", primary: "#2B1D2E", accent: "#B98A5E", name: "Maison Advisory" },
  { key: "barlow-semi-condensed", font: "Barlow Semi Condensed", primary: "#13324A", accent: "#E2A93B", name: "Northline Trades Co." },
  { key: "poppins-classic", font: "Poppins", primary: "#24324F", accent: "#D9A441", name: "Classic pick workspace" },
];

async function pages(dist, out, label = "head") {
  dist = path.resolve(dist);
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const summary = {};
  try {
    for (const p of PAGES) {
      const log = { fonts: [], aborted: [] };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
      await serveDist(ctx, dist, log);
      const payload = { blocks: BLOCKS, theme: null, brand: { primary_color: p.primary, accent_color: p.accent, font: p.font }, tenant_name: p.name };
      await ctx.addInitScript((pl) => { window.__PAIGE_RENDER_PAYLOAD__ = pl; }, payload);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${ORIGIN}/render-frame`, { waitUntil: "load" });
      const ready = await page.waitForSelector('[data-render-ready="true"]', { timeout: 20000 }).then(() => true).catch(() => false);
      const dom = await page.evaluate(() => {
        const fam = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : null; };
        return {
          scope: document.querySelector("[data-gp]")?.getAttribute("data-gp-font") ?? null,
          h1: fam("h1"), h2: fam("h2"), body: fam("[data-gp] p"), statFigure: fam("[data-gp] .font-display.tabular-nums"),
          faces: [...document.fonts].filter((f) => f.family.startsWith("brand-")).map((f) => `${f.family} ${f.weight} ${f.status}`),
          injected: [...document.head.querySelectorAll("style[data-brand-font]")].map((s) => s.getAttribute("data-brand-font")),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      const file = `${label}-page-${p.key}.png`;
      await page.screenshot({ path: path.join(out, file), fullPage: true });
      const hero = `${label}-hero-${p.key}.png`;
      await page.screenshot({ path: path.join(out, hero) });
      summary[p.key] = { font: p.font, ready, ...dom, fontRequests: log.fonts, abortedHosts: [...new Set(log.aborted.map((a) => a.split("/")[0]))], errors, file, hero };
      await ctx.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `${label}-pages-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function capture(browser, dist, url) {
  const log = { fonts: [], aborted: [] };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  await serveDist(ctx, path.resolve(dist), log);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}${url}`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ fullPage: true });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await ctx.close();
  return { png, height };
}

async function diff(browser, a, b) {
  const page = await browser.newPage();
  const r = await page.evaluate(async ([a64, b64]) => {
    const load = async (b) => { const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b}`)).blob()); const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext("2d"); x.drawImage(img, 0, 0); return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }; };
    const A = await load(a64); const B = await load(b64);
    if (A.w !== B.w || A.h !== B.h) return { sameSize: false, a: [A.w, A.h], b: [B.w, B.h] };
    let differing = 0;
    for (let i = 0; i < A.d.length; i += 4) if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2] || A.d[i + 3] !== B.d[i + 3]) differing++;
    return { sameSize: true, size: [A.w, A.h], differingPixels: differing, total: A.w * A.h };
  }, [a.png.toString("base64"), b.png.toString("base64")]);
  await page.close();
  return r;
}

async function landing(baseDist, headDist, out) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  try {
    const base1 = await capture(browser, baseDist, "/");
    const base2 = await capture(browser, baseDist, "/");
    const head = await capture(browser, headDist, "/");
    fs.writeFileSync(path.join(out, "landing-1440-base.png"), base1.png);
    fs.writeFileSync(path.join(out, "landing-1440-head.png"), head.png);
    const noise = await diff(browser, base1, base2);
    const change = await diff(browser, base1, head);
    const result = { url: "/", viewport: "1440x900 full page, reducedMotion reduce, 4s settle", baseVsBase: noise, baseVsHead: change };
    fs.writeFileSync(path.join(out, "landing-compare.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
}

const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
async function picker(out) {
  fs.mkdirSync(out, { recursive: true });
  const BASE = "http://127.0.0.1:5214/";
  const browser = await launch();
  const summary = { frames: [] };
  try {
    for (const [w, h] of VIEWPORTS) {
      for (const paige of ["closed", "open"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(`${BASE}?theme=dark&paige=${paige}&font=Literata`, { waitUntil: "networkidle" });
        await page.waitForSelector("#portal-brand-typeface");
        await page.evaluate(() => document.fonts.ready);
        const m = await page.evaluate(() => {
          const t = document.getElementById("portal-brand-typeface");
          const r = t.getBoundingClientRect();
          const owner = document.querySelector("[data-scroll-owner]");
          return {
            trigger: t.textContent, triggerBox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            docScrollWidth: document.documentElement.scrollWidth, ownerScrollWidth: owner.scrollWidth, ownerClientWidth: owner.clientWidth,
            labelFor: document.querySelector('label[for="portal-brand-typeface"]')?.textContent?.trim(),
            describedBy: document.getElementById(t.getAttribute("aria-describedby"))?.textContent,
          };
        });
        const file = `solo-${w}x${h}-paige-${paige}.png`;
        await page.screenshot({ path: path.join(out, file) });
        summary.frames.push({ viewport: `${w}x${h}`, paige, file, ...m });
        await ctx.close();
      }
    }
    // List open, both themes; then keyboard select → save → payload.
    for (const theme of ["dark", "light"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?theme=${theme}&paige=closed`, { waitUntil: "networkidle" });
      await page.waitForSelector("#portal-brand-typeface");
      // Keyboard path: focus the trigger, open with Enter.
      await page.focus("#portal-brand-typeface");
      await page.keyboard.press("Enter");
      await page.waitForSelector('[role="option"]');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const list = await page.evaluate(() => ({
        groups: [...document.querySelectorAll('[role="group"]')].map((g) => g.querySelector("[id]")?.textContent ?? g.children[1]?.textContent),
        options: [...document.querySelectorAll('[role="option"]')].length,
        brandFacesLoaded: [...document.fonts].filter((f) => f.family.startsWith("brand-") && f.status === "loaded").length,
        firstOptionFamily: getComputedStyle(document.querySelector('[role="option"] span[style]')).fontFamily,
      }));
      await page.screenshot({ path: path.join(out, `picker-open-${theme}-1366x768.png`) });
      summary[`list_${theme}`] = list;
      if (theme === "dark") {
        await page.getByRole("option", { name: "Bodoni Moda" }).scrollIntoViewIfNeeded();
        await page.getByRole("option", { name: "Bodoni Moda" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => ({
          trigger: document.getElementById("portal-brand-typeface").textContent,
          hint: document.getElementById(document.getElementById("portal-brand-typeface").getAttribute("aria-describedby")).textContent,
          focusOnTrigger: document.activeElement?.id === "portal-brand-typeface",
        }));
        await page.screenshot({ path: path.join(out, "picker-selected-bodoni-dark-1366x768.png") });
        await page.getByRole("button", { name: "Save portal" }).click();
        await page.waitForTimeout(500);
        summary.selection = { ...after, writes: await page.evaluate(() => window.__brandWrites) };
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, "picker-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (mode === "pages") await pages(args[0], args[1], args[2]);
else if (mode === "landing") await landing(args[0], args[1], args[2]);
else if (mode === "picker") await picker(args[0]);
else { console.error("usage: brand-fonts-drive.mjs pages|landing|picker …"); process.exit(2); }
