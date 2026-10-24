// Drives the EXP06 NEXUS departmental attribution in Vibe Studio (Studio home "Plan with NEXUS";
// the publish panel's prepared "Review with NEXUS") and frames it at the Solo viewports.
// Structural harness: the real Vibe Studio components over the stubbed door (`?publish=ready`),
// with `?nexus=1` threading a stub openPaige. The paige:prefill handoff is captured on
// window.__nexusHandoffs — the harness never mounts PAIGE's composer, so "handed off, not sent"
// is observable directly. NOT the live app.
//   node drive-nexus.mjs <outdir>
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "docs/evidence/ui-delivery/assets/exp06-nexus-studio";
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.STUDIO_HARNESS_PORT || 5216}/`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
const errors = [];
const results = [];
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];

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
  results.push(name);
}
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  return page;
}
const doorCalls = (page) => page.evaluate(() => window.__studioCalls.filter((c) => c.fn === "invoke:growth-publish-command").map((c) => c.args));
const marks = (page) => page.evaluate(() => ({ closed: window.__closed ?? 0, opened: window.__nexusOpen ?? 0, handoffs: [...(window.__nexusHandoffs ?? [])] }));
async function noDocOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

// 1. Studio home with the departmental line, at the four Solo viewports (light), plus dark.
//    The Studio is a full-screen overlay, so PAIGE open and closed render the same frame; both are
//    captured to mirror the record's fields.
for (const [w, h] of VIEWPORTS) {
  const p = await open("nexus=1", w, h);
  await p.waitForSelector(".vs-dept-line");
  if (!(await noDocOverflow(p))) errors.push(`home ${w}x${h}: document overflow`);
  await shoot(p, `solo-${w}x${h}-paige-closed`);
  await p.close();
  const p2 = await open("nexus=1&paige=open", w, h);
  await p2.waitForSelector(".vs-dept-line");
  await shoot(p2, `solo-${w}x${h}-paige-open`);
  await p2.close();
}
{
  const p = await open("nexus=1&theme=dark", 1366, 768);
  await p.waitForSelector(".vs-dept-line");
  await shoot(p, "home-dark-1366x768");
  await p.close();
}

// 2. Behavioral: Plan with NEXUS prefills the global chat (never sends), closes the Studio, opens PAIGE.
{
  const p = await open("nexus=1", 1366, 768);
  await p.waitForSelector(".vs-dept-line");
  const line = (await p.locator(".vs-dept-line").innerText()).replace(/\s+/g, " ");
  if (!line.includes("Marketing & growth")) errors.push(`dept line missing roster remit: ${line}`);
  const button = p.getByRole("button", { name: "Plan with Nexus" });
  await button.focus();
  const focusOk = await p.evaluate(() => {
    const el = document.activeElement;
    const o = getComputedStyle(el).outlineStyle;
    return el.tagName === "BUTTON" && o !== "none" && parseFloat(getComputedStyle(el).outlineWidth) >= 2;
  });
  if (!focusOk) errors.push("Plan with Nexus: no visible :focus-visible outline");
  const chatBefore = await p.evaluate(() => window.__studioCalls.filter((c) => c.fn.startsWith("fetch:paige-ai-chat")).length);
  await button.click();
  const m = await marks(p);
  if (m.closed !== 1) errors.push("Plan: Studio did not close");
  if (m.opened !== 1) errors.push("Plan: openPaige not called");
  if (m.handoffs.length !== 1) errors.push(`Plan: expected exactly one handoff, got ${m.handoffs.length}`);
  if (!m.handoffs[0]?.startsWith("Nexus,") || !m.handoffs[0].includes("Do not take an action")) errors.push(`Plan: bad handoff prompt: ${m.handoffs[0]}`);
  const chatAfter = await p.evaluate(() => window.__studioCalls.filter((c) => c.fn.startsWith("fetch:paige-ai-chat")).length);
  if (chatBefore !== chatAfter) errors.push("Plan: a chat message was sent from the home handoff");
  await p.close();
}

// 3. Behavioral + frames: the prepared publish panel carries "Review with NEXUS"; the click hands
//    off citing the door's own facts and never approaches the door's publish.
{
  const p = await open("nexus=1&publish=ready", 1536, 770);
  await p.locator(".vs-card", { hasText: "New client intake" }).click();
  await p.waitForSelector(".vs-session");
  await p.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  await p.getByRole("button", { name: "Publish", exact: true }).click();
  await p.waitForSelector(".vs-pop");
  await p.waitForFunction(() => !document.querySelector(".vs-checks-skel"));
  const pop = p.locator(".vs-pop");
  const popText = (await pop.innerText()).replace(/\s+/g, " ");
  if (!popText.includes("Ready to go live?")) errors.push(`panel not prepared: ${popText.slice(0, 80)}`);
  if (!popText.includes("Marketing review is Nexus's department")) errors.push("panel missing the review department line");
  await shoot(p, "panel-prepared-1536x770");
  const doorsBefore = (await doorCalls(p)).length;
  const review = p.getByRole("button", { name: "Review with Nexus" });
  await review.focus();
  await review.click();
  const m = await marks(p);
  if (m.handoffs.length !== 1) errors.push(`Review: expected one handoff, got ${m.handoffs.length}`);
  const prompt = m.handoffs[0] ?? "";
  if (!prompt.includes('form "New client intake"') || !prompt.includes("/form/f-1") || !prompt.includes("Do not publish anything")) errors.push(`Review: bad handoff prompt: ${prompt}`);
  if (m.closed !== 1 || m.opened !== 1) errors.push("Review: studio close/open marks wrong");
  if ((await doorCalls(p)).length !== doorsBefore) errors.push("Review: the door was called by the review handoff");
  await p.close();
}
{
  const p = await open("nexus=1&publish=ready&theme=dark", 1366, 768);
  await p.locator(".vs-card", { hasText: "New client intake" }).click();
  await p.waitForSelector(".vs-session");
  await p.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  await p.getByRole("button", { name: "Publish", exact: true }).click();
  await p.waitForSelector(".vs-pop");
  await p.waitForFunction(() => !document.querySelector(".vs-checks-skel"));
  await p.waitForSelector(".vs-pop .vs-link");
  await shoot(p, "panel-prepared-dark-1366x768");
  await p.close();
}

// 4. Absence control: without ?nexus=1 the affordances are simply not there.
{
  const p = await open("", 1366, 768);
  const plan = await p.getByRole("button", { name: "Plan with Nexus" }).count();
  if (plan !== 0) errors.push("absence: Plan affordance rendered without a shell handoff");
  await p.locator(".vs-card", { hasText: "New client intake" }).click();
  await p.waitForSelector(".vs-session");
  await p.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  await p.getByRole("button", { name: "Publish", exact: true }).click();
  await p.waitForSelector(".vs-pop");
  await p.waitForFunction(() => !document.querySelector(".vs-checks-skel"));
  const review = await p.getByRole("button", { name: "Review with Nexus" }).count();
  if (review !== 0) errors.push("absence: Review affordance rendered without a shell handoff");
  await p.close();
}

// 5. 200% zoom equivalent: the home line wraps, nothing overflows.
{
  const p = await open("nexus=1", 683, 384);
  await p.waitForSelector(".vs-dept-line");
  if (!(await noDocOverflow(p))) errors.push("zoom: document overflow at 683x384");
  await shoot(p, "home-zoom200-683x384");
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ frames: results, errors }, null, 1));
if (errors.length) process.exit(1);
