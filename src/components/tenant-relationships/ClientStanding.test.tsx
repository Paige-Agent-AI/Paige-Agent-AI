import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENTION_TEXT } from "../../../supabase/functions/_shared/client-engagement/labels";

// Experience 04 E4-S3 PR beta (Track D): where one client stands, on that client's Solo record —
// read through the SAME governed read and composer PAIGE answers from, so the page and the chat can
// never describe one client two ways. The fixture is the real SQL output (exp04 SQL proof).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = JSON.parse(readFileSync("src/__tests__/fixtures/exp04-client-status-source.json", "utf8"));
const TENANT = source.tenant_id as string, CLIENT = source.contact_id as string;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: TENANT, accountContextLoading: false }) }));
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

describe("ClientStanding", () => {
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
    expect(links).toContainEqual(["Open terms & agreements", "/solo/42/sales/agreements"]);
    expect(links).toContainEqual(["Open invoices", "/solo/42/sales/payments?view=invoices"]);
    expect(links).toContainEqual(["Open collections", "/solo/42/sales/payments?view=collections"]);
    expect(links).toContainEqual(["Open delivery work", "/solo/42/operations/work"]);
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
