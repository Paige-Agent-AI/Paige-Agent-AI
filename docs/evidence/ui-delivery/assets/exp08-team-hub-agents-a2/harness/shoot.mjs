import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub agents A2 rendered harness (copied from A1c's). The harness build is served on
// 127.0.0.1:4793; this drives the REAL TeamHubWorkspace (and inside it the REAL, unforked PaigeConfirmCard)
// against the in-memory doubles in src/. The rail, command row and PAIGE panel are labelled placeholders, not
// the real tenant shell; the doubles are not the database, not a model turn, and there is no A2 backend
// anywhere: an approval here is a hand-written fixture in the shape the UI reads. Fictional names only.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(OUT, "report.json");
const BASE = process.env.TEAM_HUB_HARNESS_URL ?? "http://127.0.0.1:4793/";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const desk = { vw: 1366, vh: 768, rail: 72, paige: "closed" };
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };

// state → scenario, viewer and the conversation it lives in.
// Round 2: the standing-permission receipt is gone (no seam; contract A2 forces every write to a card);
// added Running, Didn't run, Couldn't confirm, the offline card and a teammate's view of every settled state.
const STATES = {
  suggest: { s: "a2-suggest", open: "daily-management" },
  "dm-prepare": { s: "a2-dm", open: "merit" },
  "channel-task-asker": { s: "a2-task", open: "daily-management" },
  "channel-task-other": { s: "a2-task", as: "priya", open: "daily-management" },
  "channel-task-offline": { s: "a2-task", open: "daily-management", offline: true },
  working: { s: "a2-working", open: "daily-management" },
  done: { s: "a2-done", open: "daily-management" },
  "done-other": { s: "a2-done", as: "priya", open: "daily-management" },
  failed: { s: "a2-failed", open: "daily-management" },
  unconfirmed: { s: "a2-unconfirmed", open: "daily-management" },
  declined: { s: "a2-declined", open: "daily-management" },
  "declined-other": { s: "a2-declined", as: "priya", open: "daily-management" },
  expired: { s: "a2-expired", open: "daily-management" },
  "expired-other": { s: "a2-expired", as: "priya", open: "daily-management" },
  // Round 3 (owner decision 1, design option): Execute-within-standing-authority, the receipt for an
  // ordinary write the asker's standing permission covered. The asker can Pause; a teammate reads it.
  standing: { s: "a2-standing", open: "daily-management" },
  "standing-other": { s: "a2-standing", as: "priya", open: "daily-management" },
  // Not in the brief's eight: PAIGE's own card, to show her strip (gold tint + a 2px line in her ring value).
  "paige-dm-prepare": { s: "a2-dm", open: "paige" },
};
const shots = [];
for (const state of Object.keys(STATES)) for (const theme of ["dark", "light"]) shots.push({ ...desk, theme, state, name: `a2-${state}-1366-${theme}` });
for (const state of ["dm-prepare", "channel-task-asker", "channel-task-other", "done", "failed", "declined", "expired", "standing"]) for (const theme of ["dark", "light"]) shots.push({ ...phone, theme, state, name: `a2-${state}-390-${theme}` });

const report = { generated: new Date().toISOString(), harness: BASE, shots: [], interactions: [] };
const urlFor = (shot, cfg) => `${BASE}?s=${cfg.s}${cfg.as ? `&as=${cfg.as}` : ""}${cfg.offline ? "&offline=1" : ""}&theme=${shot.theme}&vw=${shot.vw}&vh=${shot.vh}&rail=${shot.rail}&row=${shot.row ?? 66}&paige=${shot.paige}&pw=${shot.pw ?? 0}`;

async function openState(page, cfg) {
  await page.waitForSelector(".th-hub .th-list");
  await page.waitForTimeout(300);
  if (cfg.open === "daily-management") await page.locator(".th-list .th-conv-item", { hasText: /^daily-management$/ }).first().dispatchEvent("click");
  else await page.locator(`.th-list .th-conv-item--agent[data-ag='${cfg.open}']`).first().dispatchEvent("click");
  await page.waitForSelector(".th-msg--agent");
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const target = document.querySelector(".th-ap") ?? Array.from(document.querySelectorAll(".th-msg--agent")).at(-1);
    target?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(250);
}

for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const cfg = STATES[shot.state];
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(urlFor(shot, cfg));
  await openState(page, cfg);
  const metrics = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const hub = document.querySelector(".th-hub");
    const parse = (value) => { const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)/.exec(value ?? ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
    const all = (value) => [...(value ?? "").matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);
    // Gold family: an amber/champagne hue with real chroma (ink and muted greys are warm but nearly neutral).
    const isGold = (value) => { const c = parse(value); if (!c || c.a < 0.12) return false;
      const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), chroma = max - min; if (chroma < 40) return false;
      let h; if (max === c.r) h = ((c.g - c.b) / chroma) % 6; else if (max === c.g) h = (c.b - c.r) / chroma + 2; else h = (c.r - c.g) / chroma + 4;
      h = (h * 60 + 360) % 360; return h >= 26 && h <= 62; };
    const IDENTITY = ".th-ag-plate, .th-ag-name, .th-ag-tag, .th-ag-chip, .th-ap-strip, .th-conv-head--agent, .th-conv-item--agent, .th-prof-id, .th-ag-dots, .th-option[data-ag]";
    const STATUS = "[data-confirm-part='seal'] svg, .th-state, .th-ag-fail svg, .th-ag-priv--failed > svg";
    const describe = (el) => { const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
      return `${el.tagName.toLowerCase()}${cls ? "." + cls.trim().split(/\s+/).slice(0, 3).join(".") : ""}`; };
    const goldUse = { approve: [], paigeIdentity: [], status: [], leaks: [] };
    const scan = (el, style, pseudo) => {
      const paints = [];
      paints.push(["color", style.color]);
      paints.push(["background-color", style.backgroundColor]);
      for (const side of ["Top", "Right", "Bottom", "Left"]) if (style[`border${side}Width`] !== "0px" && style[`border${side}Style`] !== "none") paints.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
      for (const c of all(style.boxShadow)) paints.push(["box-shadow", c]);
      for (const c of all(style.backgroundImage)) paints.push(["background-image", c]);
      if (el instanceof SVGElement) { paints.push(["stroke", style.stroke]); paints.push(["fill", style.fill]); }
      for (const [prop, value] of paints) {
        if (!isGold(value)) continue;
        // Text colour only counts where it draws something: text in this element, or an icon.
        if (prop === "color" && !pseudo && !(el instanceof SVGElement) && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const where = `${describe(el)}${pseudo ?? ""}:${prop}=${value}`;
        if (el.closest("[data-confirm-part='approve']")) goldUse.approve.push(where);
        else if (el.closest(IDENTITY) && el.closest("[data-ag='paige']")) goldUse.paigeIdentity.push(where);
        else if (el.matches(STATUS) || el.closest("[data-confirm-part='seal'] svg")) goldUse.status.push(where);
        else goldUse.leaks.push(where);
      }
    };
    for (const el of hub ? hub.querySelectorAll("*") : []) {
      if (!el.getClientRects().length) continue;
      scan(el, getComputedStyle(el), null);
      for (const pseudo of ["::before", "::after"]) { const s = getComputedStyle(el, pseudo); if (s.content && s.content !== "none" && s.content !== "normal") scan(el, s, pseudo); }
    }
    const cards = Array.from(document.querySelectorAll(".th-ap")).map((card) => {
      const ag = card.getAttribute("data-ag");
      const token = (role) => { const probe = document.createElement("i"); probe.style.color = root.getPropertyValue(`--pg-agent-${ag}-${role}`).trim(); document.body.append(probe); const v = getComputedStyle(probe).color; probe.remove(); return v; };
      const agentColours = ["fill", "tint", "ink", "ring"].map(token);
      const strip = card.querySelector(".th-ap-strip");
      const stripStyle = strip ? getComputedStyle(strip) : null;
      const footColours = [];
      const FOOT = ["seal", "status", "controls", "refusal", "next"].map((part) => `[data-confirm-part='${part}'], [data-confirm-part='${part}'] *`).join(", ");
      for (const el of card.querySelectorAll(`.th-ap-foot, .th-ap-foot *, ${FOOT}`)) {
        const s = getComputedStyle(el); for (const v of [s.color, s.backgroundColor, s.borderTopColor]) if (agentColours.includes(v)) footColours.push(`${describe(el)}=${v}`);
      }
      const r = card.getBoundingClientRect();
      const body = card.closest(".th-msg-body")?.getBoundingClientRect();
      return {
        agent: ag, state: card.getAttribute("data-ap-state"), view: card.getAttribute("data-ap-view"),
        text: card.innerText.replace(/\s+/g, " ").trim(),
        buttons: Array.from(card.querySelectorAll("button")).map((b) => ({ text: b.innerText.trim(), height: Math.round(b.getBoundingClientRect().height), disabled: b.disabled })),
        links: Array.from(card.querySelectorAll("a")).map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href"), color: getComputedStyle(a).color })),
        strip: stripStyle ? { boxShadow: stripStyle.boxShadow, background: stripStyle.backgroundColor, kindColor: getComputedStyle(strip.querySelector(".th-ap-kind")).color,
          expectFill: agentColours[0], expectInk: agentColours[2], lineIsAgentFill: stripStyle.boxShadow.includes(agentColours[0]),
          kindIsAgentInk: getComputedStyle(strip.querySelector(".th-ap-kind")).color === agentColours[2] } : null,
        agentColourInFooter: footColours,
        approveFill: (() => { const b = card.querySelector("[data-confirm-part='approve']"); if (!b) return null; const s = getComputedStyle(b);
          const probe = document.createElement("i"); probe.style.color = root.getPropertyValue("--pg-gold-fill").trim(); document.body.append(probe); const fill = getComputedStyle(probe).color; probe.remove();
          return { background: s.backgroundColor, isPgGoldFill: s.backgroundColor === fill, backgroundImage: s.backgroundImage, color: s.color, height: Math.round(b.getBoundingClientRect().height), radius: s.borderTopLeftRadius, boxShadow: s.boxShadow }; })(),
        // Measured type step: the summary carries the weight, the footer status is the caption under it.
        type: (() => { const sum = card.querySelector("[data-confirm-part='summary'], .th-ap-sum"); const st = card.querySelector("[data-confirm-part='status'] p, [data-confirm-part='refusal'], .th-ap-foot span");
          const t = (el) => el ? (({ fontSize, fontWeight, color }) => ({ fontSize, fontWeight, color }))(getComputedStyle(el)) : null; return { summary: t(sum), footer: t(st) }; })(),
        footerOrder: Array.from(card.querySelectorAll("[data-confirm-part='controls'] button")).map((b) => ({ text: b.innerText.trim(), x: Math.round(b.getBoundingClientRect().left) })).sort((a, b) => a.x - b.x).map((b) => b.text),
        rect: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) },
        insideMessageBody: body ? r.left >= body.left - 1 && r.right <= body.right + 1 : null,
        insideViewport: r.left >= 0 && r.right <= window.innerWidth,
        overflowX: card.scrollWidth > card.clientWidth + 1,
      };
    });
    return {
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      pageOverflowXpx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hubOverflowXpx: hub ? hub.scrollWidth - hub.clientWidth : null,
      goldOutsideApprove: goldUse.leaks.length > 0,
      goldUse, cards,
      lastAgentText: Array.from(document.querySelectorAll(".th-msg--agent .th-text")).at(-1)?.textContent ?? null,
    };
  });
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
  report.shots.push({ name: shot.name, state: shot.state, viewport: `${shot.vw}x${shot.vh}`, theme: shot.theme, viewer: cfg.as ?? "morgan (owner, the asker)", errors, ...metrics });
  await page.close();
}

// Interactions: the asker's Approve and Not now reach the handler with their own fingerprint; another member
// has nothing to press; offline, both controls are disabled. Recorded by the harness, never redeemed (no A2 backend).
if (!only) {
  const drive = async (name, state, click) => {
    const cfg = STATES[state];
    const page = await browser.newPage({ viewport: { width: desk.vw, height: desk.vh } });
    const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
    if (cfg.offline) await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(urlFor({ ...desk, theme: "dark" }, cfg));
    await openState(page, cfg);
    const before = await page.evaluate(() => Array.from(document.querySelectorAll(".th-ap button")).map((b) => `${b.innerText.trim()}${b.disabled ? " (disabled)" : ""}`));
    if (click) await page.locator(".th-ap button", { hasText: click }).first().click();
    await page.waitForTimeout(100);
    const recorded = await page.evaluate(() => window.__thApprovals ?? []);
    report.interactions.push({ name, state, buttonsBefore: before, clicked: click ?? null, recorded, errors });
    await page.close();
  };
  await drive("approve-dm", "dm-prepare", "Approve");
  await drive("not-now-channel", "channel-task-asker", "Not now");
  await drive("other-member-has-no-controls", "channel-task-other", null);
  await drive("offline-controls-disabled", "channel-task-offline", null);
  await drive("pause-standing", "standing", "Pause");
  await drive("standing-other-has-no-controls", "standing-other", null);
  // Keyboard: Tab onto Approve shows the hub's violet focus outline, never a gold glow.
  const page = await browser.newPage({ viewport: { width: desk.vw, height: desk.vh } });
  await page.goto(urlFor({ ...desk, theme: "dark" }, STATES["dm-prepare"]));
  await openState(page, STATES["dm-prepare"]);
  await page.locator(".th-ap button", { hasText: "Not now" }).focus();
  await page.keyboard.press("Shift+Tab");
  const focus = await page.evaluate(() => { const b = document.activeElement; const s = getComputedStyle(b);
    return { focused: b.innerText.trim(), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, boxShadow: s.boxShadow, violet: getComputedStyle(document.documentElement).getPropertyValue("--pg-violet").trim() }; });
  await page.screenshot({ path: resolve(OUT, "a2-dm-prepare-1366-dark-focus.png") });
  report.interactions.push({ name: "keyboard-focus-approve", ...focus });
  await page.close();
}
writeFileSync(REPORT, JSON.stringify(report, null, 1));
await browser.close();
console.log(`shots: ${report.shots.length}, interactions: ${report.interactions.length}`);
