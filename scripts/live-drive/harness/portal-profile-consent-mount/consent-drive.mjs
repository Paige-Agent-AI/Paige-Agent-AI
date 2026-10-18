// E09 Slice 6 — render the CUSTOMER's Your account page (/app/settings?view=client-account) and the Data &
// Privacy panel (/app/privacy) inside the real customer chrome, in every preference state, both themes, desktop
// (1440x900) and phone (390x844), and MEASURE it: text contrast (AA 4.5:1 against the real composited
// background), horizontal overflow, gold spent on the page (none: a preference is not an act of approval), touch
// targets >= 44px on the phone (the switches reach 44px through a hit-tested ::after), the 3:1 non-text contrast of
// every enabled switch's edge and thumb (WCAG 1.4.11, round 2), clipped text, page errors /
// failed responses / any request that tried to leave the machine (the network is blocked), and that the HARNESS
// RENDER tag is on screen. It also reads what each state must SAY off the rendered page (the owner decisions D1,
// D2, D4, D5, D6 and the reviewer's B2/M3/M9 copy) and drives the write states through the REAL switches.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in
// customer portal against the real RPCs on a seeded test tenant is owed to a capable session.
//
//   node scripts/live-drive/harness/portal-profile-consent-mount/consent-drive.mjs [--out dir] [--only substr]
//   node .../consent-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-profile-consent");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5361;
const NOW = new Date("2026-10-18T10:30:00-05:00");
const TZ = "America/Chicago";
const B = "Northwind Studio";
// Nothing in the preferences sections may name an address, a number, an id or internal vocabulary.
const NEVER = ["jordan.rivera@example.test", "+15035550142", "503", "e0960000", "customer_request", "customer_portal", "suppression", "consent_events", "evidence", "coach", "credit", "funding", "fundab"];

const STATES = ["default", "email-off", "email-paused", "email-paused-held", "email-reported", "reported-lift", "texts-on", "texts-on-no-tz", "texts-on-business-tz", "texts-off",
  "updates-subscribed", "business-recorded", "sharing-on", "no-address", "no-number", "multiple", "unavailable", "loading", "error", "pending", "refusal", "saved"];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const state of STATES) for (const kind of ["desktop", "phone"]) shots.push({ state, theme, kind });
    for (const kind of ["desktop", "phone"]) shots.push({ state: "default", theme, kind, privacy: true });
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_CONSENT_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");
const PREFS = "section#preferences";

/** Bring each state to the moment worth framing, through the REAL UI, and read what it says. */
async function drive(page, s, notes) {
  if (s.privacy) {
    await page.getByText("Data & Privacy").first().waitFor({ timeout: 30_000 });
    // The brand resolves before the panel decides who is looking.
    await page.waitForTimeout(500);
    notes.pageText = clean(await page.locator("[data-harness-privacy]").innerText());
    notes.manage = await page.locator('[data-harness-privacy] a[href*="client-account"]').getAttribute("href").catch(() => null);
    notes.deadManage = await page.locator('[data-harness-privacy] a[href*="tab=notifications"]').count();
    // Text that a control is drawn over (a row whose button sits on its own heading) is unreadable.
    notes.overlaps = await page.locator("[data-harness-privacy]").evaluate((root) => {
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const controls = [...root.querySelectorAll("a, button")].map((c) => [c, c.getBoundingClientRect()]);
      return [...root.querySelectorAll("p, h3")].flatMap((t) => {
        const r = t.getBoundingClientRect();
        return controls.filter(([c, cr]) => !c.contains(t) && !t.contains(c) && hit(r, cr)).map(([c]) => `${t.textContent.trim().slice(0, 24)} under ${c.textContent.trim().slice(0, 24)}`);
      });
    });
    return;
  }
  await page.getByRole("heading", { name: "Your account", level: 1 }).waitFor({ timeout: 30_000 });
  if (["multiple", "unavailable"].includes(s.state)) {
    await page.getByText(s.state === "multiple" ? "You're a client of more than one business" : "Your information is unavailable for this business").waitFor({ timeout: 30_000 });
    notes.retry = await page.getByRole("button", { name: "Try again" }).count();
    notes.pageText = clean(await page.locator('[data-harness-region="page"]').innerText());
    notes.switches = await page.locator('[role="switch"]').count();
    return;
  }
  await page.locator("#client-street").waitFor({ timeout: 30_000 });
  notes.street = await page.locator("#client-street").inputValue();
  notes.fields = await page.locator("form label").allInnerTexts();
  if (s.state === "loading") {
    await page.locator('[data-testid="preferences-loading"]').waitFor({ timeout: 30_000 });
    notes.busy = await page.locator(PREFS).getAttribute("aria-busy");
  } else {
    await page.locator('[data-testid="pref-email"]').waitFor({ timeout: 30_000 });
  }
  const row = (k) => page.locator(`[data-testid="pref-${k}"]`);
  const sw = (k) => row(k).locator('[role="switch"]');
  if (s.state === "error") {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("We couldn't refresh your preferences").waitFor({ timeout: 10_000 });
  }
  if (s.state === "pending" || s.state === "saved") {
    await sw("email").click();
    if (s.state === "pending") await row("email").getByText("Saving…").waitFor({ timeout: 10_000 });
    else await row("email").locator('[data-testid="pref-notice"]').waitFor({ timeout: 10_000 });
  }
  if (s.state === "refusal" || s.state === "reported-lift") {
    await sw("email").click();
    await row("email").locator('[data-testid="pref-notice"]').waitFor({ timeout: 10_000 });
  }
  if (s.state !== "loading") {
    for (const k of ["email", "sms", "updates", "sharing"]) {
      notes[k] = {
        state: await textOf(row(k).locator('[data-testid="pref-state"]')),
        reason: await textOf(row(k).locator('[data-testid="pref-reason"]')),
        detail: await textOf(row(k).locator('[data-testid="pref-detail"]')),
        notice: await textOf(row(k).locator('[data-testid="pref-notice"]')),
        switch: (await sw(k).count()) ? { checked: await sw(k).getAttribute("data-state"), disabled: await sw(k).isDisabled() } : null,
        buttons: (await row(k).getByRole("button").allInnerTexts()).map(clean),
        text: await textOf(row(k)),
        links: await row(k).getByRole("link").evaluateAll((as) => as.map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`)),
      };
    }
    notes.prefsText = clean(await page.locator(PREFS).innerText()) + " " + clean(await page.locator("section[aria-labelledby='client-sharing-title']").innerText().catch(() => ""));
    notes.leaks = NEVER.filter((t) => notes.prefsText.toLowerCase().includes(t.toLowerCase()));
    // Every disabled switch is described by a visible reason.
    notes.unexplained = await page.locator('[role="switch"][disabled]').evaluateAll((els) => els.filter((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(" ");
      return !ids.some((id) => { const r = document.getElementById(id); return ["pref-reason", "pref-saving"].includes(r?.dataset.testid) && r.textContent.trim() && r.getClientRects().length; });
    }).map((el) => el.getAttribute("aria-label")));
  }
  if (!s.phone) notes.nav = await page.locator('[data-harness-region="nav"]').innerText().then(clean).catch(() => "");
  // Frame the preferences: scroll the page's own scroller (never scrollIntoView: it also scrolls the shell).
  await page.locator(PREFS).evaluate((sec) => {
    const scroller = document.querySelector('[data-harness-region="page"]');
    scroller.scrollTop += sec.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  });
  await page.waitForTimeout(300);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  if (s.privacy) {
    want(!/credit|fundab|financial|funding/i.test(n.pageText ?? ""), `finance wording on a customer's Data & Privacy: ${n.pageText}`);
    want(n.manage === "/app/settings?view=client-account#preferences", `Manage -> ${n.manage}`);
    want(n.deadManage === 0, "the dead ?tab=notifications link is still there");
    want(!/Bank-Grade|PaigeAgent/.test(n.pageText ?? ""), `a customer sees the security pill or "PaigeAgent": ${n.pageText}`);
    want(!/email or text you/i.test(n.pageText ?? ""), "Data & Privacy offers texts on");
    want((n.overlaps ?? []).length === 0, `a control is drawn over text: ${JSON.stringify(n.overlaps)}`);
    want(!/30 days|Processed within/.test(n.pageText ?? ""), "deletion promises a timeframe nothing keeps (D6)");
    want((n.pageText ?? "").includes(`To delete what ${B} holds about you, message ${B}.`), "deletion does not route the business's records to the business");
    return miss;
  }
  if (["multiple", "unavailable"].includes(s.state)) {
    want(n.switches === 0, "preference switches shown without a resolved relationship");
    // Round 3 (verifier minor 7): more than one business is explained, with no retry that can't change it.
    if (s.state === "multiple") want(n.retry === 0 && (n.pageText ?? "").includes("You're a client of more than one business, so your account settings can't be shown here yet."), `multiple: retry=${n.retry} "${n.pageText}"`);
    return miss;
  }
  want(n.street === "12 Harbour Lane" || s.state === "no-address", `street "${n.street}"`);
  want(["Street address", "City", "State", "ZIP code"].every((l) => (n.fields ?? []).includes(l)), `address fields ${JSON.stringify(n.fields)}`);
  if (s.state === "loading") { want(n.busy === "true", "loading preferences not aria-busy"); return miss; }
  want((n.leaks ?? []).length === 0, `private or internal text in the preferences: ${JSON.stringify(n.leaks)}`);
  want((n.unexplained ?? []).length === 0, `disabled switch without a visible reason: ${JSON.stringify(n.unexplained)}`);
  const st = (k) => n[k]?.state ?? "";
  // D1: texts are never turned ON from the portal.
  want(!n.sms?.switch || n.sms.switch.checked === "checked" || n.sms.switch.disabled, "a texts-on switch is offered (D1)");
  switch (s.state) {
    case "default":
      want(st("email") === "On" && st("sms") === "Not set up" && st("updates") === "Not subscribed" && st("sharing") === "Not allowed", `states ${JSON.stringify([st("email"), st("sms"), st("updates"), st("sharing")])}`);
      want(n.sms.reason === "Texts can't be turned on from your account.", `texts reason "${n.sms.reason}"`);
      want((n.sms.text.match(/START/g) ?? []).length === 1, `START named ${(n.sms.text.match(/START/g) ?? []).length} times in the texts row`);
      // Round 3 (verifier minor 6): never "again", and the route is conditional on having a text to reply to.
      want(!/\bagain\b/.test(n.sms.text) && n.sms.text.includes(`reply START to a text from ${B} if you have one, or ask them.`), `texts not set up "${n.sms.text}"`);
      want(n.sms.buttons.includes("Don't text me"), `texts buttons ${JSON.stringify(n.sms.buttons)}`);
      want(/It has no effect yet/.test(n.prefsText ?? ""), "data sharing does not say it has no effect yet (D2/M3)");
      break;
    case "email-off":
      want(/^Off · you turned email off on Oct 12, 2026$/.test(st("email")), `email "${st("email")}"`);
      want(n.email.switch?.disabled === false, "the customer can't turn their own email back on");
      want(n.updates.reason === "Turn on email first.", `updates reason "${n.updates.reason}"`);
      break;
    case "email-paused":
      want(st("email") === `Paused by ${B}`, `email "${st("email")}"`);
      want(n.email.buttons.includes("Keep email off"), "no Keep email off under a business pause (B2)");
      want(n.email.links.includes(`Message ${B} -> /app/messages`), `email links ${JSON.stringify(n.email.links)}`);
      want(n.email.reason === `Only ${B} can resume email they paused.`, `email reason "${n.email.reason}"`);
      break;
    case "email-paused-held":
      want(n.email.reason === `Email comes back only when you and ${B} both turn it back on.` && !/Only Northwind/.test(n.email.text), `held reason "${n.email.reason}"`);
      want(!n.email.buttons.includes("Keep email off"), "Keep email off offered again after the customer recorded it");
      break;
    case "texts-on":
      want(/^On · you replied START on Oct 9, 2026$/.test(st("sms")) && n.sms.detail === "Texts through Paige only arrive between 8am and 8pm your time.", `texts "${st("sms")}" / "${n.sms.detail}"`);
      want(n.sms.switch?.checked === "checked" && n.sms.switch.disabled === false, "texts can't be turned off");
      break;
    case "texts-on-no-tz":
      want(n.sms.detail === `${B} doesn't have your time zone, so texts through Paige are held from 8pm to 8am Eastern Time.`, `no-tz "${n.sms.detail}"`);
      break;
    case "texts-on-business-tz":
      want(n.sms.detail === `${B} doesn't have your time zone, so texts through Paige are held from 8pm to 8am Central Time.`, `business-tz "${n.sms.detail}"`);
      break;
    case "email-reported":
      want(st("email") === `Off · you reported an email from ${B} as spam on Oct 3, 2026` && n.email.switch?.disabled === false, `reported "${st("email")}" switch=${JSON.stringify(n.email.switch)}`);
      want(n.email.detail === "Turn email back on here if you want it again." && !/delivery|provider/i.test(n.email.text), `reported detail "${n.email.detail}"`);
      break;
    case "reported-lift":
      want(n.email.notice === "Email is on." && st("email") === "On", `reported-lift "${n.email.notice}" / "${st("email")}"`);
      break;
    case "business-recorded":
      want(st("sms") === `On · set by ${B} on Sep 28, 2026` && st("updates") === `Subscribed · set by ${B} on Sep 28, 2026`, `D7 "${st("sms")}" / "${st("updates")}"`);
      break;
    case "texts-off":
      want(/^Off · you replied STOP on Oct 16, 2026$/.test(st("sms")), `texts "${st("sms")}"`);
      break;
    case "updates-subscribed":
      want(/^Subscribed on Oct 6, 2026$/.test(st("updates")) && n.updates.switch?.disabled === false, `updates "${st("updates")}"`);
      break;
    case "sharing-on":
      want(/^Allowed on Oct 14, 2026$/.test(st("sharing")), `sharing "${st("sharing")}"`);
      break;
    case "no-address":
      want(st("email") === "No email address on file" && st("updates") === "No email address on file" && !n.email.switch, `no-address "${st("email")}" / "${st("updates")}"`);
      break;
    case "no-number":
      want(st("sms") === "No phone number on file" && !n.sms.switch, `no-number "${st("sms")}"`);
      break;
    case "error":
      want(/may be out of date/.test(n.prefsText ?? "") && st("email") === "On", "a failed refresh dropped the cards or didn't say so");
      break;
    case "pending":
      want(st("email") === "Saving…" && n.updates.switch?.disabled === true, `pending "${st("email")}" others locked=${n.updates.switch?.disabled}`);
      break;
    case "refusal":
      want(n.email.notice === `${B} paused email to you, so it stays off. Ask them to resume it.` && st("email") === `Paused by ${B}`, `refusal "${n.email.notice}" / "${st("email")}"`);
      break;
    case "saved":
      want(n.email.notice === "Email is off." && /^Off · you turned email off on Oct 18, 2026$/.test(st("email")), `saved "${n.email.notice}" / "${st("email")}"`);
      break;
  }
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
  // Effective opacity of the element and its ancestors: an opacity-faded parent fades the text it holds.
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg()) ? "rgb(255,255,255)" : pageBg());
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => {
    const c = getComputedStyle(el).color, p = parse(c), o = opacityOf(el);
    const a = (p.length > 3 ? p[3] : 1) * o;
    return a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : c;
  };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden]");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled");

  // On the home frames only the Progress and Next steps tiles are this slice's; they are graded, the rest reported.
  const homeTiles = opts.home ? [...document.querySelectorAll("[data-harness-home] .bg-card")].filter((c) => /Your progress|Your next steps/.test(c.textContent)) : [];
  const pageRoots = opts.home ? homeTiles : [document.querySelector('[data-harness-region="page"]')].filter(Boolean);
  const wholePage = document.querySelector('[data-harness-region="page"]');
  const nav = document.querySelector('[data-harness-region="nav"] > div');
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    // AA: 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  });
  const pageContrast = pageRoots.flatMap(contrastFor);
  const navContrast = nav ? contrastFor(nav) : [];
  const wholeContrast = opts.home && wholePage ? contrastFor(wholePage) : [];
  const graded = (list) => list.filter((c) => !c.inactive);
  const low = (list) => graded(list).filter((c) => c.ratio < c.need);
  const min = (list) => (graded(list).length ? Math.min(...graded(list).map((c) => c.ratio)) : null);

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const goldTokens = ["--accent", "--gold", "--gold-light", "--gold-dark", "--accent-glow"];
  const golds = goldTokens.map((t) => { probe.style.color = `hsl(var(${t}))`; return parse(getComputedStyle(probe).color).slice(0, 3).join(","); });
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const goldIn = (root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag]")).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    if (n.nodeName === "svg" || n.closest("svg")) { if (isGold(cs.stroke) || isGold(cs.fill)) hits.push("icon"); }
    return hits.length ? [{ el: n.tagName.toLowerCase(), text: n.textContent.trim().slice(0, 30), hits }] : [];
  });

  const targetSel = 'a, button, input, [role="button"], [role="switch"]';
  // A control's hit area: its own box, plus an absolutely positioned ::before/::after it contains (EmptyTile
  // reaches 44px this way). The extension only counts when a real hit test at its outer edges lands on the
  // control. A control below the fold is brought into view by the page's own scroller for the test (never
  // scrollIntoView, which also scrolls the shell), and the scroller is put back before anything is framed.
  const hitOf = (n) => {
    const scroller = n.closest('[data-harness-region="page"]');
    const r0 = n.getBoundingClientRect();
    // 16px, not 8: a 24px switch's ::after reaches 10px past its box, so a switch whose box ends within 10px of
    // the fold has its extension clipped by the viewport edge and can't be hit-tested there (round 3: the
    // longer texts sentence put Updates' switch 10px above the fold on a phone).
    if (scroller && (r0.top < 16 || r0.bottom > innerHeight - 16)) {
      const saved = scroller.scrollTop;
      scroller.scrollTop += (r0.top + r0.bottom) / 2 - innerHeight / 2;
      try { return hitIn(n); } finally { scroller.scrollTop = saved; }
    }
    return hitIn(n);
  };
  const hitIn = (n) => {
    const r = n.getBoundingClientRect();
    const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    if (getComputedStyle(n).position === "static") return { ...box, extended: false };
    const ext = { ...box };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      // An absolute box's offsets are measured from the control's PADDING edge, inside its border.
      const cs = getComputedStyle(n), bw = (side) => parseFloat(cs[`border${side}Width`]) || 0;
      const pad = { top: r.top + bw("Top"), bottom: r.bottom - bw("Bottom"), left: r.left + bw("Left"), right: r.right - bw("Right") };
      ext.top = Math.min(ext.top, pad.top + t); ext.bottom = Math.max(ext.bottom, pad.bottom - b);
      ext.left = Math.min(ext.left, pad.left + l); ext.right = Math.max(ext.right, pad.right - rt);
    }
    if (ext.top === box.top && ext.bottom === box.bottom && ext.left === box.left && ext.right === box.right) return { ...box, extended: false };
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const lands = (x, y) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === n || n.contains(hit)); };
    const inView = ext.top >= 0 && ext.bottom <= innerHeight && ext.left >= 0 && ext.right <= innerWidth;
    const verified = inView && lands(cx, ext.top + 0.5) && lands(cx, ext.bottom - 0.5) && lands(ext.left + 0.5, cy) && lands(ext.right - 0.5, cy);
    const probe = (x, y) => { const h = document.elementFromPoint(x, y); return h ? `${h.tagName.toLowerCase()}.${String(h.className).slice(0, 24)}` : null; };
    return verified ? { ...ext, extended: true } : { ...box, extended: false, unverifiedExtension: { inView, ext: [ext.top, ext.bottom, ext.left, ext.right].map(Math.round), vh: innerHeight, top: probe(cx, ext.top + 0.5), bottom: probe(cx, ext.bottom - 0.5) } };
  };
  const targetsIn = (root, region) => [...root.querySelectorAll(targetSel)]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      const drawn = n.getBoundingClientRect();
      const hit = hitOf(n);
      const r = { height: hit.bottom - hit.top, width: hit.right - hit.left };
      // WCAG 2.5.8's inline exception: a link that sits inside a sentence. Reported, never silently passed.
      const inline = n.tagName === "A" && getComputedStyle(n).display === "inline" && /\S/.test((n.parentElement?.textContent ?? "").replace(n.textContent, ""));
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width), drawn: `${Math.round(drawn.width)}x${Math.round(drawn.height)}`, extended: hit.extended, unverifiedExtension: hit.unverifiedExtension ?? false, region, inline };
    });
  const targets = [...pageRoots.flatMap((r) => targetsIn(r, "page")), ...(nav ? targetsIn(nav, "nav") : [])];

  const sectionEl = opts.home ? null : document.querySelector(opts.section);
  const clipRoots = opts.home ? homeTiles : [sectionEl, ...document.querySelectorAll(opts.extraClip ?? "#__none__")].filter(Boolean);
  const clipped = clipRoots.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  // Text that spills past its card's right edge (a row that will not wrap).
  const spill = clipRoots.flatMap((root) => [...root.querySelectorAll("li, form > div, fieldset > div")]).filter((card) => {
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > cr.right + 1);
  }).map((c) => c.textContent.trim().slice(0, 40));

  // WCAG 1.4.11 (round 2): an ENABLED switch must be identifiable at 3:1 — its edge (or its fill) against what it
  // sits on, and its thumb against its track — in both states. Disabled switches are exempt and carry a reason.
  const switches = pageRoots.flatMap((root) => [...root.querySelectorAll('[role="switch"]')])
    .filter((n) => n.getClientRects().length && !n.disabled).map((n) => {
      const cs = getComputedStyle(n), outer = bgOf(n.parentElement);
      const fill = transparent(cs.backgroundColor) ? outer : blend(cs.backgroundColor, outer);
      const edge = (parseFloat(cs.borderTopWidth) || 0) > 0 && !transparent(cs.borderTopColor) ? blend(cs.borderTopColor, fill) : fill;
      const thumbEl = n.querySelector("span"), tc = thumbEl ? getComputedStyle(thumbEl).backgroundColor : fill;
      const thumb = transparent(tc) ? fill : blend(tc, fill);
      return { label: n.getAttribute("aria-label"), state: n.getAttribute("data-state"), boundary: Math.max(ratio(edge, outer), ratio(fill, outer)), thumb: ratio(thumb, fill) };
    });
  const h1 = sectionEl?.querySelector("h1");
  return {
    heading: h1?.textContent ?? null,
    font: h1 ? getComputedStyle(h1).fontFamily : getComputedStyle(document.body).fontFamily,
    contrastMin: min(pageContrast), lowPage: low(pageContrast),
    navContrastMin: min(navContrast), lowNav: low(navContrast),
    wholePageContrastMin: opts.home ? min(wholeContrast) : undefined, lowWholePage: opts.home ? low(wholeContrast) : undefined,
    goldPage: pageRoots.flatMap(goldIn), goldNav: nav ? goldIn(nav) : [], goldWholePage: opts.home && wholePage ? goldIn(wholePage) : undefined,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (wholePage ? wholePage.scrollWidth > wholePage.clientWidth + 1 : false),
    widths: { doc: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, scroller: wholePage ? [wholePage.scrollWidth, wholePage.clientWidth] : null },
    clipped, spill, targets, switches, lowSwitch: switches.filter((sw) => sw.boundary < 3 || sw.thumb < 3),
    homeTiles: opts.home ? homeTiles.length : undefined,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0 && getComputedStyle(t).visibility !== "hidden"; })(),
  };
}


async function warm(browser) {
  // The first request makes Vite optimise every dependency of the real page; wait it out once, unmeasured.
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { timeout: 240_000, waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(1000); await ctx.close();
}

async function runShots(browser, shots, label = "") {
  await warm(browser);
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-consent-${s.privacy ? "privacy" : s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    const url = s.privacy ? `/app/privacy?${new URLSearchParams({ state: s.state, theme: s.theme })}`
      : `/app/settings?${new URLSearchParams({ view: "client-account", state: s.state, theme: s.theme })}`;
    await page.goto(`http://127.0.0.1:${PORT}${url}`, { timeout: 240_000, waitUntil: "domcontentloaded" });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, home: false, section: s.privacy ? "[data-harness-privacy]" : "section[aria-labelledby='client-account-title']" });
    const small = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const smallTargets = small.filter((t) => !t.inline);
    const inlineTargets = small.filter((t) => t.inline);
    const expectations = driveError ? [] : unmet(s, notes);
    const surfaceOk = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.lowPage.length === 0 && !m.overflowX
      && m.goldPage.length === 0 && m.clipped.length === 0 && m.spill.length === 0 && m.lowSwitch.length === 0
      && smallTargets.filter((t) => t.region !== "nav").length === 0 && m.tag;
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav").length === 0;
    if (!surfaceOk) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok: surfaceOk, chromeOk, expectations, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, inlineTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${surfaceOk ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), switchMin: m.switches.length ? Math.min(...m.switches.flatMap((x) => [x.boundary, x.thumb])) : null, lowSwitch: m.lowSwitch, navMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 2),
      goldPage: m.goldPage.slice(0, 3), goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`).slice(0, 2), overflowX: m.overflowX, clipped: m.clipped, spill: m.spill.slice(0, 2),
      smallTargets, inlineTargets, errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
    }));
  }
  return { results, failed };
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
let exitCode = 0;
try {
  if (!selftest) {
    const vite = await startVite(null);
    try {
      const { results, failed } = await runShots(browser, allShots());
      fs.writeFileSync(path.join(out, "e09-consent-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("texts-on", "desktop"), caught: (r) => r.goldPage.length > 0 },
      { mutant: "contrast", shot: base("default", "desktop", "dark"), caught: (r) => r.lowPage.length > 0 },
      { mutant: "target", shot: base("default", "phone"), caught: (r) => r.smallTargets.some((t) => t.region === "page") },
      { mutant: "overflow", shot: base("default", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "reason", shot: base("default", "desktop"), caught: (r) => r.expectations.some((e) => /visible reason|texts reason/.test(e)) },
      { mutant: "switch-contrast", shot: base("default", "desktop", "light"), caught: (r) => r.lowSwitch.length > 0 },
      { mutant: "switch-contrast", shot: base("default", "desktop", "dark"), caught: (r) => r.lowSwitch.length > 0 },
    ];
    const verdicts = [];
    for (const c of controls) {
      const vite = await startVite(c.mutant);
      try {
        const { results } = await runShots(browser, [c.shot], `-MUTANT-${c.mutant}`);
        const r = Object.values(results)[0];
        const caught = !!r && !r.ok && c.caught(r);
        verdicts.push({ mutant: c.mutant, caught, ok: r?.ok, driveError: r?.driveError ?? null });
        if (!caught) exitCode = 1;
      } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } await new Promise((res) => setTimeout(res, 800)); }
    }
    fs.writeFileSync(path.join(out, "e09-consent-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
