// Drives the EXP06 PR7 domain-guidance disclosure ("Use my own address") in a real browser at
// the Solo viewports: the honest reserved-address state, the six provider profiles behind the
// selector (switching to WIX asserted), the never-touch mail line, and the owner-gated host
// path — plus the conflict observation so the truth-when-blocked state is framed too.
// Structural harness: the real DomainGuidanceCard inside the publish panel's own live-view pop.
// NOT the live app.   node drive-domain.mjs   (serve first: npx vite --config
// scripts/live-drive/harness/studio-mount/vite.config.ts)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = "docs/evidence/ui-delivery/assets/exp06-domain-guidance";
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
async function open(query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector("details.vs-domain-card");
  return page;
}
const disclosure = (page) => page.evaluate(() => {
  const d = document.querySelector("details.vs-domain-card");
  if (!d) return "";
  d.open = true;
  return d.textContent ?? "";
});

// 1. The honest starting state at the Solo viewports (light) + one dark + one conflict frame.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  const p = await open("domain=1", w, h);
  const text = await disclosure(p);
  if (!text.includes("Serving at your reserved address (acme-coaching.paigeagent.ai)")) errors.push(`${w}x${h}: reserved-address headline missing`);
  if (!text.includes("Use my own address")) errors.push(`${w}x${h}: summary line missing`);
  if (!text.includes("MX, SPF (TXT), DKIM (TXT), DMARC (TXT), Nameserver (NS), DNSSEC")) errors.push(`${w}x${h}: never-touch mail line missing`);
  if (!text.includes("never changes your DNS")) errors.push(`${w}x${h}: DNS preservation line missing`);
  const providers = await p.$$eval("select option", (os) => os.map((o) => o.textContent));
  if (JSON.stringify(providers) !== JSON.stringify(["Cloudflare", "Namecheap", "GoDaddy", "Squarespace Domains", "Porkbun", "WIX"])) errors.push(`${w}x${h}: provider list wrong: ${providers.join(",")}`);
  if (!text.includes("Export the published version")) errors.push(`${w}x${h}: host-path step 1 missing`);
  if (!text.includes("never a move")) errors.push(`${w}x${h}: recovery line missing`);
  if (/Live at /.test(text)) errors.push(`${w}x${h}: an unconnected address is called live`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) errors.push(`${w}x${h}: document overflow`);
  await shoot(p, `solo-${w}x${h}-paige-closed`);
  await p.close();
}
{
  const p = await open("domain=1&theme=dark", 1366, 768);
  await disclosure(p);
  await shoot(p, "solo-1366x768-dark");
  await p.close();
}
{
  const p = await open("domain=conflict", 1366, 768);
  const text = await disclosure(p);
  if (!text.includes("An existing record is in the way")) errors.push("conflict: headline missing");
  if (!text.includes("never overwritten")) errors.push("conflict: never-overwritten line missing");
  if (/almost ready|\bready\b/i.test(text.slice(text.indexOf("An existing record"), text.indexOf("Where is your domain?")))) errors.push("conflict: reads as ready");
  await shoot(p, "conflict-1366x768");
  await p.close();
}

// 2. The provider selector actually swaps guidance (Cloudflare → WIX external-authority rule).
{
  const p = await open("domain=1", 1366, 768);
  await disclosure(p);
  const box = await p.textContent(".vs-domain-providers");
  if (!box.includes("Cloudflare is your DNS")) errors.push("selector: default Cloudflare note missing");
  await p.selectOption("select", "wix");
  const wixBox = await p.textContent(".vs-domain-providers");
  if (!wixBox.includes("outside Wix")) errors.push("selector: WIX external-authority note missing");
  if (!wixBox.includes("not in Wix")) errors.push("selector: WIX send-them-there line missing");
  await shoot(p, "wix-profile-1366x768");
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 2));
if (errors.length) process.exit(1);
