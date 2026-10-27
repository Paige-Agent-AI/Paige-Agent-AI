import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub agents A1b rendered harness. Serves the harness build on 127.0.0.1:4792 and drives the
// REAL TeamHubWorkspace against the in-memory doubles in src/ (the Team Hub doors and the paige-ai-chat
// agent turn). The rail, command row and PAIGE panel are labelled placeholders, not the real tenant
// shell; the doubles are not the database and not a model turn. Every name and figure is fictional.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(HERE, "report.json");
const BASE = process.env.TEAM_HUB_HARNESS_URL ?? "http://127.0.0.1:4792/";
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv[2];
// Steps click through DOM events, so the PAIGE overlay placeholder (1024 and 900, PAIGE open) never
// blocks the harness's own steps; the frame still shows what a person would see under that overlay.
// The SOLO viewport records used by every Team Hub increment (tenant-command-center-shell.css + readNavPreference).
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
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };

const shots = [];
for (const r of records) for (const theme of ["dark", "light"]) shots.push({ ...r, theme, act: "private-done", name: `ev-${r.id}-agents-${theme}` });
for (const theme of ["dark", "light"]) {
  shots.push({ ...phone, theme, act: "phone-list", name: `ev-390-list-${theme}` });
  shots.push({ ...phone, theme, act: "phone-reply", name: `ev-390-reply-${theme}` });
  const w = R["1366x768-closed"];
  for (const act of ["writing", "atlist", "dmlist", "profile", "agentdm", "firstuse", "firstuse-hello", "fail", "returning", "returning-answering", "returning-unread",
    "bring-asker", "bring-prefilled", "bring-other", "private-writing", "private-fail", "others-answering", "others-replied", "thread", "dm-empty"]) {
    shots.push({ ...w, theme, act, name: `ev-state-${act}-1366-${theme}` });
  }
}
shots.push({ ...phone, theme: "dark", act: "profile", name: "ev-390-profile-dark" });
// 200% zoom on a 1280x800 window: 640x400 CSS px, the hub one column (as increment 3 measured it).
const zoom = { vw: 640, vh: 400, rail: 60, row: 58, paige: "closed" };
shots.push({ ...zoom, theme: "light", act: "phone-reply", name: "ev-zoom200-1280-reply-light" });
shots.push({ ...zoom, theme: "dark", act: "atlist", name: "ev-zoom200-1280-atlist-dark" });
shots.push({ ...phone, theme: "light", act: "agentdm", name: "ev-390-agentdm-light" });
shots.push({ ...phone, theme: "dark", act: "agentdm", name: "ev-390-agentdm-dark" });
shots.push({ ...phone, theme: "dark", act: "writing", name: "ev-390-composer-dark" });
for (const theme of ["dark", "light"]) shots.push({ ...R["1024x768-closed"], theme, act: "profile", name: `ev-state-profile-1024-${theme}` });

const GOLD = ["--pg-gold-core", "--pg-gold", "--pg-gold-deep", "--pg-gold-fill"];
const report = [];
for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  const scenario = shot.act.startsWith("firstuse") ? "firstuse" : shot.act === "agentdm" ? "agentdm" : shot.act.startsWith("returning") ? "returning"
    : shot.act.startsWith("others") ? "others" : "populated";
  const as = shot.act === "bring-asker" || shot.act === "bring-prefilled" ? "&as=priya" : "";
  const extra = shot.act === "returning-answering" ? "&rs=answering" : shot.act === "returning-unread" ? "&states=down" : shot.act === "others-replied" ? "&ps=replied_privately" : "";
  const url = `${BASE}?s=${scenario}${as}&theme=${shot.theme}&vw=${shot.vw}&vh=${shot.vh}&rail=${shot.rail}&row=${shot.row ?? 66}&paige=${shot.paige}&pw=${shot.pw ?? 0}${extra}`;
  await page.goto(url);
  await page.waitForSelector(".th-hub");
  await page.waitForTimeout(400);
  const turn = (mode) => page.evaluate((m) => { window.__thTurn = m; }, mode);
  const openConv = async (label) => { await page.locator(".th-list .th-conv-item", { hasText: new RegExp(`^${label}$`) }).first().dispatchEvent("click"); await page.waitForTimeout(250); };
  const send = async (text) => { const box = page.locator(".th-conv textarea[role=combobox]"); await box.fill(text); await box.press("Escape"); await box.press("Enter"); };
  const act = shot.act;
  if (act === "private-done" || act === "phone-reply") {
    if (act === "phone-reply") await openConv("launch"); else await openConv("launch");
    await turn("private");
    await send("@VERA how did last year's workshop do for us?");
    await page.waitForSelector(".th-ag-priv:has-text('Your answer is in your DM with VERA')", { timeout: 5000 }).catch(() => undefined);
  } else if (act === "phone-list") {
    // The phone opens on the list.
  } else if (act === "writing") {
    await openConv("launch"); await turn("never"); await send("@CURA what's a good first week for people who sign up?");
    await page.waitForSelector(".th-ag-typing");
  } else if (act === "atlist") {
    await openConv("launch"); const box = page.locator(".th-conv textarea[role=combobox]"); await box.fill("@"); await box.press("End");
    await page.waitForSelector("[role=listbox][aria-label='People and agents']");
    await page.evaluate(() => { const list = document.querySelector("[role=listbox][aria-label='People and agents']"); if (list) list.scrollTop = 0; });
  } else if (act === "dmlist") {
    await page.locator("button[aria-label='Message a teammate']").dispatchEvent("click"); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector(".th-pick-head")?.scrollIntoView({ block: "start" }));
  } else if (act === "profile") {
    await openConv("launch");
    if (shot.vw < 700) await page.waitForTimeout(100);
    await page.locator(".th-msg--agent[data-ag='nexus'] .th-ag-namebtn").first().dispatchEvent("click");
    await page.waitForSelector("aside.th-profile");
  } else if (act === "agentdm") {
    await page.locator(".th-conv-item--agent[data-ag='vera']").dispatchEvent("click"); await page.waitForTimeout(300);
  } else if (act === "fail") {
    await openConv("launch"); await turn("no_reply"); await send("@MENTOR should the workshop be free or paid?");
    await page.waitForSelector(".th-ag-fail");
  } else if (act === "returning" || act === "returning-unread") {
    await openConv("launch"); await page.waitForSelector(".th-ag-fail");
  } else if (act === "returning-answering") {
    await openConv("launch"); await page.waitForSelector(".th-ag-typing");
  } else if (act === "firstuse-hello") {
    await page.locator(".th-btn--primary", { hasText: "Say hello to PAIGE" }).first().dispatchEvent("click");
    await page.waitForSelector(".th-conv-head--agent"); await page.waitForTimeout(200);
  } else if (act === "others-answering" || act === "others-replied") {
    await openConv("launch"); await page.waitForSelector(".th-ag-priv--others");
  } else if (act === "bring-other") {
    await openConv("launch"); await page.waitForSelector(".th-ag-bring");
    await page.evaluate(() => document.querySelector(".th-msg--agent[data-ag='paige']")?.scrollIntoView({ block: "center" }));
  } else if (act === "bring-asker" || act === "bring-prefilled") {
    await openConv("launch");
    await page.waitForSelector(".th-ag-bring-btn");
    if (act === "bring-prefilled") { await page.locator(".th-ag-bring-btn", { hasText: "Bring in NEXUS" }).dispatchEvent("click"); await page.waitForTimeout(150); }
    await page.evaluate(() => document.querySelector(".th-msg--agent[data-ag='paige']")?.scrollIntoView({ block: "center" }));
  } else if (act === "private-writing" || act === "private-fail") {
    await openConv("launch"); await turn(act === "private-writing" ? "private-hold" : "private-fail");
    await send("@VERA how did last year's workshop do for us?");
    await page.waitForSelector(".th-ag-priv");
  } else if (act === "thread") {
    await openConv("client-delivery");
    await page.locator(".th-replies").first().dispatchEvent("click"); await page.waitForSelector("#th-thread-reply");
    await turn("reply");
    const box = page.locator("#th-thread-reply"); await box.fill("@ZION can you turn the agenda into tasks with owners?"); await box.press("Enter");
    await page.waitForSelector(".th-thread .th-msg--agent[data-ag='zion']", { timeout: 5000 }).catch(() => undefined);
  } else if (act === "dm-empty") {
    await page.locator(".th-conv-item--agent[data-ag='paige']").dispatchEvent("click"); await page.waitForSelector(".th-ag-empty");
  }
  await page.waitForTimeout(500);
  const metrics = await page.evaluate((gold) => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("i"); document.body.append(probe);
    const resolveColor = (value) => { probe.style.color = value; return getComputedStyle(probe).color; };
    const goldValues = gold.map((token) => resolveColor(root.getPropertyValue(token).trim()));
    const hub = document.querySelector(".th-hub");
    const goldUse = [];
    for (const element of hub ? hub.querySelectorAll("*") : []) {
      const style = getComputedStyle(element);
      for (const property of ["color", "backgroundColor", "borderTopColor"]) {
        if (property === "borderTopColor" && style.borderTopWidth === "0px") continue;
        if (goldValues.includes(style[property]) && style[property] !== "rgba(0, 0, 0, 0)") goldUse.push(`${element.className || element.tagName}:${property}`);
      }
    }
    const plates = Array.from(document.querySelectorAll(".th-ag-plate[data-ag]")).slice(0, 7).map((plate) => {
      const s = getComputedStyle(plate);
      const key = plate.getAttribute("data-ag");
      return { agent: key, background: s.backgroundColor, color: s.color, tokenTint: resolveColor(root.getPropertyValue(`--pg-agent-${key}-tint`).trim()) };
    });
    const small = Array.from(hub ? hub.querySelectorAll("button, [role=option], textarea") : []).filter((element) => {
      const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.height < 32 && !element.closest("[inert]");
    }).map((element) => `${element.className || element.tagName}:${Math.round(element.getBoundingClientRect().height)}`);
    probe.remove();
    return {
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hubOverflowX: hub ? hub.scrollWidth > hub.clientWidth + 1 : null,
      // The conversation list column: the body and every row stay inside it (the prototype's guard).
      listOverflowX: (() => {
        const body = document.querySelector(".th-list-body");
        if (!body || !body.getClientRects().length) return null;
        const edge = body.getBoundingClientRect().right;
        const rows = Array.from(body.querySelectorAll(".th-conv-item")).filter((row) => row.getClientRects().length);
        return body.scrollWidth > body.clientWidth + 1 || rows.some((row) => row.getBoundingClientRect().right > edge + 1);
      })(),
      dmHeader: (() => {
        const head = document.querySelector(".th-conv-head--agent");
        if (!head) return null;
        const title = head.querySelector(".th-conv-title");
        return { button: head.querySelector(".th-head-actions button")?.innerText ?? null,
          titleClipped: title ? title.scrollWidth > title.clientWidth + 1 : null, title: title?.textContent ?? null };
      })(),
      composerHint: (() => { const hint = document.querySelector(".th-conv .th-hint"); return hint ? { text: hint.textContent, clipped: hint.scrollWidth > hint.clientWidth + 1 } : null; })(),
      composerValue: document.querySelector(".th-conv textarea[role=combobox]")?.value ?? null,
      bring: Array.from(document.querySelectorAll(".th-ag-bring")).map((row) => row.textContent),
      goldUse, plates, small,
      announced: document.querySelector("[aria-live=polite]")?.textContent ?? "",
      typing: Array.from(document.querySelectorAll(".th-ag-typing")).map((row) => row.textContent),
      fails: Array.from(document.querySelectorAll(".th-ag-fail")).map((row) => row.textContent),
      notes: Array.from(document.querySelectorAll(".th-ag-priv")).map((row) => row.textContent),
      turns: window.__thTurns ?? [],
    };
  }, GOLD);
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
  report.push({ name: shot.name, act: shot.act, viewport: `${shot.vw}x${shot.vh}`, paige: shot.paige, theme: shot.theme, errors, ...metrics });
  await page.close();
}
// Reduced motion: the writing dots stop; the words stay.
for (const motion of ["reduce", "no-preference"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: motion });
  await page.goto(`${BASE}?s=populated&theme=dark&vw=1366&vh=768&rail=72&paige=closed`);
  await page.waitForSelector(".th-hub");
  await page.locator(".th-list .th-conv-item", { hasText: /^launch$/ }).first().dispatchEvent("click");
  await page.evaluate(() => { window.__thTurn = "never"; });
  const box = page.locator(".th-conv textarea[role=combobox]"); await box.fill("@CURA hello"); await box.press("Escape"); await box.press("Enter");
  await page.waitForSelector(".th-ag-typing");
  const animation = await page.evaluate(() => getComputedStyle(document.querySelector(".th-ag-dots i")).animationName);
  const words = await page.evaluate(() => document.querySelector(".th-ag-typing")?.textContent);
  report.push({ name: `motion-${motion}`, dotAnimation: animation, words });
  await page.close();
}
// Keyboard: the @ list is a combobox; arrows move, Enter picks an agent; Tab reaches an agent row with a visible focus ring.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${BASE}?s=populated&theme=dark&vw=1366&vh=768&rail=72&paige=closed`);
  await page.waitForSelector(".th-hub");
  await page.locator(".th-list .th-conv-item", { hasText: /^launch$/ }).first().dispatchEvent("click");
  const box = page.locator(".th-conv textarea[role=combobox]");
  await box.focus(); await page.keyboard.type("@ZI");
  const expanded = await box.getAttribute("aria-expanded");
  const active = await box.getAttribute("aria-activedescendant");
  await page.keyboard.press("Enter");
  const value = await box.inputValue();
  await page.locator(".th-conv-item--agent[data-ag='merit']").focus();
  const ring = await page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return { visible: el.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` }; });
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const opened = await page.evaluate(() => document.querySelector(".th-conv-head--agent")?.textContent);
  report.push({ name: "keyboard", comboboxExpanded: expanded, activeDescendant: active, valueAfterEnter: value, agentRowFocus: ring, openedByEnter: opened });
  await page.close();
}
writeFileSync(REPORT, JSON.stringify(report, null, 1));
await browser.close();
console.log(`shots: ${report.length}`);
