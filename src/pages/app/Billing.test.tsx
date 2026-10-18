import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Billing from "./Billing";
import { PORTAL_INVOICES_REFRESH_ERROR, type ClientPortalInvoicesState, type PortalInvoice } from "@/hooks/useClientPortalInvoices";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0950000-0000-4000-8000-000000000001";
const f = vi.hoisted(() => ({ state: null as unknown as ClientPortalInvoicesState }));
vi.mock("@/hooks/useClientPortalInvoices", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalInvoices")>()),
  useClientPortalInvoices: () => f.state,
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrand: () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: null, logo_url: null }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `e0950000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const inv = (n: number, extra: Partial<PortalInvoice> = {}): PortalInvoice => ({
  id: id(n), invoice_number: `INV-00${n}`, status: "issued", currency: "usd", issued_at: "2026-10-02T15:00:00Z",
  due_date: "2099-10-30", amount_minor: 125000, remaining_minor: 125000, provider_verified_minor: 0, manual_recorded_minor: 0,
  test_provider_minor: 0, payable: false, past_due: false, ...extra,
});
const withInvoices = (invoices: PortalInvoice[], extra: Partial<ClientPortalInvoicesState> = {}) => {
  const owed = invoices.filter((i) => i.status === "issued").reduce((s, i) => s + i.remaining_minor, 0);
  f.state = {
    ...f.state, invoices, loaded: true, invoiceCount: invoices.length,
    openCount: invoices.filter((i) => i.status === "issued" && i.remaining_minor > 0).length,
    pastDueCount: invoices.filter((i) => i.past_due).length,
    balances: invoices.length ? [{ currency: "usd", remaining_minor: owed, provider_verified_minor: 0, manual_recorded_minor: 0, test_provider_minor: 0 }] : [],
    ...extra,
  };
};

let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app/billing"]}>
      <Routes>
        <Route path="/app/billing" element={<Billing />} />
        <Route path="/app/billing/:invoiceId" element={<p>Invoice page</p>} />
        <Route path="/app/messages" element={<p>Messages page</p>} />
        <Route path="/app" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
};
const text = () => host.textContent?.replace(/\s+/g, " ") ?? "";

beforeEach(() => {
  f.state = {
    invoices: [], balances: [], openCount: 0, pastDueCount: 0, invoiceCount: 0, hasMore: false, businessName: "Northwind Studio", loading: false,
    loadingMore: false, error: null, unavailable: false, multipleBusinesses: false, tenantId: T, scopeEpoch: 0, loaded: false,
    refresh: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("is called Payments, never Billing, and names what is owed in a sentence", async () => {
  withInvoices([inv(1), inv(2, { remaining_minor: 50000 }), inv(3, { status: "void", remaining_minor: 0, amount_minor: 40000 })]);
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("Payments");
  expect(text()).not.toMatch(/billing/i);
  expect(host.querySelector("[data-testid=payments-summary]")?.textContent).toContain("$1,750.00 due across 2 open invoices");
  const pills = Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent);
  expect(pills).toEqual(["Open", "Partially paid", "Voided"]);
  // Each invoice opens its own page.
  const rows = Array.from(host.querySelectorAll("[data-testid=invoice-row]"));
  expect(rows.map((r) => r.getAttribute("href"))).toEqual([id(1), id(2), id(3)].map((x) => `/app/billing/${x}`));
  expect(rows[2].textContent).toContain("Nothing owed");
});

it("the header follows the other portal pages: name, what it holds, then what is owed a clear step smaller", async () => {
  withInvoices([inv(1), inv(2, { status: "void", remaining_minor: 0, amount_minor: 40000 })]);
  await render();
  const header = host.querySelector("header")!;
  const h1 = header.querySelector("h1")!;
  const summary = header.querySelector("[data-testid=payments-summary]")!;
  // h1, then the one-line description, then the amount (the Sessions and Documents order).
  expect(h1.nextElementSibling?.textContent).toBe("Invoices Northwind Studio has sent you.");
  expect(h1.nextElementSibling?.nextElementSibling).toBe(summary);
  const sizes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(c));
  expect(sizes(h1)).toEqual(["text-2xl"]);
  const amount = summary.querySelector("p > span")!;
  expect(amount.textContent).toContain("$1,250.00 due");
  expect(sizes(amount)).toEqual(["text-lg"]);
  // A voided pill is a filled box like the rest, so all pills end on one right edge.
  const voided = Array.from(host.querySelectorAll("[data-testid=invoice-status]")).find((e) => e.textContent === "Voided")!;
  expect(voided.className).toMatch(/(^|\s)bg-muted(\s|$)/);
});

it("spends no gold on the list and names no processor", async () => {
  withInvoices([
    inv(1, { payable: true }), inv(2), inv(3, { remaining_minor: 50000 }), inv(4, { past_due: true }),
    inv(5, { remaining_minor: 0, provider_verified_minor: 125000 }), inv(6, { status: "void", remaining_minor: 0 }),
  ]);
  await render();
  // Every status pill is on screen here, so a gold pill or row in any state is caught.
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Open", "Open", "Partially paid", "Past due", "Paid", "Voided"]);
  expect(host.querySelectorAll("[class*=gradient-gold], [class*=bg-accent], [class*=text-accent], [class*=border-accent], [class*=gold]")).toHaveLength(0);
  expect(text()).not.toMatch(/stripe|paypal|square/i);
  // A payable invoice says it is ready to pay; the link itself lives on the invoice's own page.
  const ready = host.querySelectorAll("[data-testid=invoice-pay-ready]");
  expect(ready).toHaveLength(1);
  expect(ready[0].closest("a")?.getAttribute("href")).toBe(`/app/billing/${id(1)}`);
  expect(host.querySelector("a[href^='https://']")).toBeNull();
});

it("marks past due and says nothing owed when everything is paid", async () => {
  withInvoices([inv(1, { past_due: true, due_date: "2026-10-01" }), inv(2)]);
  await render();
  expect(host.querySelector("[data-testid=payments-past-due]")?.textContent).toContain("1 past due");
  expect(host.querySelector("[data-testid=past-due]")?.textContent).toMatch(/^Was due Oct 1/);
  act(() => root.unmount()); root = createRoot(host);
  withInvoices([inv(1, { remaining_minor: 0, provider_verified_minor: 125000 })], { balances: [{ currency: "usd", remaining_minor: 0, provider_verified_minor: 125000, manual_recorded_minor: 0, test_provider_minor: 0 }] });
  await render();
  expect(host.querySelector("[data-testid=payments-paid-up]")?.textContent).toContain("You're all paid up with Northwind Studio.");
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Paid"]);
});

it("says plainly when a test payment moved no money", async () => {
  withInvoices([inv(1, { remaining_minor: 25000, test_provider_minor: 100000 })], {
    balances: [{ currency: "usd", remaining_minor: 25000, provider_verified_minor: 100000, manual_recorded_minor: 0, test_provider_minor: 100000 }],
  });
  await render();
  expect(host.querySelector("[data-testid=payments-test-caution]")?.textContent).toBe("Includes a test payment. The test payment moved no money.");
});

it("an empty list names the business and offers only a message", async () => {
  withInvoices([]);
  await render();
  expect(text()).toContain("Northwind Studio hasn't sent you any invoices");
  const links = Array.from(host.querySelectorAll("a")).map((a) => `${a.textContent?.trim()} -> ${a.getAttribute("href")}`);
  expect(links).toEqual(["Message Northwind Studio -> /app/messages?topic=payments"]);
  expect(host.querySelector("[data-testid=payments-summary]")).toBeNull();
});

it("shows the unavailable and multiple-business states instead of a list", async () => {
  f.state = { ...f.state, unavailable: true };
  await render();
  expect(text()).toContain("Payments isn't available on this account");
  act(() => root.unmount()); root = createRoot(host);
  f.state = { ...f.state, unavailable: false, multipleBusinesses: true };
  await render();
  expect(text()).toContain("Payments for more than one business isn't available yet");
  expect(host.querySelector("[data-testid=invoice-row]")).toBeNull();
});

it("keeps the list when a refresh fails, and pages older invoices on request", async () => {
  withInvoices([inv(1, { past_due: true })], { error: PORTAL_INVOICES_REFRESH_ERROR, hasMore: true, invoiceCount: 25, openCount: 9 });
  await render();
  expect(host.querySelector("[role=alert]")?.textContent).toContain("We couldn't refresh your invoices");
  expect(host.querySelectorAll("[data-testid=invoice-row]")).toHaveLength(1);
  // The open count covers every page; with pages unread, a past-due count would be a guess, so none is shown.
  expect(host.querySelector("[data-testid=payments-summary]")?.textContent).toContain("across 9 open invoices");
  expect(host.querySelector("[data-testid=payments-past-due]")).toBeNull();
  const more = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Show older invoices")!;
  await act(async () => { more.click(); });
  expect(f.state.loadMore).toHaveBeenCalledTimes(1);
  const retry = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
  await act(async () => { retry.click(); });
  expect(f.state.refresh).toHaveBeenCalledTimes(1);
});

it("shows a skeleton on the first read, never an empty state", async () => {
  f.state = { ...f.state, loading: true };
  await render();
  expect(host.querySelector("[data-testid=payments-skeleton]")).not.toBeNull();
  expect(text()).not.toContain("hasn't sent you any invoices");
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("test money never reads as paid: the headline and the pills count only money that moved", async () => {
  withInvoices([
    inv(1, { remaining_minor: 0, provider_verified_minor: 125000, test_provider_minor: 125000 }),
    inv(2, { remaining_minor: 25000, provider_verified_minor: 100000, test_provider_minor: 100000 }),
  ], { balances: [{ currency: "usd", remaining_minor: 25000, provider_verified_minor: 225000, manual_recorded_minor: 0, test_provider_minor: 225000 }] });
  await render();
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Test payment", "Open"]);
  act(() => root.unmount()); root = createRoot(host);
  withInvoices([inv(1, { remaining_minor: 0, provider_verified_minor: 125000, test_provider_minor: 125000 })], {
    balances: [{ currency: "usd", remaining_minor: 0, provider_verified_minor: 125000, manual_recorded_minor: 0, test_provider_minor: 125000 }],
  });
  await render();
  const summary = host.querySelector("[data-testid=payments-summary]")?.textContent ?? "";
  expect(summary).toContain("Settled by a test payment. No money moved.");
  expect(summary).not.toMatch(/paid up/);
});

// ── Round 3 ──────────────────────────────────────────────────────────────────────────────────────────

it("live and test money on one settled invoice: the pill follows the live money, with a quiet test note", async () => {
  // $750 recorded by the business, $500 from a test payment: settled on the books, but only $750 moved.
  withInvoices([inv(1, { remaining_minor: 0, manual_recorded_minor: 75000, provider_verified_minor: 50000, test_provider_minor: 50000 })], {
    balances: [{ currency: "usd", remaining_minor: 0, provider_verified_minor: 50000, manual_recorded_minor: 75000, test_provider_minor: 50000 }],
  });
  await render();
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Partially paid"]);
  expect(host.querySelector("[data-testid=invoice-test-note]")?.textContent).toBe("Includes a test payment");
  const row = host.querySelector("[data-testid=invoice-row]")?.textContent ?? "";
  expect(row).not.toMatch(/\$0\.00 due|Test payment(?! moved)/);
  expect(host.querySelector("[data-testid=payments-test-caution]")?.textContent).toBe("Includes a test payment. The test payment moved no money.");
  act(() => root.unmount()); root = createRoot(host);
  // Live provider money and test money together read the same way.
  withInvoices([inv(1, { remaining_minor: 0, provider_verified_minor: 125000, test_provider_minor: 50000 })], {
    balances: [{ currency: "usd", remaining_minor: 0, provider_verified_minor: 125000, manual_recorded_minor: 0, test_provider_minor: 50000 }],
  });
  await render();
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Partially paid"]);
  // Test money alone keeps its own pill and needs no second note.
  act(() => root.unmount()); root = createRoot(host);
  withInvoices([inv(1, { remaining_minor: 0, provider_verified_minor: 125000, test_provider_minor: 125000 })]);
  await render();
  expect(Array.from(host.querySelectorAll("[data-testid=invoice-status]")).map((e) => e.textContent)).toEqual(["Test payment"]);
  expect(host.querySelector("[data-testid=invoice-test-note]")).toBeNull();
});
