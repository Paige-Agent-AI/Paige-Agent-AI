// E09 Slice 3 — render the CUSTOMER portal Progress page (/app/progress) inside the real customer chrome, and
// the customer home's Progress + Next steps tiles (/app), in every state, both themes, desktop, the owner's two
// laptop sizes and phone, and MEASURE it: text contrast (AA 4.5:1 against the real composited background) on the
// page, horizontal overflow, gold spent on the page (none: nothing here is an act), touch targets >= 44px on the
// phone, clipped text, page errors / failed responses / any request that tried to leave the machine (the network
// is blocked), and that the HARNESS RENDER tag is on screen. It also reads the OWNER-DECIDED behaviour off the
// rendered page (D3 title/state/due only, blocked shows In progress, cancelled hidden; D5 no completion control;
// D7 no journey stages) and checks it against what each state must show.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in
// customer portal on the deployed app, against a seeded test-tenant item the owner shared, is owed to a capable
// session.
//
//   node scripts/live-drive/harness/portal-progress-customer-mount/progress-drive.mjs [--out dir] [--only substr]
//   node .../progress-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-progress-customer");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5244;
// A fixed clock and zone so every due date, "Due today" and past-due mark is reproducible frame to frame.
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";
const BUSINESS = "Northwind Studio";
// Rows the stub holds that the customer must never see (stubs.ts PRIVATE_TITLES), plus private column text.
const NEVER = ["Internal pricing review", "Paid ads plan", "Old proposal draft", "Call Jordan back", "Sam's onboarding pack",
  "Northwind internal retro", "Internal note", "margin is thin", "Blocked", "Cancelled", "Assigned", "Priority"];

const PAGE_STATES = ["populated", "empty", "alldone", "loading", "unavailable", "multiple", "error", "hasmore"];
const SIZES = { desktop: [1440, 900], laptop: [1366, 768], wide: [1536, 770], phone: [390, 844] };
function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const state of PAGE_STATES) {
      shots.push({ state, theme, kind: "desktop" });
      shots.push({ state, theme, kind: "phone" });
    }
    // The owner's own screens (1366x768 and 1536x770): the populated page, where the most is on screen.
    shots.push({ state: "populated", theme, kind: "laptop" });
    shots.push({ state: "populated", theme, kind: "wide" });
    // Done unfolded by the real toggle, and a pointer resting on the action-items line.
    shots.push({ state: "populated", theme, kind: "desktop", variant: "done-open" });
    shots.push({ state: "populated", theme, kind: "phone", variant: "done-open" });
    shots.push({ state: "populated", theme, kind: "desktop", variant: "hover" });
    for (const state of ["home", "home-empty", "home-error"]) {
      shots.push({ state, theme, kind: "desktop", home: true });
      shots.push({ state, theme, kind: "phone", home: true });
    }
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_PROGRESS_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const section = "section[aria-labelledby='progress-title']";
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
/** The text of an element that may be absent, without waiting out the default timeout for it. */
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");

/** Bring each state to the moment worth framing, through the REAL UI, and read what the owner decided off the page. */
async function drive(page, s, notes) {
  const ready = async () => { await page.getByRole("heading", { name: "Progress", exact: true, level: 1 }).waitFor({ timeout: 30_000 }); };
  const readPage = async () => {
    const root = page.locator(section);
    notes.pageText = clean(await root.innerText());
    notes.leaks = NEVER.filter((t) => notes.pageText.toLowerCase().includes(t.toLowerCase()));
    notes.pills = [...new Set(await root.locator('[data-testid="state-pill"]').allInnerTexts())].map(clean);
    // D5: nothing on this page completes an item. The only button allowed is the Done fold (and Try again on error).
    notes.buttons = (await root.getByRole("button").allInnerTexts()).map(clean);
    notes.completion = await root.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').count()
      + (await root.getByRole("button", { name: /mark|complete|finish|tick/i }).count());
    notes.links = await root.getByRole("link").evaluateAll((as) => as.map((a) => `${a.textContent.trim().replace(/\s+/g, " ")} -> ${a.getAttribute("href")}`));
    notes.summary = await textOf(root.locator('[data-testid="progress-summary"]'));
  };
  switch (s.state) {
    case "populated": case "hasmore": case "error": {
      await ready();
      await page.locator('[data-testid="progress-item"]').first().waitFor({ timeout: 30_000 });
      if (s.state === "error") {
        // The page's own refresh: the window regains focus, the read fails, the list must stay.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.locator(`${section} [role="alert"]`).waitFor({ timeout: 10_000 });
        notes.alert = clean(await page.locator(`${section} [role="alert"]`).innerText());
      }
      if (s.state === "populated" || s.state === "hasmore") {
        // Next up: each row's title, then its due line with the milestone it sits under (P1-1).
        notes.nextUp = await page.locator(`${section} [data-testid="next-up"] [data-testid="next-up-item"]`).evaluateAll((els) => els.map((e) => {
          const [title, line] = [...e.querySelectorAll("p")].map((p) => p.innerText.replace(/\s+/g, " ").trim());
          return `${title} — ${line}`;
        }));
        notes.nextUpHeading = await textOf(page.locator(`${section} #progress-next`));
      }
      if (s.state === "populated") {
        // Groups as the customer reads them: each card's heading, then its rows, in order.
        notes.groups = await page.locator(`${section} section[aria-labelledby="progress-open"] > ol > li`).evaluateAll((lis) => lis.map((li) => {
          const head = li.querySelector("h3")?.textContent.replace(/^Milestone: /, "").trim();
          const rows = [...li.querySelectorAll("ol li [data-testid='progress-item'] p:first-child")].map((p) => p.textContent.trim());
          return `${head}: ${rows.join(" | ")}`;
        }));
        const assets = page.locator(`${section} [data-testid="progress-item"]`).filter({ hasText: "Send the brand assets folder" });
        notes.blockedRow = clean(await assets.innerText());
        // One past-due mark in the full list, and the same item named again in Next up (it leads it).
        notes.pastDue = (await page.locator(`${section} section[aria-labelledby="progress-open"] [data-testid="past-due"]`).allInnerTexts()).map(clean);
        notes.pastDueNext = (await page.locator(`${section} [data-testid="next-up"] [data-testid="past-due"]`).allInnerTexts()).map(clean);
        notes.dueToday = clean(await page.locator(`${section} [data-testid="progress-item"]`).filter({ hasText: "Review the moodboard" }).innerText());
        notes.doneToggle = await page.locator(`${section} button[aria-expanded]`).evaluate((b) => ({ text: b.textContent.trim(), expanded: b.getAttribute("aria-expanded") }));
        notes.nextUpFirstViewport = await page.locator(`${section} [data-testid="next-up"]`).evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight).catch(() => null);
        notes.doneVisible = await page.locator(`${section} [data-testid="progress-item"]`).filter({ hasText: "Discovery questionnaire" }).isVisible();
        notes.actionLine = await textOf(page.locator('[data-testid="action-items-waiting"]'));
        notes.actionHref = await page.locator('[data-testid="action-items-waiting"]').getAttribute("href").catch(() => null);
        // Pills keep one right edge on a row, whatever the title length (no ragged column).
        notes.pillRights = await page.locator(`${section} li li [data-testid="state-pill"]`).evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().right)))]);
      }
      if (s.variant === "done-open") {
        await page.locator(`${section} button[aria-expanded]`).click();
        await page.locator(`${section} [data-testid="progress-item"]`).filter({ hasText: "Discovery questionnaire" }).waitFor({ state: "visible", timeout: 10_000 });
        notes.doneRows = await page.locator(`${section} [aria-labelledby$="-heading"] [data-testid="progress-item"]`).evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
        notes.doneTitleLefts = await page.locator(`${section} [aria-labelledby$="-heading"] [data-testid="progress-item"] > div`).evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
        // Scroll the page's own scroller (never scrollIntoView: it also scrolls the overflow-hidden shell above it).
        await page.locator(`${section} button[aria-expanded]`).evaluate((b) => {
          const scroller = document.querySelector('[data-harness-region="page"]');
          scroller.scrollTop += b.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
        });
      }
      if (s.variant === "hover") {
        const line = page.locator('[data-testid="action-items-waiting"]');
        await line.hover();
        await page.waitForTimeout(250);
        notes.hover = await line.evaluate((el) => { const cs = getComputedStyle(el); return { fill: cs.backgroundColor, text: cs.color, hovered: el.matches(":hover") }; });
      }
      await readPage();
      if (s.state === "hasmore") {
        notes.moreLine = await textOf(page.locator(section).getByText(/^Showing the first/));
        notes.doneUnlisted = await textOf(page.locator(`${section} [data-testid="done-unlisted"]`));
        notes.doneHeading = await textOf(page.locator(`${section} [aria-labelledby$="-heading"] h2`).first());
      }
      break;
    }
    case "alldone":
      await ready();
      await page.locator('[data-testid="all-done"]').waitFor({ timeout: 30_000 });
      notes.allDone = clean(await page.locator('[data-testid="all-done"]').innerText());
      notes.doneToggle = await page.locator(`${section} button[aria-expanded]`).evaluate((b) => ({ text: b.textContent.trim(), expanded: b.getAttribute("aria-expanded") }));
      notes.actionLine = await page.locator('[data-testid="action-items-waiting"]').count();
      notes.nextUpCount = await page.locator('[data-testid="next-up"]').count();
      await readPage();
      break;
    case "empty":
      await ready();
      await page.getByText(`${BUSINESS} hasn't shared any progress with you yet`).waitFor({ timeout: 30_000 });
      await readPage();
      break;
    case "unavailable":
      await page.getByText("Progress isn't available on this account").waitFor({ timeout: 30_000 });
      await readPage();
      break;
    case "multiple":
      await page.getByText("Progress for more than one business isn't available yet").waitFor({ timeout: 30_000 });
      await readPage();
      break;
    case "loading":
      await page.locator('[data-testid="progress-skeleton"]').waitFor({ state: "attached", timeout: 30_000 });
      notes.busy = await page.locator(section).getAttribute("aria-busy");
      break;
    case "home": case "home-empty": case "home-error": {
      const tile = page.locator('[data-harness-home] [data-testid="progress-tile"]');
      await tile.waitFor({ timeout: 30_000 });
      notes.progressTile = clean(await tile.innerText());
      notes.progressHref = await tile.getAttribute("href");
      notes.progressNext = await textOf(page.locator('[data-harness-home] [data-testid="progress-tile-next"]'));
      notes.progressOpen = await textOf(page.locator('[data-harness-home] [data-testid="progress-tile-open"]'));
      notes.progressHeadline = await page.locator('[data-harness-home] [data-testid="progress-tile-headline"]').evaluate((e) => ({ text: e.textContent.trim(), size: getComputedStyle(e).fontSize })).catch(() => null);
      const next = page.locator("[data-harness-home] .bg-card").filter({ hasText: "Your next steps" });
      await page.locator('[data-harness-home] [data-testid="next-steps-loading"]').waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      notes.nextTile = clean(await next.innerText());
      notes.nextHref = (await next.locator("a").count()) ? await next.locator("a").first().getAttribute("href") : null;
      notes.homeText = clean(await page.locator("[data-harness-home]").innerText());
      // Opening the tile lands on the progress page itself, never a Paige prompt.
      const prefill = page.evaluate(() => new Promise((res) => { window.addEventListener("paige:prefill", (e) => res(e.detail?.prompt ?? "prefill"), { once: true }); setTimeout(() => res(null), 1500); }));
      await tile.click();
      notes.tileOpens = new URL(page.url()).pathname;
      notes.tilePrefill = await prefill;
      await page.goBack();
      await tile.waitFor({ timeout: 30_000 });
      await page.mouse.move(0, 0);
      break;
    }
  }
  if (!s.phone && !s.home) {
    // The customer nav, in order, as rendered: Progress appears once, for a customer of one business only.
    notes.nav = await page.locator('[data-harness-region="nav"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/app")));
  }
  await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
  if (s.variant !== "hover") await page.waitForTimeout(400);
}

/** What the owner decided each state must show, checked against what the drive read off the page. */
function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const customerPage = !s.home && s.state !== "loading";
  if (customerPage) {
    want((n.leaks ?? []).length === 0, `private or staff-only text on the customer page: ${JSON.stringify(n.leaks)}`);
    want(n.completion === 0, `a completion control is on the page (D5): ${n.completion}`);
    want((n.pills ?? []).every((p) => ["Not started", "In progress", "Done"].includes(p)), `pill outside the three customer states: ${JSON.stringify(n.pills)}`);
    want(!/journey|stage/i.test(n.pageText ?? ""), "journey stages named on the page (D7)");
  }
  const progressInNav = (n.nav ?? []).filter((h) => h === "/app/progress").length;
  if (!s.phone && !s.home) {
    const customer = !["unavailable", "multiple"].includes(s.state);
    want(progressInNav === (customer ? 1 : 0), `Progress in the nav ${progressInNav} time(s) for ${customer ? "a" : "a non-"}customer`);
    if (customer && progressInNav) {
      const i = n.nav.indexOf("/app/progress"), anchor = Math.max(n.nav.indexOf("/app/sessions"), n.nav.indexOf("/app/messages"));
      want(anchor >= 0 && i === anchor + 1, `Progress not directly after Sessions/Messages: ${JSON.stringify(n.nav)}`);
    }
  }
  if (s.state === "populated") {
    want(n.summary === "3 of 13 done 1 past due", `summary "${n.summary}"`);
    if (!s.variant) {
      // P1-1: Next up names the dated open work that comes first — past due, then due today, then soonest —
      // with its milestone as context; undated work and the milestone heading's own date never crowd it.
      want(n.nextUpHeading === "Next up", `Next up heading "${n.nextUpHeading}"`);
      want(eq((n.nextUp ?? []).map((r) => r.replace(/^(.*?) — (?:(?:Not started|In progress) · )?/, "$1 — ")), [
        "Send the brand assets folder — Past due · Wed, Oct 14 · in Brand identity",
        "Review the moodboard — Due today",
        "First logo concepts — Due Mon, Oct 19 · in Brand identity",
      ]), `Next up rows ${JSON.stringify(n.nextUp)}`);
      want((n.pastDueNext ?? []).length === 1, `past-due marks in Next up ${JSON.stringify(n.pastDueNext)}`);
      want(eq(n.groups, [
        "Brand identity: Send the brand assets folder | First logo concepts | Colour palette and type pairing",
        "Website launch: Homepage wireframe",
        "Other work: Review the moodboard | Book the product photographer | Ad copy first draft | Draft the About page copy with your notes on the founding story and the studio's first year in Harbour Lane",
      ]), `groups ${JSON.stringify(n.groups)}`);
      // D3: blocked inside the business reads as In progress for the customer, and it is past due.
      want(/In progress/.test(n.blockedRow ?? "") && /Past due/.test(n.blockedRow ?? ""), `blocked row "${n.blockedRow}"`);
      want((n.pastDue ?? []).length === 1, `past-due marks in the list ${JSON.stringify(n.pastDue)}`);
      want(/Due today/.test(n.dueToday ?? ""), `due-today row "${n.dueToday}"`);
      want(n.doneToggle?.expanded === "false" && /Done \(3\)/.test(n.doneToggle?.text ?? "") && n.doneVisible === false, `Done fold ${JSON.stringify(n.doneToggle)} visible=${n.doneVisible}`);
      want(n.actionLine === "You have 2 action items waiting" && n.actionHref === "/app/actions", `action-items line "${n.actionLine}" -> ${n.actionHref}`);
      want((n.pillRights ?? []).length <= 1, `pills ragged ${JSON.stringify(n.pillRights)}`);
    }
    want((n.links ?? []).includes(`Message ${BUSINESS} -> /app/messages?topic=progress`), `footer message link ${JSON.stringify(n.links)}`);
    want(eq((n.buttons ?? []).map((b) => b.replace(/\s*\(\d+\)/, "")), ["Done"]), `buttons ${JSON.stringify(n.buttons)}`);
    if (s.variant === "done-open") {
      // P3: a Done row says "Finished <date>" and carries no Done pill beside it.
      want(eq((n.doneRows ?? []).map((r) => r.split(" Finished")[0]), ["Discovery questionnaire", "Milestone: Kickoff", "Sign the engagement letter"]), `done rows ${JSON.stringify(n.doneRows)}`);
      want((n.doneRows ?? []).every((r) => / Finished \w{3}, \w{3} \d{1,2}$/.test(r) && !/\bDone\b/.test(r)), `done row wording ${JSON.stringify(n.doneRows)}`);
      want((n.doneTitleLefts ?? []).length === 1, `done titles ragged ${JSON.stringify(n.doneTitleLefts)}`);
    }
    if (s.variant === "hover") want(n.hover?.hovered === true, "action-items line is not under the pointer");
  }
  if (s.state === "error") {
    // P2-6: the list is still on screen, so a failed re-read is a failed refresh, not a failed load.
    want(/couldn't refresh this list, so it may be out of date/i.test(n.alert ?? "") && /Try again/.test(n.alert ?? "") && !/couldn't load/i.test(n.alert ?? ""), `error alert "${n.alert}"`);
    want(/Brand identity/.test(n.pageText ?? ""), "the list was dropped when the refresh failed");
  }
  if (s.state === "hasmore") {
    want(n.moreLine === "Showing the first 100 of 109 shared items.", `has_more line "${n.moreLine}"`);
    // P2-7: finished work past the 100-item page keeps a Done heading and says why it isn't listed.
    want(n.doneHeading === "Done (3)" && n.doneUnlisted === "3 finished items aren't listed here. This page shows up to 100 items, open work first.", `Done unlisted "${n.doneHeading}" / "${n.doneUnlisted}"`);
    want(n.summary === "3 of 109 done 1 past due" && (n.nextUp ?? []).length === 3, `has_more summary "${n.summary}" next-up ${JSON.stringify(n.nextUp)}`);
  }
  if (s.state === "alldone") {
    want(n.allDone === `Everything ${BUSINESS} has shared with you is done.`, `all-done line "${n.allDone}"`);
    want(n.doneToggle?.expanded === "true", "Done folded when nothing is open");
    want(n.actionLine === 0, "action-items line shown with no open action items");
    want(n.nextUpCount === 0, "Next up shown when nothing is open");
  }
  if (s.state === "empty") {
    want((n.links ?? []).includes(`Message ${BUSINESS} -> /app/messages?topic=progress`), `empty-state message link ${JSON.stringify(n.links)}`);
    want(!/of \d+ done/.test(n.pageText ?? ""), "empty page shows a done count");
  }
  if (s.state === "loading") want(n.busy === "true", "loading section not aria-busy");
  if (s.state === "home") {
    want(n.progressTile === "Your progress 3 of 13 done 1 past due Next: Send the brand assets folder · past due Open progress", `progress tile "${n.progressTile}"`);
    want(n.progressNext === "Next: Send the brand assets folder · past due" && n.progressOpen === "Open progress", `progress tile next "${n.progressNext}" open "${n.progressOpen}"`);
    want(n.nextTile === "Your next steps 2 waiting Action items from Northwind Studio Open action items" && n.nextHref === "/app/actions", `next steps tile "${n.nextTile}" -> ${n.nextHref}`);
  }
  if (s.state === "home-empty") {
    want(/Nothing shared yet/.test(n.progressTile ?? "") && !/0 of 0/.test(n.progressTile ?? ""), `empty progress tile "${n.progressTile}"`);
    want(/When Northwind Studio sends you an action item/.test(n.nextTile ?? ""), `empty next steps tile "${n.nextTile}"`);
  }
  if (s.state === "home-error") {
    // P2-2: the failure is the headline at a smaller step than a figure, and it never reads as zero.
    want(n.progressTile === "Your progress Couldn't check right now Open Progress to try again. Open progress" && !/\b0\b/.test(n.progressTile ?? ""), `failed tile "${n.progressTile}"`);
    want(n.progressHeadline?.size === "18px", `failed headline size ${JSON.stringify(n.progressHeadline)}`);
  }
  if (s.home) {
    want(n.progressHref === "/app/progress" && n.tileOpens === "/app/progress" && n.tilePrefill === null, `tile opens ${n.tileOpens} prefill=${n.tilePrefill}`);
    want(!/\bcoach(ed|es|ing)?\b/i.test(n.homeText ?? ""), "the tiles say coach/coached (§2)");
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
    if (scroller && (r0.top < 8 || r0.bottom > innerHeight - 8)) {
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

  const sectionEl = opts.home ? null : document.querySelector("section[aria-labelledby='progress-title']");
  const clipRoots = opts.home ? homeTiles : [sectionEl].filter(Boolean);
  const clipped = clipRoots.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  // Text that spills past its card's right edge (a row that will not wrap).
  const spill = clipRoots.flatMap((root) => [...root.querySelectorAll("li, .bg-card, [data-testid='progress-item']")]).filter((card) => {
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > cr.right + 1);
  }).map((c) => c.textContent.trim().slice(0, 40));

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
    clipped, spill, targets,
    homeTiles: opts.home ? homeTiles.length : undefined,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0 && getComputedStyle(t).visibility !== "hidden"; })(),
  };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-progress-${s.state}${s.variant ? `-${s.variant}` : ""}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    // The network is blocked: only the local harness server answers. Anything else is recorded and refused.
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}${s.home ? "/app" : "/app/progress"}?${new URLSearchParams({ state: s.state, theme: s.theme })}`);
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, home: !!s.home });
    const small = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const smallTargets = small.filter((t) => !t.inline);
    const inlineTargets = small.filter((t) => t.inline);
    const expectations = driveError ? [] : unmet(s, notes);
    const surfaceOk = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.lowPage.length === 0 && !m.overflowX
      && m.goldPage.length === 0 && m.clipped.length === 0 && m.spill.length === 0
      && smallTargets.filter((t) => t.region !== "nav").length === 0 && m.tag && (!s.home || m.homeTiles >= 2);
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav").length === 0;
    if (!surfaceOk) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (s.home) {
      // The two tiles this slice owns, each framed on its own wherever the grid put it (one is below a phone's fold).
      for (const [key, re] of [["progress", /Your progress/], ["next-steps", /Your next steps/]]) {
        const tile = page.locator("[data-harness-home] .bg-card").filter({ hasText: re }).first();
        if (await tile.count()) await tile.screenshot({ path: path.join(out, `${name}-tile-${key}.png`) }).catch(() => undefined);
      }
    }
    results[name] = { ok: surfaceOk, chromeOk, expectations, state: s.state, variant: s.variant ?? null, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, inlineTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${surfaceOk ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), navMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 3),
      wholePageMin: m.wholePageContrastMin, lowWholePage: m.lowWholePage?.slice(0, 3), goldPage: m.goldPage.slice(0, 3), goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`),
      goldWholePage: m.goldWholePage?.length, overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, inlineTargets, errors: errors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
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
      fs.writeFileSync(path.join(out, "e09-progress-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    // Negative controls: each defect is injected by the harness's own vite transform (no product file edited) and
    // the drive MUST report it through the named check. A control that passes means the drive is blind to it.
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("populated", "desktop"), caught: (r) => r.goldPage.length > 0 },
      { mutant: "contrast", shot: base("populated", "desktop", "dark"), caught: (r) => r.lowPage.length > 0 },
      { mutant: "overflow", shot: base("populated", "phone"), caught: (r) => r.overflowX === true },
      { mutant: "target", shot: base("empty", "phone"), caught: (r) => r.smallTargets.some((t) => t.region === "page") },
      { mutant: "clip", shot: base("populated", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "complete", shot: base("populated", "desktop"), caught: (r) => r.expectations.some((e) => /completion control/.test(e)) },
      { mutant: "nextup", shot: base("populated", "laptop"), caught: (r) => r.expectations.some((e) => /Next up/.test(e)) },
      { mutant: "tiletarget", shot: { ...base("home-empty", "phone"), home: true }, caught: (r) => r.smallTargets.some((t) => /what's next/i.test(t.text) && t.extended === false && t.h === 36) },
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
    fs.writeFileSync(path.join(out, "e09-progress-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
