// Drives the EXP06 PR7 domain-guidance disclosure ("Use my own address") in a real browser at
// the Solo viewports: the honest unobserved reserved-address state (the card claims neither
// serving nor held — a publication receipt proves the artifact's URL, not the reserved host
// root), the six provider profiles behind the selector (switching to WIX asserted), the
// never-touch mail line, and the owner-gated host path — plus the conflict observation so the
// truth-when-blocked state is framed too. Since the review-honored harness change, the pop
// renders inside a real .vs-studio root and the shell honors ?paige=, so BOTH dock geometries
// are captured as real frames at every viewport (no bounding claims), plus a keyboard-toggle leg.
// Structural harness: the real DomainGuidanceCard inside the studio's own scoped tokens.
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

/** The core truth set asserted in every light frame (closed AND open dock). */
async function coreAssertions(page, w, h, label) {
  const text = await disclosure(page);
  if (!text.includes("Your reserved address (acme-coaching.paigeagent.ai)")) errors.push(`${label} ${w}x${h}: unobserved reserved-address headline missing`);
  if (!text.includes("isn't checked from this panel")) errors.push(`${label} ${w}x${h}: unobserved-honesty line missing`);
  if (!text.includes("Use my own address")) errors.push(`${label} ${w}x${h}: summary line missing`);
  if (!text.includes("MX, SPF (TXT), DKIM (TXT), DMARC (TXT), Nameserver (NS), DNSSEC")) errors.push(`${label} ${w}x${h}: never-touch mail line missing`);
  if (!text.includes("never changes your DNS")) errors.push(`${label} ${w}x${h}: DNS preservation line missing`);
  const providers = await page.$$eval("select option", (os) => os.map((o) => o.textContent));
  if (JSON.stringify(providers) !== JSON.stringify(["Cloudflare", "Namecheap", "GoDaddy", "Squarespace Domains", "Porkbun", "WIX"])) errors.push(`${label} ${w}x${h}: provider list wrong: ${providers.join(",")}`);
  if (!text.includes("Export the published version")) errors.push(`${label} ${w}x${h}: host-path step 1 missing`);
  if (!text.includes("never a move")) errors.push(`${label} ${w}x${h}: recovery line missing`);
  if (/Live at /.test(text)) errors.push(`${label} ${w}x${h}: an unconnected address is called live`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) errors.push(`${label} ${w}x${h}: document overflow`);
  // The scoped-token fix is load-bearing here: inside .vs-studio the summary must resolve the
  // studio's FOREGROUND token, not the ink background (--vs-ink would render it near-invisible).
  const summaryColor = await page.$eval("details.vs-domain-card > summary", (s) => getComputedStyle(s).color);
  const bg = await page.$eval(".vs-studio", (s) => getComputedStyle(s).backgroundColor);
  if (summaryColor === bg) errors.push(`${label} ${w}x${h}: summary text color equals the studio background (invisible)`);
  // The Studio is a full-screen fixed overlay: it covers the shell (and the dock under it), and
  // the document itself must not scroll — the pop owns its own scrolling.
  const overlay = await page.$eval(".vs-studio", (s) => { const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { x: r.x, y: r.y, w: r.width, h: r.height, z: cs.zIndex }; });
  if (overlay.x !== 0 || overlay.y !== 0 || overlay.w !== w || overlay.h !== h || Number(overlay.z) < 1) errors.push(`${label} ${w}x${h}: studio overlay is not full-screen above the shell`);
  const docScrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight || document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (docScrolls) errors.push(`${label} ${w}x${h}: the page itself scrolls (the pop must own scrolling)`);
}

// 1. The honest starting state at the Solo viewports — PAIGE dock closed AND open, real frames
//    both, with the pop's geometry PROVEN invariant to the dock state (the Studio overlay is
//    full-screen; the dock sits under it exactly as in the product).
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  const closedPage = await open("domain=1", w, h);
  await coreAssertions(closedPage, w, h, "closed");
  const dockHidden = await closedPage.$eval("aside.tcs-paige", (a) => a.hidden);
  if (!dockHidden) errors.push(`closed ${w}x${h}: dock should be hidden`);
  const closedPop = await closedPage.$eval(".vs-pop", (p) => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  await shoot(closedPage, `solo-${w}x${h}-paige-closed`);
  await closedPage.close();

  const openPage = await open("domain=1&paige=open", w, h);
  await coreAssertions(openPage, w, h, "open");
  const dockInDom = await openPage.$eval("aside.tcs-paige", (a) => !a.hidden && a.getBoundingClientRect().width > 0);
  if (!dockInDom) errors.push(`open ${w}x${h}: PAIGE dock not present in the shell beneath`);
  const openPop = await openPage.$eval(".vs-pop", (p) => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  if (JSON.stringify(closedPop) !== JSON.stringify(openPop)) errors.push(`open ${w}x${h}: pop geometry changed with the dock (overlay must be invariant): ${JSON.stringify(closedPop)} vs ${JSON.stringify(openPop)}`);
  await shoot(openPage, `solo-${w}x${h}-paige-open`);
  await openPage.close();
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

// 3. Keyboard reachability: the disclosure opens with the keyboard alone (Enter on the focused
//    summary), and the provider selector is reachable and operable by keyboard (Arrow keys).
{
  const p = await open("domain=1", 1366, 768);
  await p.locator("details.vs-domain-card > summary").focus();
  const focusedIsSummary = await p.evaluate(() => document.activeElement?.matches("details.vs-domain-card > summary"));
  if (!focusedIsSummary) errors.push("keyboard: summary did not take focus");
  await p.keyboard.press("Enter"); // the native disclosure toggle, driven by a real key press
  const isOpen = await p.$eval("details.vs-domain-card", (d) => d.open);
  if (!isOpen) errors.push("keyboard: Enter did not open the disclosure");
  const stateVisible = await p.$eval(".vs-domain-state", (s) => s.getBoundingClientRect().height > 0);
  if (!stateVisible) errors.push("keyboard: state block not visible after Enter");
  await shoot(p, "keyboard-toggle-1366x768");
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 2));
if (errors.length) process.exit(1);
