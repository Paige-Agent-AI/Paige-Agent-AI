// E09 Slice A — render the CUSTOMER portal Agreements page (/app/agreements) inside the real customer chrome, the
// customer home's agreements line (/app), the platform-terms page (/app/agreements/platform and the staff fallback),
// and the FROZEN signing page (/sign/:token) reached from the portal versus from the emailed link — in every state,
// both themes, desktop 1440x900 and phone 390x844 — and MEASURE it: text contrast (AA against the real composited
// background, gradients included), horizontal overflow, gold (the ONLY gold act is the first "Review and sign"),
// touch targets >= 44px on the phone, clipped or spilling text, page errors / failed responses / any request that
// tried to leave the machine (the network is blocked), and that the HARNESS RENDER tag is on screen. It also reads
// the owner-decided behaviour off the rendered page (D-A1..D-A8) and checks it against what each state must show.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). A signed-in customer
// signing a real sent agreement on the deployed app is owed to a capable session.
//
//   node scripts/live-drive/harness/portal-agreements-customer-mount/agreements-drive.mjs [--out dir] [--only substr]
//   node .../agreements-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-agreements-customer");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5251;
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";
const BUSINESS = "Northwind Studio";
const EMAIL_TOKEN = "e".repeat(64);
const PORTAL_TOKEN = "f0".repeat(32);
// Rows and columns the stub holds that the customer must never see (stubs.ts NEVER_SHOWN).
const NEVER = ["Sam's onboarding agreement", "Northwind internal NDA", "Unsent draft retainer", "PRIVATE BODY", "$4,800", "4,800",
  "owner@northwind", "deadbeef", "offer-private", "tenant-agreements/", "Alex Moreno", "token", "sha256",
  // VISIBILITY (integrator default): on the customer's contact, but they are not a counterparty signer on either.
  "Venue hire agreement", "Internal scope sign-off"];
/** "Emailed" is never said: a link the engine records as sent may have been copied and shared another way. */
const HOW_IT_TRAVELLED = /emailed|by email/i;
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const STAFF = ["staff", "staff-error"];
/** Any wording that sends the customer to the emailed link as if it certainly still works (the round-3 finding). */
const EMAIL_PROMISE = /use the link|from the link|Sign each agreement from the link/i;

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const kind of ["desktop", "phone"]) {
      for (const state of ["mixed", "waiting", "signed", "empty", "loading", "multiple", "error", "staff", "staff-error", "others"]) shots.push({ page: "agreements", state, theme, kind });
      shots.push({ page: "agreements", state: "mixed", variant: "opening", query: { open: "pending" }, theme, kind });
      shots.push({ page: "agreements", state: "mixed", variant: "refused-here", query: { open: "here" }, theme, kind });
      shots.push({ page: "agreements", state: "mixed", variant: "refused-later", query: { open: "later" }, theme, kind });
      shots.push({ page: "agreements", state: "mixed", variant: "open-failed", query: { open: "fail" }, theme, kind });
      shots.push({ page: "agreements", state: "signed", variant: "download-busy", query: { copy: "pending" }, theme, kind });
      shots.push({ page: "agreements", state: "signed", variant: "download", theme, kind });
      shots.push({ page: "agreements", state: "signed", variant: "open", theme, kind });
      shots.push({ page: "agreements", state: "signed", variant: "download-failed", query: { copy: "fail" }, theme, kind });
      shots.push({ page: "home", state: "home", theme, kind });
      shots.push({ page: "home", state: "home-none", theme, kind });
      shots.push({ page: "platform", state: "mixed", theme, kind });
    }
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_AGREEMENTS_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const section = "section[aria-labelledby='agreements-title']";
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");
const urlFor = (s) => {
  const q = new URLSearchParams({ state: s.state, theme: s.theme, ...(s.query ?? {}) });
  const p = s.page === "home" ? "/app" : s.page === "platform" ? "/app/agreements/platform" : "/app/agreements";
  return `http://127.0.0.1:${PORT}${p}?${q}`;
};

/** Bring each state to the moment worth framing, through the REAL UI, and read what the owner decided off the page. */
async function drive(page, s, notes) {
  const readList = async () => {
    const root = page.locator(section);
    notes.pageText = clean(await root.innerText());
    notes.leaks = NEVER.filter((t) => notes.pageText.toLowerCase().includes(t.toLowerCase()));
    notes.title = await textOf(root.locator("h1"));
    notes.summary = await textOf(root.locator('[data-testid="agreements-summary"]'));
    notes.groups = await root.locator("section[aria-labelledby^='agreements-']").evaluateAll((secs) => secs.map((sec) => ({
      heading: sec.querySelector("h2")?.textContent.trim(),
      rows: [...sec.querySelectorAll("[data-testid='agreement-row']")].map((r) => `${r.querySelector("h3").textContent.trim()} | ${r.getAttribute("data-state")}`),
    })));
    notes.pills = (await root.locator('[data-testid="agreement-state"]').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())));
    notes.inlineStates = (await root.locator('[data-testid="state-inline"]').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())));
    notes.buttons = (await root.getByRole("button").allInnerTexts()).map(clean);
    notes.links = await root.getByRole("link").evaluateAll((as) => as.map((a) => `${a.textContent.trim().replace(/\s+/g, " ")} -> ${a.getAttribute("href")}`));
    notes.notes = (await root.locator('[data-testid="agreement-note"]').allInnerTexts()).map(clean);
    notes.problem = await textOf(root.locator('[data-testid="agreement-problem"]'));
    notes.replaces = await textOf(root.locator('[data-testid="replaces-email-link"]'));
    notes.engagements = (await root.locator('[data-testid="engagement-title"]').allInnerTexts()).map(clean);
  };
  if (s.page === "home") {
    await page.locator("[data-harness-home] .grid").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    notes.line = await textOf(page.locator('[data-testid="agreements-waiting-line"]'));
    // The Documents tile (Slice 4, on main) renders from its own glance read, as it ships.
    await page.locator('[data-testid="documents-tile"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    notes.documentsTile = await textOf(page.locator('[data-testid="documents-tile"]'));
    notes.lineHref = await page.locator('[data-testid="agreements-waiting-line"]').getAttribute("href").catch(() => null);
    if (notes.line) {
      await page.locator('[data-testid="agreements-waiting-line"]').click();
      await page.locator(section).waitFor({ timeout: 15_000 });
      notes.lineOpens = new URL(page.url()).pathname;
      await page.goBack();
      await page.locator('[data-testid="agreements-waiting-line"]').waitFor({ timeout: 15_000 });
      await page.mouse.move(0, 0);
    }
  } else if (s.page === "platform" || STAFF.includes(s.state)) {
    await page.getByText("Your agreements", { exact: false }).first().waitFor({ timeout: 30_000 });
    await page.getByText("PaigeAgent Terms of Service").first().waitFor({ timeout: 30_000 });
    notes.platformText = clean(await page.locator('[data-harness-region="page"]').innerText());
    notes.customerTitle = await page.locator("#agreements-title").count();
    notes.customerError = await page.getByText("couldn't load your agreements", { exact: false }).count();
  } else if (s.state === "loading") {
    await page.locator('[data-testid="agreements-skeleton"]').waitFor({ state: "attached", timeout: 30_000 });
    // Before the first list comes back nothing says this login is a customer: the shape of a list, no customer
    // header, no customer footer (a staff login briefly saw both before round 4).
    notes.skeleton = await page.locator('[data-testid="agreements-skeleton"]').count();
    notes.customerTitle = await page.locator("#agreements-title").count();
    notes.footer = await page.locator('[data-testid="platform-terms-link"]').count();
  } else if (s.state === "multiple") {
    await page.getByText("Agreements for more than one business aren't available here yet").waitFor({ timeout: 30_000 });
    await readList();
  } else if (s.state === "empty") {
    await page.getByText(`${BUSINESS} hasn't sent you any agreements`).waitFor({ timeout: 30_000 });
    await readList();
  } else {
    await page.locator('[data-testid="agreement-row"]').first().waitFor({ timeout: 30_000 });
    if (s.state === "error") {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator(`${section} [role="alert"]`).first().waitFor({ timeout: 10_000 });
      notes.alert = clean(await page.locator(`${section} [role="alert"]`).first().innerText());
    }
    if (["opening", "refused-here", "refused-later", "open-failed"].includes(s.variant)) {
      await page.locator('[data-testid="review-and-sign"]').first().click();
      if (s.variant === "opening") await page.getByRole("button", { name: "Opening…" }).waitFor({ timeout: 10_000 });
      // The emailed link died after the list loaded: the refusal re-reads the list, and the row itself now says so.
      else if (s.variant === "refused-here") {
        await page.locator('[data-testid="agreement-row"]').filter({ hasText: "Website build agreement" })
          .locator('[data-testid="agreement-note"]').filter({ hasText: "has expired" }).waitFor({ timeout: 10_000 });
      } else await page.locator('[data-testid="agreement-problem"]').waitFor({ timeout: 10_000 });
      notes.problemLinks = await page.locator('[data-testid="agreement-problem"] a').evaluateAll((as) => as.map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`));
      await page.mouse.move(0, 0);
    }
    if (s.variant === "download-busy") {
      await page.locator('[data-testid="download-signed"]').click();
      await page.getByRole("button", { name: "Downloading…" }).waitFor({ timeout: 10_000 });
    }
    if (s.variant === "download") {
      const dl = page.waitForEvent("download", { timeout: 15_000 });
      await page.locator('[data-testid="download-signed"]').click();
      const d = await dl;
      notes.downloadName = d.suggestedFilename();
      const file = path.join(out, `download-${s.theme}-${s.kind}.pdf`);
      await d.saveAs(file);
      notes.downloadHead = fs.readFileSync(file, "utf8").slice(0, 8);
      fs.rmSync(file);
      await page.getByRole("button", { name: "Download signed copy" }).waitFor({ timeout: 10_000 });
    }
    if (s.variant === "open") {
      // "Open": the signed copy in a NEW tab, opened by the click itself (so no pop-up blocker), with no opener.
      const popup = page.context().waitForEvent("page", { timeout: 15_000 });
      await page.locator('[data-testid="open-signed"]').click();
      const tab = await popup;
      await tab.waitForURL(/^blob:/, { timeout: 15_000 });
      notes.openUrl = tab.url().slice(0, 5);
      notes.openOpener = await tab.evaluate(() => window.opener === null);
      notes.openHead = await tab.evaluate(async () => (await (await fetch(location.href)).text()).slice(0, 8)).catch((e) => `fetch failed: ${String(e).slice(0, 80)}`);
      notes.openType = await tab.evaluate(async () => (await (await fetch(location.href)).blob()).type).catch(() => null);
      await tab.close();
      await page.bringToFront();
      await page.locator('[data-testid="open-signed"]').filter({ hasText: /^Open$/ }).waitFor({ timeout: 10_000 });
    }
    if (s.variant === "download-failed") {
      await page.locator('[data-testid="download-signed"]').click();
      await page.locator('[data-testid="agreement-problem"]').waitFor({ timeout: 10_000 });
    }
    await readList();
    if (s.state === "mixed" && !s.variant) {
      // Every "Ask {Business} for a new link" goes to Messages; no suggested words until Messages reads them (Slice 5).
      const ask = page.locator('[data-testid="ask-new-link"], [data-testid="ask-new-link-inline"]');
      notes.askHrefs = await ask.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      await ask.first().click();
      notes.askLanded = await textOf(page.locator("[data-harness-elsewhere]"));
      await page.goBack();
      await page.locator('[data-testid="agreement-row"]').first().waitFor({ timeout: 15_000 });
      await page.mouse.move(0, 0);
    }
  }
  if (!s.phone && s.page !== "platform") {
    notes.nav = await page.locator('[data-harness-region="nav"] nav[aria-label="Customer navigation"]').evaluate((nav) =>
      [...nav.querySelectorAll(":scope > a, :scope > button")].map((el) => el.getAttribute("data-portal-group") ? `[${el.getAttribute("data-portal-group")}]` : el.textContent.trim())).catch(() => null);
  }
  await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
  await page.waitForTimeout(400);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const customerList = s.page === "agreements" && !["loading", ...STAFF].includes(s.state);
  if (customerList) {
    want((n.leaks ?? []).length === 0, `private text on the customer page: ${JSON.stringify(n.leaks)}`);
    want((n.links ?? []).some((l) => l === "PaigeAgent terms you've accepted -> /app/agreements/platform"), `platform-terms link ${JSON.stringify(n.links)}`);
    want(!EMAIL_PROMISE.test(n.pageText ?? ""), `the page sends the customer to the emailed link: "${(n.pageText ?? "").match(EMAIL_PROMISE)?.[0]}"`);
    want(!HOW_IT_TRAVELLED.test(n.pageText ?? ""), `the page says how a link travelled: "${(n.pageText ?? "").match(HOW_IT_TRAVELLED)?.[0]}"`);
    want(!(n.links ?? []).some((l) => /draft=/.test(l)), `a ?draft= link nothing reads yet ${JSON.stringify(n.links)}`);
  }
  if (s.page === "agreements" && !s.phone && ![...STAFF, "multiple"].includes(s.state)) {
    // D-A1: Agreements sits in Paperwork beside Documents for every customer of one business.
    want(eq(n.nav, ["Home", "Messages", "[Your work]", "[Paperwork]", "Resources"]), `customer nav ${JSON.stringify(n.nav)}`);
  }
  // Waiting on THIS customer, by the date that binds: the dead emailed link first (it needs the business), then
  // the two they can sign here. The co-signed agreement is not theirs to count.
  const mixedRows = [
    "Consulting retainer renewal | awaiting_you", "Website build agreement | awaiting_you", "Photo usage release | awaiting_you",
  ];
  if (s.state === "mixed" && s.page === "agreements") {
    want(n.title === `Agreements with ${BUSINESS}`, `title "${n.title}"`);
    want(n.summary === "3 waiting for your signature", `summary "${n.summary}"`);
    want(eq(n.groups?.map((g) => g.heading), ["Waiting for you", "Everything else"]), `groups ${JSON.stringify(n.groups)}`);
    want(eq(n.groups?.[0]?.rows, mixedRows), `waiting rows ${JSON.stringify(n.groups?.[0]?.rows)}`);
    // Whose signature it is: in this list the counterparty is always the customer, so their own words are true.
    want(eq(n.groups?.[1]?.rows?.map((r) => r.split(" | ")[1]), ["signed", "awaiting_signature", "awaiting_business", "awaiting_countersign", "withdrawn", "signed", "declined", "expired"]), `everything-else rows ${JSON.stringify(n.groups?.[1]?.rows)}`);
    // Everything else in the SQL's order: newest of signed-or-sent first.
    // Rows under "Waiting for you" carry no pill: the heading says it once.
    const labels = ["Signed", "Waiting for a signature", `Waiting for ${BUSINESS}`, `Waiting for ${BUSINESS}`, "Withdrawn", "Signed", "Declined", "Expired"];
    want(eq(s.phone ? n.inlineStates.map((t) => t.replace(/\s*·$/, "")) : n.pills, s.phone ? labels.filter((l) => l !== "Signed" && l !== "Expired") : labels), `${s.phone ? "inline states" : "pills"} ${JSON.stringify(s.phone ? n.inlineStates : n.pills)}`);
    // After refused-here the pressed row's emailed link is dead too: one act left.
    want(eq(n.buttons.filter((b) => /Review and sign|Opening…/.test(b)).length, s.variant === "refused-here" ? 1 : 2), `Review and sign buttons ${JSON.stringify(n.buttons)}`);
    want(n.notes.includes(`${BUSINESS} has sent a signing link for this one. If you can't use it, ask ${BUSINESS} for a new link.`), `co-signer note ${JSON.stringify(n.notes)}`);
    want(n.notes.includes(`The signing link ${BUSINESS} sent you has expired.`), `dead-link note ${JSON.stringify(n.notes)}`);
    want(n.notes.includes(`You've signed. It's complete once ${BUSINESS} signs.`), `countersign note ${JSON.stringify(n.notes)}`);
    want(n.notes.includes(`${BUSINESS} withdrew this agreement. There's nothing to sign.`), `withdrawn note ${JSON.stringify(n.notes)}`);
    want(n.notes.includes("The signed copy isn't ready to download yet."), `unsealed note ${JSON.stringify(n.notes)}`);
    want(n.replaces === `Opening an agreement here replaces the signing link ${BUSINESS} sent you.`, `D-A4 note "${n.replaces}"`);
    want(eq(n.engagements, ["For Website build", "For Brand strategy"]), `engagement names ${JSON.stringify(n.engagements)}`);
    if (!s.variant) {
      // Dead emailed link (button), co-signer (inline), expired agreement (button): all to Messages, no ?draft=.
      want(eq(n.askHrefs, ["/app/messages", "/app/messages", "/app/messages"]), `ask hrefs ${JSON.stringify(n.askHrefs)}`);
      want(n.askLanded === "/app/messages", `ask landed "${n.askLanded}"`);
    }
  }
  if (s.variant === "opening") want(n.buttons.includes("Opening…"), `opening ${JSON.stringify(n.buttons)}`);
  if (s.variant === "refused-here") {
    // Said once, by the re-read row — never again as an alert under it (round-4 compliance gap 2).
    want(n.problem === "", `refusal repeated as an alert "${n.problem}"`);
    const dead = `The signing link ${BUSINESS} sent you has expired.`;
    want(n.notes.filter((t) => t === dead).length === 2, `dead-link notes (Consulting + Website) ${JSON.stringify(n.notes)}`);
    want((n.pageText ?? "").split(dead).length - 1 === 2, `the dead-link sentence appears ${(n.pageText ?? "").split(dead).length - 1} times`);
  }
  if (s.state === "others" && s.page === "agreements") {
    want(eq(n.groups?.map((g) => g.heading), ["Waiting for you", "Everything else"]), `others groups ${JSON.stringify(n.groups)}`);
    want(eq(n.groups?.[0]?.rows, ["Coaching package terms | awaiting_you"]), `others waiting ${JSON.stringify(n.groups?.[0]?.rows)}`);
    want(n.summary === "1 waiting for your signature", `others summary "${n.summary}"`);
    want(n.replaces === "", `a "replaces the link sent you" hint with no sent link: "${n.replaces}"`);
    // VISIBILITY: the agreement signed only at another address and the one with no counterparty are not listed.
    want(eq(n.groups?.[1]?.rows, ["Speaker appearance terms | awaiting_earlier_signer", "Joint venture outline | awaiting_others", "Partnership side letter | awaiting_signature"]), `others everything-else ${JSON.stringify(n.groups?.[1]?.rows)}`);
    const wantNotes = [
      "Opening it here gives you a private signing link that works for up to a day.",
      "Someone else signs first. You'll be able to sign once they have.",
      "You've signed. It's complete once everyone else has.",
      `${BUSINESS} hasn't sent you a signing link for this one. If you need one, ask ${BUSINESS} for it.`,
    ];
    want(eq([...n.notes].sort(), [...wantNotes].sort()), `others notes ${JSON.stringify(n.notes)}`);
    // W1: a witness first is never the business; W3: a signed co-signer is never asked to act.
    want(!new RegExp(`${BUSINESS} signs first|has sent a signing link`).test(n.pageText ?? ""), `others credits the business or asks a signed co-signer to act: ${n.pageText}`);
    const othersLabels = ["Waiting for another signer", "Waiting for others", "Waiting for a signature"];
    want(eq(s.phone ? n.inlineStates.map((t) => t.replace(/\s*·$/, "")) : n.pills, othersLabels), `others ${s.phone ? "inline states" : "pills"} ${JSON.stringify(s.phone ? n.inlineStates : n.pills)}`);
    want(eq(n.buttons.filter((b) => /Review and sign/.test(b)).length, 1), `others buttons ${JSON.stringify(n.buttons)}`);
  }
  if (s.variant === "refused-later") {
    want(n.problem === `This agreement has been opened several times in the last hour. Try again in an hour, or ask ${BUSINESS} for a new link.`, `refusal "${n.problem}"`);
    want(eq(n.problemLinks, [`ask ${BUSINESS} for a new link -> /app/messages`]), `refusal link ${JSON.stringify(n.problemLinks)}`);
  }
  if (s.variant === "open-failed") want(n.problem === "We couldn't open this agreement. Check your connection and try again.", `refusal "${n.problem}"`);
  if (s.state === "waiting") {
    want(eq(n.groups?.map((g) => g.heading), ["Waiting for you"]) && n.summary === "1 waiting for your signature", `waiting ${JSON.stringify(n.groups)} "${n.summary}"`);
  }
  if (s.state === "signed" && s.page === "agreements") {
    want(eq(n.groups?.map((g) => g.heading), ["Your agreements"]), `signed groups ${JSON.stringify(n.groups)}`);
    want(n.summary === "Nothing is waiting for your signature.", `signed summary "${n.summary}"`);
    if (!s.variant) want(n.buttons.includes("Download signed copy") && n.buttons.includes("Open"), `signed buttons ${JSON.stringify(n.buttons)}`);
    if (s.variant === "download-busy") want(n.buttons.includes("Downloading…"), `download busy ${JSON.stringify(n.buttons)}`);
    if (s.variant === "open") want(n.openUrl === "blob:" && n.openOpener === true && n.openHead === "%PDF-1.4" && n.openType === "application/pdf", `open ${n.openUrl} opener-null=${n.openOpener} ${n.openHead} ${n.openType}`);
    if (s.variant === "download") want(n.downloadName === "Brand strategy retainer (signed).pdf" && n.downloadHead === "%PDF-1.4", `download ${n.downloadName} ${n.downloadHead}`);
    if (s.variant === "download-failed") want(/couldn't get the signed copy/.test(n.problem), `download failure "${n.problem}"`);
  }
  if (s.state === "empty") want(n.title === `Agreements with ${BUSINESS}` && (n.groups ?? []).length === 0, `empty ${n.title} ${JSON.stringify(n.groups)}`);
  if (s.state === "error") want(/couldn't refresh this list, so it may be out of date/.test(n.alert ?? "") && (n.groups ?? []).length > 0, `error "${n.alert}"`);
  if (s.state === "loading") want(n.skeleton === 1 && n.customerTitle === 0 && n.footer === 0, `loading: skeleton ${n.skeleton}, customer title ${n.customerTitle}, footer ${n.footer}`);
  if (s.page === "platform" || STAFF.includes(s.state)) {
    want(/PaigeAgent Terms of Service/.test(n.platformText ?? "") && n.customerTitle === 0, `platform terms page ${n.platformText?.slice(0, 80)}`);
    want(n.customerError === 0, "a staff login was shown the customer error card");
  }
  if (s.state === "home") want(n.line === "2 agreements waiting for your signature Review" && n.lineHref === "/app/agreements" && n.lineOpens === "/app/agreements", `home line "${n.line}" -> ${n.lineHref} / ${n.lineOpens}`);
  if (s.page === "home") {
    // Home as it ships: the Agreements line AND the Documents tile, from its own read (never "Couldn't check").
    want(/Documents/.test(n.documentsTile ?? "") && /3 files/.test(n.documentsTile ?? "") && new RegExp(`2 shared by ${BUSINESS} · 1 from you`).test(n.documentsTile ?? "")
      && !/Couldn't check/.test(n.documentsTile ?? ""), `documents tile "${n.documentsTile}"`);
  }
  if (s.state === "home-none") want(n.line === "", `home line shown with nothing waiting: "${n.line}"`);
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      let c = getComputedStyle(n).backgroundColor;
      const img = getComputedStyle(n).backgroundImage;
      // A gradient fill (the gold act button) paints no background-color: grade against its LIGHTEST/DARKEST stop
      // whichever is worse, by taking each stop in turn below.
      if (transparent(c) && /gradient/.test(img)) c = (img.match(/rgba?\([^)]*\)|color\([^)]*\)/) ?? [c])[0];
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

  const pageRoot = document.querySelector('[data-harness-region="page"]');
  const homeLine = document.querySelector('[data-testid="agreements-waiting-line"]');
  // Graded: the Agreements page (or, on Home, this slice's line). The platform-terms page is MyAgreements, unchanged
  // (§58): measured and REPORTED, never graded as this slice's surface.
  const graded = opts.page === "home" ? [homeLine].filter(Boolean) : opts.platform ? [] : [document.querySelector("section[aria-labelledby='agreements-title']")].filter(Boolean);
  const reported = opts.platform ? [pageRoot].filter(Boolean) : [];
  const nav = document.querySelector('[data-harness-region="nav"] nav[aria-label="Customer navigation"]');
  const textNodes = (root) => [...root.querySelectorAll("*"), root].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    // Text on a gradient: graded against every stop, the worst one counts.
    const stops = (() => { for (let x = n; x; x = x.parentElement) { const img = getComputedStyle(x).backgroundImage; if (/gradient/.test(img)) return img.match(/rgba?\([^)]*\)/g) ?? []; if (!transparent(getComputedStyle(x).backgroundColor)) return []; } return []; })();
    const worst = stops.length ? Math.min(...stops.map((st) => ratio(fgOf(n, st), st))) : ratio(fgOf(n, bg), bg);
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: worst, need, inactive: inactive(n), size: cs.fontSize };
  });
  const surface = graded.flatMap(contrastFor).filter((c) => !c.inactive);
  const low = surface.filter((c) => c.ratio < c.need);
  const reportedLow = reported.flatMap(contrastFor).filter((c) => !c.inactive && c.ratio < c.need);
  const navLow = nav ? contrastFor(nav).filter((c) => !c.inactive && c.ratio < c.need) : [];

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const golds = ["--accent", "--gold", "--gold-light", "--gold-dark", "--accent-glow"].map((t) => { probe.style.color = `hsl(var(${t}))`; return parse(getComputedStyle(probe).color).slice(0, 3).map(Math.round).join(","); });
  probe.remove();
  const goldHue = (c) => {
    const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return false;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    return h >= 30 && h <= 55 && sat > 0.45 && l > 0.35 && l < 0.85;
  };
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const goldRoots = graded.length ? graded : [];
  const goldHits = goldRoots.flatMap((root) => [root, ...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag]")).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    const stops = /gradient/.test(cs.backgroundImage) ? cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [] : [];
    if (isGold(cs.backgroundColor) || stops.some((c) => isGold(c) || goldHue(c))) hits.push("background");
    if (["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(cs[`border${side}Width`]) > 0 && isGold(cs[`border${side}Color`]))) hits.push("border");
    const act = n.closest("button, a");
    return hits.length ? [{ el: n.tagName.toLowerCase(), text: n.textContent.trim().slice(0, 30), act: act ? act.textContent.trim().slice(0, 40) : null, actEl: act, hits }] : [];
  }));
  const goldActEls = [...new Set(goldHits.filter((g) => g.actEl && (g.hits.includes("background") || g.hits.includes("border"))).map((g) => g.actEl))];
  const goldActs = goldActEls.map((el) => el.textContent.trim());
  const firstSign = document.querySelector('[data-testid="review-and-sign"]');
  // Any gold that is not the first "Review and sign" is a finding.
  const stray = goldHits.filter((g) => !(g.actEl && g.actEl === firstSign)).map(({ actEl: _e, ...g }) => g);

  const targetSel = 'a, button, input, [role="button"]';
  const targetsIn = (root) => [...root.querySelectorAll(targetSel), ...(root.matches?.(targetSel) ? [root] : [])]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => { const r = n.getBoundingClientRect(); return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width) }; });
  const targets = graded.flatMap(targetsIn);

  const clipped = graded.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim()
      // The state pill truncates a long business name by design and carries the full text inline below sm.
      && !n.matches('[data-testid="agreement-state"]'))
    .map((n) => n.textContent.trim().slice(0, 40));
  const spill = graded.flatMap((root) => [...root.querySelectorAll("li, .bg-card")]).filter((card) => {
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > cr.right + 1);
  }).map((c) => c.textContent.trim().slice(0, 40));
  return {
    contrastMin: surface.length ? Math.min(...surface.map((c) => c.ratio)) : null, low, reportedLow, navLow,
    stray, goldActs,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5 || (pageRoot ? pageRoot.scrollWidth > pageRoot.clientWidth + 1 : false),
    clipped, spill, targets,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0; })(),
  };
}

async function newPage(browser, s) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US", acceptDownloads: true,
    ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
  });
  await ctx.clock.setFixedTime(NOW);
  const page = await ctx.newPage();
  const errors = [], blocked = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
    if (u.protocol === "blob:") return route.continue();
    blocked.push(route.request().url().slice(0, 140));
    return route.abort("blockedbyclient");
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, errors, blocked };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-agreements-${s.page}-${s.state}${s.variant ? `-${s.variant}` : ""}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const { ctx, page, errors, blocked } = await newPage(browser, s);
    const notes = {};
    await page.goto(urlFor(s), { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measureInPage, { page: s.page, platform: s.page === "platform" || STAFF.includes(s.state) });
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const expectations = driveError ? [] : unmet(s, notes);
    // The one act: the first "Review and sign", gold, on a page that offers signing; nothing gold anywhere else.
    const signing = s.page === "agreements" && ["mixed", "waiting", "error", "others"].includes(s.state);
    // After "opened too many times" the row's act goes quiet until the list is re-read: no gold at all.
    const wantActs = signing && s.variant !== "refused-later" ? [s.variant === "opening" ? "Opening…" : "Review and sign"] : [];
    if (JSON.stringify(m.goldActs) !== JSON.stringify(wantActs)) expectations.push(`gold acts ${JSON.stringify(m.goldActs)} (want ${JSON.stringify(wantActs)})`);
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0 && !m.overflowX
      && m.stray.length === 0 && m.clipped.length === 0 && m.spill.length === 0 && smallTargets.length === 0 && m.tag;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (s.page === "agreements" && !driveError && !["loading", ...STAFF].includes(s.state)) {
      await page.locator(section).screenshot({ path: path.join(out, `${name}-page.png`) }).catch(() => undefined);
    }
    // The rows below the fold and the footer, as the customer sees them: the page's own scroll container, scrolled
    // a screen at a time (80% steps, so each frame overlaps the last), until every row has been fully in view in at
    // least one frame and the footer shows. A `-page.png` element frame is clipped by the scroller on a phone.
    if (s.page === "agreements" && ["mixed", "others"].includes(s.state) && !s.variant && !driveError) {
      const scroller = () => {
        const root = document.querySelector("section[aria-labelledby='agreements-title']");
        let el = root?.parentElement ?? null;
        while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
        return el ?? document.scrollingElement;
      };
      // The finder runs in the page; it is passed as source because a function cannot cross into page.evaluate.
      const steps = await page.evaluate((src) => {
        const sc = (0, eval)(src)();
        return { max: sc.scrollHeight - sc.clientHeight, view: sc.clientHeight };
      }, `(${scroller})`);
      notes.scroll = steps;
      const seen = new Set();
      const tops = [];
      for (let top = 0; ; top += Math.round(steps.view * 0.8)) { tops.push(Math.min(top, steps.max)); if (top >= steps.max) break; }
      for (const [i, top] of tops.entries()) {
        const inView = await page.evaluate(([src, y]) => {
          const sc = (0, eval)(src)();
          sc.scrollTo({ top: y, behavior: "instant" });
          const box = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
          return [...document.querySelectorAll("[data-testid='agreement-row']")].filter((r) => {
            const b = r.getBoundingClientRect(); return b.top >= box.top - 1 && b.bottom <= Math.min(box.bottom, window.innerHeight) + 1;
          }).map((r) => r.querySelector("h3").textContent.trim());
        }, [`(${scroller})`, top]);
        inView.forEach((t) => seen.add(t));
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, `${name}-scroll${i + 1}.png`) });
      }
      const all = await page.locator("[data-testid='agreement-row'] h3").allInnerTexts();
      notes.scrollFrames = tops.length;
      notes.rowsNeverFullyInView = all.map(clean).filter((t) => !seen.has(t));
      if (notes.rowsNeverFullyInView.length) { expectations.push(`rows never fully in a scroll frame ${JSON.stringify(notes.rowsNeverFullyInView)}`); failed = true; }
      notes.footerInView = await page.locator('[data-testid="platform-terms-link"]').evaluate((a) => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
      if (!notes.footerInView) { expectations.push("footer not in view after scrolling to the bottom"); failed = true; }
    }
    results[name] = { ok: ok && expectations.length === 0, driveError, expectations, errors, blocked, notes, smallTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), reportedLow: m.reportedLow.slice(0, 2), navLow: m.navLow.slice(0, 2),
      goldActs: m.goldActs, stray: m.stray.slice(0, 3), overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, errors: errors.slice(0, 3), blocked: blocked.slice(0, 3), tag: m.tag,
    }));
  }
  return { results, failed };
}

/**
 * The frozen signing page (§28), reached from the portal and from the emailed link. Same agreement, same signer:
 * the page itself only ever sees a token, so the two frames must be the same pixels. Then the emailed link after a
 * portal open: refused, because there is one live link per signer (D-A4) — stated honestly, not hidden.
 */
async function runSigning(browser) {
  const results = {};
  let failed = false;
  for (const kind of ["desktop", "phone"]) {
    const [w, h] = SIZES[kind];
    const s = { theme: "light", kind, w, h, phone: kind === "phone" };
    // A frame is taken only once the page has settled: fonts loaded and two consecutive captures identical (the
    // read-progress bar and web fonts can still be landing at the first capture).
    const shot = async (page, file) => {
      await page.evaluate(() => document.fonts.ready);
      let prev = null;
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(400);
        const buf = await page.screenshot({ fullPage: false });
        if (prev && Buffer.compare(prev, buf) === 0) { fs.writeFileSync(path.join(out, file), buf); return buf; }
        prev = buf;
      }
      fs.writeFileSync(path.join(out, file), prev);
      return prev;
    };
    const ready = async (page) => { await page.locator(".ags-pad, canvas, [class*='ags']").first().waitFor({ timeout: 30_000 }); await page.waitForLoadState("networkidle").catch(() => undefined); };

    const email = await newPage(browser, s);
    await email.page.goto(`http://127.0.0.1:${PORT}/sign/${EMAIL_TOKEN}`);
    let emailError = null, emailPng = null;
    try { await ready(email.page); emailPng = await shot(email.page, `e09-agreements-sign-from-email-${kind}-${w}x${h}.png`); } catch (e) { emailError = String(e).slice(0, 300); }
    await email.ctx.close();

    const portal = await newPage(browser, s);
    let portalError = null, portalPng = null, landed = null, emailAfter = null;
    try {
      await portal.page.goto(`http://127.0.0.1:${PORT}/app/agreements?state=mixed&theme=light`);
      await portal.page.locator('[data-testid="review-and-sign"]').first().click();
      await portal.page.waitForURL(`**/sign/${PORTAL_TOKEN}`, { timeout: 15_000 });
      landed = new URL(portal.page.url()).pathname;
      await ready(portal.page);
      portalPng = await shot(portal.page, `e09-agreements-sign-from-portal-${kind}-${w}x${h}.png`);
      // The emailed link after a portal open: the frozen page refuses it.
      await portal.page.goto(`http://127.0.0.1:${PORT}/sign/${EMAIL_TOKEN}`);
      await portal.page.waitForTimeout(1500);
      emailAfter = clean(await portal.page.locator("body").innerText()).slice(0, 200);
      await shot(portal.page, `e09-agreements-sign-email-after-portal-${kind}-${w}x${h}.png`);
    } catch (e) { portalError = String(e).slice(0, 300); }
    await portal.ctx.close();

    // Byte-identical, or — when headless Chromium's compositing of the hero's gradient and blur jitters — at most
    // 0.05% of pixels differing by at most 16/255 per channel. Both numbers are reported; a content change (a word,
    // a field, a different agreement) moves thousands of pixels by far more.
    let pixelDiff = null;
    if (emailPng && portalPng && Buffer.compare(emailPng, portalPng) !== 0) {
      const probe = await browser.newPage();
      pixelDiff = await probe.evaluate(async ([x, y]) => {
        const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${b64}`; });
        const [ia, ib] = await Promise.all([load(x), load(y)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true };
        const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
        const da = px(ia), db = px(ib);
        let changed = 0, maxDelta = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
          if (d) { changed++; maxDelta = Math.max(maxDelta, d); }
        }
        return { changed, total: da.length / 4, maxDelta };
      }, [emailPng.toString("base64"), portalPng.toString("base64")]);
      await probe.close();
    }
    const identical = !!emailPng && !!portalPng && (pixelDiff === null
      || (!pixelDiff.sizeMismatch && pixelDiff.changed / pixelDiff.total <= 0.0005 && pixelDiff.maxDelta <= 16));
    const refusedAfter = !!emailAfter && !/Website build agreement/.test(emailAfter);
    const ok = !emailError && !portalError && identical && landed === `/sign/${PORTAL_TOKEN}` && refusedAfter
      && email.errors.length === 0 && portal.errors.length === 0 && email.blocked.length === 0 && portal.blocked.length === 0;
    if (!ok) failed = true;
    results[`sign-${kind}`] = { ok, identical, pixelDiff, landed, emailAfter, emailError, portalError, errors: [...email.errors, ...portal.errors], blocked: [...email.blocked, ...portal.blocked] };
    console.log(`e09-agreements-sign-${kind} ${ok ? "OK" : "FAIL"}`, JSON.stringify(results[`sign-${kind}`]));
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
      const sign = only && !"sign".includes(only) ? { results: {}, failed: false } : await runSigning(browser);
      fs.writeFileSync(path.join(out, "e09-agreements-measurements.json"), JSON.stringify({ ...results, ...sign.results }, null, 2));
      exitCode = failed || sign.failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light", extra = {}) => ({ page: "agreements", state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone", ...extra });
    const controls = [
      { mutant: "gold", shot: base("mixed", "desktop"), caught: (r) => r.goldActs.length > 1 || r.stray.length > 0 },
      { mutant: "contrast", shot: base("mixed", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "overflow", shot: base("mixed", "phone"), caught: (r) => r.overflowX === true },
      { mutant: "target", shot: base("mixed", "phone"), caught: (r) => r.smallTargets.length > 0 },
      { mutant: "clip", shot: base("mixed", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "cansign", shot: base("mixed", "desktop"), caught: (r) => r.expectations.some((e) => /Review and sign buttons|gold acts/.test(e)) },
      { mutant: "dedupe", shot: base("mixed", "desktop", "light", { variant: "refused-here", query: { open: "here" } }), caught: (r) => r.expectations.some((e) => /refusal repeated|sentence appears/.test(e)) },
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
    fs.writeFileSync(path.join(out, "e09-agreements-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
