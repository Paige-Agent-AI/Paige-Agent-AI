// Drives the EXP06 PR8 sharing-truth surfaces in a real browser (harness `?seo=1`): the REAL
// applyPublishedSeo applied to the REAL document (the drive asserts the metas from the live
// DOM, not from the rendered list), beside the REAL SharingPreviewLine the publish panel
// mounts. NOT the live app.   node drive-seo.mjs   (serve first: npx vite --config
// scripts/live-drive/harness/studio-mount/vite.config.ts)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = "docs/evidence/ui-delivery/assets/exp06-seo-quality";
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5216}/`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
const errors = [];
const results = [];

async function shoot(page, name) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    tag.dataset.harnessLabel = "1";
    document.body.append(tag);
  });
  const ok = await page.evaluate(() => { const r = document.querySelector("[data-harness-label]")?.getBoundingClientRect(); return !!r && r.height > 0 && r.bottom <= innerHeight; });
  if (!ok) throw new Error("label not on screen — refusing to write the frame");
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  results.push(name);
}

async function coreAssertions(page, label) {
  // The REAL head of the REAL document, driven by the REAL module.
  const head = await page.evaluate(() => ({
    title: document.title,
    description: document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    ogTitle: document.head.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
    ogImage: document.head.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? null,
    card: document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content") ?? null,
    twTitle: document.head.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? null,
    twDesc: document.head.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? null,
    twImage: document.head.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ?? null,
  }));
  if (head.title !== "Referral Workshop") errors.push(`${label}: document.title is "${head.title}"`);
  if (head.description !== "Ninety minutes to a Monday-ready referral plan.") errors.push(`${label}: meta description wrong: ${head.description}`);
  if (head.ogTitle !== "Referral Workshop") errors.push(`${label}: og:title wrong`);
  if (head.ogImage !== "https://media.example.com/og/workshop.png") errors.push(`${label}: og:image wrong: ${head.ogImage}`);
  if (head.ogUrl !== page.url()) errors.push(`${label}: og:url is not the page's own address`);
  if (head.card !== "summary_large_image") errors.push(`${label}: twitter:card wrong: ${head.card}`);
  // Review finding honored: the twitter trio must MATCH the published truth, not the shell's.
  if (head.twTitle !== "Referral Workshop") errors.push(`${label}: twitter:title wrong: ${head.twTitle}`);
  if (head.twDesc !== "Ninety minutes to a Monday-ready referral plan.") errors.push(`${label}: twitter:description wrong: ${head.twDesc}`);
  if (head.twImage !== "https://media.example.com/og/workshop.png") errors.push(`${label}: twitter:image wrong: ${head.twImage}`);
  // The owner-visible truth: the panel's sharing line says exactly what will ship.
  const text = await page.textContent(".vs-seo-preview");
  if (!text.includes("What search and share will show:")) errors.push(`${label}: sharing-preview label missing`);
  if (!text.includes("Referral Workshop")) errors.push(`${label}: sharing-preview title missing`);
  if (!text.includes("Ninety minutes to a Monday-ready referral plan.")) errors.push(`${label}: sharing-preview description missing`);
  if (!text.includes("Applied when the page loads in a browser")) errors.push(`${label}: client-rendering boundary line missing`);
  // The line never claims ranking or placement.
  if (/rank|first on google|top of search/i.test(text)) errors.push(`${label}: ranking claim present`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) errors.push(`${label}: document overflow`);
}

// 1. The sharing truth at the Solo viewports, light + one dark + one narrow leg.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on("pageerror", (e) => errors.push(`${w}x${h}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${w}x${h} console: ${m.text()}`); });
  await p.goto(`${base}?seo=1`);
  await p.waitForSelector("[data-harness-seo-applied]");
  await coreAssertions(p, `${w}x${h}`);
  await shoot(p, `seo-${w}x${h}`);
  await p.close();
}
{
  const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await p.goto(`${base}?seo=1&theme=dark`);
  await p.waitForSelector("[data-harness-seo-applied]");
  await coreAssertions(p, "dark");
  await shoot(p, "seo-1366x768-dark");
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 2));
if (errors.length) process.exit(1);
