import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub agents A1c rendered harness (copied from A1b's). Serves the harness build on 127.0.0.1:4792
// and drives the REAL TeamHubWorkspace against the in-memory doubles in src/ (the Team Hub doors and the
// paige-ai-chat agent turn). The rail, command row and PAIGE panel are labelled placeholders, not the real
// tenant shell; the doubles are not the database and not a model turn. Every name and figure is fictional.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(HERE, "report.json");
const BASE = process.env.TEAM_HUB_HARNESS_URL ?? "http://127.0.0.1:4792/";
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv[2];
const desk = { vw: 1366, vh: 768, rail: 72, paige: "closed" };
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };
const shots = [];
for (const theme of ["dark", "light"]) {
  for (const act of ["writing-others", "private-fail-merit", "atlist-top", "atlist-everyone", "chips"]) shots.push({ ...desk, theme, act, name: `ev-a1c-${act}-1366-${theme}` });
}
shots.push({ ...phone, theme: "dark", act: "writing-others", name: "ev-a1c-writing-others-390-dark" });
shots.push({ ...phone, theme: "dark", act: "atlist-everyone", name: "ev-a1c-atlist-everyone-390-dark" });
shots.push({ ...phone, theme: "light", act: "atlist-top", name: "ev-a1c-atlist-top-390-light" });
// Round 2: the private box whose state cannot be read ("may still be writing", MERIT's tint kept, §28) and the thread's @ list.
for (const theme of ["dark", "light"]) {
  for (const act of ["private-still-writing-merit", "thread-atlist"]) shots.push({ ...desk, theme, act, name: `ev-a1c-${act}-1366-${theme}` });
}
shots.push({ ...phone, theme: "dark", act: "thread-atlist", name: "ev-a1c-thread-atlist-390-dark" });

const GOLD = ["--pg-gold-core", "--pg-gold", "--pg-gold-deep", "--pg-gold-fill"];
const report = [];
for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  const scenario = shot.act === "writing-others" ? "writing" : shot.act === "chips" ? "chips" : shot.act === "private-still-writing-merit" ? "unknown" : "populated";
  const url = `${BASE}?s=${scenario}${scenario === "unknown" ? "&states=down" : ""}&theme=${shot.theme}&vw=${shot.vw}&vh=${shot.vh}&rail=${shot.rail}&row=${shot.row ?? 66}&paige=${shot.paige}&pw=${shot.pw ?? 0}`;
  await page.goto(url);
  await page.waitForSelector(".th-hub");
  await page.waitForTimeout(400);
  const turn = (mode) => page.evaluate((m) => { window.__thTurn = m; }, mode);
  const openConv = async (label) => { await page.locator(".th-list .th-conv-item", { hasText: new RegExp(`^${label}$`) }).first().dispatchEvent("click"); await page.waitForTimeout(250); };
  const send = async (text) => { const box = page.locator(".th-conv textarea[role=combobox]"); await box.fill(text); await box.press("Escape"); await box.press("Enter"); };
  const act = shot.act;
  if (act === "writing-others") {
    // Morgan did not ask: the writing row comes from the member-safe read alone.
    await openConv("launch"); await page.waitForSelector(".th-ag-typing");
  } else if (act === "private-fail-merit") {
    await openConv("launch"); await turn("private-fail");
    await send("@MERIT what did Harper & Co. pay us last quarter?");
    await page.waitForSelector(".th-ag-priv--failed");
    await page.evaluate(() => document.querySelector(".th-ag-priv--failed")?.scrollIntoView({ block: "center" }));
  } else if (act === "atlist-top" || act === "atlist-everyone") {
    await openConv("launch"); const box = page.locator(".th-conv textarea[role=combobox]"); await box.fill("@"); await box.press("End");
    await page.waitForSelector("[role=listbox][aria-label='People and agents']");
    if (act === "atlist-everyone") {
      // Up from the first option wraps to the last (@here), which the list scrolls into view.
      // Up from the first option wraps to the last (@here); the list keeps it in view by itself.
      await box.press("ArrowUp"); await page.waitForTimeout(150);
    } else {
      await page.evaluate(() => { const list = document.querySelector("[role=listbox][aria-label='People and agents']"); if (list) list.scrollTop = 0; });
    }
  } else if (act === "private-still-writing-merit") {
    await openConv("launch"); await page.waitForSelector(".th-ag-priv[data-ag='merit']");
    await page.evaluate(() => document.querySelector(".th-ag-priv[data-ag='merit']")?.scrollIntoView({ block: "center" }));
  } else if (act === "thread-atlist") {
    await openConv("client-delivery");
    await page.locator(".th-conv button", { hasText: /^2 replies/ }).first().click();
    const reply = page.locator("#th-thread-reply"); await reply.waitFor();
    await reply.fill("@"); await reply.press("End");
    await page.waitForSelector(".th-thread [role=listbox][aria-label='People and agents']");
  } else if (act === "chips") {
    await openConv("launch"); await page.waitForSelector(".th-bc-chip");
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
      atList: Array.from(document.querySelectorAll("[role=listbox][aria-label='People and agents'] .th-pop-head, [role=listbox][aria-label='People and agents'] [role=option]"))
        .map((item) => item.getAttribute("role") === "option" ? `${item.getAttribute("aria-selected") === "true" ? "*" : ""}${item.getAttribute("data-ag") ?? item.getAttribute("data-bc") ?? item.querySelector(".th-option-meta span")?.textContent}` : `# ${item.textContent}`),
      failedBox: (() => { const box = document.querySelector(".th-ag-priv--failed"); if (!box) return null; const s = getComputedStyle(box);
        return { text: box.textContent, dataAg: box.getAttribute("data-ag"), border: s.borderTopColor, background: s.backgroundColor,
          surface: resolveColor(root.getPropertyValue("--pg-surface").trim()), line: resolveColor(root.getPropertyValue("--pg-line").trim()) }; })(),
      unknownBox: (() => { const box = Array.from(document.querySelectorAll(".th-ag-priv")).find((row) => row.textContent?.includes("may still be writing")); if (!box) return null; const s = getComputedStyle(box);
        return { text: box.textContent, dataAg: box.getAttribute("data-ag"), statusClass: box.classList.contains("th-ag-priv--status"), border: s.borderTopColor, background: s.backgroundColor,
          icon: box.querySelector("svg") ? getComputedStyle(box.querySelector("svg")).color : null,
          surface: resolveColor(root.getPropertyValue("--pg-surface").trim()), agentInk: resolveColor(root.getPropertyValue("--pg-agent-merit-ink").trim()) }; })(),
      threadAtList: Array.from(document.querySelectorAll(".th-thread [role=listbox][aria-label='People and agents'] .th-pop-head, .th-thread [role=listbox][aria-label='People and agents'] [role=option]"))
        .map((item) => item.getAttribute("role") === "option" ? `${item.getAttribute("data-ag") ?? item.getAttribute("data-bc") ?? item.querySelector(".th-option-meta span")?.textContent}` : `# ${item.textContent}`),
      threadHint: document.querySelector(".th-thread .th-hint")?.textContent ?? null,
      chips: Array.from(document.querySelectorAll(".th-msg .th-mention")).map((chip) => ({ text: chip.textContent, kind: chip.classList.contains("th-bc-chip") ? "everyone" : chip.getAttribute("data-ag") ? "agent" : "person",
        background: getComputedStyle(chip).backgroundColor })),
      fails: Array.from(document.querySelectorAll(".th-ag-fail")).map((row) => row.textContent),
      notes: Array.from(document.querySelectorAll(".th-ag-priv")).map((row) => row.textContent),
      turns: window.__thTurns ?? [],
    };
  }, GOLD);
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
  report.push({ name: shot.name, act: shot.act, viewport: `${shot.vw}x${shot.vh}`, paige: shot.paige, theme: shot.theme, errors, ...metrics });
  await page.close();
}
// Reduced motion: another member's writing dots stop; the words stay.
for (const motion of ["reduce", "no-preference"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: motion });
  await page.goto(`${BASE}?s=writing&theme=dark&vw=1366&vh=768&rail=72&paige=closed`);
  await page.waitForSelector(".th-hub");
  await page.locator(".th-list .th-conv-item", { hasText: /^launch$/ }).first().dispatchEvent("click");
  await page.waitForSelector(".th-ag-typing");
  const animation = await page.evaluate(() => getComputedStyle(document.querySelector(".th-ag-dots i")).animationName);
  const words = await page.evaluate(() => document.querySelector(".th-ag-typing")?.textContent);
  report.push({ name: `motion-${motion}`, dotAnimation: animation, words });
  await page.close();
}
// Keyboard: the @ list wraps up to @here, Tab picks @channel, and the send carries p_broadcast_mention and no agent.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${BASE}?s=populated&theme=dark&vw=1366&vh=768&rail=72&paige=closed`);
  await page.waitForSelector(".th-hub");
  await page.locator(".th-list .th-conv-item", { hasText: /^launch$/ }).first().dispatchEvent("click");
  const box = page.locator(".th-conv textarea[role=combobox]");
  await box.focus(); await page.keyboard.type("@");
  await page.keyboard.press("ArrowUp");
  const last = await box.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Tab");
  const value = await box.inputValue();
  await page.keyboard.type("the workshop moved to Nov 14");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".th-bc-chip");
  report.push({ name: "keyboard", lastOption: last, valueAfterTab: value, turns: await page.evaluate(() => window.__thTurns ?? []) });
  await page.close();
}
writeFileSync(REPORT, JSON.stringify(report, null, 1));
await browser.close();
console.log(`shots: ${report.length}`);
