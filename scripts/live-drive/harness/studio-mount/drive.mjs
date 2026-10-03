// Drives the Vibe Studio harness: the Solo matrix (4 viewports × PAIGE closed/open) on a project in
// layout C, plus Studio home, a live build turn, the publish panel, form settings, the timeline, a
// page on the stage, an image approval, dark theme, keyboard and reduced motion.
// Structural harness — NOT the live app.
// Serve first:  npx vite --config scripts/live-drive/harness/studio-mount/vite.config.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "scripts/live-drive/artifacts/studio";
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:5216/";
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];
const results = [];
async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
  const ok = await page.evaluate(() => { const t = [...document.querySelectorAll("div")].find((d) => d.textContent === "harness render · not live"); const r = t?.getBoundingClientRect(); return !!r && r.height > 0 && r.bottom <= innerHeight; });
  if (!ok) throw new Error("label not on screen — refusing to write the frame");
}
async function shoot(page, name) { await label(page); await page.screenshot({ path: `${out}/${name}.png` }); }
async function open(query, w, h, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ?? "no-preference" });
  page.on("pageerror", (e) => errors.push(`${query} ${w}x${h}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${query} ${w}x${h} console: ${m.text()}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  return page;
}
async function openProject(page, title) {
  await page.locator(".vs-card", { hasText: title }).click();
  await page.waitForSelector(".vs-session");
  await page.waitForFunction(() => document.querySelector(".vs-sheet, .vs-page-frame iframe, .vs-stage-empty"));
  await page.waitForTimeout(250);
}
async function measure(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const inView = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; };
    const studio = q(".vs-studio");
    const offenders = [...studio.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 3).map((el) => el.className || el.tagName);
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      studioCoversViewport: (() => { const r = studio.getBoundingClientRect(); return r.left <= 0 && r.top <= 0 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1; })(),
      offenders,
      publishVisible: inView(q(".vs-top-actions .vs-btn-gold, .vs-top-actions .vs-btn:last-child")),
      timelineVisible: inView(q(".vs-timeline-head")),
      chatInputVisible: inView(q("#vs-chat-input")) || q(".vs-chat")?.dataset.open === "false",
      stageScrolls: (() => { const s = q(".vs-stage"); return s ? { overflowY: getComputedStyle(s).overflowY, scrollable: s.scrollHeight > s.clientHeight } : null; })(),
    };
  });
}

// The Solo matrix on a project (layout C).
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const page = await open(`theme=light&paige=${paige}`, w, h);
    await openProject(page, "New client intake");
    const name = `solo-${w}x${h}-paige-${paige}`;
    results.push({ name, ...(await measure(page)) });
    await shoot(page, name);
    await page.close();
  }
}

// Studio home.
for (const [w, h] of [[1366, 768], [900, 1000]]) {
  const page = await open("theme=light", w, h);
  await page.waitForSelector(".vs-card");
  results.push({ name: `home-${w}`, docOverflowX: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), focused: await page.evaluate(() => document.activeElement?.id) });
  await shoot(page, `home-${w}x${h}`);
  await page.close();
}

// A turn in progress and done: steps, reply, stage refreshed.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "New client intake");
  await page.fill("#vs-chat-input", "Add a question about budget");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".vs-steps li");
  await page.waitForFunction(() => document.querySelector(".vs-msg-paige:last-of-type")?.textContent?.includes("budget") || [...document.querySelectorAll(".vs-msg-paige")].some((m) => m.textContent.includes("budget for this")));
  await page.waitForTimeout(200);
  results.push({ name: "turn", steps: await page.$$eval(".vs-steps li span", (s) => s.map((x) => x.firstChild?.textContent)), saveState: await page.textContent(".vs-status") });
  await shoot(page, "turn-1366x768");
  await page.close();
}

// Publish panel → publish → the address the RPC returned.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "New client intake");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForSelector(".vs-pop");
  await page.waitForTimeout(150);
  results.push({ name: "publish-checks", checks: await page.$$eval(".vs-checks li span", (s) => s.map((x) => x.firstChild?.textContent)), focused: await page.evaluate(() => document.activeElement?.textContent) });
  await shoot(page, "publish-1366x768");
  await page.getByRole("button", { name: "Publish now" }).click();
  await page.waitForSelector(".vs-pop h2:text(\"It's live\")");
  results.push({ name: "publish-done", calls: await page.evaluate(() => window.__studioCalls.filter((c) => c.fn.endsWith("_publish"))), link: await page.textContent(".vs-pop a") });
  await shoot(page, "published-1366x768");
  await page.keyboard.press("Escape");
  results.push({ name: "publish-esc", panelOpen: await page.locator(".vs-pop").count(), stillInProject: await page.locator(".vs-session").count() });
  await page.close();
}

// Form settings.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "New client intake");
  await page.getByRole("button", { name: "Form settings" }).click();
  await page.waitForSelector(".vs-inspector");
  await page.waitForTimeout(250);
  await shoot(page, "form-settings-1366x768");
  await page.close();
}

// Timeline: pick version 1 → go back.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "New client intake");
  await page.locator(".vs-version", { hasText: "First draft" }).click();
  await shoot(page, "timeline-select-1366x768");
  await page.getByRole("button", { name: "Go back to this version" }).click();
  await page.waitForSelector(".vs-notice");
  results.push({ name: "restore", calls: await page.evaluate(() => window.__studioCalls.filter((c) => c.fn === "restore_artifact_version")), notice: await page.textContent(".vs-notice") });
  await page.close();
}

// A page on the stage (real GrowthBlocks through LivePreview), desktop and phone preview.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "Referral workshop page");
  await page.waitForTimeout(600);
  await shoot(page, "page-1366x768");
  await page.getByRole("button", { name: "Phone" }).click();
  await page.waitForTimeout(500);
  await shoot(page, "page-phone-1366x768");
  await page.close();
}

// An image waiting for approval in the project's chat.
{
  const page = await open("theme=light&approval=1", 1366, 768);
  await openProject(page, "New client intake");
  results.push({ name: "approval", shown: await page.locator(".vs-approval").count() });
  await shoot(page, "approval-1366x768");
  await page.close();
}

// Dark app theme (the Studio keeps its own dark stage either way).
{
  const page = await open("theme=dark&paige=open", 1366, 768);
  await openProject(page, "New client intake");
  await shoot(page, "dark-1366x768-paige-open");
  await page.close();
}

// Narrow: chat becomes a drawer.
{
  const page = await open("theme=light", 900, 1000);
  await openProject(page, "New client intake");
  await page.getByRole("button", { name: "Show chat" }).click();
  await page.waitForTimeout(300);
  results.push({ name: "chat-drawer-900", open: await page.evaluate(() => document.querySelector(".vs-chat")?.dataset.open), inputVisible: await page.evaluate(() => { const r = document.querySelector("#vs-chat-input").getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; }) });
  await shoot(page, "chat-drawer-900x1000");
  await page.close();
}

// Keyboard: Tab order through the project top bar; Esc steps back to home, Esc again closes.
{
  const page = await open("theme=light", 1366, 768);
  await openProject(page, "New client intake");
  await page.evaluate(() => document.activeElement?.blur());
  const route = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    route.push(await page.evaluate(() => { const a = document.activeElement; return a.getAttribute("aria-label") || a.textContent?.trim().slice(0, 28) || a.tagName; }));
  }
  results.push({ name: "keyboard", route });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector(".vs-home");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  results.push({ name: "esc", backToHome: true, studioClosed: await page.evaluate(() => window.__closed === 1) });
  await page.close();
}

// Reduced motion.
{
  const page = await open("theme=light", 1366, 768, { reducedMotion: "reduce" });
  await openProject(page, "New client intake");
  results.push({ name: "reduced-motion", cardTransition: await page.evaluate(() => { const els = [...document.querySelectorAll(".vs-studio *")]; const moving = els.filter((e) => { const cs = getComputedStyle(e); return (parseFloat(cs.animationDuration) > 0.01 && cs.animationName !== "none") || parseFloat(cs.transitionDuration) > 0.01; }); return moving.length; }) });
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 1));
if (errors.length) process.exit(1);
