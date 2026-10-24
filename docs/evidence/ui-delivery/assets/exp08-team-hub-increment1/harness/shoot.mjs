import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv[2];
// Real shell numbers (tenant-command-center-shell.css + readNavPreference): rail 216 when the
// viewport is ≥1440 (expanded by default), else 72 (compact) ≤1366; PAIGE inline is
// max(340, 26vw) above 1366, 340 at ≤1366, and an overlay of min(410, vw − rail) at ≤1080.
const records = [
  { id: "1536x770-closed", vw: 1536, vh: 770, rail: 216, paige: "closed" },
  { id: "1536x770-open", vw: 1536, vh: 770, rail: 216, paige: "inline", pw: 399 },
  { id: "1366x768-closed", vw: 1366, vh: 768, rail: 72, paige: "closed" },
  { id: "1366x768-open", vw: 1366, vh: 768, rail: 72, paige: "inline", pw: 340 },
  { id: "1366x768-navexpanded-open", vw: 1366, vh: 768, rail: 216, paige: "inline", pw: 340 },
  { id: "1024x768-closed", vw: 1024, vh: 768, rail: 72, paige: "closed" },
  { id: "1024x768-open", vw: 1024, vh: 768, rail: 72, paige: "overlay" },
  { id: "900x1000-closed", vw: 900, vh: 1000, rail: 72, paige: "closed" },
  { id: "900x1000-open", vw: 900, vh: 1000, rail: 72, paige: "overlay" },
];
const shots = [];
for (const r of records) for (const theme of ["dark", "light"]) shots.push({ ...r, theme, s: "populated", act: "thread", name: `ev-${r.id}-${theme}` });
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };
for (const theme of ["dark", "light"]) {
  shots.push({ ...phone, theme, s: "populated", act: "none", name: `ev-390-list-${theme}` });
  shots.push({ ...phone, theme, s: "populated", act: "phoneconv", name: `ev-390-conv-${theme}` });
}
shots.push({ ...phone, theme: "dark", s: "populated", act: "phonethread", name: "ev-390-thread-dark" });
shots.push({ ...phone, theme: "light", s: "firstuse", act: "none", name: "ev-390-firstuse-light" });
shots.push({ ...phone, theme: "dark", s: "firstuse", act: "phonecreate", name: "ev-390-firstuse-create-dark" });
shots.push({ ...records[2], theme: "light", s: "firstuse", act: "none", name: "ev-state-firstuse-1366-light" });
shots.push({ ...records[2], theme: "dark", s: "unavailable", act: "none", name: "ev-state-unavailable-1366-dark" });
shots.push({ ...records[5], theme: "light", s: "failed", act: "fail", name: "ev-state-sendfailed-1024-light" });
shots.push({ ...records[2], theme: "dark", s: "populated", act: "create", name: "ev-state-createchannel-1366-dark" });
shots.push({ ...records[0], theme: "dark", s: "populated", act: "mention", name: "ev-state-mention-1536-dark" });
shots.push({ ...records[1], theme: "light", s: "populated", act: "addpeople", name: "ev-state-addpeople-1536open-light" });
shots.push({ ...records[3], theme: "dark", s: "populated", act: "addpeople", name: "ev-state-addpeople-1366open-dark" });
shots.push({ ...records[2], theme: "dark", s: "populated", act: "unread", name: "ev-state-unread-opened-1366-dark" });
shots.push({ ...records[2], theme: "light", s: "populated", act: "unread", name: "ev-state-unread-opened-1366-light" });
shots.push({ ...phone, theme: "dark", s: "populated", act: "phoneunread", name: "ev-390-unread-opened-dark" });
shots.push({ ...records[5], theme: "dark", s: "populated", act: "leaveprivate", name: "ev-state-leaveconfirm-1024-dark" });
shots.push({ ...records[2], theme: "light", s: "populated", act: "createprivate", name: "ev-state-createprivate-1366-light" });

const report = [];
for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const q = new URLSearchParams({ s: shot.s, theme: shot.theme, vw: shot.vw, vh: shot.vh, rail: shot.rail, row: shot.row ?? 66, paige: shot.paige, pw: shot.pw ?? 0 });
  await page.goto(`http://127.0.0.1:4791/?${q}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const click = async (sel) => { await page.locator(sel).first().evaluate((el) => { el.focus(); el.click(); }); await page.waitForTimeout(350); };
  if (shot.act === "thread") await click(".th-replies");
  if (shot.act === "phoneconv") await click("#th-conv-c-general");
  if (shot.act === "phonethread") { await click("#th-conv-c-general"); await click(".th-replies"); }
  if (shot.act === "phonecreate") await click(".th-list .th-center button");
  if (shot.act === "create") { await click("button[aria-label='Create a channel']"); await page.locator(".th-inline-form input").fill("launch-week"); await click(".th-seg button:nth-child(2)"); await click(".th-chips .th-chip"); }
  if (shot.act === "mention") { await page.locator("textarea[role=combobox]").click(); await page.keyboard.type("Thanks @sa"); await page.waitForTimeout(300); }
  if (shot.act === "fail") { await page.locator("textarea[role=combobox]").click(); await page.keyboard.type("Sharing the run-of-show now."); await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
  if (shot.act === "unread" || shot.act === "phoneunread") await click("#th-conv-c-onboard");
  if (shot.act === "leaveprivate") { await click("#th-conv-c-lead"); await click(".th-head-actions .th-btn--ghost"); }
  if (shot.act === "createprivate") { await click("button[aria-label='Create a channel']"); await page.locator(".th-inline-form input").fill("leads"); await click(".th-seg button:nth-child(2)"); }
  if (shot.act === "addpeople") { await click("#th-conv-c-lead"); await click(".th-head-actions button"); await click("form[aria-label='Add people to this channel'] .th-chip"); }
  const metrics = await page.evaluate(() => {
    const hub = document.querySelector(".th-hub");
    const grid = document.querySelector(".th-grid");
    const thread = document.querySelector(".th-thread");
    const small = [...document.querySelectorAll(".th-hub button, .th-hub textarea, .th-hub input")]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
      .map((el) => ({ t: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
      .filter((b) => b.h < 40 || b.w < 40);
    const overflow = document.documentElement.scrollWidth > window.innerWidth;
    return { hubW: hub ? Math.round(hub.getBoundingClientRect().width) : null, cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      view: grid?.getAttribute("data-view"), thread: thread ? getComputedStyle(thread).position : null, small, overflow,
      separators: [...document.querySelectorAll(".th-hub [role=separator]")].map((el) => el.getAttribute("aria-label")),
      inert: [...document.querySelectorAll(".th-hub [inert]")].map((el) => el.className), log: document.querySelectorAll("[role=log]").length,
      marks: window.__thMarks ?? [] };
  });
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  report.push({ name: shot.name, ...metrics, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
