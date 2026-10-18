// E09 Slice 5 — render the CUSTOMER portal "Payments" page (/app/billing), one invoice's page
// (/app/billing/:id) and the customer home's Payments line (/app), in every state, both themes, desktop and
// phone, and MEASURE it: text contrast (AA against the real composited background), horizontal overflow, gold
// (allowed ONLY on the invoice page's Pay link), touch targets >= 44px on the phone, clipped text, page errors /
// failed responses / any request that tried to leave the machine (the network is blocked), and that the HARNESS
// RENDER tag is on screen. It also reads the owner-decided behaviour off the rendered page: the customer sees
// only invoices the business issued to them; Pay appears only when the business sent a link and opens exactly
// that link in a new tab with no opener; no processor is named; the customer-facing name is Payments.
// The chrome is the REAL Slice M AppNav: the drive reaches Payments through its Paperwork group (desktop menu opened
// by keyboard and by pointer; phone drawer), frames the menu open, presses Payments and the Home line, and checks the
// group stays the active entry on every Payments page. Every frame waits for document.fonts.ready.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts) and no payment link
// is ever opened. The signed-in customer portal on the deployed app, against a seeded test-mode invoice, is owed.
//
//   node scripts/live-drive/harness/portal-payments-customer-mount/payments-drive.mjs [--out dir] [--only substr]
//   node .../payments-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-payments-customer");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5245;
// A fixed clock and zone so every date and past-due mark is reproducible frame to frame.
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";
const BUSINESS = "Northwind Studio";
const IDS = {
  payable: "e0950000-0000-4000-9000-000000000107", partial: "e0950000-0000-4000-9000-000000000104",
  paid: "e0950000-0000-4000-9000-000000000101", void: "e0950000-0000-4000-9000-000000000098",
  expired: "e0950000-0000-4000-9000-000000000095",
};
// Rows the stub holds that the customer must never see (stubs.ts NEVER), plus internals and processor names.
const NEVER = ["INV-0110", "CSV-", "INV-0090", "INV-9001", "Internal memo", "acct_TEST", "Stripe", "PayPal", "cs_test", "Billing"];

const LIST_STATES = ["populated", "empty", "loading", "unavailable", "multiple", "error", "hasmore", "paidup", "test", "test-settled", "mixed-settled"];
const INVOICE_SHOTS = [
  { invoice: "payable", state: "populated" }, { invoice: "partial", state: "populated" },
  { invoice: "void", state: "populated", doc: true }, { invoice: "expired", state: "populated" }, { invoice: "payable", state: "test" },
  { invoice: "payable", state: "doc-error" }, { invoice: "payable", state: "pay-error" },
  // Round 2: a test-mode link, an invoice a test payment settled, a read that refuses an invoice the list still
  // shows as owed, and a request sent through a processor this page cannot open.
  { invoice: "payable", state: "testlink" }, { invoice: "paid", state: "test-settled", doc: true },
  { invoice: "payable", state: "pay-unavailable" }, { invoice: "payable", state: "other-processor" },
  // Round 3: the document's own payment section framed for live, test-only and mixed money; a part payment
  // that landed with money still owed (live and test mode); a test-mode payment in flight with no link.
  { invoice: "paid", state: "populated", doc: true }, { invoice: "paid", state: "mixed-settled", doc: true },
  { invoice: "payable", state: "part-settled" }, { invoice: "payable", state: "part-settled-test" }, { invoice: "payable", state: "inflight-test" },
  // Round 4: the void invoice above also frames its document's balance section (doc: true): nothing is owed there either.
  // Round 5: documents whose business-recorded payments were corrected: fully (issued and void) and in part.
  { invoice: "payable", state: "corrected", doc: true }, { invoice: "partial", state: "corrected", doc: true }, { invoice: "void", state: "corrected", doc: true },
];
const ASK_DRAFT = "Could you send me a payment link for invoice INV-0104?";
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const kind of ["desktop", "phone"]) {
      for (const state of LIST_STATES) shots.push({ page: "list", state, theme, kind });
      for (const s of INVOICE_SHOTS) shots.push({ page: "invoice", ...s, theme, kind });
      for (const state of ["populated", "home-empty"]) shots.push({ page: "home", state, theme, kind, home: true });
      // From an invoice with no link, through Ask, into the real Messages composer.
      shots.push({ page: "ask", invoice: "partial", state: "populated", theme, kind });
      // The customer reaching Payments through the REAL grouped menu (Slice M): from Home, open Paperwork (desktop
      // menu / phone drawer), framed open, then choose Payments; and on an invoice, the menu open with Payments current.
      shots.push({ page: "nav", from: "home", state: "populated", theme, kind, home: true });
      shots.push({ page: "nav", from: "invoice", invoice: "payable", state: "populated", theme, kind });
    }
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}
const pathOf = (s) => (s.page === "home" || (s.page === "nav" && s.from === "home") ? "/app" : s.page === "list" ? "/app/billing" : `/app/billing/${IDS[s.invoice]}`);
const nameOf = (s, label = "") => `e09-payments-${s.page}${s.from ? `-from-${s.from}` : ""}${s.invoice ? `-${s.invoice}` : ""}-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
const NAV = '[data-harness-region="nav"] nav[aria-label="Customer navigation"]';
const DRAWER = '[role="dialog"] nav[aria-label="Customer navigation"]';
// The Paperwork group as a customer of one business with a generic catalog sees it (Agreements is not client-live).
const PAPERWORK = ["Documents|/app/documents|Files shared with you", "Payments|/app/billing|Invoices and receipts"];

/** The desktop bar: each top-level entry, a group trigger as [Name] (with * when it carries the active state). */
async function readBar(page) {
  return page.locator(NAV).locator(":scope > a, :scope > button").evaluateAll((els) => els.map((e) => (e.dataset.portalGroup
    ? `[${e.dataset.portalGroup}]${e.dataset.active === "true" ? "*" : ""}`
    : `${e.textContent.trim()}|${e.getAttribute("href")}${e.getAttribute("aria-current") === "page" ? "*" : ""}`)));
}

/** The open desktop group menu: name|href|description, * when it is the current page. */
async function readMenu(page) {
  return page.locator('[role="menu"] [role="menuitem"]').evaluateAll((els) => els.map((e) => {
    const label = e.querySelector("[data-portal-label]")?.textContent.trim() ?? "";
    const desc = e.querySelector("[data-portal-label] + span")?.textContent.trim() ?? "";
    return `${label}|${e.getAttribute("href")}|${desc}${e.getAttribute("aria-current") === "page" ? "*" : ""}`;
  }));
}
const DOC_FRAME = "section[aria-labelledby='invoice-title'] iframe";

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_PAYMENTS_MUTANT: mutant ?? "" },
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
const LIST = "section[aria-labelledby='payments-title']";
const INVOICE = "section[aria-labelledby='invoice-title']";

/** Bring each state to the moment worth framing, through the REAL UI, and read what it shows. */
async function drive(page, s, notes) {
  const root = s.page === "list" ? LIST : INVOICE;
  const read = async () => {
    const r = page.locator(s.page === "home" ? "[data-harness-home]" : root);
    notes.pageText = clean(await r.innerText());
    notes.leaks = NEVER.filter((t) => notes.pageText.includes(t));
    notes.links = await r.getByRole("link").evaluateAll((as) => as.map((a) => `${a.textContent.trim().replace(/\s+/g, " ")} -> ${a.getAttribute("href")}`));
    notes.buttons = (await r.getByRole("button").allInnerTexts()).map(clean);
  };
  if (s.page === "nav") {
    // The page under the menu first, so the frame shows a settled page, then the menu itself.
    if (s.from === "home") await page.locator('[data-testid="payments-balance-line"]').waitFor({ timeout: 30_000 });
    else await page.locator('[data-testid="payment-payable"]').waitFor({ timeout: 30_000 });
    if (s.phone) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.locator(DRAWER).waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
      notes.drawer = await page.locator(DRAWER).locator("[data-portal-heading], button").evaluateAll((els) => els.map((e) => (e.hasAttribute("data-portal-heading")
        ? `# ${e.textContent.trim()}` : `${e.textContent.trim().replace(/\s+/g, " ")}${e.getAttribute("aria-current") === "page" ? "*" : ""}`)));
      notes.paperworkGroup = await page.locator(DRAWER).locator('[role="group"]').evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll("[data-portal-heading], button")].map((e) => e.textContent.trim())));
    } else {
      await page.locator(NAV).waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
      notes.bar = await readBar(page);
      // Opened from the keyboard first, as a keyboard user would, read, closed with Escape.
      const trigger = page.locator(`${NAV} button[data-portal-group="Paperwork"]`);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      notes.menuKeyboard = await readMenu(page);
      notes.firstFocused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
      await page.keyboard.press("Escape");
      await page.locator('[role="menu"]').waitFor({ state: "detached", timeout: 10_000 });
      notes.focusReturned = await trigger.evaluate((el) => document.activeElement === el);
      // Then opened by pointer and framed open.
      await trigger.click();
      await page.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      notes.menu = await readMenu(page);
      notes.otherGroups = await page.locator(`${NAV} button[data-portal-group]`).evaluateAll((bs) => bs.map((b) => b.dataset.portalGroup));
    }
    await page.waitForTimeout(400);
    notes.pageText = clean(await page.locator(s.phone ? DRAWER : '[role="menu"]').innerText());
    return;
  }
  if (s.page === "ask") {
    // The customer has no link, asks for one, and lands in their conversation with suggested words.
    await page.locator('[data-testid="ask-payment-link"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="ask-payment-link"]').click();
    await page.waitForURL(/\/app\/messages/, { timeout: 15_000 });
    const field = page.locator("[data-harness-region='page'] textarea");
    await field.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !!document.querySelector("[data-harness-region='page'] textarea")?.value, null, { timeout: 15_000 });
    await page.waitForTimeout(300);
    notes.composer = await field.inputValue();
    notes.focused = await field.evaluate((el) => document.activeElement === el);
    notes.url = await page.evaluate(() => `${location.pathname}${location.search}`);
    notes.sendsBefore = await page.evaluate(() => window.__harnessSends.length);
    const r = page.locator("[data-harness-region='page']");
    notes.pageText = clean(await r.innerText());
    notes.leaks = NEVER.filter((t) => notes.pageText.includes(t));
    // Framed here, with the suggestion in the composer; the send itself happens after the frame (see runShots).
  } else if (s.page === "home") {
    await page.locator("[data-harness-home] .bg-card").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    notes.line = await textOf(page.locator('[data-testid="payments-balance-line"]'));
    notes.lineHref = await page.locator('[data-testid="payments-balance-line"]').getAttribute("href").catch(() => null);
    notes.lineFirst = await page.evaluate(() => document.querySelector("[data-harness-home]")?.firstElementChild?.getAttribute("data-testid") ?? null);
    // The line's own geometry: the amount leads, the past-due count never splits, and on a phone the link
    // sits under the words instead of squeezing them.
    notes.lineLayout = await page.evaluate(() => {
      const line = document.querySelector('[data-testid="payments-balance-line"]');
      if (!line) return null;
      const owed = line.querySelector('[data-testid="payments-balance-owed"]');
      const past = line.querySelector('[data-testid="payments-balance-past-due"]');
      const view = [...line.querySelectorAll("span")].find((x) => x.textContent.trim() === "View payments");
      const words = owed?.parentElement;
      return {
        owedWeight: owed ? Number(getComputedStyle(owed).fontWeight) : null,
        firstText: words?.textContent.trim().slice(0, 12) ?? null,
        pastRects: past ? past.getClientRects().length : null,
        viewBelow: view && words ? view.getBoundingClientRect().top >= words.getBoundingClientRect().bottom - 1 : null,
      };
    });
    await read();
  } else if (s.page === "list") {
    await page.getByRole("heading", { name: "Payments", exact: true, level: 1 }).waitFor({ timeout: 30_000 });
    if (s.state === "loading") {
      await page.locator('[data-testid="payments-skeleton"]').waitFor({ state: "attached", timeout: 30_000 });
      notes.busy = await page.locator(LIST).getAttribute("aria-busy");
    } else if (["populated", "error", "hasmore", "paidup", "test", "test-settled", "mixed-settled"].includes(s.state)) {
      await page.locator('[data-testid="invoice-row"]').first().waitFor({ timeout: 30_000 });
      if (s.state === "error") {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.locator(`${LIST} [role="alert"]`).waitFor({ timeout: 10_000 });
        notes.alert = clean(await page.locator(`${LIST} [role="alert"]`).innerText());
      }
      if (s.state === "hasmore") {
        notes.moreLine = await textOf(page.locator(LIST).getByText(/^Showing \d+ of \d+ invoices/));
        notes.rowsBefore = await page.locator('[data-testid="invoice-row"]').count();
        await page.getByRole("button", { name: "Show older invoices" }).click();
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid="invoice-row"]').length > n, notes.rowsBefore, { timeout: 10_000 });
        notes.rowsAfter = await page.locator('[data-testid="invoice-row"]').count();
        notes.moreAfter = await page.getByRole("button", { name: "Show older invoices" }).count();
      }
      notes.summary = await textOf(page.locator('[data-testid="payments-summary"]'));
      notes.rows = await page.locator('[data-testid="invoice-row"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      notes.pills = (await page.locator('[data-testid="invoice-status"]').allInnerTexts()).map(clean);
      notes.ready = await page.locator('[data-testid="invoice-pay-ready"]').count();
    } else {
      await page.locator(`${LIST} h3`).first().waitFor({ timeout: 30_000 });
    }
    await read();
  } else {
    await page.locator(INVOICE).waitFor({ timeout: 30_000 });
    const panelReady = s.state === "doc-error" ? '[data-testid="payment-panel"]'
      : s.invoice === "paid" ? (["test-settled", "mixed-settled"].includes(s.state) ? '[data-testid="payment-test-settled"]' : '[data-testid="payment-paid"]') : s.invoice === "void" ? '[data-testid="payment-void"]'
        : s.state === "pay-error" ? `${INVOICE} [role="alert"]` : s.state === "pay-unavailable" ? '[data-testid="payment-unavailable"]'
          : '[data-testid="payment-payable"], [data-testid="payment-no-link"], [data-testid="payment-request-state"], [data-testid="payment-part-settled"]';
    await page.locator(panelReady).first().waitFor({ timeout: 30_000 });
    if (s.state === "doc-error") await page.getByText("We couldn't open the invoice document.").waitFor({ timeout: 15_000 });
    else await page.locator(`${INVOICE} iframe`).waitFor({ timeout: 15_000 });
    notes.title = await textOf(page.locator(`${INVOICE} h1`));
    notes.subline = await textOf(page.locator(`${INVOICE} header p`));
    notes.panel = await textOf(page.locator('[data-testid="payment-panel"]'));
    const pay = page.locator('[data-testid="pay-now"]');
    notes.pay = (await pay.count()) ? await pay.evaluate((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent.trim() })) : null;
    notes.ask = await page.locator('[data-testid="ask-payment-link"]').getAttribute("href").catch(() => null);
    notes.testLink = await textOf(page.locator('[data-testid="test-link"]'));
    notes.testRequest = await textOf(page.locator('[data-testid="test-request"]'));
    notes.caution = await textOf(page.locator('[data-testid="test-caution"]'));
    if (s.doc) {
      // The issued document's own payment section, as the sandboxed frame shows it (read, never scripted).
      await page.waitForFunction((sel) => !!document.querySelector(sel)?.contentDocument?.querySelector("section.activity"), DOC_FRAME, { timeout: 15_000 });
      notes.docPayment = await page.locator(DOC_FRAME).evaluate((f) => ["section.balance", "section.activity"]
        .map((q) => f.contentDocument?.querySelector(q)?.innerText ?? "").join(" | ").replace(/\s+/g, " ").trim());
    }
    notes.frameDoc = (await page.locator(`${INVOICE} iframe`).count())
      ? await page.locator(`${INVOICE} iframe`).evaluate((f) => ({ sandbox: f.getAttribute("sandbox"), has: (f.getAttribute("srcdoc") ?? "").slice(0, 4000), height: f.getBoundingClientRect().height }))
      : null;
    await read();
  }
  await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => { notes.navStillLoading = true; });
  // The grouped bar (Slice M) as it stands on this page: Payments lives in Paperwork, so the bar shows the group.
  if (!s.phone && !s.home) notes.bar = await readBar(page);
  await page.waitForTimeout(400);
}

/** What each state must show, checked against what the drive read off the page. */
function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (s.state !== "loading") want((n.leaks ?? []).length === 0, `hidden, internal or processor text on the page: ${JSON.stringify(n.leaks)}`);
  if (!s.phone && !s.home && s.page !== "nav") {
    // Payments sits in Paperwork, never on the bar itself; on every Payments page (list and invoice) the group is the
    // active entry and nothing else is. A viewer who is not a customer of one business has neither.
    const bar = n.bar ?? [];
    const customer = !["unavailable", "multiple"].includes(s.state);
    const paperwork = bar.filter((x) => x.startsWith("[Paperwork]"));
    want(!bar.some((x) => x.includes("|/app/billing")), `Payments on the bar instead of in Paperwork: ${JSON.stringify(bar)}`);
    want(!bar.some((x) => /Billing/.test(x)), "the nav says Billing");
    if (customer && s.page !== "ask") want(eq(paperwork, ["[Paperwork]*"]) && bar.filter((x) => x.endsWith("*")).length === 1, `Paperwork not the one active entry on a Payments page: ${JSON.stringify(bar)}`);
    if (!customer) want(paperwork.length === 0, `Paperwork offered to a non-customer: ${JSON.stringify(bar)}`);
  }
  if (s.page === "nav") {
    want(!/Billing/.test(n.pageText ?? ""), `the menu says Billing: "${n.pageText}"`);
    if (s.phone) {
      const d = n.drawer ?? [];
      const group = (n.paperworkGroup ?? []).find((g) => g[0] === "Paperwork") ?? [];
      want(eq(group, ["Paperwork", "Documents", "Payments"]), `Paperwork group in the drawer ${JSON.stringify(n.paperworkGroup)}`);
      const current = d.filter((x) => x.endsWith("*"));
      want(eq(current, [s.from === "home" ? "Home*" : "Payments*"]), `current drawer entry ${JSON.stringify(current)} in ${JSON.stringify(d)}`);
      want(d.filter((x) => x.replace("*", "") === "Payments").length === 1, `Payments in the drawer ${JSON.stringify(d)}`);
    } else {
      const bar = n.bar ?? [];
      want(eq(bar.filter((x) => x.startsWith("[Paperwork]")), [s.from === "home" ? "[Paperwork]" : "[Paperwork]*"]), `Paperwork trigger ${JSON.stringify(bar)}`);
      want(!bar.some((x) => x.includes("|/app/billing")), `Payments on the bar instead of in Paperwork: ${JSON.stringify(bar)}`);
      const want_menu = PAPERWORK.map((x) => (s.from === "invoice" && x.startsWith("Payments|") ? `${x}*` : x));
      want(eq(n.menuKeyboard, want_menu) && eq(n.menu, want_menu), `Paperwork menu ${JSON.stringify(n.menu)} (keyboard ${JSON.stringify(n.menuKeyboard)})`);
      want(n.firstFocused === "menuitem" && n.focusReturned === true, `keyboard: first focus ${n.firstFocused}, focus back on the trigger ${n.focusReturned}`);
    }
    if (s.from === "home" && n.landed !== undefined) {
      // Choosing Payments lands on the Payments page with the menu closed and its group now the active entry.
      const l = n.landed;
      want(l.path === "/app/billing" && l.heading === true && l.closed === true, `choosing Payments ${JSON.stringify(l)}`);
      if (!s.phone) want(eq((l.bar ?? []).filter((x) => x.endsWith("*")), ["[Paperwork]*"]), `after choosing Payments the bar ${JSON.stringify(l.bar)}`);
    }
  }
  if (s.page === "list") {
    if (s.state === "populated") {
      want(n.summary === "$2,950.00 due across 3 open invoices 1 past due", `summary "${n.summary}"`);
      want(eq(n.pills, ["Open", "Past due", "Paid", "Voided", "Open"]), `pills ${JSON.stringify(n.pills)}`);
      want(n.ready === 1, `ready-to-pay rows ${n.ready}`);
      want((n.rows ?? [])[1]?.includes("$900.00 due") && (n.rows ?? [])[1]?.includes("of $2,400.00"), `partial row "${(n.rows ?? [])[1]}"`);
      want((n.links ?? []).includes(`Message ${BUSINESS} -> /app/messages?topic=payments`), `footer link ${JSON.stringify(n.links)}`);
      want(/processed by Northwind Studio's payment provider/.test(n.pageText ?? ""), "footer provider line missing");
    }
    if (s.state === "paidup") want(/You're all paid up with Northwind Studio\./.test(n.summary ?? ""), `paid-up "${n.summary}"`);
    if (s.state === "test") {
      want(/Includes a test payment\. The test payment moved no money\./.test(n.summary ?? ""), `test caution "${n.summary}"`);
      // Test money alone never makes an invoice "Partially paid".
      want((n.pills ?? [])[0] === "Open", `test-only part-settled pill "${(n.pills ?? [])[0]}"`);
    }
    if (s.state === "test-settled") {
      want(/Settled by a test payment\. No money moved\./.test(n.summary ?? "") && !/paid up/.test(n.summary ?? ""), `test-settled summary "${n.summary}"`);
      want(eq(n.pills, ["Test payment", "Voided"]), `test-settled pills ${JSON.stringify(n.pills)}`);
    }
    if (s.state === "mixed-settled") {
      // Live money paid part of it; the pill follows the live money, with a quiet note about the test part.
      want(eq(n.pills, ["Partially paid", "Voided"]), `mixed pills ${JSON.stringify(n.pills)}`);
      want(/Includes a test payment$/.test((n.rows ?? [])[0] ?? "") && !/\$0\.00 due/.test((n.rows ?? [])[0] ?? ""), `mixed row "${(n.rows ?? [])[0]}"`);
      want(/Includes a test payment\. The test payment moved no money\./.test(n.summary ?? ""), `mixed summary "${n.summary}"`);
    }
    if (s.state === "empty") {
      want(/Northwind Studio hasn't sent you any invoices/.test(n.pageText ?? ""), "empty copy");
      want(eq(n.links, [`Message ${BUSINESS} -> /app/messages?topic=payments`]), `empty links ${JSON.stringify(n.links)}`);
    }
    if (s.state === "unavailable") want(/Payments isn't available on this account/.test(n.pageText ?? ""), "unavailable copy");
    if (s.state === "multiple") want(/Payments for more than one business isn't available yet/.test(n.pageText ?? ""), "multiple copy");
    if (s.state === "loading") want(n.busy === "true", "loading section not aria-busy");
    if (s.state === "error") {
      want(/couldn't refresh your invoices/.test(n.alert ?? "") && /Try again/.test(n.alert ?? ""), `error alert "${n.alert}"`);
      want((n.rows ?? []).length === 5, "the list was dropped when the refresh failed");
    }
    if (s.state === "hasmore") {
      want(n.moreLine === "Showing 20 of 29 invoices.", `more line "${n.moreLine}"`);
      want(n.rowsBefore === 20 && n.rowsAfter === 29 && n.moreAfter === 0, `paging ${n.rowsBefore} -> ${n.rowsAfter}, more button ${n.moreAfter}`);
    }
  }
  if (s.page === "invoice") {
    const pay = n.pay;
    const payable = s.invoice === "payable" && !["pay-error", "pay-unavailable", "other-processor", "part-settled", "part-settled-test", "inflight-test"].includes(s.state);
    if (payable) {
      want(!!pay && pay.target === "_blank" && pay.rel.split(" ").sort().join(" ") === "noopener noreferrer" && /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_harness_107$/.test(pay.href ?? ""), `pay link ${JSON.stringify(pay)}`);
      want(pay?.text === (s.state === "test" ? "Pay $1,000.00" : "Pay $1,250.00"), `pay text "${pay?.text}"`);
      // The amount is said once as what is due and once on Pay; the request sentence only when it differs.
      want(!/has requested a payment of/.test(n.panel ?? ""), `amount restated "${n.panel}"`);
      want(s.state === "testlink" ? n.testLink === "Test link: no money will move" : n.testLink === "", `test-link note "${n.testLink}"`);
    } else {
      want(!pay, `Pay offered where the business sent no usable link: ${JSON.stringify(pay)}`);
    }
    if (s.state !== "doc-error") want(!!n.frameDoc && n.frameDoc.sandbox === "allow-same-origin allow-modals" && n.frameDoc.has.includes("Brand identity sprint") && n.frameDoc.height > 300, `document ${JSON.stringify(n.frameDoc && { ...n.frameDoc, has: n.frameDoc.has.length })}`);
    if (s.invoice === "partial") {
      want(/\$900\.00 due/.test(n.panel ?? "") && /of \$2,400\.00/.test(n.panel ?? "") && /^Past due · Issued/.test(n.subline ?? ""), `partial panel "${n.panel}" subline "${n.subline}"`);
      want(n.ask === `/app/messages?${new URLSearchParams({ topic: "payments", draft: "Could you send me a payment link for invoice INV-0104?" })}`, `ask link ${n.ask}`);
    }
    if (s.invoice === "paid" && !["test-settled", "mixed-settled"].includes(s.state)) want(/Paid in full/.test(n.panel ?? "") && /Confirmed by Northwind Studio's payment provider\./.test(n.panel ?? ""), `paid panel "${n.panel}"`);
    if (s.state === "test-settled") want(/Settled by a test payment\. No money moved\./.test(n.panel ?? "") && !/Paid in full|Confirmed by|payment provider/.test(n.panel ?? "") && !/^Paid/.test(n.subline ?? ""), `test-settled panel "${n.panel}" subline "${n.subline}"`);
    if (s.state === "pay-unavailable") want(/This invoice isn't available to pay here right now\./.test(n.panel ?? "") && !/voided|nothing is owed/i.test(n.panel ?? ""), `unavailable panel "${n.panel}"`);
    if (s.state === "other-processor") want(/Northwind Studio hasn't sent a link you can pay from here\./.test(n.panel ?? "") && !/no longer available/.test(n.panel ?? "") && !!n.ask, `other-processor panel "${n.panel}" ask=${n.ask}`);
    if (s.invoice === "void") want(/This invoice was voided\. Nothing is owed\./.test(n.panel ?? ""), `void panel "${n.panel}"`);
    if (s.invoice === "expired") want(/This payment request has expired/.test(n.panel ?? "") && !!n.ask, `expired panel "${n.panel}" ask=${n.ask}`);
    if (s.state === "test" && s.page === "invoice") want(n.caution === "Includes a test payment of $250.00. The test payment moved no money.", `test caution "${n.caution}"`);
    if (s.state === "mixed-settled") want(/Settled, partly by a test payment\./.test(n.panel ?? "") && /Confirmed by Northwind Studio's payment provider\. The test payment moved no money\./.test(n.panel ?? "") && /^Partially paid/.test(n.subline ?? ""), `mixed panel "${n.panel}" subline "${n.subline}"`);
    if (s.state === "part-settled" || s.state === "part-settled-test") {
      const test = s.state === "part-settled-test";
      want(/\$750\.00 due/.test(n.panel ?? "") && !/updates once the payment is confirmed/.test(n.panel ?? "") && !!n.ask, `part-settled panel "${n.panel}" ask=${n.ask}`);
      want(test ? /Your test payment of \$500\.00 went through\. The test payment moved no money\./.test(n.panel ?? "") && (n.panel.match(/moved no money/g) ?? []).length === 1 && !/was confirmed|Payment confirmed/.test(n.panel)
        : /Your payment of \$500\.00 was confirmed\./.test(n.panel ?? "") && !/test/i.test(n.panel ?? ""), `part-settled wording "${n.panel}"`);
    }
    if (s.state === "inflight-test") want(n.testRequest === "Test payment: no money will move" && /updates once the payment is confirmed/.test(n.panel ?? ""), `in-flight test "${n.testRequest}" panel "${n.panel}"`);
    if (s.doc) {
      const d = n.docPayment ?? "";
      want(!/stripe|paypal/i.test(d), `the document names the processor: "${d}"`);
      if (s.state === "test-settled") want(/Settled by a test payment \(no money moved\)/.test(d) && /Test payment No money moved/.test(d) && /Test payments \(no money moved\): \$600\.00/.test(d) && !/Paid \(|Provider-confirmed|Payment confirmed/.test(d)
        && !/business|Manually recorded|corrections/i.test(d), `document payment section (test) "${d}"`);
      if (s.state === "mixed-settled") want(/Partially paid \(the rest settled by a test payment that moved no money\)/.test(d) && /Provider-confirmed payments: \$400\.00/.test(d) && /Test payments \(no money moved\): \$200\.00/.test(d) && /Payment confirmed/.test(d) && /Test payment No money moved/.test(d) && !/\bPaid\b/.test(d), `document payment section (mixed) "${d}"`);
      if (s.invoice === "paid" && s.state === "populated") want(/Paid \(provider-confirmed\)/.test(d) && /Provider-confirmed payments: \$600\.00/.test(d) && /Provider-confirmed payment/.test(d) && !/Test payment|no money moved/.test(d), `document payment section (live) "${d}"`);
      // Round 4: a voided invoice's document owes nothing: no outstanding figure and no outstanding equation.
      if (s.invoice === "void") want(/Nothing owed: this invoice was voided\./.test(d) && /Voided/.test(d) && !/outstanding/i.test(d) && !/\$400\.00/.test(d), `document payment section (void) "${d}"`);
      // Round 5: a corrected payment is never "no payments"; business-recorded money has one name and its totals say they are after corrections.
      if (s.state === "corrected") {
        const full = s.invoice !== "partial";
        want(!/no payments|Manually recorded/i.test(d) && /Payment recorded/.test(d) && /Payment correction \/ reversal/.test(d)
          && (full ? /Recorded payments were corrected; nothing counts toward this invoice\./.test(d) && (s.invoice === "void" || /\$1250\.00 USD/.test(d))
            : /Business-recorded payments: \$1500\.00 USD\./.test(d) && /Totals are after corrections\./.test(d) && /\$900\.00 USD/.test(d)),
        `document payment section (corrected) "${d}"`);
      }
      // Checked once the frame has been scrolled (runShots sets it after the main frames).
      if (n.docInView !== undefined) want(n.docInView === true, `document payment section not brought into view ${JSON.stringify(n.docInView)}`);
    }
    if (s.state === "doc-error") want(/We couldn't open the invoice document\./.test(n.pageText ?? ""), "doc error copy");
    if (s.state === "pay-error") want(/We couldn't check for a payment link\./.test(n.panel ?? ""), `pay error "${n.panel}"`);
    want(n.title === `Invoice ${{ payable: "INV-0107", partial: "INV-0104", paid: "INV-0101", void: "INV-0098", expired: "INV-0095" }[s.invoice]}`, `title "${n.title}"`);
  }
  if (s.page === "ask") {
    want(n.composer === ASK_DRAFT, `composer "${n.composer}"`);
    want(n.focused === true, "the suggested draft is not focused");
    const u = new URL(n.url ?? "/", "http://x.test");
    want(u.pathname === "/app/messages" && !u.searchParams.has("draft"), `draft still in the address: ${n.url}`);
    want(n.sendsBefore === 0, `sent before the customer pressed Send: ${n.sendsBefore}`);
    want(Array.isArray(n.sent) && n.sent.length === 1 && n.sent[0].body === ASK_DRAFT, `sent after Send ${JSON.stringify(n.sent)}`);
  }
  if (s.page === "home") {
    if (s.state === "populated") {
      want(n.line === "$2,950.00 due · 3 open invoices from Northwind Studio · 1 past due View payments", `home line "${n.line}"`);
      const l = n.lineLayout ?? {};
      want(l.owedWeight >= 600 && l.firstText?.startsWith("$2,950.00") && l.pastRects === 1, `home line emphasis/nowrap ${JSON.stringify(l)}`);
      if (s.phone) want(l.viewBelow === true, `View payments not under the words on a phone ${JSON.stringify(l)}`);
      want(n.lineHref === "/app/billing" && n.lineFirst === "payments-balance-line", `home line href ${n.lineHref} first=${n.lineFirst}`);
      // Pressed after the frame (runShots): the line takes the customer to Payments.
      const pressed = n.lineLanded;
      if (pressed !== undefined) want(pressed.path === "/app/billing" && pressed.heading === true, `pressing the Home line ${JSON.stringify(pressed)}`);
    } else {
      want(n.line === "", `home line shown with nothing owed: "${n.line}"`);
    }
    want(!/\bcoach(ed|es|ing)?\b/i.test(n.pageText ?? ""), "the home says coach (§2)");
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

  // On the home frames only the Payments line is this slice's; it is graded, the rest reported.
  const homeTiles = opts.home ? [...document.querySelectorAll('[data-harness-home] [data-testid="payments-balance-line"]')] : [];
  const pageRoots = opts.home ? homeTiles : [document.querySelector('[data-harness-region="page"]')].filter(Boolean);
  const wholePage = document.querySelector('[data-harness-region="page"]');
  const nav = document.querySelector('[data-harness-region="nav"] > div');
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  // A gradient fill (the gold Pay link) has no background-color: read its colour stops and grade the text
  // against the WORST stop, so a gradient can never pass on the page colour behind it.
  const gradientStops = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const img = getComputedStyle(n).backgroundImage;
      if (img && img.includes("gradient")) return img.match(/rgba?\([^)]+\)|color\([^)]+\)/g) ?? [];
      if (!transparent(getComputedStyle(n).backgroundColor)) return [];
    }
    return [];
  };
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    // AA: 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const stops = gradientStops(n).map((c) => blend(c, bg));
    const r = stops.length ? Math.min(...stops.map((stop) => ratio(fgOf(n, stop), stop))) : ratio(fgOf(n, bg), bg);
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: r, need, inactive: inactive(n), size: cs.fontSize, gradient: stops.length > 0 };
  });
  // An open group menu (desktop) or drawer (phone) is portalled out of the bar. Payments' own place in it is graded
  // as this slice's surface: the whole desktop Paperwork menu, or the drawer's Paperwork group. The rest of the
  // drawer (brand header, the other groups, Get help, Account, Settings, Sign Out) is the shipped, frozen menu:
  // measured and REPORTED as chrome findings, never silently passed, not graded as this slice's.
  const dialog = opts.navOpen ? document.querySelector('[role="dialog"]') : null;
  const paperworkGroup = dialog ? [...dialog.querySelectorAll('[role="group"]')].find((g) => g.querySelector("[data-portal-heading]")?.textContent.trim() === "Paperwork") : null;
  const menus = opts.navOpen ? [document.querySelector('[role="menu"]'), paperworkGroup].filter(Boolean) : [];
  const drawerChrome = dialog ? [dialog] : [];
  const pageContrast = pageRoots.flatMap(contrastFor);
  const navContrast = nav ? contrastFor(nav) : [];
  const menuContrast = menus.flatMap(contrastFor);
  const drawerContrast = drawerChrome.flatMap(contrastFor);
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
  // Gold is allowed on exactly one control: the invoice page's Pay link. Hits inside it are reported, never failed.
  const goldIn = (root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag]") && !n.closest('[data-testid="pay-now"]')).flatMap((n) => {
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
  const targets = [...pageRoots.flatMap((r) => targetsIn(r, "page")), ...(nav ? targetsIn(nav, "nav") : []), ...menus.flatMap((r) => targetsIn(r, "menu")),
    ...drawerChrome.flatMap((r) => targetsIn(r, "drawer"))];

  const sectionEl = opts.home ? null : document.querySelector("section[aria-labelledby='payments-title'], section[aria-labelledby='invoice-title']");
  const clipRoots = [...(opts.home ? homeTiles : [sectionEl].filter(Boolean)), ...menus];
  const clipped = clipRoots.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  // Text that spills past its card's right edge (a row that will not wrap).
  const spill = clipRoots.flatMap((root) => [...root.querySelectorAll("li, .bg-card, [data-testid='invoice-row']")]).filter((card) => {
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > cr.right + 1);
  }).map((c) => c.textContent.trim().slice(0, 40));

  const h1 = sectionEl?.querySelector("h1");
  return {
    heading: h1?.textContent ?? null,
    font: h1 ? getComputedStyle(h1).fontFamily : getComputedStyle(document.body).fontFamily,
    contrastMin: min(pageContrast), lowPage: low(pageContrast),
    navContrastMin: min(navContrast), lowNav: low(navContrast),
    menuOpen: menus.length, menuContrastMin: opts.navOpen ? min(menuContrast) : undefined, lowMenu: low(menuContrast), goldMenu: menus.flatMap(goldIn),
    drawerContrastMin: dialog ? min(drawerContrast) : undefined, lowDrawer: low(drawerContrast), goldDrawer: drawerChrome.flatMap(goldIn),
    clippedDrawer: drawerChrome.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
      .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim() && !paperworkGroup?.contains(n))
      .map((n) => n.textContent.trim().slice(0, 40)),
    wholePageContrastMin: opts.home ? min(wholeContrast) : undefined, lowWholePage: opts.home ? low(wholeContrast) : undefined,
    goldPage: pageRoots.flatMap(goldIn),
    payGold: (() => { const p = document.querySelector('[data-testid="pay-now"]'); return p ? getComputedStyle(p).backgroundImage.includes("gradient") : null; })(), goldNav: nav ? goldIn(nav) : [], goldWholePage: opts.home && wholePage ? goldIn(wholePage) : undefined,
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
    const name = nameOf(s, label);
    if (only && !name.includes(only)) continue;
    // A renderer that crashes under machine load is retried once in a fresh context; a second crash fails the shot.
    let attempt = 0;
    for (;;) {
      try { if (await shotOnce(s, name)) failed = true; break; } catch (e) {
        if (++attempt >= 2 || !/Target crashed|Page crashed|Target page, context or browser has been closed/.test(String(e))) throw e;
        console.log(`${name} RETRY after ${String(e).slice(0, 80)}`);
      }
    }
  }
  return { results, failed };

  async function shotOnce(s, name) {
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
    // Playwright's fixed clock injects an init script into every frame, and the document frame's sandbox (no
    // allow-scripts, by design) refuses it. That refusal is the sandbox working, not a page error; it is not recorded.
    page.on("console", (m) => { if (m.type() === "error" && !/Blocked script execution in 'about:srcdoc'/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}${pathOf(s)}?${new URLSearchParams({ state: s.state, theme: s.theme })}`, { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    // Nothing is measured or framed until document.fonts.ready has settled. Which requested face actually renders is
    // MEASURED (a canvas width against two fallbacks), not assumed: the app declares no @font-face for its body and
    // heading faces, so a face renders only where the machine has it installed. Reported per frame.
    notes.fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const first = (el) => getComputedStyle(el).fontFamily.split(",")[0].trim().replace(/["']/g, "");
      const families = [...new Set([document.body, document.querySelector("h1")].filter(Boolean).map(first))];
      const ctx = document.createElement("canvas").getContext("2d");
      const width = (font) => { ctx.font = font; return ctx.measureText("Payments $1,250.00 Paperwork Ag").width; };
      const renders = (f) => ["monospace", "serif"].some((fb) => width(`16px "${f}", ${fb}`) !== width(`16px ${fb}`));
      return { status: document.fonts.status, families, renders: Object.fromEntries(families.map((f) => [f, renders(f)])) };
    });
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, home: !!s.home, navOpen: s.page === "nav" });
    const small = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const smallTargets = small.filter((t) => !t.inline);
    const inlineTargets = small.filter((t) => t.inline);
    // The Ask step's frame is the composer with the suggestion in it; the send happens after it is framed.
    if (s.page === "ask" && !driveError) {
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      try {
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForFunction(() => window.__harnessSends.length > 0, null, { timeout: 10_000 });
        notes.sent = await page.evaluate(() => window.__harnessSends);
      } catch (e) { driveError = `send: ${String(e).slice(0, 300)}`; }
    }
    const expectations = driveError ? [] : unmet(s, notes);
    // The home's empty state renders no line at all; there is nothing of this slice's to grade there.
    const homeOk = !s.home || m.homeTiles >= (s.state === "populated" ? 1 : 0);
    if (notes.fonts?.status !== "loaded") expectations.push(`fonts not settled before the frame ${JSON.stringify(notes.fonts)}`);
    const menuOk = s.page !== "nav" || (m.menuOpen === 1 && m.lowMenu.length === 0 && m.goldMenu.length === 0 && smallTargets.filter((t) => t.region === "menu").length === 0);
    let surfaceOk = !driveError && expectations.length === 0 && menuOk && errors.length === 0 && blocked.length === 0 && m.lowPage.length === 0 && !m.overflowX
      && m.goldPage.length === 0 && (notes.pay ? m.payGold === true : true) && m.clipped.length === 0 && m.spill.length === 0
      && smallTargets.filter((t) => t.region === "page").length === 0 && m.tag && homeOk;
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav" || t.region === "drawer").length === 0
      && m.lowDrawer.length === 0 && m.goldDrawer.length === 0 && m.clippedDrawer.length === 0;

    if (s.page !== "ask") await page.screenshot({ path: path.join(out, `${name}.png`) });
    // After the frame: the Home line and the menu are pressed, and where they land is read off the page.
    const landing = async () => {
      await page.waitForURL(/\/app\/billing$/, { timeout: 15_000 });
      const heading = await page.getByRole("heading", { name: "Payments", exact: true, level: 1 }).waitFor({ timeout: 30_000 }).then(() => true, () => false);
      return { path: await page.evaluate(() => location.pathname), heading };
    };
    if (!driveError && s.page === "home" && s.state === "populated") {
      try {
        await page.locator('[data-testid="payments-balance-line"]').click();
        notes.lineLanded = await landing();
      } catch (e) { notes.lineLanded = { error: String(e).slice(0, 200) }; }
    }
    if (!driveError && s.page === "nav" && s.from === "home") {
      try {
        if (s.phone) await page.locator(DRAWER).getByRole("button", { name: "Payments", exact: true }).click();
        else await page.locator('[role="menu"]').getByRole("menuitem", { name: /^Payments/ }).click();
        const where = await landing();
        const closed = await page.locator(s.phone ? '[role="dialog"]' : '[role="menu"]').waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
        notes.landed = { ...where, closed, ...(s.phone ? {} : { bar: await readBar(page) }) };
      } catch (e) { notes.landed = { error: String(e).slice(0, 200) }; }
    }
    if (!driveError && ((s.page === "home" && s.state === "populated") || (s.page === "nav" && s.from === "home"))) {
      const late = unmet(s, notes).filter((e) => !expectations.includes(e));
      if (late.length) { expectations.push(...late); surfaceOk = false; }
    }
    if (!["home", "ask", "nav"].includes(s.page)) await page.locator('[data-harness-region="page"]').screenshot({ path: path.join(out, `${name}-page.png`) }).catch(() => undefined);
    if (s.doc && !driveError) {
      // Scroll the page's own scroller until the document's payment section sits near the top, and frame it.
      notes.docInView = await page.evaluate((sel) => {
        const f = document.querySelector(sel), sec = f?.contentDocument?.querySelector("section.balance");
        const scroller = document.querySelector('[data-harness-region="page"]');
        if (!f || !sec || !scroller) return false;
        scroller.scrollTop += f.getBoundingClientRect().top + sec.getBoundingClientRect().top - 72;
        const top = f.getBoundingClientRect().top + sec.getBoundingClientRect().top;
        return top >= 0 && top < innerHeight - 120;
      }, DOC_FRAME);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `${name}-doc.png`) });
      const docMiss = unmet(s, notes).filter((e) => !expectations.includes(e));
      if (docMiss.length) { expectations.push(...docMiss); surfaceOk = false; }
    }
    results[name] = { ok: surfaceOk, chromeOk, expectations, page: s.page, invoice: s.invoice ?? null, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, inlineTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${surfaceOk ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), navMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 3),
      ...(s.page === "nav" ? { menuMin: m.menuContrastMin, lowMenu: m.lowMenu.slice(0, 3), goldMenu: m.goldMenu.slice(0, 3), menuTargets: smallTargets.filter((t) => t.region === "menu"),
        drawerMin: m.drawerContrastMin, lowDrawer: m.lowDrawer.slice(0, 3), goldDrawer: m.goldDrawer.slice(0, 3), clippedDrawer: m.clippedDrawer } : {}),
      fonts: notes.fonts,
      goldPage: m.goldPage.slice(0, 3), payGold: m.payGold, goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`),
      overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, inlineTargets, errors: errors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
    }));
    return !surfaceOk;
  }
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
let exitCode = 0;
try {
  if (!selftest) {
    const vite = await startVite(null);
    try {
      const { results, failed } = await runShots(browser, allShots());
      // A partial (--only) run updates its own frames in the record and keeps the rest.
      const file = path.join(out, "e09-payments-measurements.json");
      const prior = only && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
      fs.writeFileSync(file, JSON.stringify({ ...prior, ...results }, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    // Negative controls: each defect is injected by the harness's own vite transform (no product file edited) and
    // the drive MUST report it through the named check. A control that passes means the drive is blind to it.
    const base = (pageKind, state, kind, extra = {}) => ({ page: pageKind, state, theme: "light", kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone", ...extra });
    const controls = [
      { mutant: "gold", shot: base("list", "populated", "desktop"), caught: (r) => r.goldPage.length > 0 },
      { mutant: "contrast", shot: { ...base("list", "populated", "desktop"), theme: "dark" }, caught: (r) => r.lowPage.length > 0 },
      { mutant: "overflow", shot: base("list", "populated", "phone"), caught: (r) => r.overflowX === true },
      { mutant: "target", shot: base("list", "empty", "phone"), caught: (r) => r.smallTargets.some((t) => t.region === "page") },
      { mutant: "clip", shot: base("list", "populated", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "opener", shot: base("invoice", "populated", "desktop", { invoice: "payable" }), caught: (r) => r.expectations.some((e) => /pay link/.test(e)) },
      { mutant: "paywithout", shot: base("invoice", "populated", "desktop", { invoice: "partial" }), caught: (r) => r.expectations.some((e) => /Pay offered/.test(e)) },
      { mutant: "draftkept", shot: base("ask", "populated", "desktop", { invoice: "partial" }), caught: (r) => r.expectations.some((e) => /draft still in the address/.test(e)) },
      // Round 3: the issued document tells a test receipt as money received (the renderer ignores the environment).
      { mutant: "doclabel", shot: base("invoice", "test-settled", "desktop", { invoice: "paid", doc: true }), caught: (r) => r.expectations.some((e) => /document (payment section|names the processor)/.test(e)) },
      // Round 4: the issued document of a voided invoice tells the customer the full amount is still outstanding.
      { mutant: "docvoid", shot: base("invoice", "populated", "desktop", { invoice: "void", doc: true }), caught: (r) => r.expectations.some((e) => /document payment section \(void\)/.test(e)) },
      // Round 5: the document says "No payments recorded." beside a payment that was recorded and corrected.
      { mutant: "doccorrected", shot: base("invoice", "corrected", "desktop", { invoice: "void", doc: true }), caught: (r) => r.expectations.some((e) => /document payment section \(corrected\)/.test(e)) },
      // The Slice M menu: the catalog name back ("Billing"), Payments filed outside Paperwork, an invoice that no
      // longer keeps the group active, and the current drawer entry spent in gold.
      { mutant: "navlabel", shot: base("nav", "populated", "desktop", { from: "home", home: true }), caught: (r) => r.expectations.some((e) => /Paperwork menu|says Billing/.test(e)) },
      { mutant: "navgroup", shot: base("nav", "populated", "phone", { from: "home", home: true }), caught: (r) => r.expectations.some((e) => /Paperwork group in the drawer/.test(e)) },
      { mutant: "navactive", shot: base("invoice", "populated", "desktop", { invoice: "payable" }), caught: (r) => r.expectations.some((e) => /Paperwork not the one active entry/.test(e)) },
      { mutant: "navgold", shot: base("nav", "populated", "phone", { from: "invoice", invoice: "payable" }), caught: (r) => r.goldMenu.length > 0 },
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
    fs.writeFileSync(path.join(out, "e09-payments-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
