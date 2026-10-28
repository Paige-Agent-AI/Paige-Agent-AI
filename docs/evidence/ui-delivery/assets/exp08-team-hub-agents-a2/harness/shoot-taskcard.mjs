import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 A2a slice 1: the Team Hub task card's link to Operations → Work, shot SEPARATELY from the frozen A2
// set (shoot.mjs, §28), so nothing here can touch those frames or their report. Same harness build on
// 127.0.0.1:4793: the REAL TeamHubWorkspace and TaskCard against the in-memory doubles; the plan_items read is
// a hand-written fixture (`tr`: read, failed, unreadable). Not the real shell, not authenticated, and the
// link's target screen is not rendered here (the harness mounts Team Hub only). Fictional names only.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(OUT, "report-taskcard.json");
const BASE = process.env.TEAM_HUB_HARNESS_URL ?? "http://127.0.0.1:4793/";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const desk = { vw: 1366, vh: 768, rail: 72, row: 66 };
const phone = { vw: 390, vh: 844, rail: 60, row: 58 };
const shots = [];
for (const tr of ["read", "failed", "unreadable"]) for (const theme of ["dark", "light"]) for (const [size, v] of [["1366", desk], ["390", phone]]) shots.push({ ...v, tr, theme, name: `a2a-taskcard-${tr}-${size}-${theme}` });
const urlFor = (shot) => `${BASE}?s=a2-taskcard&tr=${shot.tr}&theme=${shot.theme}&vw=${shot.vw}&vh=${shot.vh}&rail=${shot.rail}&row=${shot.row}&paige=closed&pw=0`;

async function open(page) {
  await page.waitForSelector(".th-hub .th-list");
  await page.waitForTimeout(300);
  await page.locator(".th-list .th-conv-item", { hasText: /^daily-management$/ }).first().dispatchEvent("click");
  await page.waitForSelector(".th-src .th-src-foot");
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector(".th-src")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
}

const report = { generated: new Date().toISOString(), harness: BASE, shots: [], interactions: [] };
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(urlFor(shot));
  await open(page);
  const metrics = await page.evaluate(() => {
    const card = document.querySelector(".th-src");
    const foot = card?.querySelector(".th-src-foot");
    const fresh = foot?.querySelector(".th-src-fresh")?.getBoundingClientRect();
    const links = Array.from(card?.querySelectorAll("a") ?? []).map((a) => { const s = getComputedStyle(a); const r = a.getBoundingClientRect();
      return { text: a.innerText.trim(), href: a.getAttribute("href"), color: s.color, background: s.backgroundColor, fontSize: s.fontSize, fontWeight: s.fontWeight,
        height: Math.round(r.height), right: Math.round(r.right), overlapsReadTime: fresh ? !(r.right <= fresh.left || r.left >= fresh.right || r.bottom <= fresh.top || r.top >= fresh.bottom) : null }; });
    const r = card?.getBoundingClientRect();
    return {
      cardText: card?.innerText.replace(/\s+/g, " ").trim() ?? null, links,
      footDisplay: foot ? getComputedStyle(foot).display : null,
      insideCard: r ? links.every((l) => l.right <= Math.round(r.right) + 1) : null,
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      pageOverflowXpx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ink: getComputedStyle(document.documentElement).getPropertyValue("--pg-ink").trim(),
    };
  });
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
  report.shots.push({ name: shot.name, read: shot.tr, viewport: `${shot.vw}x${shot.vh}`, theme: shot.theme, errors, ...metrics });
  await page.close();
}
// Keyboard: Tab reaches the link with the hub's violet ring, inset inside the card.
const page = await browser.newPage({ viewport: { width: desk.vw, height: desk.vh } });
await page.goto(urlFor({ ...desk, tr: "read", theme: "dark" }));
await open(page);
await page.locator(".th-src a").focus();
const focus = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a);
  return { focused: a.innerText.trim(), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, outlineOffset: s.outlineOffset, violet: getComputedStyle(document.documentElement).getPropertyValue("--pg-violet").trim() }; });
await page.screenshot({ path: resolve(OUT, "a2a-taskcard-read-1366-dark-focus.png") });
report.interactions.push({ name: "keyboard-focus-open-link", ...focus });
await page.close();
writeFileSync(REPORT, JSON.stringify(report, null, 1));
await browser.close();
console.log(`shots: ${report.shots.length}, interactions: ${report.interactions.length}`);
