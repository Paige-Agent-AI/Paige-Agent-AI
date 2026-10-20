// E09 Slice 2 — render the CUSTOMER portal Sessions page (/app/sessions) inside the real customer chrome in
// every state, both themes, desktop and phone, and MEASURE it: text contrast (AA 4.5:1 against the real
// composited background) on the page AND on any open sheet/dialog, horizontal overflow, gold spent (none on the
// page or its overlays; the chrome is measured and reported separately), touch targets >= 44px on the phone,
// page errors / failed responses, and that the HARNESS RENDER tag is on screen. Each state is reached through
// the REAL UI (clicking Reschedule, a day, a time; Cancel; Cancel session), never by injecting state.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in
// customer portal on the deployed app, against a seeded test-tenant booking, is owed to a capable session.
//
//   node scripts/live-drive/harness/portal-sessions-customer-mount/sessions-drive.mjs [--out dir] [--only name-substring]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-sessions-customer");
const only = arg("--only");
fs.mkdirSync(out, { recursive: true });
const PORT = 5242;
// A fixed clock and zone so every date, deadline and "in New York time" label is reproducible frame to frame.
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";

const DESKTOP_STATES = ["upcoming", "empty", "reschedule", "cancel", "failed", "unavailable", "multiple", "loading"];
const shots = [];
for (const state of DESKTOP_STATES) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 1440, h: 900, kind: "desktop" });
// The past list sits below the fold on a desktop frame: frame it on its own so the four past rows are seen.
for (const theme of ["light", "dark"]) shots.push({ state: "upcoming", theme, w: 1440, h: 900, kind: "desktop-past", scrollPast: true });
for (const state of ["upcoming", "reschedule", "cancel", "failed"]) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 390, h: 844, kind: "phone", phone: true });
// A pointer resting on a session's own actions (desktop): the house ghost/outline hover is graded like any other state.
for (const theme of ["light", "dark"]) shots.push({ state: "hover", theme, w: 1440, h: 900, kind: "desktop" });
// The customer home's Sessions tile (/app): the soonest upcoming session, and the nothing-booked tile.
for (const theme of ["light", "dark"]) {
  shots.push({ state: "home", theme, w: 1440, h: 900, kind: "desktop", home: true });
  // A pointer resting on the tile's Book a session: the shared ghost hover is overridden locally (QUIET hover).
  shots.push({ state: "home-hover", theme, w: 1440, h: 900, kind: "desktop", home: true });
  shots.push({ state: "home-empty", theme, w: 1440, h: 900, kind: "desktop", home: true });
  shots.push({ state: "home", theme, w: 390, h: 844, kind: "phone", phone: true, home: true });
}

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

const row = (page, title) => page.locator("section[aria-labelledby='sessions-upcoming'] li").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** Bring each state to the moment worth framing, through the REAL UI. */
async function drive(page, s, notes) {
  const list = async () => { await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor({ timeout: 30_000 }); await row(page, "Kickoff call").waitFor({ timeout: 30_000 }); };
  switch (s.state) {
    case "upcoming": {
      await list();
      await page.getByRole("button", { name: "Past sessions" }).click();
      await page.locator("section ol li").filter({ hasText: "Intro consultation" }).waitFor({ timeout: 10_000 });
      if (s.scrollPast) await page.getByRole("button", { name: "Past sessions" }).evaluate((b) => b.scrollIntoView({ block: "start" }));
      else await page.evaluate(() => { document.querySelector('[data-harness-region="page"]').scrollTop = 0; });
      // Behaviour the owner decided, read off the rendered page (not the stub):
      const closed = row(page, "Brand strategy session");
      notes.closedRow = {
        hasReschedule: await closed.getByRole("button", { name: "Reschedule" }).count(),
        hasCancel: await closed.getByRole("button", { name: "Cancel" }).count(),
        messageLink: await closed.getByRole("link", { name: "Message Northwind Studio" }).count(),
        text: (await closed.innerText()).replace(/\s+/g, " ").slice(0, 220),
      };
      const kick = row(page, "Kickoff call");
      notes.onlineRow = {
        join: await kick.getByRole("link", { name: /Join/ }).getAttribute("href").catch(() => null),
        joinTarget: await kick.getByRole("link", { name: /Join/ }).getAttribute("target").catch(() => null),
        otherZone: (await kick.innerText()).match(/[^\n]*in New York time/)?.[0] ?? null,
        reschedule: await kick.getByRole("button", { name: "Reschedule" }).count(),
        cancel: await kick.getByRole("button", { name: "Cancel" }).count(),
      };
      // A past row is one compact line: its title is the span the <li> is labelled by, its outcome the pill.
      notes.pastPills = await page.locator(`[id$="-heading"] ~ div li`).evaluateAll((lis) => lis.map((li) => {
        const title = document.getElementById(li.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() ?? "(no title)";
        return `${title} · ${[...li.querySelectorAll("span.rounded-full")].map((x) => x.textContent.trim()).join("")}`;
      }));
      // Location wording and icon, by row: the icon is decided by location_kind, the words by the settled rule.
      notes.locations = await page.locator("section[aria-labelledby='sessions-upcoming'] li").evaluateAll((lis) => lis.map((li) => {
        const p = [...li.querySelectorAll("p")].find((x) => x.querySelector("svg") && !x.closest("[role='alert']") && !x.querySelector("time"));
        const icon = p?.querySelector("svg")?.getAttribute("class")?.match(/lucide-([a-z0-9-]+)/g)?.filter((c) => c !== "lucide-icon").join(" ") ?? null;
        return `${li.querySelector("h3")?.textContent} · ${p?.textContent?.trim()} · ${icon}`;
      }));
      // A past row names where it was, in the server's SETTLED wording (place only, never "to follow").
      notes.pastLocations = await page.locator('[data-testid="past-location"]').evaluateAll((els) => els.map((el) => {
        const icon = el.querySelector("svg")?.getAttribute("class")?.match(/lucide-([a-z0-9-]+)/g)?.filter((c) => c !== "lucide-icon").join(" ") ?? null;
        return `${el.textContent.trim()} · ${icon}`;
      }));
      // Every past pill ends on the same edge: the fixed column, so the time column is not ragged.
      notes.pastPillRights = await page.locator('[data-testid="past-pill"]').evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().right)))]);
      notes.pastTimeRights = await page.locator(`[id$="-heading"] ~ div li > div > span.tabular-nums`).evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().right)))]);
      notes.deadlines = await page.locator("section[aria-labelledby='sessions-upcoming'] li time[title], section[aria-labelledby='sessions-upcoming'] li p:has(> svg.lucide-lock)").allInnerTexts();
      notes.pills = await page.locator("section[aria-labelledby='sessions-upcoming'] li span.rounded-full").allInnerTexts();
      notes.hostLeak = await page.evaluate(() => /host|staff|owner/i.test(document.querySelector("section[aria-labelledby='sessions-title']").innerText));
      break;
    }
    case "empty": await page.getByText("No upcoming sessions").waitFor({ timeout: 30_000 }); break;
    case "reschedule": {
      await list();
      await row(page, "Kickoff call").getByRole("button", { name: "Reschedule" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("group", { name: "Day" }).waitFor({ timeout: 10_000 });
      const days = sheet.getByRole("group", { name: "Day" }).getByRole("button");
      notes.dayCount = await days.count();
      await days.nth(1).click();
      const times = sheet.getByRole("group", { name: /^Times on/ }).getByRole("button");
      notes.timesOnDay2 = await times.allInnerTexts();
      await times.nth(1).click();
      // The from→to summary carries the times; the act button says the act once ("Move session").
      notes.confirm = await sheet.getByRole("button", { name: /^Move session$/ }).innerText();
      notes.confirmEnabled = await sheet.getByRole("button", { name: /^Move session$/ }).isEnabled();
      notes.offersCurrentStart = (await sheet.innerText()).includes("current");
      break;
    }
    case "cancel":
      await list();
      await row(page, "Kickoff call").getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("alertdialog").waitFor({ timeout: 10_000 });
      notes.dialog = (await page.getByRole("alertdialog").innerText()).replace(/\s+/g, " ");
      break;
    case "failed":
      await list();
      await row(page, "Quarterly review").getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel session" }).click();
      await row(page, "Quarterly review").getByRole("alert").waitFor({ timeout: 10_000 });
      await page.getByRole("alertdialog").waitFor({ state: "detached", timeout: 10_000 });
      await row(page, "Quarterly review").scrollIntoViewIfNeeded();
      notes.refusal = (await row(page, "Quarterly review").getByRole("alert").innerText()).replace(/\s+/g, " ");
      // A refusal whose way out is a message holds this session's own changes until it is dismissed or re-read.
      notes.heldActions = {
        reschedule: await row(page, "Quarterly review").getByRole("button", { name: "Reschedule" }).count(),
        cancel: await row(page, "Quarterly review").getByRole("button", { name: "Cancel", exact: true }).count(),
        messageLinkInAlert: await row(page, "Quarterly review").getByRole("alert").getByRole("link", { name: "Message Northwind Studio" }).count(),
        dismiss: await row(page, "Quarterly review").getByRole("alert").getByRole("button", { name: "Dismiss" }).count(),
        tryAgain: await row(page, "Quarterly review").getByRole("alert").getByRole("button", { name: /Try again|Retry/ }).count(),
      };
      break;
    case "unavailable": await page.getByText("Sessions aren't available on this account").waitFor({ timeout: 30_000 }); break;
    case "multiple": await page.getByText("Sessions for more than one business aren't available yet").waitFor({ timeout: 30_000 }); break;
    case "loading": await page.locator("section[aria-labelledby='sessions-title'] [role='status']").first().waitFor({ state: "attached", timeout: 30_000 }); break;
    case "hover": {
      await list();
      const kick = row(page, "Kickoff call");
      await kick.scrollIntoViewIfNeeded();
      // What the hovered button actually reads as: its own text colour against its own (hover) fill.
      const read = (b) => b.evaluate((el) => { const cs = getComputedStyle(el); return { fill: cs.backgroundColor, text: cs.color }; });
      await kick.getByRole("button", { name: "Reschedule" }).hover();
      await page.waitForTimeout(250);
      notes.rescheduleHover = await read(kick.getByRole("button", { name: "Reschedule" }));
      await kick.getByRole("button", { name: "Cancel", exact: true }).hover();
      await page.waitForTimeout(250);
      notes.cancelHover = await read(kick.getByRole("button", { name: "Cancel", exact: true }));
      return; // keep the pointer where it is for the frame
    }
    case "home": {
      const tile = page.locator("[data-harness-home] a[href='/app/sessions']");
      await tile.waitFor({ timeout: 30_000 });
      notes.tile = (await tile.innerText()).replace(/\s+/g, " ");
      notes.headline = (await page.locator('[data-harness-home] [data-testid="next-session-headline"]').innerText()).trim();
      notes.closedLine = await page.locator('[data-harness-home] [data-testid="next-session-closed"]').count();
      notes.tileBook = await page.locator("[data-harness-home]").getByRole("button", { name: "Book a session" }).count();
      notes.homeText = (await page.locator("[data-harness-home]").innerText()).replace(/\s+/g, " ");
      // Booking stays what the old tile did: ask the customer's agent to set one up.
      const prefill = page.evaluate(() => new Promise((res) => { window.addEventListener("paige:prefill", (e) => res(e.detail?.prompt ?? null), { once: true }); setTimeout(() => res(null), 3000); }));
      await page.locator("[data-harness-home]").getByRole("button", { name: "Book a session" }).first().click();
      notes.bookPrefill = await prefill;
      await page.locator("[data-harness-home] a[href='/app/sessions']").click();
      notes.tileOpens = new URL(page.url()).pathname;
      await page.goBack();
      await tile.waitFor({ timeout: 30_000 });
      await page.mouse.move(0, 0);
      break;
    }
    case "home-hover": {
      await page.locator("[data-harness-home] a[href='/app/sessions']").waitFor({ timeout: 30_000 });
      const book = page.locator("[data-harness-home]").getByRole("button", { name: "Book a session" }).first();
      await book.hover();
      await page.waitForTimeout(250);
      notes.bookHover = await book.evaluate((el) => { const cs = getComputedStyle(el); return { fill: cs.backgroundColor, text: cs.color, h: Math.round(el.getBoundingClientRect().height) }; });
      notes.bookHovered = await book.evaluate((el) => el.matches(":hover"));
      await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
      return; // keep the pointer on the button for the frame
    }
    case "home-empty": {
      await page.locator("[data-harness-home]").getByText("No upcoming sessions").waitFor({ timeout: 30_000 });
      const card = page.locator("[data-harness-home] .bg-card").filter({ hasText: "No upcoming sessions" });
      notes.tile = (await card.innerText()).replace(/\s+/g, " ");
      notes.tileActions = await card.getByRole("button").allInnerTexts();
      break;
    }
  }
  await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
  await page.waitForTimeout(500);
}

/** What the owner decided each state must show, checked against what the drive read off the page. */
function unmet(s, notes) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (s.state === "upcoming") {
    // The icon follows location_kind (phone / video / in person), never whether a join link exists.
    want(eq(notes.locations, [
      "Brand strategy session · Phone call · lucide-phone",
      "Kickoff call · Zoom · lucide-video",
      "Quarterly review · In person: 14 Harbour Lane, Suite 3 · lucide-map-pin",
    ]), `locations ${JSON.stringify(notes.locations)}`);
    want(eq(notes.pastPills, ["Brand strategy session · Completed", "Brand strategy session · Cancelled", "Kickoff call · Missed", "Intro consultation · Completed"]), `pastPills ${JSON.stringify(notes.pastPills)}`);
    // Settled wording: the cancelled Zoom with no link reads "Zoom", never "Zoom — link to follow".
    want(eq(notes.pastLocations, ["Zoom · lucide-video", "Zoom · lucide-video", "Phone call · lucide-phone", "Location not recorded · lucide-map-pin"]), `pastLocations ${JSON.stringify(notes.pastLocations)}`);
    want((notes.pastPillRights ?? []).length === 1 && (notes.pastTimeRights ?? []).length === 1, `past columns ragged pills=${JSON.stringify(notes.pastPillRights)} times=${JSON.stringify(notes.pastTimeRights)}`);
    want(notes.closedRow?.hasReschedule === 0 && notes.closedRow?.hasCancel === 0 && notes.closedRow?.messageLink === 1, "closed row offers changes or no message link");
    want(!(notes.pills ?? []).includes("Scheduled"), "upcoming carries a Scheduled pill");
    want(notes.hostLeak === false, "host/staff named");
  }
  if (s.state === "failed") {
    const h = notes.heldActions ?? {};
    want(h.reschedule === 0 && h.cancel === 0 && h.messageLinkInAlert === 1 && h.dismiss === 1 && h.tryAgain === 0, `refusal hold ${JSON.stringify(h)}`);
  }
  if (s.state === "home") {
    want(/Next session/.test(notes.tile ?? "") && /Brand strategy session/.test(notes.tile ?? ""), `tile ${notes.tile}`);
    // The headline is how near it is, in the Sessions page's words; the closed window is said on the tile.
    want(notes.headline === "Today · in 45 min", `headline ${notes.headline}`);
    want(notes.closedLine === 1, "tile does not say changes are closed");
    want(notes.tileBook === 1 && typeof notes.bookPrefill === "string", "Book a session missing or does not ask the agent");
    // Owner ruling 2026-10-19: the customer's agent is named (Ava here), never PAIGE, the owner's COO.
    want(!/paige/i.test(notes.homeText ?? "") && /Ask Ava/.test(notes.homeText ?? ""), `home names PAIGE or not the agent: ${notes.homeText}`);
    want(notes.tileOpens === "/app/sessions", `tile opens ${notes.tileOpens}`);
  }
  if (s.state === "cancel") want(/ask Ava\.$/.test(notes.dialog ?? "") || /ask Ava\./.test(notes.dialog ?? ""), `cancel dialog does not name the agent: ${notes.dialog}`);
  if (s.state === "cancel") want(!/paige/i.test(notes.dialog ?? ""), `cancel dialog names PAIGE: ${notes.dialog}`);
  if (s.state === "home-hover") want(notes.bookHovered === true, "Book a session is not under the pointer");
  if (s.state === "home-empty") want(eq(notes.tileActions, ["Message Northwind Studio", "Book a session"]), `empty tile actions ${JSON.stringify(notes.tileActions)}`);
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
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
  const fgOf = (el, bg) => { const c = getComputedStyle(el).color; return alphaOf(c) < 1 ? blend(c, bg) : c; };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden]");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled");

  const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((n) => n.getClientRects().length);
  // On the home frames only the Sessions tile is this slice's; it is graded on its own, the rest is reported.
  const homeTile = opts.home
    ? ([...document.querySelectorAll("[data-harness-home] .bg-card")].find((c) => /Next session|No upcoming sessions/.test(c.textContent)) ?? null)
    : null;
  const scopes = {
    page: opts.home ? homeTile : document.querySelector('[data-harness-region="page"]'),
    wholePage: document.querySelector('[data-harness-region="page"]'),
    nav: document.querySelector('[data-harness-region="nav"] > div'),
  };
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n);
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), inactive: inactive(n), size: getComputedStyle(n).fontSize };
  });
  // With a modal open the page behind it is inert and dimmed; it is graded only when nothing is open.
  const pageContrast = scopes.page && !overlays.length ? contrastFor(scopes.page) : [];
  const overlayContrast = overlays.flatMap(contrastFor);
  const navContrast = scopes.nav && !overlays.length ? contrastFor(scopes.nav) : [];
  const wholePageContrast = opts.home && scopes.wholePage ? contrastFor(scopes.wholePage) : [];
  const graded = (list) => list.filter((c) => !c.inactive);
  const min = (list) => (graded(list).length ? Math.min(...graded(list).map((c) => c.ratio)) : null);

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important"); // a transitioning probe reads back its old colour
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
    return hits.length ? [{ el: `${n.tagName.toLowerCase()}`, text: n.textContent.trim().slice(0, 30), hits }] : [];
  });

  const targetSel = 'a, button, input, [role="button"]';
  const targetsIn = (root, region) => [...root.querySelectorAll(targetSel)]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      const r = n.getBoundingClientRect();
      // The hit area a finger actually gets: the box, grown by an absolutely-positioned ::after that overhangs it
      // (negative insets on a positioned target). Reported beside the drawn box, never instead of it.
      const a = getComputedStyle(n, "::after"), own = getComputedStyle(n);
      const pseudo = a.content !== "none" && a.content !== "normal" && a.position === "absolute" && own.position !== "static";
      const grow = (v) => (pseudo && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
      const hitH = Math.round(r.height + grow(a.top) + grow(a.bottom)), hitW = Math.round(r.width + grow(a.left) + grow(a.right));
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 34), h: Math.round(r.height), w: Math.round(r.width), hitH, hitW, region };
    });
  const targets = overlays.length
    ? overlays.flatMap((o) => targetsIn(o, "overlay"))
    : [...(scopes.page ? targetsIn(scopes.page, "page") : []), ...(scopes.nav ? targetsIn(scopes.nav, "nav") : [])];

  const scroller = scopes.wholePage;
  const section = opts.home ? homeTile : document.querySelector("section[aria-labelledby='sessions-title']");
  // Overflow a person can actually scroll: the document, the page scroller, and the open overlay's own box.
  // The sheet's day strip scrolls sideways BY DESIGN (overflow-x-auto) and is reported, not graded.
  const overlayOverflow = overlays.map((o) => ({ role: o.getAttribute("role"), over: o.scrollWidth > o.clientWidth + 1, w: [o.scrollWidth, o.clientWidth], right: Math.round(o.getBoundingClientRect().right), vw: innerWidth }));
  const dayStrip = document.querySelector('[role="group"][aria-label="Day"]');

  // Text clipped by its own box (an ellipsis or a hidden overflow cutting words off).
  const clipped = [...(section ? section.querySelectorAll("h1,h2,h3,p,span,a,button") : []), ...overlays.flatMap((o) => [...o.querySelectorAll("h2,p,span,button")])]
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX))
    .map((n) => n.textContent.trim().slice(0, 40));

  return {
    heading: section?.querySelector("h1")?.textContent ?? null,
    pageText: section?.innerText.replace(/\s+/g, " ").slice(0, 700) ?? null,
    overlayText: overlays.map((o) => o.innerText.replace(/\s+/g, " ").slice(0, 400)),
    navText: scopes.nav?.innerText.replace(/\s+/g, " ").slice(0, 300) ?? null,
    contrastMin: min(pageContrast), lowPage: graded(pageContrast).filter((c) => c.ratio < 4.5),
    overlayContrastMin: min(overlayContrast), lowOverlay: graded(overlayContrast).filter((c) => c.ratio < 4.5),
    navContrastMin: min(navContrast), lowNav: graded(navContrast).filter((c) => c.ratio < 4.5),
    homeTileFound: opts.home ? !!homeTile : undefined,
    wholePageContrastMin: opts.home ? min(wholePageContrast) : undefined, lowWholePage: opts.home ? graded(wholePageContrast).filter((c) => c.ratio < 4.5) : undefined,
    goldWholePage: opts.home && scopes.wholePage ? goldIn(scopes.wholePage) : undefined,
    inactiveText: [...pageContrast, ...overlayContrast].filter((c) => c.inactive).map((c) => `${c.text} (${c.ratio})`).slice(0, 6),
    goldPage: scopes.page ? goldIn(scopes.page) : [], goldOverlay: overlays.flatMap(goldIn), goldNav: scopes.nav ? goldIn(scopes.nav) : [],
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false) || overlayOverflow.some((o) => o.over || o.right > o.vw + 1),
    overlayOverflow, dayStrip: dayStrip ? { scrollWidth: dayStrip.scrollWidth, clientWidth: dayStrip.clientWidth } : null,
    widths: { doc: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, scroller: scroller ? [scroller.scrollWidth, scroller.clientWidth] : null },
    clipped, targets,
    panels: [...document.querySelectorAll("[data-panel]")].map((p) => Math.round(p.getBoundingClientRect().width)),
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0 && getComputedStyle(t).visibility !== "hidden"; })(),
    opts,
  };
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `e09-sessions-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], requestFailures = [], dialogs = [], notes = {};
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => requestFailures.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 160)));
    page.on("dialog", async (d) => { dialogs.push(`${d.type()}: ${d.message()}`); await d.accept(); });
    await page.goto(`http://127.0.0.1:${PORT}${s.home ? "/app" : "/app/sessions"}?${new URLSearchParams({ state: s.state === "home-hover" ? "home" : s.state, theme: s.theme })}`);
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, home: !!s.home });
    const smallTargets = s.phone ? m.targets.filter((t) => t.hitH < 44 || t.hitW < 44) : [];
    const expectations = driveError ? [] : unmet(s, notes);
    const surfaceOk = !driveError && expectations.length === 0 && errors.length === 0 && m.lowPage.length === 0 && m.lowOverlay.length === 0 && !m.overflowX
      && m.goldPage.length === 0 && m.goldOverlay.length === 0 && m.clipped.length === 0
      && smallTargets.filter((t) => t.region !== "nav").length === 0 && m.tag && (!s.home || m.homeTileFound);
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav").length === 0;
    if (!surfaceOk) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok: surfaceOk, chromeOk, expectations, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, requestFailures, dialogs, notes, smallTargets, ...m };
    await ctx.close();
    console.log(`${name} ${surfaceOk ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), overlayMin: m.overlayContrastMin, lowOverlay: m.lowOverlay.slice(0, 3),
      navContrastMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 3), wholePageMin: m.wholePageContrastMin, lowWholePage: m.lowWholePage?.slice(0, 3), goldWholePage: m.goldWholePage?.length, goldPage: m.goldPage.length, goldOverlay: m.goldOverlay.length,
      goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`), overflowX: m.overflowX, clipped: m.clipped, smallTargets, errors: errors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 2), notes, tag: m.tag,
    }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "e09-sessions-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
