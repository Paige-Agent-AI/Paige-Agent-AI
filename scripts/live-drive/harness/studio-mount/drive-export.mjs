// Drives the PORTABLE EXPORT artifact itself (WEB-04): opens the fixture the real builder wrote
// (a plain file on disk — no server, no SPA, no scripts) in a real browser, asserts the static
// document's honesty at both a desktop and a phone width, and captures labelled frames.
//   node drive-export.mjs <outdir>
// Prereq: PAIGE_WRITE_EXPORT_FIXTURE=1 npx vitest run src/lib/growth/exportPortable.fixture.test.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(here, "../../../../docs/evidence/ui-delivery/assets/exp06-portable-export/acme-coaching-workshop-2026-10-01.html");
const out = process.argv[2] || "docs/evidence/ui-delivery/assets/exp06-portable-export";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
const errors = [];
const frames = [];

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
  await page.screenshot({ path: `${out}/${name}.png` });
  frames.push(name);
}

for (const [w, h, tag] of [[1366, 768, "desktop"], [390, 844, "phone"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${tag} console: ${m.text()}`); });
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // The honesty assertions — run at BOTH widths.
  const facts = await page.evaluate(() => ({
    title: document.title,
    scripts: document.querySelectorAll("script").length,
    forms: document.querySelectorAll("form").length,
    liveLink: !!document.querySelector(`a[href*="/p/acme-coaching/workshop"]`),
    video: !!document.querySelector("iframe[src*='youtube-nocookie']"),
    formCard: document.body.innerText.includes("Handled securely on the live page."),
    lineage: document.body.innerText.includes("A download, not a deployment"),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    h1: document.querySelector("h1")?.textContent ?? "",
  }));
  if (facts.title !== "Turn your next ten clients into a referral engine") errors.push(`${tag}: wrong title`);
  if (facts.scripts !== 0) errors.push(`${tag}: ${facts.scripts} script element(s) in the exported page`);
  if (facts.forms !== 0) errors.push(`${tag}: a <form> shipped in the exported page`);
  if (!facts.liveLink) errors.push(`${tag}: no link back to the live page`);
  if (!facts.video) errors.push(`${tag}: no youtube-nocookie embed`);
  if (!facts.formCard) errors.push(`${tag}: the embedded form's honest line is missing`);
  if (!facts.lineage) errors.push(`${tag}: lineage footer missing`);
  if (facts.overflow) errors.push(`${tag}: document overflow`);

  // Capture the top of the page (hero) — the exported document's own scroll owns the rest.
  await shoot(page, `export-${tag}-${w}x${h}`);
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ frames, errors }, null, 1));
if (errors.length) process.exit(1);
