// E09 Slice 7 — render the owner's "Portal access" card inside the real Solo client record, and the customer's
// paused / ended page inside the real /app access gate, in every state the plan names (§3 "Frames to render":
// joined; paused with reason and by; ended; the confirm step for each act; conflict; refused; loading — plus not
// joined, error, a confirmed pause, invite again; customer paused, ended and a pause that lands mid-session), both
// themes, desktop 1440x900 and phone 390x844, and MEASURE it: text contrast (AA, against the composited background),
// horizontal overflow, gold (owner: only on the one Restore act; customer: none), touch targets >= 44px on the
// phone, clipped text, page errors, any request that tried to leave the machine (the network is blocked), and that
// the HARNESS RENDER tag is on screen. Each state is reached through the REAL UI (clicking Pause, choosing a
// reason, typing a note, confirming). It also reads the owner-decided behaviour off the page and the stub's call
// log: the write carries the version the owner read, success is said only after a re-read that started after the
// write (§70.1), no notification is sent (D4), the confirm names what does and does not change (review MEDIUM-6/7),
// and the customer page shows no platform shell (no menu, no Support).
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in owner pause/restore/end against the real
// set_client_portal_access and the signed-in customer's page are owed to a capable session.
//
//   node scripts/live-drive/harness/portal-access-mount/access-drive.mjs [--out dir] [--only substr]
//   node .../access-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-access");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5263;
const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const NAME = "Jordan Rivera";
const FIRST = "Jordan";
const BUSINESS = "Northwind Studio";
const SIZES = { desktop: [1440, 900], phone: [390, 844], laptop: [1366, 768], wide: [1536, 770], compact: [1024, 768], tall: [900, 1000] };
const OWNER = ["joined", "paused", "ended", "notjoined", "loading", "refused", "error", "confirm-pause", "confirm-end", "confirm-restore", "paused-done", "changed", "reinvite",
  // Round 2: "Shared with" while paused, and the record header naming a withheld portal (review 8/12).
  "shared-paused", "header-paused", "header-ended"];
const CUSTOMER_STATES = ["paused", "ended", "midsession", "paused-logo"];
// Round 2 (review 2/8/14): the contact panel — inbox card rail and contact detail — on the tiers
// customer_portal_invite reaches (§60/§61: Solo, Sub-account, Enterprise).
const PANEL_STATES = ["joined", "paused", "ended", "confirm-pause", "confirm-end", "confirm-restore"];
const PANEL_TIERS = { joined: ["standalone", "sub_account", "enterprise"], "confirm-pause": ["standalone", "sub_account"] };
// Round 2 (verifier 7 / compliance 3): the old invitation link after access was paused or ended.
const INVITE_STATES = ["paused", "ended"];

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) for (const kind of ["desktop", "phone"]) {
    for (const state of OWNER) shots.push({ surface: "owner", state, theme, kind });
    for (const state of CUSTOMER_STATES) shots.push({ surface: "customer", state, theme, kind });
    for (const state of PANEL_STATES) for (const tier of PANEL_TIERS[state] ?? ["standalone"]) shots.push({ surface: "panel", state, tier, theme, kind });
    for (const state of INVITE_STATES) shots.push({ surface: "invite", state, theme, kind });
    // The Portal dashboard's Client access table: every client, then filtered to "Access paused".
    for (const state of ["roster", "roster-paused"]) shots.push({ surface: "portal", state, theme, kind });
  }
  // The owner's Solo record at the two laptop sizes the Solo evidence fields name (PAIGE dock closed).
  for (const theme of ["light", "dark"]) for (const kind of ["laptop", "wide"]) for (const state of ["paused", "confirm-pause"]) shots.push({ surface: "owner", state, theme, kind });
  // Round 2: the two narrower Solo widths the evidence fields name (PAIGE dock closed; the dock is not mounted here).
  for (const theme of ["light", "dark"]) for (const kind of ["compact", "tall"]) for (const state of ["paused", "confirm-pause", "header-paused"]) shots.push({ surface: "owner", state, theme, kind });
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_ACCESS_MUTANT: mutant ?? "" },
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
const SECTION = "#client-portal-access";
const CUSTOMER_ROOT = "main.customer-access-state";
const PANEL_ROOT = "[data-panel-root]";
const INVITE_ROOT = "main.customer-entry";
const PORTAL_ROOT = "table:has(.opd-access-state)";
const HEADER_ROOT = ".trc-record-header";
const SHARED_ROOT = "#client-shared-work";
const rootFor = (s) => s.surface === "customer" ? CUSTOMER_ROOT : s.surface === "panel" ? PANEL_ROOT : s.surface === "invite" ? INVITE_ROOT
  : s.surface === "portal" ? PORTAL_ROOT : s.state.startsWith("header-") ? `${HEADER_ROOT} a.trc-record-access` : s.state === "shared-paused" ? SHARED_ROOT : SECTION;

async function driveOwner(page, s, n) {
  const section = page.locator(SECTION);
  await section.waitFor({ timeout: 30_000 });
  const btn = (name) => section.getByRole("button", { name, exact: true });
  const before = () => page.evaluate(() => ({ reads: window.__harness.reads, writes: window.__harness.writes.length }));
  const settled = () => section.locator(".trc-access-state").waitFor({ timeout: 30_000 });
  const confirm = async (open, reason, note) => {
    await settled();
    await btn(open).click();
    await section.locator(".trc-access-confirm").waitFor({ timeout: 10_000 });
    if (reason) await section.locator(".trc-access-reason", { hasText: reason }).click();
    if (note) await section.locator(".trc-access-field textarea").fill(note);
  };
  switch (s.state) {
    case "loading": await section.locator(".trc-access-skeleton").waitFor({ timeout: 30_000 }); n.busy = await section.getAttribute("aria-busy"); break;
    case "refused": await section.getByText(`Only the business owner or an admin can manage ${NAME}’s portal access.`).waitFor({ timeout: 30_000 }); break;
    case "error": await section.locator('[role="alert"]').waitFor({ timeout: 30_000 }); n.alert = clean(await section.locator('[role="alert"]').innerText()); break;
    case "confirm-pause": await confirm("Pause access", "Payment", "Waiting on the October retainer."); break;
    case "confirm-end": await confirm("End access", "Our work together has ended"); break;
    case "confirm-restore": await confirm("Restore access"); break;
    case "paused-done": case "changed": {
      await confirm("Pause access", "Payment", "Waiting on the October retainer.");
      const b = await before();
      await section.locator(".trc-access-confirm").getByRole("button", { name: "Pause access", exact: true }).click();
      await section.locator(".trc-access-note").waitFor({ timeout: 10_000 });
      const a = await page.evaluate(() => ({ reads: window.__harness.reads, writes: window.__harness.writes, invokes: window.__harness.invokes }));
      n.write = a.writes[a.writes.length - 1] ?? null;
      n.writesMade = a.writes.length - b.writes;
      n.readsAfterWrite = a.reads - b.reads;
      n.invokes = a.invokes;
      n.note = clean(await section.locator(".trc-access-note").innerText());
      n.noteRole = await section.locator(".trc-access-note").getAttribute("role");
      break;
    }
    case "reinvite": {
      await settled();
      await btn("Invite again").click();
      await section.locator(".trc-access-reinvite").waitFor({ timeout: 10_000 });
      await section.locator(".opd-invitation").waitFor({ timeout: 15_000 }).catch(() => undefined);
      n.reinvite = clean(await section.locator(".trc-access-reinvite").innerText());
      n.manager = await section.locator(".opd-invitation").count();
      n.review = await section.getByRole("button", { name: "Review invitation", exact: true }).evaluate((b) => ({ disabled: b.disabled })).catch(() => null);
      break;
    }
    case "header-paused": case "header-ended": {
      await settled();
      n.chip = await textOf(page.locator(".trc-record-header a.trc-record-access"));
      n.chipHref = await page.locator(".trc-record-header a.trc-record-access").getAttribute("href").catch(() => null);
      break;
    }
    case "shared-paused": {
      await settled();
      await page.locator(SHARED_ROOT).waitFor({ timeout: 30_000 });
      n.sharedNote = await textOf(page.locator(`${SHARED_ROOT} .trc-shared-connect`));
      break;
    }
    default: await settled();
  }
  n.label = await textOf(section.locator(".trc-access-state"));
  n.summary = await textOf(section.locator(".trc-access-heading p"));
  n.facts = await section.locator(".trc-access-facts > div").evaluateAll((ds) => ds.map((d) => `${d.querySelector("dt")?.textContent.trim()} ${d.querySelector("dd")?.textContent.trim()}`));
  n.buttons = await section.locator("button").evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => `${b.textContent.trim()}${b.disabled ? ":disabled" : ""}${b.hasAttribute("data-gold") ? ":gold" : ""}`));
  n.confirmText = await textOf(section.locator(".trc-access-confirm"));
  n.radios = await section.locator('[role="radio"]').count();
  n.order = await page.evaluate(() => [...(document.querySelector(".trc-record-body")?.children ?? [])].slice(0, 3).map((c) => c.id || c.className));
  n.text = clean(await section.innerText());
  // The header frames are taken at the top of the record, as the owner first sees it.
  if (s.state.startsWith("header-")) { await page.waitForTimeout(300); return; }
  // Frame the card the way the owner reaches it: scrolled to, under the record's sticky header.
  await page.locator(s.state === "shared-paused" ? SHARED_ROOT : SECTION).evaluate((el) => {
    const scroller = el.closest(".trc-record-scroll") ?? document.scrollingElement;
    const head = document.querySelector(".trc-record-head, .trc-record-header");
    const offset = head ? head.getBoundingClientRect().height + 8 : 8;
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
  });
  await page.waitForTimeout(300);
}

async function drivePanel(page, s, n) {
  const root = page.locator(PANEL_ROOT);
  await root.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-panel-root] [role="switch"]'), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const open = async (label) => {
    await root.getByRole("button", { name: label, exact: true }).click();
    await page.locator('[role="alertdialog"]').waitFor({ timeout: 10_000 });
  };
  if (s.state === "confirm-pause") {
    // The gentler act is what switching a joined client off opens.
    await root.getByRole("switch").click();
    await page.locator('[role="alertdialog"]').waitFor({ timeout: 10_000 });
    await page.locator('[role="alertdialog"] label', { hasText: "Payment" }).click();
  }
  if (s.state === "confirm-end") { await open("End access"); await page.locator('[role="alertdialog"] label', { hasText: "Our work together has ended" }).click(); }
  if (s.state === "confirm-restore") await open("Restore access");
  n.rowButtons = await root.locator("button:not([role='switch'])").evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()));
  n.dialog = await textOf(page.locator('[role="alertdialog"]'));
  n.dialogButtons = await page.locator('[role="alertdialog"] button:not([role="radio"])').evaluateAll((bs) => bs.map((b) => `${b.textContent.trim()}${b.disabled ? ":disabled" : ""}${/bg-gradient-gold/.test(b.className) ? ":gold" : ""}`));
  n.text = clean(await root.innerText());
  await page.waitForTimeout(300);
}

async function driveInvite(page, s, n) {
  await page.locator(`${INVITE_ROOT} h1`).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !/Checking/.test(document.querySelector("main.customer-entry h1")?.textContent ?? ""), null, { timeout: 30_000 });
  n.title = await textOf(page.locator(`${INVITE_ROOT} h1`));
  n.buttons = await page.locator(`${INVITE_ROOT} button`).evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()));
  n.text = clean(await page.locator(INVITE_ROOT).innerText());
  await page.waitForTimeout(300);
}

async function drivePortal(page, s, n) {
  await page.locator(".trc-workspace").waitFor({ timeout: 30_000 });
  // The owner's way in: the Portal tab, then the dashboard's "Client access" tab.
  await page.getByRole("link", { name: "Portal", exact: true }).or(page.getByRole("tab", { name: "Portal", exact: true })).first().click();
  await page.getByRole("tab", { name: "Client access", exact: true }).click();
  await page.locator(".opd-access-state").first().waitFor({ timeout: 30_000 });
  if (s.state === "roster-paused") await page.locator('select:has(option[value="paused"])').selectOption("paused");
  await page.locator('.opd-access-state[data-state="paused"]').first().waitFor({ timeout: 30_000 });
  n.labels = await page.locator(".opd-access-state").evaluateAll((els) => els.map((e) => `${e.closest("tr")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 60) ?? ""}|${e.textContent.trim()}`));
  n.text = clean(await page.locator(PORTAL_ROOT).innerText());
  await page.locator('.opd-access-state[data-state="paused"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

async function driveCustomer(page, s, n) {
  if (s.state === "midsession") {
    // Open portal first: the shell renders. Then the owner pauses, and the next check (focus) shows the page.
    await page.locator("[data-shell-standin]").waitFor({ timeout: 30_000 });
    n.shellBefore = true;
    await page.evaluate(() => { window.__harness.pauseNow(); window.dispatchEvent(new Event("focus")); });
  }
  await page.locator(CUSTOMER_ROOT).waitFor({ timeout: 30_000 });
  n.title = await textOf(page.locator(`${CUSTOMER_ROOT} h1`));
  n.logos = await page.locator(`${CUSTOMER_ROOT} img`).evaluateAll((imgs) => imgs.filter((i) => i.getClientRects().length && getComputedStyle(i).display !== "none").map((i) => ({ src: i.getAttribute("src")?.slice(0, 40), w: i.naturalWidth })));
  n.body = await textOf(page.locator(`${CUSTOMER_ROOT} p`));
  n.buttons = await page.locator("button").evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()));
  n.text = clean(await page.locator("body").innerText());
  await page.waitForTimeout(300);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (s.surface === "customer") {
    const paused = s.state !== "ended";
    want(n.title === (paused ? `Your access to ${BUSINESS} is paused.` : `Your access to ${BUSINESS} has ended.`), `title "${n.title}"`);
    want(paused ? n.body === `${BUSINESS} has paused your portal for now. Your portal messages and files are kept. If you have questions, reach out to ${BUSINESS} the way you usually do.`
      : n.body === `${BUSINESS} has closed your portal access. If you’re working with them again, they can send you a new invitation.`, `body "${n.body}"`);
    want(eq(n.buttons, ["Sign out"]), `customer actions ${JSON.stringify(n.buttons)}`);
    // The stand-in shell's words (its menu and greeting), and the owner's internal reason and note, never appear.
    want(!/Support|Home · Messages|Welcome back/.test(n.text ?? "") && !/payment|retainer/i.test(n.text ?? ""), `platform shell or internal reason visible: "${n.text}"`);
    if (s.state === "midsession") want(n.shellBefore === true, "mid-session: the open portal was never shown first");
    // The business's own mark: the light variant in light, the dark variant in dark, exactly one painted.
    if (s.state === "paused-logo") want((n.logos ?? []).length === 1 && n.logos[0].w > 0, `logo ${JSON.stringify(n.logos)}`);
    return miss;
  }
  if (s.surface === "invite") {
    want(n.title === (s.state === "paused" ? `Your access to ${BUSINESS} is paused.` : `Your access to ${BUSINESS} has ended.`), `invite title "${n.title}"`);
    want(!/Let’s try again|status unavailable/i.test(n.text ?? "") && eq(n.buttons, ["Sign out"]), `invite page "${n.text}" ${JSON.stringify(n.buttons)}`);
    return miss;
  }
  if (s.surface === "portal") {
    const l = (n.labels ?? []).join(" ; ");
    if (s.state === "roster") want(/Jordan Rivera.*\|Access paused/.test(l) && /Sam Okafor.*\|Access ended/.test(l) && /Maya Ortiz/.test(l), `roster labels ${l}`);
    else want((n.labels ?? []).length === 1 && /Jordan Rivera.*\|Access paused/.test(l), `filtered roster ${l}`);
    return miss;
  }
  if (s.surface === "panel") {
    const tierNote = `tier ${s.tier}`;
    switch (s.state) {
      case "joined": want(n.rowButtons?.includes("Pause access") && n.rowButtons?.includes("End access") && !n.rowButtons?.includes("Restore access"), `${tierNote} joined panel ${JSON.stringify(n.rowButtons)}`); break;
      case "paused": want(/Access paused/.test(n.text ?? "") && n.rowButtons?.[0] === "Restore access" && n.rowButtons?.includes("End access") && !n.rowButtons?.includes("Pause access"), `paused panel ${JSON.stringify(n.rowButtons)} "${n.text}"`); break;
      case "ended": want(/Access ended/.test(n.text ?? "") && !n.rowButtons?.includes("End access"), `ended panel ${JSON.stringify(n.rowButtons)}`); break;
      case "confirm-pause": want(/^Pause Jordan Rivera’s portal access\?/.test(n.dialog ?? "") && /End access instead/.test(n.dialog ?? "") && eq(n.dialogButtons?.slice(-2), ["Cancel", "Pause access"]), `${tierNote} pause dialog ${JSON.stringify(n.dialogButtons)} "${n.dialog}"`); break;
      case "confirm-end": want(/^End Jordan Rivera’s portal access\?/.test(n.dialog ?? "") && !/Nothing is deleted/.test(n.dialog ?? "") && eq(n.dialogButtons?.slice(-2), ["Cancel", "End access"]), `end dialog ${JSON.stringify(n.dialogButtons)}`); break;
      case "confirm-restore": want(eq(n.dialogButtons?.slice(-2), ["Cancel", "Restore access:gold"]) && !/exactly as/.test(n.dialog ?? ""), `restore dialog ${JSON.stringify(n.dialogButtons)}`); break;
    }
    return miss;
  }
  if (!["loading", "refused", "error", "header-paused", "header-ended", "shared-paused"].includes(s.state)) want(eq(n.order?.slice(1, 3), ["client-shared-work", "client-portal-access"]), `card not under Shared with: ${JSON.stringify(n.order)}`);
  const gold = (n.buttons ?? []).filter((b) => b.endsWith(":gold"));
  switch (s.state) {
    case "joined":
      want(n.label === "Joined" && n.summary === `Joined. ${FIRST} can open your portal.`, `joined "${n.label}" / "${n.summary}"`);
      want(eq(n.buttons, ["Pause access", "End access"]) && gold.length === 0, `joined buttons ${JSON.stringify(n.buttons)}`);
      break;
    case "paused":
      want(n.label === "Access paused", `paused label "${n.label}"`);
      want(eq(n.facts, ["Paused Oct 16, 2026", "By Avery Lin", "Reason Payment", "Team note Waiting on the October retainer — restore as soon as it clears."]), `paused facts ${JSON.stringify(n.facts)}`);
      want(eq(n.buttons, ["Restore access:gold", "End access"]), `paused buttons ${JSON.stringify(n.buttons)}`);
      break;
    case "ended":
      want(n.label === "Access ended" && eq(n.facts, ["Ended Oct 12, 2026", "By Avery Lin", "Reason Our work together has ended"]), `ended ${n.label} ${JSON.stringify(n.facts)}`);
      want(eq(n.buttons, ["Invite again"]), `ended buttons ${JSON.stringify(n.buttons)}`);
      break;
    case "notjoined":
      want(n.label === "Not joined" && n.summary === `${NAME} hasn’t joined your portal yet. An invitation is waiting for them.`, `not joined "${n.summary}"`);
      want(eq(n.buttons, ["Open Portal invitations"]), `not-joined buttons ${JSON.stringify(n.buttons)}`);
      break;
    case "loading": want(n.busy === "true", "loading card not aria-busy"); break;
    case "error": want(/couldn’t check Jordan Rivera’s portal access\. Nothing has changed\./.test(n.alert ?? "") && /Try again/.test(n.alert ?? ""), `error "${n.alert}"`); break;
    case "confirm-pause":
      want(/^Pause Jordan Rivera’s portal access\?/.test(n.confirmText ?? ""), "pause confirm title");
      for (const line of [`They’ll see that their access to ${BUSINESS} is paused the next time they open it.`, "Their history stays on this contact", "Emails and texts you send them aren’t affected, and we won’t email them about this.", "Invoices, agreements and booked sessions you already sent stay as they are.", "Only your team sees this."])
        want((n.confirmText ?? "").includes(line), `pause confirm missing "${line}"`);
      want(n.radios === 5 && eq(n.buttons.slice(-2), ["Cancel", "Pause access"]) && gold.length === 0, `pause confirm controls ${n.radios} ${JSON.stringify(n.buttons)}`);
      break;
    case "confirm-end":
      for (const line of ["To bring them back you’ll send a new invitation.", "Anything they connected under their own login stops showing here until they rejoin."])
        want((n.confirmText ?? "").includes(line), `end confirm missing "${line}"`);
      want(!/Nothing is deleted/.test(n.confirmText ?? "") && eq(n.buttons.slice(-2), ["Cancel", "End access"]) && gold.length === 0, `end confirm ${JSON.stringify(n.buttons)}`);
      break;
    case "confirm-restore":
      want(n.radios === 0 && eq(n.buttons, ["Cancel", "Restore access:gold"]), `restore confirm ${n.radios} ${JSON.stringify(n.buttons)}`);
      break;
    case "paused-done":
      want(n.writesMade === 1 && n.write?.p_action === "pause" && n.write?.p_reason === "payment" && n.write?.p_note === "Waiting on the October retainer."
        && n.write?.p_expected_changed_at === null && n.write?.p_expected_actor_id === "e0900000-0000-4000-8000-00000000f001", `write ${JSON.stringify(n.write)}`);
      want(n.readsAfterWrite >= 1, `success shown with no re-read after the write (§70.1): reads after = ${n.readsAfterWrite}`);
      want(n.note === `Paused. ${FIRST} will see that their access is paused the next time they open your portal.` && n.noteRole === "status", `done note "${n.note}"`);
      want(n.label === "Access paused" && eq(n.buttons, ["Restore access:gold", "End access"]), `after pause ${n.label} ${JSON.stringify(n.buttons)}`);
      want(n.invokes === 0, `a function (notification) was invoked: ${n.invokes} (D4)`);
      break;
    case "changed":
      want(n.note === "This changed since you opened it. Here’s where it stands now." && n.noteRole === "alert", `changed note "${n.note}"`);
      want(n.label === "Access paused" && (n.facts ?? []).includes("By Sam Okafor") && n.readsAfterWrite >= 1, `changed did not re-read: ${n.label} ${JSON.stringify(n.facts)}`);
      break;
    case "header-paused": case "header-ended":
      want(n.chip === (s.state === "header-paused" ? "Portal access paused" : "Portal access ended") && n.chipHref === "#client-portal-access", `header chip "${n.chip}" ${n.chipHref}`);
      break;
    case "shared-paused":
      want(/^Paused — Jordan can’t see this right now\./.test(n.sharedNote ?? ""), `shared-with paused line "${n.sharedNote}"`);
      break;
    case "reinvite":
      want(/If they accept, they’ll see your earlier messages and shared work\./.test(n.reinvite ?? ""), `reinvite copy "${n.reinvite}"`);
      // The existing invitation command, for this contact, and usable: the ended contact is no longer linked.
      want(n.manager === 1 && n.review?.disabled === false && !/couldn’t be checked/.test(n.reinvite ?? ""), `reinvite manager ${n.manager} review ${JSON.stringify(n.review)}`);
      // Review 9: the spent joining invitation is not shown as "Latest invitation: accepted" under "Access ended".
      want(!/Latest invitation: accepted/.test(n.reinvite ?? ""), `reinvite shows the spent invitation: "${n.reinvite}"`);
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
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    const pageBg = getComputedStyle(document.body).backgroundColor;
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg) ? "rgb(255,255,255)" : pageBg);
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => {
    const c = getComputedStyle(el).color, p = parse(c), a = (p.length > 3 ? p[3] : 1) * opacityOf(el);
    return a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : c;
  };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden], [aria-hidden='true']");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled, fieldset:disabled");
  const section = document.querySelector(opts.root);
  const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((o) => o.getClientRects().length);
  const roots = [section, ...overlays].filter(Boolean);
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  // A gradient fill (the shared gold Button) has no background-color, so bgOf alone would grade its text
  // against whatever sits behind the button. Grade it against every colour stop and keep the worst.
  const gradientStops = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/gradient\(/.test(cs.backgroundImage)) return cs.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g) ?? [];
      if (!transparent(cs.backgroundColor) && alphaOf(cs.backgroundColor) >= 1) return null;
    }
    return null;
  };
  const contrast = roots.flatMap((root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const stops = gradientStops(n);
    const graded = stops && stops.length ? Math.min(...stops.map((stop) => { const b = blend(stop, bg); return ratio(fgOf(n, b), b); })) : ratio(fgOf(n, bg), bg);
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: graded, need, inactive: inactive(n), size: cs.fontSize, gradient: !!(stops && stops.length) };
  }));
  const graded = contrast.filter((c) => !c.inactive);
  // A switch is a non-text control: its track border/fill must reach 3:1 against what it sits on (WCAG 1.4.11).
  const switches = section ? [...section.querySelectorAll('[role="switch"]')].filter((e) => e.getClientRects().length).map((e) => {
    const cs = getComputedStyle(e), around = bgOf(e.parentElement);
    const edge = !transparent(cs.backgroundColor) ? blend(cs.backgroundColor, around) : cs.borderTopColor;
    return { label: e.getAttribute("aria-label"), state: e.getAttribute("aria-checked"), ratio: ratio(edge, around), disabled: e.disabled };
  }) : [];

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const tokens = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map((t) => getComputedStyle(section ?? document.documentElement).getPropertyValue(t).trim()).filter(Boolean);
  const golds = [...tokens.map((t) => { probe.style.color = t; return getComputedStyle(probe).color; }),
    ...["--accent", "--gold", "--gold-dark"].map((t) => { probe.style.color = `hsl(var(${t}))`; return getComputedStyle(probe).color; })]
    .map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  // The shared gold Button is a gradient (--gradient-gold), so its stops are gold too (compliance r2 gap 5).
  probe.style.backgroundImage = "var(--gradient-gold)";
  const gradientGolds = (getComputedStyle(probe).backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  golds.push(...gradientGolds);
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const gold = roots.flatMap((root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (/gradient\(/.test(cs.backgroundImage) && (cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).some(isGold)) hits.push("gradient");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    // The one act that may carry gold: Restore (data-gold on the card; the panel's own "Restore access"
    // Button, whose gold is a gradient), or the existing invitation command's own act (.opd-primary,
    // "Review invitation") when the card reuses it for Invite again. Gold elsewhere is a defect.
    const act = !!n.closest("[data-gold], .opd-primary") || n.closest("button")?.textContent.trim() === "Restore access";
    return hits.length ? [{ el: n.tagName.toLowerCase(), cls: String(n.className).slice(0, 40), text: n.textContent.trim().slice(0, 30), hits, act }] : [];
  }));

  // Same measurement as the customer drive (portal-progress-customer-mount/progress-drive.mjs hitIn).
  const extendedHit = (n) => {
    const r = n.getBoundingClientRect();
    const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    if (getComputedStyle(n).position === "static") return box;
    const ext = { ...box };
    const cs = getComputedStyle(n), bw = (side) => parseFloat(cs[`border${side}Width`]) || 0;
    const pad = { top: r.top + bw("Top"), bottom: r.bottom - bw("Bottom"), left: r.left + bw("Left"), right: r.right - bw("Right") };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      ext.top = Math.min(ext.top, pad.top + t); ext.bottom = Math.max(ext.bottom, pad.bottom - b);
      ext.left = Math.min(ext.left, pad.left + l); ext.right = Math.max(ext.right, pad.right - rt);
    }
    if (ext.top === box.top && ext.bottom === box.bottom && ext.left === box.left && ext.right === box.right) return box;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const lands = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === n || n.contains(h)); };
    const inView = ext.top >= 0 && ext.bottom <= innerHeight && ext.left >= 0 && ext.right <= innerWidth;
    return inView && lands(cx, ext.top + 0.5) && lands(cx, ext.bottom - 0.5) && lands(ext.left + 0.5, cy) && lands(ext.right - 0.5, cy) ? ext : box;
  };
  // With a modal open, only the modal's controls are reachable; what is behind it is not a target.
  const targetRoots = overlays.length ? overlays : roots;
  const targets = targetRoots.flatMap((root) => [...root.querySelectorAll('a, button, input, select, textarea, [role="switch"]')]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      // A control inside a <label> is hit anywhere on the label: that is its target. Otherwise its own box,
      // plus an absolutely positioned ::before/::after (the sheet's Close reaches 44px this way), counted only
      // when real hit tests at the extension's outer edges land on the control.
      const label = n.closest("label");
      const hit = label ? label.getBoundingClientRect() : extendedHit(n);
      const r = n.getBoundingClientRect();
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(hit.bottom - hit.top), w: Math.round(hit.right - hit.left), drawn: `${Math.round(r.width)}x${Math.round(r.height)}` };
    }));

  const scroller = section?.closest(".trc-record-scroll");
  const platformShell = !!document.querySelector("[data-shell-standin]");
  const clipped = roots.flatMap((root) => [...root.querySelectorAll("h2,h3,p,span,strong,a,button,label")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  const spill = section ? [...section.querySelectorAll(".trc-access-facts > div, .trc-access-actions, .trc-access-confirm, .trc-access-head")].filter((row) => {
    const rr = row.getBoundingClientRect();
    return [...row.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > rr.right + 1);
  }).map((r) => r.textContent.trim().slice(0, 40)) : [];
  return {
    contrastMin: graded.length ? Math.min(...graded.map((c) => c.ratio)) : null,
    low: graded.filter((c) => c.ratio < c.need), switches, lowSwitch: switches.filter((sw) => !sw.disabled && sw.ratio < 3),
    gold, goldActs: document.querySelectorAll("[data-gold], .opd-primary").length, targets, clipped, spill,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false) || (section ? section.scrollWidth > section.clientWidth + 1 : false)
      || overlays.some((o) => o.scrollWidth > o.clientWidth + 1 || o.getBoundingClientRect().right > innerWidth + 1),
    sectionW: section ? Math.round(section.getBoundingClientRect().width) : null,
    font: section ? getComputedStyle(section.querySelector("h3, h1") ?? section).fontFamily : null,
    // Which face actually painted: a declared-and-loaded @font-face for the first family, or the fallback.
    fontLoaded: section ? (() => {
      const el = section.querySelector("h1, h2, h3, h4") ?? section, cs = getComputedStyle(el);
      const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      return [...document.fonts].some((f) => f.status === "loaded" && f.family.replace(/["']/g, "") === family) && document.fonts.check(`${cs.fontWeight} 16px "${family}"`);
    })() : null,
    fontFamily: section ? getComputedStyle(section.querySelector("h1, h2, h3, h4") ?? section).fontFamily.split(",")[0].replace(/["']/g, "").trim() : null,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.bottom <= innerHeight + 1 && getComputedStyle(t).visibility !== "hidden"; })(),
    phone: opts.phone, platformShell,
  };
}


async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-access-${s.surface}-${s.state}${s.tier && s.tier !== "standalone" ? `-${s.tier}` : ""}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "America/New_York", locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(new Date("2026-10-18T16:00:00Z"));
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
    const url = s.surface === "customer"
      ? `http://127.0.0.1:${PORT}/app?${new URLSearchParams({ surface: "customer", state: s.state, theme: s.theme })}`
      : s.surface === "panel" ? `http://127.0.0.1:${PORT}/contact?${new URLSearchParams({ surface: "panel", state: s.state, tier: s.tier, theme: s.theme })}`
        : s.surface === "invite" ? `http://127.0.0.1:${PORT}/join/harness?${new URLSearchParams({ surface: "invite", state: s.state, theme: s.theme })}`
          : s.surface === "portal" ? `http://127.0.0.1:${PORT}/solo/42/clients/portal?${new URLSearchParams({ state: s.state, theme: s.theme })}`
            : `http://127.0.0.1:${PORT}/solo/42/clients/people?${new URLSearchParams({ person: CLIENT, state: s.state, theme: s.theme })}`;
    await page.goto(url, { timeout: 240_000 });
    let driveError = null;
    const drive = { customer: driveCustomer, panel: drivePanel, invite: driveInvite, portal: drivePortal }[s.surface] ?? driveOwner;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    // Judge type in the face that ships: wait for every declared face, then measure and frame (review 1).
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, root: rootFor(s) });
    const allSmall = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    // The Portal dashboard is main's surface (tabs, toolbar, row buttons); this slice changed only its access
    // labels. Its phone targets are reported, not gated, and named as pre-existing in the evidence record.
    const smallTargets = s.surface === "portal" ? [] : allSmall;
    const preexistingSmallTargets = s.surface === "portal" ? allSmall : [];
    const expectations = driveError ? [] : unmet(s, notes);
    // Gold: the customer page carries none; the owner card carries it only on the one Restore act.
    const strayGold = s.surface === "customer" ? m.gold : m.gold.filter((g) => !g.act);
    const goldActsOk = s.surface === "customer" ? m.goldActs === 0 : m.goldActs <= 1;
    const shellLeak = s.surface === "customer" && m.platformShell;
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0
      && !m.overflowX && strayGold.length === 0 && goldActsOk && !shellLeak && m.clipped.length === 0 && m.spill.length === 0 && smallTargets.length === 0 && m.tag
      // A frame judged in a fallback face is not evidence of the design (review 1).
      && m.fontLoaded === true;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok, expectations, surface: s.surface, state: s.state, tier: s.tier ?? null, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, preexistingSmallTargets, strayGold, shellLeak, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), strayGold: strayGold.slice(0, 3), goldActs: m.goldActs, shellLeak,
      overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, sectionW: m.sectionW, font: m.fontFamily, fontLoaded: m.fontLoaded,
      errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
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
      fs.writeFileSync(path.join(out, "e09-access-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (surface, state, kind, theme = "light") => ({ surface, state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("owner", "confirm-pause", "desktop"), caught: (r) => r.strayGold.length > 0 },
      { mutant: "gold-gradient", shot: base("owner", "confirm-pause", "desktop"), caught: (r) => r.strayGold.some((g) => g.hits.includes("gradient")) },
      { mutant: "contrast", shot: base("owner", "joined", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "target", shot: base("owner", "joined", "phone"), caught: (r) => r.smallTargets.length > 0 },
      { mutant: "overflow", shot: base("owner", "paused", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "unconfirmed", shot: base("owner", "paused-done", "desktop"), caught: (r) => r.expectations.some((e) => /no re-read/.test(e)) },
      { mutant: "shell", shot: base("customer", "paused", "desktop"), caught: (r) => !!r.driveError || r.shellLeak },
      { mutant: "font", shot: base("owner", "paused", "desktop"), caught: (r) => r.fontLoaded === false },
    ].filter((c) => !process.env.SELFTEST_ONLY || c.mutant === process.env.SELFTEST_ONLY);
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
    fs.writeFileSync(path.join(out, "e09-access-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
