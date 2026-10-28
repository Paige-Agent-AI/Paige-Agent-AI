import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENTION_TEXT } from "../../../supabase/functions/_shared/client-engagement/labels";
import {effectiveStandingFixture} from "../../__tests__/fixtures/exp04-effective-standing-source";

// Experience 04 E4-S3 PR beta (Track D): where one client stands, on that client's Solo record —
// read through the SAME governed read and composer PAIGE answers from, so the page and the chat can
// never describe one client two ways. The fixture is the real SQL output (exp04 SQL proof).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = JSON.parse(readFileSync("src/__tests__/fixtures/exp04-client-status-source.json", "utf8"));
const TENANT = source.tenant_id as string, CLIENT = source.contact_id as string;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: TENANT, activeUserId: "e0400000-0000-4000-8000-000000000001", accountContextStatus: "ready", accountContextLoading: false }) }));
import { ClientStanding } from "./ClientStanding";

const reply = (patch: Record<string, unknown> = {}) => ({ data: { ...structuredClone(source), receipt_id: undefined, ...patch }, error: null });
let host: HTMLDivElement, root: Root;
beforeEach(() => { rpc.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (openPaige = vi.fn()) => {
  await act(async () => root.render(<MemoryRouter><ClientStanding contactId={CLIENT} clientName="Test Consulting Client" account="42" openPaige={openPaige} /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
};
const row = (label: string) => [...host.querySelectorAll(".trc-standing-row")].find(r => r.querySelector(".trc-standing-label")?.textContent === label) as HTMLElement | undefined;
const dd = (term: string) => [...host.querySelectorAll(".trc-standing-money > div")].find(d => d.querySelector("dt")?.textContent === term)?.querySelector("dd");
const hrefs = () => [...host.querySelectorAll("a")].map(a => [a.textContent, a.getAttribute("href")]);

function reviewedReply(phase = "accepted") {
  const f = effectiveStandingFixture(), e = f.accepted;
  const submitted = phase !== "not_submitted";
  const released = ["accepted", "revision_requested", "awaiting_client"].includes(phase);
  const decided = ["accepted", "revision_requested", "internal_revision_requested"].includes(phase);
  const delivery = { schema_version: 1, state: "verified", tenant_id: f.source.tenant_id,
    client_id: f.source.contact_id, commercial_terms_id: f.t.id,
    signing_id: e.signing_id, signing_version: e.signing_version,
    content_sha256: e.document_sha256, sealed_sha256: e.sealed_sha256,
    plan_id: "e4850000-0000-4000-8000-000000000001", coverage_complete: true, has_more: false,
    milestone_count: 1, items: [{ work_item_id: f.source.work.items[0].id, phase,
      submission_id: submitted ? "e4850000-0000-4000-8000-000000000002" : null,
      submission_revision: submitted ? 2 : null, artifact_digest: submitted ? "d".repeat(64) : null,
      release_id: released ? "e4850000-0000-4000-8000-000000000003" : null,
      decision_at: decided ? "2026-10-20T00:30:00Z" : null }] };
  Object.assign(f.t, { reviewed_delivery: delivery });
  return { ...f, delivery };
}

describe("ClientStanding", () => {
  it("lets the owner inspect the original exact-version client decision without closing the engagement", async () => {
    const f = reviewedReply(); rpc.mockResolvedValue({ data: f.source, error: null }); await render();
    const delivery = row("Delivery")!;
    expect(delivery.textContent).toContain("1 of 1 reviewed milestones accepted by the client");
    expect(delivery.textContent).toContain("Engagement completion still needs review");
    const details = delivery.querySelector("details")!;
    expect(details).not.toBeNull(); expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Review 1 delivery decision");
    act(() => (details.querySelector("summary") as HTMLElement).click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain(f.source.work.items[0].title);
    expect(details.textContent).toContain("Submission revision 2");
    expect(details.textContent).toContain("Client accepted");
    expect(details.textContent).not.toContain(f.delivery.items[0].release_id);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(delivery.querySelector("a")?.getAttribute("href")).toBe("/solo/42/operations/work");
  });
  it.each([
    ["not_submitted", "Not submitted"], ["internal_review", "Internal review"],
    ["internal_revision_requested", "Internal revision requested"], ["not_released", "Ready for client release"],
    ["awaiting_client", "Awaiting client decision"], ["revision_requested", "Client revision requested"],
  ])("keeps the original %s state distinct in the decision disclosure", async (phase, label) => {
    const f = reviewedReply(phase); rpc.mockResolvedValue({ data: f.source, error: null }); await render();
    const details = row("Delivery")?.querySelector("details");
    expect(details?.textContent).toContain(label);
    expect(details?.textContent).not.toContain("Client accepted");
    if (phase === "not_submitted") expect(details?.textContent).not.toContain("Version");
  });
  it.each(["not_linked", "scope_changed", "unavailable"])("shows the %s reason without invented decisions", async state => {
    const f = reviewedReply(); f.delivery.state = state;
    rpc.mockResolvedValue({ data: f.source, error: null }); await render();
    const delivery = row("Delivery")!;
    const reason = { not_linked: "No reviewed delivery plan is linked", scope_changed: "The delivery scope changed", unavailable: "delivery evidence needs verification" }[state];
    expect(delivery.textContent).toContain(reason);
    expect(delivery.querySelector("details")).toBeNull();
    expect(delivery.textContent).not.toContain("0 of");
  });
  it("uses the business date for a decision near midnight", async () => {
    const f = reviewedReply(); f.source.business_time_zone = { state: "configured", zone: "America/New_York" };
    rpc.mockResolvedValue({ data: f.source, error: null }); await render();
    expect(row("Delivery")?.querySelector("details")?.textContent).toContain("Decision Oct 19, 2026");
  });
  it("withholds decision dates when the business zone is missing", async () => {
    const f = reviewedReply(); f.source.business_time_zone = { state: "missing", zone: null }; f.source.as_of_date = null;
    rpc.mockResolvedValue({ data: f.source, error: null }); await render();
    const text = row("Delivery")?.querySelector("details")?.textContent;
    expect(text).toContain("Decision date not shown until the business time zone is set");
    expect(text).not.toContain("Oct 20");
  });
  it("shows the accepted revision separately from the later working draft", async () => {
    const {source:changed}=effectiveStandingFixture();rpc.mockResolvedValue({data:changed,error:null});await render();
    expect(row("Agreement")?.textContent).toContain("Accepted revision 1 · Working draft revision 2 differs");
    expect(row("Agreement")?.textContent).toContain("$3,500.00 accepted");
    expect(dd("Overdue")?.textContent).toBe("$320.00");
  });
  it("does not call an exact original signing outside the title list untitled", async () => {
    const {source:changed,accepted}=effectiveStandingFixture();changed.signings=[];changed.signings_has_more=true;
    rpc.mockResolvedValue({data:changed,error:null});await render();
    expect(row("Agreement")?.textContent).toContain("Original signed agreement");
    expect(row("Agreement")?.textContent).not.toContain("Untitled agreement");
    expect(row("Agreement")?.querySelector('a')?.getAttribute('href')).toBe(`/solo/42/sales/agreements?agreement=${accepted.signing_id}`);
  });
  it.each([0,3])("does not equate %i done work records with accepted service", async done => {
    const work={...structuredClone(source.work),total:3,done,open:0,cancelled:3-done,blocked:0,overdue:0,undated_open:0};
    work.items=work.items.map((item: Record<string,unknown>)=>({...item,status:done===3?"done":"cancelled"}));
    rpc.mockResolvedValue(reply({work}));await render();
    expect(row("Delivery")?.textContent).toContain("Nothing open");
    expect(row("Delivery")?.textContent).toContain(`${done} of 3 done`);
    expect(row("Delivery")?.textContent).toContain("Client acceptance is not shown here.");
  });
  it("explains an invoice revision mismatch while preserving balances and original navigation", async () => {
    const changed=structuredClone(source);changed.terms[0].collection_terms_version=2;
    rpc.mockResolvedValue({data:{...changed,receipt_id:undefined},error:null});await render();
    expect(dd("Outstanding")?.textContent).toBe("$3,020.00");
    expect(dd("Paid · verified by your payment provider")?.textContent).toBe("$100.00");
    expect(dd("Recorded by you · not provider-verified")?.textContent).toBe("$500.00");
    expect(dd("Overdue")?.textContent).toContain("Not known");
    expect(dd("Overdue")?.textContent).toContain("Invoice and plan versions differ");
    expect(host.textContent).toContain(ATTENTION_TEXT.invoice_terms_version_mismatch);
    expect(hrefs()).toContainEqual(["Open terms & agreements","/solo/42/sales/agreements"]);
  });
  it("reads one client through the governed read, once, and headlines where they stand", async () => {
    rpc.mockResolvedValue(reply()); await render();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("read_client_engagement_status", { _expected_tenant_id: TENANT, _contact_id: CLIENT });
    expect(host.querySelector("#client-standing h3")?.textContent).toBe("Where Test Consulting Client stands");
    expect(host.textContent).toContain("Checked");
  });
  it("keeps the signature's state apart from the engagement's, in the Sales words", async () => {
    rpc.mockResolvedValue(reply()); await render();
    const agreement = row("Agreement")!;
    expect(agreement.querySelector(".trc-standing-state")?.textContent).toBe("Completed"); // never "Signed"
    expect(agreement.textContent).toContain("Terms: Active");
    expect(agreement.textContent).toContain("Test consulting agreement");
  });
  it("keeps provider-verified and owner-recorded money apart, and test money out of both", async () => {
    rpc.mockResolvedValue(reply()); await render();
    expect(dd("Paid · verified by your payment provider")?.textContent).toBe("$100.00");
    expect(dd("Recorded by you · not provider-verified")?.textContent).toBe("$500.00");
    expect(dd("Outstanding")?.textContent).toBe("$3,020.00");
    expect(dd("Overdue")?.textContent).toBe("$320.00");
    expect(row("Money")?.querySelector(".trc-standing-state")?.textContent).toBe("Overdue");
    expect(host.querySelector(".trc-standing-test")?.textContent).toContain("Test payments (not real money): $300.00");
  });
  it("payment requests in flight are never counted as paid", async () => {
    rpc.mockResolvedValue(reply()); await render();
    const requests = host.querySelector(".trc-standing-requests")?.textContent ?? "";
    expect(requests).toContain("$200.00 awaiting payment provider confirmation — not received");
    expect(requests).toContain("1 payment with an unknown outcome");
    expect(requests).toContain("1 failed payment request");
  });
  it("a total that cannot be added up says why, never $0.00", async () => {
    const mixed = structuredClone(source); mixed.invoices.find((i: { invoice_number: string }) => i.invoice_number === "E4-0002").currency = "eur";
    rpc.mockResolvedValue({ data: { ...mixed, receipt_id: undefined }, error: null }); await render();
    expect(dd("Outstanding")?.textContent).toContain("Not known");
    expect(dd("Outstanding")?.textContent).toContain("More than one currency, so not added up");
    expect(host.querySelector(".trc-standing-money")?.textContent).not.toContain("$0.00");
  });
  it("without a business time zone, overdue is On hold — never an amount — and links to the one setting", async () => {
    rpc.mockResolvedValue(reply({ business_time_zone: { state: "missing", zone: null }, as_of_date: null })); await render();
    expect(dd("Overdue")?.textContent).toContain("On hold until the business time zone is set");
    expect(dd("Overdue")?.textContent).not.toMatch(/\$/);
    expect(row("Money")?.querySelector(".trc-standing-state")?.textContent).toBe("On hold");
    expect(hrefs()).toContainEqual(["Open business time zone setting", "/solo/42/settings/setup/business-profile#business-time-zone"]);
  });
  it("links only through the shared route map and frozen labels", async () => {
    rpc.mockResolvedValue(reply()); await render();
    const links = hrefs();
    expect(links).toContainEqual(["Open terms & agreements", `/solo/42/sales/agreements?agreement=${source.signings[0].id}`]);
    expect(links).toContainEqual(["Open invoices", "/solo/42/sales/payments?view=invoices"]);
    expect(links).toContainEqual(["Open collections", "/solo/42/sales/payments?view=collections"]);
    expect(links).toContainEqual(["Open delivery work", "/solo/42/operations/work"]);
  });
  it("opens the one complete managed invoice using the same reference as PAIGE", async () => {
    const single = { ...source.invoices[0], status: 'issued' };
    rpc.mockResolvedValue(reply({ invoices: [single], invoices_has_more: false })); await render();
    expect(hrefs()).toContainEqual(["Open invoice", `/solo/42/sales/payments?view=invoices&invoice=${single.id}`]);
    expect(hrefs()).not.toContainEqual(["Open invoices", "/solo/42/sales/payments?view=invoices"]);
  });
  it("delivery says how far along it is and what is next", async () => {
    rpc.mockResolvedValue(reply()); await render();
    const delivery = row("Delivery")!;
    expect(delivery.querySelector(".trc-standing-state")?.textContent).toBe("Behind");
    expect(delivery.textContent).toContain("1 of 3 done");
    expect(delivery.textContent).toContain("Next: Draft discovery report");
  });
  it("next steps are the same sentences PAIGE says, at most three, then 'Show N more' reveals the rest in place, and PAIGE is one click away", async () => {
    const ask = vi.fn(); rpc.mockResolvedValue(reply()); await render(ask);
    const items = [...host.querySelectorAll(".trc-standing-next li")].map(li => li.querySelector("span")?.textContent);
    expect(items).toEqual([ATTENTION_TEXT.payment_overdue, ATTENTION_TEXT.behind_schedule, ATTENTION_TEXT.payment_outcome_unknown]);
    const more = [...host.querySelectorAll("button")].find(b => b.textContent === "Show 2 more") as HTMLButtonElement;
    expect(more).toBeDefined();
    more.focus();
    await act(async () => more.click());
    expect(host.querySelectorAll(".trc-standing-next li").length).toBe(5);
    // The control stays mounted as a toggle, so keyboard focus is never dropped to <body>.
    expect(document.activeElement).toBe(more);
    expect(more.textContent).toBe("Show fewer");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await act(async () => ([...host.querySelectorAll("button")].find(b => b.textContent === "Ask PAIGE about Test Consulting Client") as HTMLButtonElement).click());
    expect(ask).toHaveBeenCalledOnce();
  });
  it("a client with nothing commercial recorded gets a teaching empty state that leads to setting up terms", async () => {
    rpc.mockResolvedValue(reply({ terms: [], signings: [], invoices: [], work: { ...source.work, total: 0, done: 0, open: 0, overdue: 0, blocked: 0, cancelled: 0, undated_open: 0, items: [] } })); await render();
    expect(host.textContent).toContain("Nothing commercial is recorded for Test Consulting Client yet.");
    expect(hrefs()).toContainEqual(["Set up terms", "/solo/42/sales/agreements"]);
    expect(host.querySelector(".trc-standing-money")).toBeNull();
  });
  it("a refusal is a state with no retry; a failed read is an alert that retries exactly once more", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await render();
    expect(host.querySelector("[role=status]")?.textContent).toContain("Only the business owner or an admin can see agreements and payments for Test Consulting Client.");
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Try again")).toBe(false);
    act(() => root.unmount()); root = createRoot(host); rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } }); await render();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Nothing here is shown as zero");
    rpc.mockResolvedValue(reply());
    await act(async () => ([...host.querySelectorAll("button")].find(b => b.textContent === "Try again") as HTMLButtonElement).click());
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(row("Money")).toBeDefined();
  });
  it("while reading it shows skeleton rows, never figures", async () => {
    rpc.mockReturnValue(new Promise(() => {})); await render();
    expect(host.querySelector(".trc-standing-rows[aria-busy=true]")).not.toBeNull();
    expect(host.textContent).not.toMatch(/\$\d/);
    expect(host.textContent).toContain("Checking where Test Consulting Client stands");
  });
  it("each row names itself first and its state beside it, never a pill above the label (no kicker at any width)", async () => {
    rpc.mockResolvedValue(reply()); await render();
    for (const label of ["Agreement", "Money", "Delivery", "Next steps"]) {
      const r = row(label)!;
      expect(r, label).toBeDefined();
      const kids = [...r.children].map(c => c.className);
      // The label is its own cell and comes before the state, so a reader (and the narrow layout) meets the name first.
      expect(kids.indexOf("trc-standing-label")).toBe(0);
      expect(kids.indexOf("trc-standing-state")).toBe(1);
      expect(r.querySelector(".trc-standing-body .trc-standing-label")).toBeNull();
    }
    const css = readFileSync("src/components/tenant-relationships/client-standing.css", "utf8");
    const narrow = css.slice(css.indexOf("@container (max-width: 560px)"));
    expect(narrow).toMatch(/grid-template-areas:\s*"label state"\s*"body body"\s*"actions actions"/);
  });
  it("Check again keeps the last answer on screen at full ink, busy and announced, instead of collapsing to a skeleton", async () => {
    rpc.mockResolvedValue(reply()); await render();
    let settle: (v: unknown) => void = () => {};
    rpc.mockReturnValue(new Promise(r => { settle = r; }));
    await act(async () => ([...host.querySelectorAll("button")].find(b => b.textContent === "Check again") as HTMLButtonElement).click());
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".trc-standing-skeleton")).toBeNull();
    expect(dd("Outstanding")?.textContent).toBe("$3,020.00");
    expect(host.querySelector("#client-standing")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector(".trc-standing-content")?.hasAttribute("data-refreshing")).toBe(true);
    // Announced to assistive tech, and nothing is dimmed below AA while it re-reads.
    expect(host.querySelector('.trc-standing-meta [role="status"]')?.textContent).toBe("Checking again…");
    expect(readFileSync("src/components/tenant-relationships/client-standing.css", "utf8")).not.toMatch(/\[data-refreshing\][^{]*\{[^}]*opacity/);
    const again = [...host.querySelectorAll("button")].find(b => b.textContent === "Check again") as HTMLButtonElement;
    // aria-disabled, not disabled: a disabled button blurs, and keyboard focus would fall to <body>.
    expect(again.disabled).toBe(false);
    expect(again.getAttribute("aria-disabled")).toBe("true");
    await act(async () => again.click());
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => { settle(reply()); await Promise.resolve(); });
    expect(host.querySelector(".trc-standing-content")?.hasAttribute("data-refreshing")).toBe(false);
  });
  it("a failed read offers exactly one retry action", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } }); await render();
    const labels = [...host.querySelectorAll("button")].map(b => b.textContent);
    expect(labels.filter(l => l === "Try again" || l === "Check again")).toEqual(["Try again"]);
  });
  it("a held Overdue spans the money grid so its sentence and link each get a line, and the arrow stays on the link's last word", async () => {
    rpc.mockResolvedValue(reply({ business_time_zone: { state: "missing", zone: null }, as_of_date: null })); await render();
    const cell = dd("Overdue")!.parentElement!;
    expect(cell.classList.contains("trc-standing-money-wide")).toBe(true);
    const tail = cell.querySelector(".trc-standing-link .trc-standing-link-tail");
    expect(tail?.textContent).toBe("setting");
    expect(tail?.querySelector("svg")).not.toBeNull();
  });
  it("an unrecognised saved zone says so, not that no zone is set", async () => {
    rpc.mockResolvedValue(reply({ business_time_zone: { state: "invalid", zone: null }, as_of_date: null })); await render();
    expect(dd("Overdue")?.textContent).toContain("On hold: the saved business time zone isn’t recognised");
    expect(dd("Overdue")?.textContent).not.toContain("until the business time zone is set");
    expect(dd("Overdue")?.textContent).not.toMatch(/\$/);
  });
  it("without a business zone a timestamp is never printed as a business date (as PAIGE: 'not shown')", async () => {
    rpc.mockResolvedValue(reply({ business_time_zone: { state: "missing", zone: null }, as_of_date: null })); await render();
    const agreement = row("Agreement")!.textContent ?? "";
    expect(agreement).not.toMatch(/Aug \d|Sep \d|2026/);
    expect(agreement).toContain("not shown");
    const delivery = row("Delivery")!.textContent ?? "";
    expect(delivery).toContain("Next: Draft discovery report");
    expect(delivery).not.toMatch(/Oct \d/);
    expect(delivery).toContain("not shown");
  });
  it("with the business zone set, the same timestamps are business dates", async () => {
    rpc.mockResolvedValue(reply()); await render();
    expect(row("Agreement")!.textContent).toContain("Sent Aug 28, 2026");
    expect(row("Delivery")!.textContent).toContain("due Oct 10, 2026");
  });
  it("the empty state is one column: the action area only takes a grid slot inside a ledger row", async () => {
    const css = readFileSync("src/components/tenant-relationships/client-standing.css", "utf8");
    // A bare .trc-standing-actions grid-area leaks into the empty state's plain grid and makes an implicit second column.
    expect(css).not.toMatch(/(^|\})\s*\.trc-standing-actions\s*\{[^}]*grid-area/);
    expect(css).toMatch(/\.trc-standing-row\s*>\s*\.trc-standing-actions\s*\{\s*grid-area:\s*actions/);
  });
  it("dates and the checked time never break inside the value on a narrow screen", async () => {
    rpc.mockResolvedValue(reply()); await render();
    const nowrap = [...host.querySelectorAll(".trc-standing-nowrap")].map(n => n.textContent);
    expect(nowrap.some(t => /^Completed /.test(t ?? ""))).toBe(true);
    expect(host.querySelector('.trc-standing-meta [role="status"] .trc-standing-nowrap')).not.toBeNull();
  });
  it("spends no gold and no hard-coded colour", () => {
    const tsx = readFileSync("src/components/tenant-relationships/ClientStanding.tsx", "utf8");
    expect(tsx).not.toMatch(/state="on"|state="included"|variant="gold"|--pg-gold|gold-dark/);
    const css = readFileSync("src/components/tenant-relationships/client-standing.css", "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|--pg-gold|gold-dark/i);
  });
});
