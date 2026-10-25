import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub increment 2 rendered harness. Serves the harness build on 127.0.0.1:4791 and
// drives the REAL TeamHubWorkspace against the in-memory doubles in src/. The rail, command row and
// PAIGE panel are labelled placeholders, not the real tenant shell.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv[2];
// Real shell numbers (tenant-command-center-shell.css + readNavPreference), as in increment 1:
// rail 216 at ≥1440 viewport (expanded by default), else 72 (compact); PAIGE inline is
// max(340, 26vw) above 1366, 340 at ≤1366, and an overlay of min(410, vw − rail) at ≤1080.
const records = [
  { id: "1536x770-closed", vw: 1536, vh: 770, rail: 216, paige: "closed" },
  { id: "1536x770-open", vw: 1536, vh: 770, rail: 216, paige: "inline", pw: 399 },
  { id: "1366x768-closed", vw: 1366, vh: 768, rail: 72, paige: "closed" },
  { id: "1366x768-open", vw: 1366, vh: 768, rail: 72, paige: "inline", pw: 340 },
  { id: "1024x768-closed", vw: 1024, vh: 768, rail: 72, paige: "closed" },
  { id: "1024x768-open", vw: 1024, vh: 768, rail: 72, paige: "overlay" },
  { id: "900x1000-closed", vw: 900, vh: 1000, rail: 72, paige: "closed" },
  { id: "900x1000-open", vw: 900, vh: 1000, rail: 72, paige: "overlay" },
];
const R = Object.fromEntries(records.map((r) => [r.id, r]));
const shots = [];
for (const r of records) for (const theme of ["dark", "light"]) shots.push({ ...r, theme, s: "populated", act: "work", name: `ev-${r.id}-work-${theme}` });
// A hub at least 1440px wide, the only width where Team work is a third column (contract §5).
const wide = { vw: 1920, vh: 1080, rail: 216, paige: "closed" };
shots.push({ ...wide, theme: "dark", s: "populated", act: "work", name: "ev-1920x1080-closed-work-thirdcolumn-dark" });
shots.push({ ...wide, theme: "light", s: "populated", act: "work", name: "ev-1920x1080-closed-work-thirdcolumn-light" });
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };
shots.push({ ...phone, theme: "dark", s: "populated", act: "phonework", name: "ev-390-work-dark" });
shots.push({ ...phone, theme: "light", s: "populated", act: "phonework", name: "ev-390-work-light" });
shots.push({ ...phone, theme: "dark", s: "populated", act: "phoneconv", name: "ev-390-conv-taskcards-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "cmdmenu", name: "ev-state-commandmenu-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", s: "populated", act: "cmdmenu", name: "ev-state-commandmenu-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "taskpreview", name: "ev-state-taskpreview-owner-1366-dark" });
shots.push({ ...R["1024x768-closed"], theme: "light", s: "populated", act: "taskpreview", name: "ev-state-taskpreview-owner-1024-light" });
shots.push({ ...R["1366x768-closed"], theme: "light", s: "populated", me: "member", act: "taskpreview", name: "ev-state-taskpreview-member-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "taskcreated", name: "ev-state-taskcreated-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "specialist", name: "ev-state-continuepaige-owner-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", s: "populated", me: "member", act: "specialist", name: "ev-state-continuepaige-member-1366-light" });
shots.push({ ...R["1024x768-closed"], theme: "dark", s: "populated", me: "member", act: "specialist", name: "ev-state-continuepaige-member-1024-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "continued", name: "ev-state-continuepaige-handedoff-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "populated", act: "none", name: "ev-state-taskcard-unreadable-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", s: "populated", act: "none", name: "ev-state-taskcard-unreadable-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "nowork", act: "work", name: "ev-state-workempty-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", s: "nowork", act: "work", name: "ev-state-workempty-1366-light" });
shots.push({ ...phone, theme: "light", s: "nowork", act: "phonework", name: "ev-390-workempty-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", s: "readfail", act: "work", name: "ev-state-readfailed-1366-dark" });

const report = [];
for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("requestfailed", (r) => errors.push(`requestfailed ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  const q = new URLSearchParams({ s: shot.s, theme: shot.theme, vw: shot.vw, vh: shot.vh, rail: shot.rail, row: shot.row ?? 66, paige: shot.paige, pw: shot.pw ?? 0, me: shot.me ?? "owner" });
  await page.goto(`http://127.0.0.1:4791/?${q}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const click = async (sel) => { await page.locator(sel).first().evaluate((el) => { el.focus(); el.click(); }); await page.waitForTimeout(400); };
  const composer = "textarea[role=combobox]";
  const typeIn = async (text) => { await page.locator(composer).first().click(); await page.keyboard.type(text, { delay: 5 }); await page.waitForTimeout(300); };
  if (shot.act === "work" || shot.act === "phonework") await click("button[aria-label='Team work']");
  if (shot.act === "phoneconv") await click("#th-conv-c-general");
  if (shot.act === "cmdmenu") await typeIn("/");
  if (shot.act === "taskpreview" || shot.act === "taskcreated") {
    await typeIn("Send the Brightline welcome packet");
    await click("button[aria-label='PAIGE commands']");
    await page.locator("[role=option]", { hasText: "Draft a task" }).first().click();
    await page.waitForTimeout(400);
    if (shot.act === "taskcreated") { await page.locator(".th-preview button[type=submit]").click(); await page.waitForTimeout(700); }
  }
  if (shot.act === "specialist" || shot.act === "continued") {
    await typeIn("@ZION can you summarize Thursday's kickoff decisions for the client?");
    await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    if (shot.act === "continued") { await page.locator(".th-preview button[type=submit]").click(); await page.waitForTimeout(700); }
  }
  const metrics = await page.evaluate(() => {
    const hub = document.querySelector(".th-hub");
    const grid = document.querySelector(".th-grid");
    const work = document.querySelector(".th-work");
    const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const small = [...document.querySelectorAll(".th-hub button, .th-hub textarea, .th-hub input")]
      .filter(visible)
      .map((el) => ({ t: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
      .filter((b) => b.h < 40 || b.w < 40);
    const overflow = document.documentElement.scrollWidth > window.innerWidth;
    const hubOverflow = hub ? hub.scrollWidth > hub.clientWidth : null;
    const w = window;
    return { hubW: hub ? Math.round(hub.getBoundingClientRect().width) : null, cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      view: grid?.getAttribute("data-view"), dataWork: grid?.getAttribute("data-work"),
      workPosition: work ? getComputedStyle(work).position : null, workW: work ? Math.round(work.getBoundingClientRect().width) : null,
      workRows: document.querySelectorAll(".th-work-row").length,
      workNotes: [...document.querySelectorAll(".th-work-note")].map((el) => el.textContent),
      workEmpty: document.querySelector(".th-work-empty")?.textContent ?? null,
      cards: [...document.querySelectorAll(".th-src")].filter(visible).map((el) => ({ label: el.getAttribute("aria-label"), text: el.querySelector(".th-src-mid")?.textContent?.slice(0, 80) })),
      menu: document.querySelector("[role=listbox][aria-label='PAIGE commands']") ? [...document.querySelectorAll("[role=listbox][aria-label='PAIGE commands'] [role=option]")].map((el) => el.querySelector(".th-option-meta > span")?.textContent) : null,
      preview: document.querySelector(".th-preview h3")?.textContent ?? null,
      previewNotices: [...document.querySelectorAll(".th-preview .th-note, .th-preview .th-pv-notice")].map((el) => el.textContent),
      actButtons: [...document.querySelectorAll(".th-hub .th-btn--act")].filter(visible).map((el) => el.textContent),
      small, overflow, hubOverflow,
      inert: [...document.querySelectorAll(".th-hub [inert]")].map((el) => el.className),
      reads: w.__thReads ?? [], paigeOpened: w.__thPaigeOpened ?? 0, prefill: w.__thPrefill ?? [] };
  });
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  report.push({ name: shot.name, ...metrics, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
