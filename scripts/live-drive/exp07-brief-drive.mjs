// EXP07 row 1 — the structured brief, driven end to end on the studio-mount harness:
// (1) Studio home: the composer's detail fields open, filled, and "Build it" — the FIRST chat
//     request body must carry the composed brief (job + "Brief details:" block), proving what
//     Paige receives and what gets saved as seed_brief;
// (2) the session's brief card, pinned above the conversation, showing the composed details;
// (3) reopening an EXISTING project (s-page) shows the brief it started with.
// Four Solo viewports × PAIGE closed/open for the session card (the durable outcome), plus
// home-composer extras (light/dark/collapsed) and the reopen capture. Harness render — NOT live.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "docs/evidence/ui-delivery/assets/exp07-brief");
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.EXP07_BRIEF_PORT || 5226);
const base = `http://127.0.0.1:${port}/`;

const vite = spawn("npx", ["vite", "--config", "scripts/live-drive/harness/studio-mount/vite.config.ts"], {
  cwd: root, shell: true, stdio: "pipe",
  env: { ...process.env, STUDIO_HARNESS_PORT: String(port) },
});
await new Promise((resolve, reject) => {
  let buf = "";
  const clean = () => buf.replace(/\x1b\[[0-9;]*m/g, "");
  vite.stdout.on("data", (d) => { buf += d; if (clean().includes(`:${port}`)) resolve(); });
  vite.stderr.on("data", (d) => { buf += d; });
  setTimeout(() => reject(new Error(`vite boot timeout: ${clean().slice(-400)}`)), 120_000);
});

const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
const errors = [];
const results = [];
const note = (ok, name, detail = "") => { results.push({ ok, name, detail }); if (!ok) console.log(`FAIL  ${name}  ${detail}`); };

const JOB = "A landing page for my spring referral workshop";
const FILLED = { audience: "Solo consultants planning a referral engine", outcome: "Twenty bookings for the April session", channel: "Email and LinkedIn", deliverables: "One page and three posts" };
const COMPOSED = `${JOB}\n\nBrief details:\nAudience: ${FILLED.audience}\nOutcome: ${FILLED.outcome}\nChannel: ${FILLED.channel}\nDeliverables: ${FILLED.deliverables}`;

async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function shoot(page, name) { await label(page); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); }

/** Home with the details panel open and filled. (Chat bodies are recorded in-page by the harness:
 *  the chat fetch is intercepted and never reaches the network, so window.__chatBodies is the source.) */
async function homeWithDetails(page, { fill = true, theme = "light" } = {}) {
  await page.goto(`${base}?theme=${theme}`, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await page.waitForSelector(".vs-home", { timeout: 60_000 });
  if (fill) {
    await page.fill("#vs-brief", JOB);
    await page.click("button.vs-brief-toggle");
    await page.waitForSelector(".vs-brief-fields");
    for (const key of Object.keys(FILLED)) await page.fill(`#vs-brief-${key}`, FILLED[key]);
  }
}
const chatBodies = (page) => page.evaluate(() => window.__chatBodies ?? []);

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// ── The 8 Solo frames: build from a structured brief, land in the project, see the card ──
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const name = `solo-${w}x${h}-paige-${paige}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    try {
      await homeWithDetails(page);
      await page.click("button:has-text('Build it')");
      await page.waitForSelector(".vs-session", { timeout: 30_000 });
      await page.waitForSelector(".vs-brief-card", { timeout: 30_000 });
      await page.waitForTimeout(500);
      const bodies = await chatBodies(page);
      const card = await page.locator(".vs-brief-card").innerText();
      const first = bodies[0]?.messages?.[0]?.content ?? "";
      note(first === COMPOSED, `${name} first chat message is the composed brief`, JSON.stringify(first).slice(0, 140));
      note(card.includes("The brief") && card.includes("Audience: Solo consultants") && card.includes("Brief details:"), `${name} brief card shows the recorded details`, card.replace(/\n/g, " · ").slice(0, 140));
      const ox = await overflow(page);
      note(ox <= 0, `${name} no horizontal overflow`, `overflowX=${ox}`);
      await shoot(page, name);
    } catch (e) {
      note(false, `${name} flow completed`, String(e).slice(0, 200));
    }
    await page.close();
  }
}

// ── Extras: the composer itself (light, dark, collapsed) and reopening an existing project ──
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await homeWithDetails(page, { theme: "light" });
  await shoot(page, "home-composer-1366x768");
  const ox = await overflow(page);
  note(ox <= 0, "home composer no horizontal overflow", `overflowX=${ox}`);
  await page.click("button.vs-brief-toggle"); // collapse with values kept
  await shoot(page, "home-composer-collapsed-1366x768");
  const toggleText = (await page.locator("button.vs-brief-toggle").innerText()).trim();
  note(toggleText.startsWith("Details"), "collapsed toggle says details were added", toggleText);
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await homeWithDetails(page, { theme: "dark" });
  await shoot(page, "home-composer-dark-1366x768");
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(`reopen: ${e}`));
  await page.goto(`${base}?theme=light`, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await page.waitForSelector(".vs-home", { timeout: 60_000 });
  await page.locator(".vs-card", { hasText: "Referral workshop page" }).click();
  await page.waitForSelector(".vs-brief-card", { timeout: 30_000 });
  const card = await page.locator(".vs-brief-card").innerText();
  note(card.includes("Audience: Solo consultants planning a referral engine"), "reopening an existing project shows its stored brief", card.replace(/\n/g, " · ").slice(0, 140));
  await shoot(page, "brief-reopen-1366x768");
  await page.close();
}

await browser.close();
try { vite.kill(); } catch { /* ignore */ }
try { process.platform === "win32" && spawn("taskkill", ["/F", "/T", "/PID", String(vite.pid)], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }

const passed = results.filter((r) => r.ok).length;
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ results, pageErrors: errors }, null, 2));
console.log(`${passed}/${results.length} checks passed${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}; captures in ${outDir}`);
process.exit(passed < results.length || errors.length ? 1 : 0);
