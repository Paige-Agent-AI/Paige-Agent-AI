import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub agents A2b rendered harness (copied from A2's). The harness is served on 127.0.0.1:4793
// (vite.config.mjs here) and this drives the REAL TeamHubWorkspace, useTeamHub and the REAL, unforked
// TeamHubApproval / PaigeConfirmCard, with NO onApprovalAct (as SoloApp mounts it): every card comes from
// the team_hub_card_states read and every Approve / Not now is the hub's own { teamHubCardAct } invoke,
// both answered by the in-memory double in src/mock-supabase.ts. The rail, command row and PAIGE panel are
// labelled stand-ins, not the real tenant shell; the double is not the database, not the doors and not a
// model turn. Fictional names only. Run: node docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/shoot.mjs
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(OUT, "report.json");
const BASE = process.env.TEAM_HUB_HARNESS_URL ?? "http://127.0.0.1:4793/";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

const V = {
  "1536-closed": { vw: 1536, vh: 770, rail: 216, paige: "closed" },
  "1536-open": { vw: 1536, vh: 770, rail: 216, paige: "inline", pw: 399 },
  "1366-closed": { vw: 1366, vh: 768, rail: 72, paige: "closed" },
  "1366-open": { vw: 1366, vh: 768, rail: 72, paige: "inline", pw: 340 },
  "1024-closed": { vw: 1024, vh: 768, rail: 72, paige: "closed" },
  "1024-open": { vw: 1024, vh: 768, rail: 72, paige: "overlay" },
  "900-closed": { vw: 900, vh: 1000, rail: 72, paige: "closed" },
  "900-open": { vw: 900, vh: 1000, rail: 72, paige: "overlay" },
  "390": { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" },
};

// state -> scenario, viewer, conversation, and the steps driven through the real UI before the frame.
const STATES = {
  "a-handover-waiting": { s: "b2-handover", open: "zion" },
  "b-handover-working": { s: "b2-handover", act: "hold", open: "zion", steps: ["approve"], expect: "working" },
  "b-handover-done": { s: "b2-handover", open: "zion", steps: ["approve"], expect: "done" },
  "b-handover-done-thread": { s: "b2-handover", open: "zion", steps: ["approve", "thread"], expect: "done" },
  "b-handover-done-reread": { s: "b2-handover-done", open: "zion", expect: "done" },
  "c-cancel-waiting": { s: "b2-cancel", open: "zion" },
  "d-cancel-declined": { s: "b2-cancel", open: "zion", steps: ["decline"], expect: "declined" },
  "e-handover-failed": { s: "b2-handover", act: "failed", open: "zion", steps: ["approve"], expect: "failed" },
  "e-handover-failed-thread": { s: "b2-handover", act: "failed", open: "zion", steps: ["approve", "thread"], expect: "failed" },
  "f-publish-waiting": { s: "b2-publish", open: "nexus" },
  "f-publish-done": { s: "b2-publish", open: "nexus", steps: ["approve"], expect: "done" },
  "f-publish-done-thread": { s: "b2-publish", open: "nexus", steps: ["approve", "thread"], expect: "done" },
  "f-publish-done-noaddr": { s: "b2-publish", act: "done-noaddr", open: "nexus", steps: ["approve", "thread"], expect: "done" },
  "g-refused-not-yours": { s: "b2-handover", act: "not_yours", open: "zion", steps: ["approve"], mirror: true, expect: "waiting" },
  "g-refused-already-decided": { s: "b2-handover", act: "already_decided", open: "zion", steps: ["approve"], mirror: true, expect: "done" },
  "g-refused-could-not-start": { s: "b2-handover", act: "could_not_start", open: "zion", steps: ["approve"], mirror: true, expect: "waiting" },
  "h-redirect-asker": { s: "b2-redirect", open: "daily-management" },
  "h-redirect-asker-opened-dm": { s: "b2-redirect", open: "daily-management", steps: ["open-dm"] },
  "h-redirect-teammate": { s: "b2-redirect", as: "priya", open: "daily-management" },
  "i-teammate-own-zion-dm": { s: "b2-handover", as: "priya", open: "zion" },
  "j-paige-handover-waiting": { s: "b2-paige-handover", open: "paige" },
  "j-paige-handover-done": { s: "b2-paige-handover", open: "paige", steps: ["approve"], expect: "done" },
};
const shots = [];
for (const state of Object.keys(STATES)) for (const theme of ["dark", "light"]) shots.push({ ...V["1366-closed"], vp: "1366-closed", theme, state, name: `a2b-${state}-1366-${theme}` });
for (const state of ["a-handover-waiting", "b-handover-done", "f-publish-done", "h-redirect-asker"]) {
  for (const vp of ["1536-closed", "1536-open", "1366-open", "1024-closed", "1024-open", "900-closed", "900-open"]) shots.push({ ...V[vp], vp, theme: "dark", state, name: `a2b-${state}-${vp}-dark` });
}
for (const state of ["a-handover-waiting", "b-handover-done"]) for (const theme of ["dark", "light"]) shots.push({ ...V["390"], vp: "390", theme, state, name: `a2b-${state}-390-${theme}` });
shots.push({ ...V["1366-closed"], vp: "1366-closed", theme: "dark", state: "a-handover-waiting", tenant: "b", name: "a2b-a-handover-waiting-1366-dark-tenant-b" });

const report = { generated: new Date().toISOString(), harness: BASE, shots: [], interactions: [] };
const urlFor = (shot, cfg) => `${BASE}?s=${cfg.s}${cfg.as ? `&as=${cfg.as}` : ""}${cfg.act ? `&act=${cfg.act}` : ""}${cfg.mirror ? "&mirror=1" : ""}${shot.tenant ? `&t=${shot.tenant}` : ""}&theme=${shot.theme}&vw=${shot.vw}&vh=${shot.vh}&rail=${shot.rail}&row=${shot.row ?? 66}&paige=${shot.paige}&pw=${shot.pw ?? 0}`;

async function openConversation(page, cfg) {
  await page.waitForSelector(".th-hub .th-list", { timeout: 20000 });
  await page.waitForTimeout(300);
  // Real pointer clicks through Playwright's actionability checks (visible, stable, not covered), never synthetic events.
  if (cfg.open === "daily-management") await page.locator(".th-list .th-conv-item", { hasText: /^daily-management$/ }).first().click();
  else await page.locator(`.th-list .th-conv-item--agent[data-ag='${cfg.open}']`).first().click();
  await page.waitForTimeout(600);
}
async function drive(page, cfg) {
  for (const step of cfg.steps ?? []) {
    if (step === "approve") await page.locator(".th-ap [data-confirm-part='approve']").first().click();
    if (step === "decline") await page.locator(".th-ap [data-confirm-part='deny']").first().click();
    if (step === "thread") await page.locator(".th-msg--agent .th-replies").first().click();
    if (step === "open-dm") await page.locator("button", { hasText: "Open DM with ZION" }).first().click();
    await page.waitForTimeout(step === "approve" || step === "decline" ? 900 : 600);
  }
  if (cfg.expect) await page.waitForSelector(`.th-ap[data-ap-state='${cfg.expect}']`, { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => {
    const target = document.querySelector(".th-thread .th-msg--agent:last-child") ?? document.querySelector(".th-ap") ?? Array.from(document.querySelectorAll(".th-msg--agent")).at(-1);
    target?.scrollIntoView({ block: "center" });
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
}

// Measured on the page: card geometry, the colour rules (agent colour in the strip only, gold only on
// Approve), WCAG contrast of the card's text against what is actually behind it, overflow, raw ids.
const measure = () => {
  const root = getComputedStyle(document.documentElement);
  const hub = document.querySelector(".th-hub");
  const parse = (value) => { const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)/.exec(value ?? ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const all = (value) => [...(value ?? "").matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);
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
    const paints = [["color", style.color], ["background-color", style.backgroundColor]];
    for (const side of ["Top", "Right", "Bottom", "Left"]) if (style[`border${side}Width`] !== "0px" && style[`border${side}Style`] !== "none") paints.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
    for (const c of all(style.boxShadow)) paints.push(["box-shadow", c]);
    for (const c of all(style.backgroundImage)) paints.push(["background-image", c]);
    if (el instanceof SVGElement) { paints.push(["stroke", style.stroke]); paints.push(["fill", style.fill]); }
    for (const [prop, value] of paints) {
      if (!isGold(value)) continue;
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
  // WCAG contrast: text colour over the composited background behind it (alpha layers blended up the tree).
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const backdrop = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let out = { r: 255, g: 255, b: 255, a: 1 }; for (const layer of layers.reverse()) out = blend(layer, out); return out; };
  const contrast = (el) => { if (!el) return null; const s = getComputedStyle(el); const fg = parse(s.color); if (!fg) return null; const bg = backdrop(el); const f = fg.a < 1 ? blend(fg, bg) : fg;
    const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x); return { ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color }; };
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
    const approve = card.querySelector("[data-confirm-part='approve']");
    const deny = card.querySelector("[data-confirm-part='deny']");
    const texts = Array.from(card.querySelectorAll("*")).filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length);
    const clipped = texts.filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible").map((el) => `${describe(el)}: ${el.textContent.trim().slice(0, 40)}`);
    return {
      agent: ag, state: card.getAttribute("data-ap-state"), view: card.getAttribute("data-ap-view"),
      text: card.innerText.replace(/\s+/g, " ").trim(),
      buttons: Array.from(card.querySelectorAll("button")).map((b) => ({ text: b.innerText.trim(), height: Math.round(b.getBoundingClientRect().height), width: Math.round(b.getBoundingClientRect().width), disabled: b.disabled })),
      strip: stripStyle ? { kindColor: getComputedStyle(strip.querySelector(".th-ap-kind")).color, lineIsAgentFill: stripStyle.boxShadow.includes(agentColours[0]) || stripStyle.borderTopColor === agentColours[0] || stripStyle.boxShadow.includes(agentColours[3]),
        kindIsAgentInk: getComputedStyle(strip.querySelector(".th-ap-kind")).color === agentColours[2] } : null,
      agentColourInFooter: footColours,
      approveFill: approve ? (() => { const s = getComputedStyle(approve); const probe = document.createElement("i"); probe.style.color = root.getPropertyValue("--pg-gold-fill").trim(); document.body.append(probe); const fill = getComputedStyle(probe).color; probe.remove();
        return { background: s.backgroundColor, isPgGoldFill: s.backgroundColor === fill, color: s.color, height: Math.round(approve.getBoundingClientRect().height) }; })() : null,
      contrast: {
        kind: contrast(card.querySelector(".th-ap-kind")),
        summary: contrast(card.querySelector("[data-confirm-part='summary'], .th-ap-sum")),
        note: contrast(card.querySelector("[data-confirm-part='action-note']")),
        status: contrast(card.querySelector("[data-confirm-part='status'] p, [data-confirm-part='status'] span, .th-ap-foot span")),
        approve: contrast(approve), notNow: contrast(deny),
      },
      footerOrder: Array.from(card.querySelectorAll("[data-confirm-part='controls'] button")).map((b) => ({ text: b.innerText.trim(), x: Math.round(b.getBoundingClientRect().left) })).sort((a, b) => a.x - b.x).map((b) => b.text),
      rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
      insideMessageBody: body ? r.left >= body.left - 1 && r.right <= body.right + 1 : null,
      insideViewport: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
      overflowX: card.scrollWidth > card.clientWidth + 1,
      clippedText: clipped,
    };
  });
  const visible = hub?.innerText ?? "";
  const rawIds = [...visible.matchAll(/\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16}|c-dm-[a-z-]+|u-(?:me|priya|sam|marcus)|zion-card|nexus-card|task_handover|task_cancel|page_publish|operations_work|not_yours|already_decided)\b/gi)].map((m) => m[0]);
  const openDm = Array.from(document.querySelectorAll(".th-ag-bring-btn")).map((b) => ({ text: b.innerText.trim(), height: Math.round(b.getBoundingClientRect().height), className: b.className }));
  const redirectRows = Array.from(document.querySelectorAll(".th-msg--agent")).filter((m) => m.innerText.includes("I can do that with you in our DM.")).map((m) => m.innerText.replace(/\s+/g, " ").trim());
  return {
    docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    pageOverflowXpx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hubOverflowXpx: hub ? hub.scrollWidth - hub.clientWidth : null,
    goldOutsideApprove: goldUse.leaks.length > 0, goldUse, cards, rawIds, openDm, redirectRows,
    thread: (() => { const t = document.querySelector(".th-thread"); return t ? Array.from(t.querySelectorAll(".th-msg--agent .th-text")).map((x) => x.textContent) : null; })(),
    liveRegion: document.querySelector(".th-hub .th-sr[aria-live=polite]")?.textContent ?? null,
    conversationTitle: document.querySelector(".th-conv-head")?.innerText.replace(/\s+/g, " ").trim().slice(0, 80) ?? null,
    listedAgentDms: Array.from(document.querySelectorAll(".th-list .th-conv-item--agent")).map((a) => a.getAttribute("data-ag")),
    cardActs: window.__thCardActs ?? [], cardReads: window.__thCardReads ?? [], openedDm: window.__thOpenedDm ?? [],
    // What is visible under a card when the card itself can't say it (A2b review fix 2).
    cardNotices: Array.from(document.querySelectorAll(".th-msg--agent .th-fail")).map((el) => el.textContent.trim()),
    directMessages: Array.from(document.querySelectorAll(".th-list .th-conv-item:not(.th-conv-item--agent)")).map((el) => el.innerText.replace(/\s+/g, " ").trim()).filter((t) => !/^(general|daily-management|client-delivery)$/.test(t)),
    activeElement: (() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.getAttribute("data-confirm-part") ? `[${a.getAttribute("data-confirm-part")}]` : ""}` : null; })(),
  };
};

for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const cfg = STATES[shot.state];
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = []; const failed = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url().replace(BASE, "/")}`); });
  await page.goto(urlFor(shot, cfg));
  // The PAIGE overlay stand-in covers the hub, as the real overlay does, so a real click can't reach it.
  // It is hidden while the hub is driven to the state and shown again for the frame.
  const overlay = "[data-harness=paige-scrim], [data-harness=paige-overlay]";
  if (shot.paige === "overlay") await page.evaluate((sel) => document.querySelectorAll(sel).forEach((el) => { el.style.visibility = "hidden"; }), overlay);
  await openConversation(page, cfg);
  await drive(page, cfg);
  if (shot.paige === "overlay") await page.evaluate((sel) => document.querySelectorAll(sel).forEach((el) => { el.style.visibility = ""; }), overlay);
  const metrics = await page.evaluate(measure);
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
  report.shots.push({ name: shot.name, state: shot.state, viewport: `${shot.vw}x${shot.vh}`, paige: shot.paige, theme: shot.theme, tenant: shot.tenant ?? "a",
    viewer: cfg.as ? "Priya Shah (teammate, did not ask)" : "Morgan Reyes (owner, the asker)", errors, failedRequests: failed, ...metrics });
  await page.close();
}

if (!only || only === "interactions") {
  // Focus order by DOM, recorded once: the controls' DOM order versus their on-screen order.
  // Keyboard: from the top of the document, Tab reaches Approve on the asker's card, then Not now; Enter on Approve fires the act.
  {
    const cfg = STATES["a-handover-waiting"];
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(urlFor({ ...V["1366-closed"], theme: "dark" }, cfg));
    await openConversation(page, cfg);
    await drive(page, cfg);
    // Reset the sequential focus starting point to the top of the document: blur, then a click on the
    // stand-in rail (nothing focusable), so the count below is from the top, not from the last focus.
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.click(8, 300);
    let presses = 0; let onApprove = false;
    for (; presses < 200; presses += 1) {
      await page.keyboard.press("Tab");
      onApprove = await page.evaluate(() => document.activeElement?.getAttribute("data-confirm-part") === "approve");
      if (onApprove) { presses += 1; break; }
    }
    const focusInfo = () => page.evaluate(() => { const b = document.activeElement; const s = getComputedStyle(b); const r = b.getBoundingClientRect();
      return { part: b.getAttribute("data-confirm-part"), text: b.innerText.trim(), focusVisible: b.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow,
        inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; });
    const approve = await focusInfo();
    await page.screenshot({ path: resolve(OUT, "a2b-a-handover-waiting-1366-dark-focus-approve.png") });
    await page.keyboard.press("Tab");
    const next = await focusInfo();
    await page.screenshot({ path: resolve(OUT, "a2b-a-handover-waiting-1366-dark-focus-notnow.png") });
    await page.keyboard.press("Shift+Tab");
    const back = await focusInfo();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => { const a = document.activeElement; const s = a ? getComputedStyle(a) : null;
      return { acts: window.__thCardActs ?? [], state: document.querySelector(".th-ap")?.getAttribute("data-ap-state"), active: a?.tagName + "." + (a?.className || "") + (a?.id ? "#" + a.id : ""),
        activeIsCardRow: Boolean(a?.matches?.(".th-msg") && a.querySelector(".th-ap")), outline: s ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` : null }; });
    await page.screenshot({ path: resolve(OUT, "a2b-a-handover-waiting-1366-dark-enter-approve.png") });
    report.interactions.push({ name: "keyboard-tab-approve-notnow-enter", tabPressesFromTop: presses, reachedApprove: onApprove, approve, afterTab: next, afterShiftTab: back, afterEnter: after });
    await page.close();
  }
  // Keyboard on Not now: Enter on the focused Not now sends decline once.
  {
    const cfg = STATES["c-cancel-waiting"];
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(urlFor({ ...V["1366-closed"], theme: "dark" }, cfg));
    await openConversation(page, cfg);
    await drive(page, cfg);
    await page.locator(".th-ap [data-confirm-part='deny']").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    report.interactions.push({ name: "keyboard-enter-notnow-twice", ...(await page.evaluate(() => ({ acts: window.__thCardActs ?? [], state: document.querySelector(".th-ap")?.getAttribute("data-ap-state"), text: document.querySelector(".th-ap")?.innerText.replace(/\s+/g, " ") }))) });
    await page.close();
  }
  // Reduced motion: the Approve -> Running -> Done flow with prefers-reduced-motion: reduce.
  {
    const cfg = STATES["b-handover-working"];
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    await page.goto(urlFor({ ...V["1366-closed"], theme: "dark" }, cfg));
    await openConversation(page, cfg);
    await drive(page, cfg);
    const rm = await page.evaluate(() => ({ prefers: matchMedia("(prefers-reduced-motion: reduce)").matches,
      running: document.getAnimations().filter((a) => a.playState === "running").map((a) => `${a.effect?.target?.className ?? "?"}:${a.animationName ?? a.constructor.name}:${a.effect?.getTiming?.().duration}`),
      cardState: document.querySelector(".th-ap")?.getAttribute("data-ap-state"), cardText: document.querySelector(".th-ap")?.innerText.replace(/\s+/g, " "),
      sealAnimation: (() => { const el = document.querySelector(".th-ap [data-confirm-part='seal'] svg, .th-ap [data-confirm-part='seal']"); if (!el) return null; const s = getComputedStyle(el); return { animationName: s.animationName, animationDuration: s.animationDuration }; })() }));
    await page.screenshot({ path: resolve(OUT, "a2b-b-handover-working-1366-dark-reduced-motion.png") });
    const pageN = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await pageN.goto(urlFor({ ...V["1366-closed"], theme: "dark" }, cfg));
    await openConversation(pageN, cfg);
    await drive(pageN, cfg);
    const normal = await pageN.evaluate(() => ({ running: document.getAnimations().filter((a) => a.playState === "running").map((a) => `${a.effect?.target?.className ?? "?"}:${a.animationName ?? a.constructor.name}`) }));
    report.interactions.push({ name: "reduced-motion-working-card", reduced: rm, withoutPreference: normal });
    await page.close(); await pageN.close();
  }
  // 200% zoom of 1366x768: a 683x384 CSS-px viewport at device scale 2, the waiting card and the done card.
  for (const [state, file] of [["a-handover-waiting", "a2b-a-handover-waiting-zoom200-dark.png"], ["b-handover-done", "a2b-b-handover-done-zoom200-dark.png"]]) {
    const cfg = STATES[state];
    const page = await browser.newPage({ viewport: { width: 683, height: 384 }, deviceScaleFactor: 2 });
    await page.goto(urlFor({ vw: 683, vh: 384, rail: 60, row: 58, paige: "closed", theme: "dark" }, cfg));
    await openConversation(page, cfg);
    await drive(page, cfg);
    const m = await page.evaluate(measure);
    let presses = 0; let reached = false;
    if (state === "a-handover-waiting") {
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.click(8, 200);
      for (; presses < 200; presses += 1) { await page.keyboard.press("Tab"); reached = await page.evaluate(() => document.activeElement?.getAttribute("data-confirm-part") === "approve"); if (reached) { presses += 1; break; } }
      if (reached) await page.evaluate(() => document.activeElement.scrollIntoView({ block: "nearest" }));
    }
    const approveVisible = await page.evaluate(() => { const b = document.querySelector(".th-ap [data-confirm-part='approve']"); if (!b) return null; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
    await page.screenshot({ path: resolve(OUT, file) });
    report.interactions.push({ name: `zoom200-${state}`, pageOverflowXpx: m.pageOverflowXpx, hubOverflowXpx: m.hubOverflowXpx, cards: m.cards.map((c) => ({ state: c.state, rect: c.rect, overflowX: c.overflowX, clippedText: c.clippedText, buttons: c.buttons })), tabPresses: presses, reachedApprove: reached, approveFullyVisible: approveVisible, rawIds: m.rawIds });
    await page.close();
  }
  // A teammate's hub: the asker's agent DMs are not listed, and their card read is never asked for.
  {
    const cfg = STATES["h-redirect-teammate"];
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(urlFor({ ...V["1366-closed"], theme: "dark" }, cfg));
    await openConversation(page, cfg);
    await drive(page, cfg);
    report.interactions.push({ name: "teammate-cannot-reach-asker-card", ...(await page.evaluate(() => ({ cardReads: window.__thCardReads ?? [], cardActs: window.__thCardActs ?? [],
      openDmButtons: Array.from(document.querySelectorAll(".th-ag-bring-btn")).length }))) });
    await page.close();
  }
}
writeFileSync(REPORT, JSON.stringify(report, null, 1));
await browser.close();
console.log(`shots: ${report.shots.length}, interactions: ${report.interactions.length}`);
