// E09 Slice 2, OWNER side — open the Solo calendar's "New appointment" drawer, open the client combobox (one
// combobox under Title: chip + Remove, a "Not a client (guest only)" row, an in-drawer list), search it, choose a
// client with the KEYBOARD (type "jor", press Enter: the first match, never the guest row), and frame it light + dark
// at 1366x768: the list open and narrowed, the client chosen (Calendar defaulted), the list reopened (current value
// marked apart from the keyboard highlight), and the client chosen with Calendar put back to Unassigned on purpose (the hint). Measures text contrast (AA) inside the drawer, gold spent inside
// the drawer (the act button is the only allowed spend), horizontal overflow, page errors, the HARNESS tag, and
// what the picker actually offers (options before/after search, guest-name prefill, the hint line).
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME: the create_internal_booking write with _contact_id is not exercised here.
//   node scripts/live-drive/harness/portal-sessions-customer-mount/owner-calendar/owner-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-sessions-owner-calendar");
fs.mkdirSync(out, { recursive: true });
const PORT = 5243;
const NOW = new Date("2026-10-16T15:30:00-05:00");

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", process.env.HARNESS_VITE_CONFIG || path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

function measure() {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (transparent(c)) continue; layers.push(c); if (alphaOf(c) >= 1) break; }
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : "rgb(255,255,255)";
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const drawer = document.querySelector('aside.sc-drawer[role="dialog"]');
  if (!drawer) return { drawer: false };
  const vis = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only");
  const inactive = (n) => !!n.closest(":disabled, [aria-disabled='true']");
  const texts = [...drawer.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && vis(n) && n.tagName !== "OPTION")
    .map((n) => { const bg = bgOf(n); const c = getComputedStyle(n).color; return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 50), ratio: ratio(alphaOf(c) < 1 ? blend(c, bg) : c, bg), inactive: inactive(n), size: getComputedStyle(n).fontSize }; });
  // Placeholders are the only label a search box shows while empty.
  for (const i of drawer.querySelectorAll("input[placeholder]")) if (!i.value && vis(i)) {
    const bg = bgOf(i); const ph = getComputedStyle(i, "::placeholder").color;
    texts.push({ text: `(placeholder) ${i.placeholder}`, ratio: ratio(alphaOf(ph) < 1 ? blend(ph, bg) : ph, bg), inactive: i.disabled, size: getComputedStyle(i).fontSize });
  }
  const graded = texts.filter((t) => !t.inactive);
  const probe = document.createElement("i"); document.body.append(probe);
  // [data-pg] * carries a (reduced-motion: .01ms !important) colour transition, so a probe read right after a
  // change returns the OLD colour; with it every gold token read back as ink and the gold check was blind.
  probe.style.setProperty("transition", "none", "important");
  // A token that is not an HSL triple makes hsl(var(--t)) invalid, and the probe then just inherits the body
  // colour (ink); that fallback is excluded so ink is never mistaken for gold.
  const inherited = getComputedStyle(probe).color;
  const golds = ["--accent", "--gold", "--gold-light", "--gold-dark", "--pg-gold", "--pg-gold-ink", "--pg-gold-core"].map((t) => { probe.style.color = `hsl(var(${t}))`; const a = getComputedStyle(probe).color; probe.style.color = `var(${t})`; return [a, getComputedStyle(probe).color]; }).flat().filter((c) => c !== inherited).map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const gold = [...drawer.querySelectorAll("*")].filter(vis).flatMap((n) => {
    const cs = getComputedStyle(n); const h = [];
    if (isGold(cs.backgroundColor)) h.push("background"); if (isGold(cs.color) && n.textContent.trim()) h.push("text");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) h.push("border");
    return h.length ? [{ el: n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(/\s+/).join(".") : ""), text: n.textContent.trim().slice(0, 30), h }] : [];
  });
  const combo = drawer.querySelector('[role="combobox"]');
  const pop = document.querySelector(".sc-combo-pop");
  const body = drawer.querySelector(".sc-drawer-body");
  const r = drawer.getBoundingClientRect();
  const box = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width) }; };
  const describedBy = (n) => (n?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
  const cal = drawer.querySelector("#sc-cal");
  return {
    drawer: true,
    goldTokens: golds,
    contrastMin: graded.length ? Math.min(...graded.map((t) => t.ratio)) : null,
    low: graded.filter((t) => t.ratio < 4.5),
    gold,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5 || drawer.scrollWidth > drawer.clientWidth + 1 || r.right > innerWidth + 1,
    drawerBox: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height), bodyScroll: (() => { const b = drawer.querySelector(".sc-drawer-body"); return b ? [b.scrollHeight, b.clientHeight] : null; })() },
    comboboxes: drawer.querySelectorAll('[role="combobox"]').length,
    comboValueText: combo?.textContent.trim().replace(/\s+/g, " ") ?? null,
    comboExpanded: combo?.getAttribute("aria-expanded") ?? null,
    listOpen: !!pop && vis(pop),
    listInsideDrawer: pop ? drawer.contains(pop) : null,
    listBox: pop && vis(pop) ? box(pop) : null, drawerBodyBox: box(body), viewport: [innerWidth, innerHeight],
    // The open list must be fully on screen and not cut off by the drawer body's own scroll box.
    listClipped: pop && vis(pop) ? (() => { const p = pop.getBoundingClientRect(), b = (body ?? drawer).getBoundingClientRect(); return p.bottom > innerHeight + 1 || p.right > innerWidth + 1 || p.bottom > b.bottom + 1 || p.top < b.top - 1; })() : null,
    listRows: pop && vis(pop) ? [...pop.querySelectorAll("[cmdk-item]")].map((n) => `${n.textContent.trim().replace(/\s+/g, " ")}:${Math.round(n.getBoundingClientRect().height)}px${n.getAttribute("data-selected") === "true" ? " (highlighted)" : ""}`) : null,
    listStatus: pop && vis(pop) ? pop.querySelector(".sc-combo-status")?.textContent ?? null : null,
    nativeSelectsInDrawer: [...drawer.querySelectorAll("select")].map((n) => n.id),
    calendarValue: cal ? cal.options[cal.selectedIndex]?.textContent : null,
    calendarHint: describedBy(cal),
    clientHint: describedBy(combo),
    guest: drawer.querySelector("#sc-guest")?.value ?? null,
    // 44px: the combobox box (trigger + Remove share its 44px height inside a 1px border) and every list row.
    targets: [...drawer.querySelectorAll('.sc-combo, [cmdk-item]')].filter(vis).map((n) => ({ text: (n.getAttribute("aria-label") || n.textContent).trim().replace(/\s+/g, " ").slice(0, 34), h: Math.round(n.getBoundingClientRect().height), w: Math.round(n.getBoundingClientRect().width) })),
    // The buttons inside that box, reported (their own hit area excludes the box's 1px border).
    innerButtons: [...drawer.querySelectorAll('.sc-combo-trigger, .sc-combo-clear')].filter(vis).map((n) => `${(n.getAttribute("aria-label") || "trigger").slice(0, 24)}:${Math.round(n.getBoundingClientRect().height)}x${Math.round(n.getBoundingClientRect().width)}`),
    focusRing: (() => { const a = document.activeElement; if (!a || !drawer.contains(a)) return null; const cs = getComputedStyle(a); return { el: a.getAttribute("role") || a.tagName.toLowerCase(), outline: `${cs.outlineStyle} ${cs.outlineColor}`, offset: cs.outlineOffset, boxShadow: cs.boxShadow, gold: isGold(cs.outlineColor) }; })(),
    // The keyboard highlight (violet row) and the current value (check mark) must look different.
    currentRow: pop && vis(pop) ? (() => {
      const cur = pop.querySelector('[cmdk-item][data-current="true"]'); if (!cur) return null;
      const check = cur.querySelector(".sc-combo-check"), name = cur.querySelector(".sc-combo-opt-name");
      return { text: cur.textContent.trim().replace(/\s+/g, " "), highlighted: cur.getAttribute("data-selected") === "true", checkColor: check ? getComputedStyle(check).color : null, nameColor: name ? getComputedStyle(name).color : null, checkGold: check ? isGold(getComputedStyle(check).color) : null, nameWeight: name ? getComputedStyle(name).fontWeight : null, fill: getComputedStyle(cur).backgroundColor };
    })() : null,
    highlightFill: pop && vis(pop) ? (() => { const h = pop.querySelector('[cmdk-item][data-selected="true"]'); return h ? getComputedStyle(h).backgroundColor : null; })() : null,
    fieldHeights: [...drawer.querySelectorAll("input, select, button")].filter(vis).map((n) => `${n.id || n.textContent.trim().slice(0, 16) || n.tagName}:${Math.round(n.getBoundingClientRect().height)}`),
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const b = t?.getBoundingClientRect(); return !!b && b.width > 40 && b.height >= 10; })(),
  };
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, reducedMotion: "reduce", timezoneId: "America/Chicago", locale: "en-US" });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], notes = {};
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/?theme=${theme}`);
    let driveError = null;
    /** Measure and frame the moment the drive has just reached. */
    const frame = async (step) => {
      const name = `e09-sessions-owner-calendar-${step}-${theme}-1366x768`;
      await page.waitForTimeout(300);
      const m = await page.evaluate(measure);
      // 44px: the client box, every list row, AND the trigger + Remove inside the box (no dead 1px edge).
      const small = [...(m.targets ?? []).filter((t) => t.h < 44), ...(m.innerButtons ?? []).filter((b) => Number(b.split(":")[1].split("x")[0]) < 44).map((b) => ({ text: b }))];
      // What the owner decided each moment must show.
      const expectations = [];
      const want = (cond, what) => { if (!cond) expectations.push(what); };
      if (step === "client-list-open") {
        // Once typed, the matches lead and the guest row follows; the merged duplicate is never offered.
        want(JSON.stringify(notes.optionsAfterSearch) === JSON.stringify(["Jordan Riverajordan.rivera@example.test", "Not a client (guest only) (chosen)"]), `search narrows to ${JSON.stringify(notes.optionsAfterSearch)}`);
        want(/^Jordan Rivera.*\(highlighted\)$/.test(m.listRows?.[0] ?? ""), `first match not highlighted ${JSON.stringify(m.listRows)}`);
        want(!(notes.optionsBeforeSearch ?? []).some((o) => /jordan\.old/.test(o)), `merged duplicate offered ${JSON.stringify(notes.optionsBeforeSearch)}`);
        want(notes.order?.[0] === "Title" && notes.order?.[1] === "Client", `field order ${JSON.stringify(notes.order)}`);
        want(m.nativeSelectsInDrawer.every((id) => id !== "sc-client"), "client picker is a native select");
      }
      if (step === "client-chosen") {
        want(m.comboValueText === "Jordan Riverajordan.rivera@example.test", `chip ${m.comboValueText}`);
        want(m.calendarValue === "Consultations", `calendar default ${m.calendarValue}`);
        want(m.guest === "Jordan Rivera", `guest ${m.guest}`);
        want(m.calendarHint.length === 0, "unassigned hint shown with a calendar chosen");
        want(/solid/.test(m.focusRing?.outline ?? "") && m.focusRing?.gold === false, `keyboard focus ring ${JSON.stringify(m.focusRing)}`);
        // The trigger's own inset ring (-2px) applies, as in the app where solo-calendar.css loads after index.css;
        // 3px means the shell default won, i.e. the harness loaded the CSS in the wrong order.
        want(m.focusRing?.offset === "-2px", `ring offset ${m.focusRing?.offset} (expected the trigger's own -2px)`);
        want(notes.enterChose === "Jordan Riverajordan.rivera@example.test", `Enter after "jor" chose ${notes.enterChose}`);
      }
      if (step === "client-list-current") {
        // Reopened with nothing typed: the guest row leads and is highlighted; Jordan is marked as the current value.
        want(/^Not a client.*\(highlighted\)$/.test(m.listRows?.[0] ?? ""), `reopened highlight ${JSON.stringify(m.listRows)}`);
        want(m.currentRow && !m.currentRow.highlighted && m.currentRow.checkGold === false && m.currentRow.checkColor === m.currentRow.nameColor && Number(m.currentRow.nameWeight) >= 600 && m.currentRow.fill !== m.highlightFill, `current vs highlight ${JSON.stringify({ cur: m.currentRow, hl: m.highlightFill })}`);
      }
      if (step === "client-chosen-unassigned") {
        want(notes.unassignedKept === "Unassigned", "Unassigned chosen on purpose was overwritten");
        want(/Pick a calendar so they can reschedule or cancel/.test(m.calendarHint.join(" ")), `unassigned hint ${JSON.stringify(m.calendarHint)}`);
        // The focused native select's ring is indigo too (the field rings were gold before this slice).
        want(m.focusRing?.el === "select" && /solid/.test(m.focusRing?.outline ?? "") && m.focusRing?.gold === false, `select focus ring ${JSON.stringify(m.focusRing)} (active: ${notes.selectFocused})`);
      }
      const ok = !driveError && expectations.length === 0 && errors.length === 0 && m.drawer && m.low.length === 0 && !m.overflowX && m.tag
        && m.gold.filter((g) => !/sc-btn--gold/.test(g.el)).length === 0 && small.length === 0 && m.listClipped !== true
        && (!/list/.test(step) || (m.listOpen && m.listInsideDrawer));
      if (!ok) failed = true;
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      results[name] = { ok, expectations, driveError, errors: [...errors], notes: { ...notes }, smallTargets: small, ...m };
      console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({ driveError, expectations, errors: errors.slice(0, 3), contrastMin: m.contrastMin, low: m.low.slice(0, 4), gold: m.gold.map((g) => `${g.el.slice(0, 40)}:${g.h}`), overflowX: m.overflowX, small, inner: m.innerButtons, listOpen: m.listOpen, listInsideDrawer: m.listInsideDrawer, listClipped: m.listClipped, listRows: m.listRows, listStatus: m.listStatus, combo: m.comboValueText, calendar: m.calendarValue, calendarHint: m.calendarHint, clientHint: m.clientHint, guest: m.guest, focusRing: m.focusRing, nativeSelects: m.nativeSelectsInDrawer, notes }));
    };
    try {
      await page.getByRole("button", { name: "New appointment" }).click();
      const drawer = page.getByRole("dialog", { name: "New appointment" });
      await drawer.waitFor({ timeout: 15_000 });
      // The client combobox (the two native selects, Length and Calendar, also expose role=combobox).
      const combo = drawer.locator(".sc-combo-trigger");
      await page.waitForFunction(() => !/Loading your clients/.test(document.querySelector('aside.sc-drawer[role="dialog"] .sc-field-hint')?.textContent ?? ""), null, { timeout: 15_000 });
      // The untouched drawer: its placeholders are the only labels its empty fields show, so grade them here too.
      const empty = await page.evaluate(measure);
      notes.emptyDrawerLow = empty.low;
      notes.emptyDrawerMin = empty.contrastMin;
      notes.order = await drawer.locator(".sc-field").evaluateAll((fs) => fs.map((f) => (f.querySelector("label, .sc-field-label")?.textContent ?? "?").trim()));
      if (notes.emptyDrawerLow.length) failed = true;
      await drawer.getByLabel("Title").fill("Kickoff call");
      await combo.click();
      await page.locator(".sc-combo-pop [cmdk-input]").waitFor({ timeout: 10_000 });
      notes.optionsBeforeSearch = await page.locator(".sc-combo-pop [cmdk-item]").allTextContents();
      notes.searchFocused = await page.evaluate(() => document.activeElement?.hasAttribute("cmdk-input") ?? false);
      await page.keyboard.type("jor");
      notes.optionsAfterSearch = await page.locator(".sc-combo-pop [cmdk-item]").allTextContents();
      await frame("client-list-open");
      // Search, then Enter: the keyboard path must choose the first MATCH, never quietly book a guest.
      await page.keyboard.press("Enter");
      await page.locator(".sc-combo-pop").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => { notes.listStayedOpen = true; });
      notes.enterChose = (await combo.textContent())?.trim().replace(/\s+/g, " ") ?? null;
      // Reach the combobox from the keyboard, as an owner tabbing through the form would, so :focus-visible applies.
      await drawer.getByLabel("Title").click();
      await page.keyboard.press("Tab");
      notes.tabLandsOn = await page.evaluate(() => document.activeElement?.className ?? null);
      await frame("client-chosen");
      // Reopen with nothing typed: the current value is marked (check + weight), distinct from the keyboard highlight.
      await combo.click();
      await page.locator(".sc-combo-pop [cmdk-input]").waitFor({ timeout: 10_000 });
      await frame("client-list-current");
      await page.keyboard.press("Escape");
      await page.locator(".sc-combo-pop").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => { notes.listStayedOpenAfterEscape = true; });
      // Closing returns focus to the trigger; let that land before focusing anything else, or it lands late and steals it.
      await page.waitForFunction(() => document.activeElement?.classList.contains("sc-combo-trigger"), null, { timeout: 3_000 }).catch(() => { notes.escapeFocus = "not returned to the trigger"; });
      // The owner puts Calendar back to Unassigned on purpose: the default must not return, and the hint explains.
      await drawer.locator("#sc-cal").selectOption({ label: "Unassigned" });
      await drawer.locator("#sc-cal").focus();
      await page.waitForTimeout(300);
      notes.selectFocused = await page.evaluate(() => document.activeElement?.id ?? null);
      await page.mouse.move(0, 0);
      notes.unassignedKept = await drawer.locator("#sc-cal").evaluate((n) => n.options[n.selectedIndex].textContent);
      await frame("client-chosen-unassigned");
    } catch (e) { driveError = String(e).slice(0, 400); failed = true; console.log(`owner ${theme} drive error`, driveError); }
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
fs.writeFileSync(path.join(out, "e09-sessions-owner-calendar-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
