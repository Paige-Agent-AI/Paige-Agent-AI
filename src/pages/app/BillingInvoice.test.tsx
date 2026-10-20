import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BillingInvoice from "./BillingInvoice";
import type { ClientPortalInvoicesState, PortalInvoice, PortalPaymentRead } from "@/hooks/useClientPortalInvoices";

// Synthetic test tenant (Northwind Studio); never a real account. No network: the document function and
// the payment read are doubles, and the only payment link is a test-mode checkout URL.
const T = "e0950000-0000-4000-8000-000000000001";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalInvoicesState,
  payment: vi.fn(),
}));
vi.mock("@/hooks/useClientPortalInvoices", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalInvoices")>()),
  useClientPortalInvoices: () => f.state,
  readPortalInvoicePayment: (...a: unknown[]) => f.payment(...a),
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrand: () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: null, logo_url: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt-test" } } }) } },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `e0950000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const inv = (extra: Partial<PortalInvoice> = {}): PortalInvoice => ({
  id: id(1), invoice_number: "INV-0042", status: "issued", currency: "usd", issued_at: "2026-10-02T15:00:00Z",
  due_date: "2099-10-30", amount_minor: 125000, remaining_minor: 125000, provider_verified_minor: 0, manual_recorded_minor: 0,
  test_provider_minor: 0, payable: false, past_due: false, ...extra,
});
const LINK = "https://checkout.stripe.com/c/pay/cs_test_a1b2";
const ready = (request: Record<string, unknown> | null, remaining = 125000, environment: "test" | "live" | null = "live"): PortalPaymentRead => ({
  state: "ready", remainingMinor: remaining, testProviderMinor: 0, environment,
  request: request ? { amountMinor: 125000, currency: "usd", state: "customer_action_required", url: LINK, remainingMinor: remaining, expiresAt: Date.now() + 3_600_000, ...request } as never : null,
});

let root: Root, host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn>;
let where = "";
function Where() { const l = useLocation(); where = `${l.pathname}${l.search}`; return null; }
const render = async (path = `/app/billing/${id(1)}`) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/app/billing/:invoiceId" element={<BillingInvoice />} />
        <Route path="/app/billing" element={<p>Payments page</p>} />
        <Route path="/app/messages" element={<p>Messages page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
};
const text = () => host.textContent?.replace(/\s+/g, " ") ?? "";
const $ = (sel: string) => host.querySelector(sel);

beforeEach(() => {
  f.payment.mockReset();
  f.payment.mockResolvedValue(ready(null));
  f.state = {
    invoices: [inv()], balances: [], openCount: 1, pastDueCount: 0, invoiceCount: 1, hasMore: false, businessName: "Northwind Studio", loading: false,
    loadingMore: false, error: null, unavailable: false, multipleBusinesses: false, tenantId: T, scopeEpoch: 0, loaded: true,
    refresh: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
  };
  fetchMock = vi.fn().mockResolvedValue(new Response("<!doctype html><html><body><main>Invoice INV-0042</main></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("payable: one gold Pay that opens exactly the business's link in a new tab, without an opener", async () => {
  f.payment.mockResolvedValue(ready({}));
  await render();
  expect(f.payment).toHaveBeenCalledWith({ invoiceId: id(1), tenantId: T });
  const pay = $("[data-testid=pay-now]") as HTMLAnchorElement;
  expect(pay.getAttribute("href")).toBe(LINK);
  expect(pay.target).toBe("_blank");
  expect(pay.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
  expect(pay.textContent).toContain("Pay $1,250.00");
  // Gold is spent on this one control and nowhere else on the page.
  const gold = host.querySelectorAll("[class*=gradient-gold]");
  expect(gold).toHaveLength(1);
  expect(gold[0]).toBe(pay);
  expect(text()).not.toMatch(/stripe/i);
});

it("the subline wraps between its parts, never inside a date, and pretty wrapping keeps the business name together", async () => {
  await render();
  const sub = $("[data-testid=invoice-subline]") as HTMLElement;
  expect(sub.className).toContain("[text-wrap:pretty]");
  const whole = Array.from(sub.querySelectorAll("span.whitespace-nowrap")).map((e) => e.textContent?.replace(/\s+/g, " ").trim());
  expect(whole).toEqual([expect.any(String), expect.stringMatching(/^Issued /), expect.stringMatching(/^Due /)]);
  // "from" is bound to the name by a no-break space, so it never ends a line on its own.
  expect(sub.textContent).toMatch(/from\u00a0Northwind Studio$/);
});

it("no link: says so, and the ask drafts a message the customer edits and sends", async () => {
  await render();
  expect(text()).toContain("Northwind Studio hasn't sent a payment link for this invoice.");
  expect($("[data-testid=pay-now]")).toBeNull();
  expect(host.querySelectorAll("[class*=gradient-gold]")).toHaveLength(0);
  const ask = $("[data-testid=ask-payment-link]") as HTMLAnchorElement;
  expect(ask.textContent).toContain("Ask Northwind Studio for a payment link");
  await act(async () => { ask.click(); });
  const url = new URL(where, "https://x.test");
  expect(url.pathname).toBe("/app/messages");
  expect(url.searchParams.get("draft")).toBe("Could you send me a payment link for invoice INV-0042?");
});

it("an expired link is never offered, and the customer can ask for a new one", async () => {
  f.payment.mockResolvedValue(ready({ state: "expired", url: null }));
  await render();
  expect($("[data-testid=pay-now]")).toBeNull();
  expect(text()).toContain("This payment request has expired");
  expect($("[data-testid=ask-payment-link]")).not.toBeNull();
});

it("a link that expires while the page is open stops being offered", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    f.payment.mockResolvedValue(ready({ expiresAt: Date.now() + 1_000 }));
    await render();
    expect($("[data-testid=pay-now]")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect($("[data-testid=pay-now]")).toBeNull();
    expect(text()).toContain("This payment request has expired");
    expect(text()).not.toContain("no longer available");
    expect($("[data-testid=ask-payment-link]")).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

it("paid: says who confirmed it, without naming a processor, and never reads for a link", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 0, provider_verified_minor: 125000 })] };
  await render();
  expect($("[data-testid=payment-paid]")?.textContent).toContain("Paid in full");
  expect(text()).toContain("Confirmed by Northwind Studio's payment provider.");
  expect(f.payment).not.toHaveBeenCalled();
  act(() => root.unmount()); root = createRoot(host);
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 0, manual_recorded_minor: 125000 })] };
  await render();
  expect(text()).toContain("Recorded by Northwind Studio.");
});

it("void: nothing is owed and no payment is offered", async () => {
  f.state = { ...f.state, invoices: [inv({ status: "void", remaining_minor: 0 })] };
  await render();
  expect($("[data-testid=payment-void]")?.textContent).toBe("This invoice was voided. Nothing is owed.");
  expect($("[data-testid=pay-now]")).toBeNull();
  expect(f.payment).not.toHaveBeenCalled();
});

it("reads the document as the signed-in customer through the scoped document function", async () => {
  await render();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const u = new URL(url);
  expect(u.pathname).toBe("/functions/v1/sales-invoice-document");
  expect(Object.fromEntries(u.searchParams)).toEqual({ portal: "1", invoice_id: id(1), tenant_id: T });
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-test");
  const frame = $("iframe") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
  expect(frame.getAttribute("srcdoc")).toContain("Invoice INV-0042");
});

it("an invoice that isn't the customer's says so and offers the way back", async () => {
  await render(`/app/billing/${id(9)}`);
  expect(text()).toContain("This invoice isn't available");
  expect(f.payment).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => root.unmount()); root = createRoot(host);
  await render("/app/billing/not-a-uuid");
  expect(text()).toContain("This invoice isn't available");
});

it("reads on, page by page, to find an older invoice", async () => {
  f.state = { ...f.state, invoices: [inv({ id: id(5) })], hasMore: true };
  await render();
  expect(f.state.loadMore).toHaveBeenCalled();
  expect($("[data-testid=invoice-skeleton]")).not.toBeNull();
});

it("a failed payment check is said plainly and can be retried", async () => {
  f.payment.mockRejectedValueOnce(new Error("network"));
  await render();
  expect(text()).toContain("We couldn't check for a payment link.");
  f.payment.mockResolvedValue(ready({}));
  const retry = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
  await act(async () => { retry.click(); });
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  expect($("[data-testid=pay-now]")).not.toBeNull();
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("an invoice the payment read can no longer reach is never called voided, and the list is re-read", async () => {
  // The read refuses for a relationship that has gone or an invoice no longer issued to this customer;
  // the list just showed it as owed, so "voided, nothing is owed" would be a false statement about money.
  f.payment.mockResolvedValue({ state: "unavailable" });
  await render();
  expect(text()).toContain("This invoice isn't available to pay here right now.");
  expect(text()).not.toMatch(/voided|nothing is owed/i);
  expect($("[data-testid=pay-now]")).toBeNull();
  expect(f.state.refresh).toHaveBeenCalledTimes(1);
});

it("a request with no link the customer can pay from never says the link is gone, and never assumes the processor", async () => {
  // The projection drops the link for any other processor, and for a link whose merchant binding changed.
  f.payment.mockResolvedValue(ready({ url: null }));
  await render();
  expect(text()).toContain("Northwind Studio hasn't sent a link you can pay from here.");
  expect(text()).not.toMatch(/no longer available|stripe|paypal/i);
  expect($("[data-testid=pay-now]")).toBeNull();
  expect($("[data-testid=ask-payment-link]")).not.toBeNull();
});

it("a test link says no money will move, and Pay is still the one act", async () => {
  f.payment.mockResolvedValue(ready({}, 125000, "test"));
  await render();
  expect($("[data-testid=test-link]")?.textContent).toBe("Test link: no money will move");
  const gold = host.querySelectorAll("[class*=gradient-gold]");
  expect(gold).toHaveLength(1);
  expect(gold[0]).toBe($("[data-testid=pay-now]"));
  act(() => root.unmount()); root = createRoot(host);
  f.payment.mockResolvedValue(ready({}));
  await render();
  expect($("[data-testid=test-link]")).toBeNull();
});

it("an invoice settled by a test payment never reads as paid by the provider", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 0, provider_verified_minor: 125000, test_provider_minor: 125000 })] };
  await render();
  expect(text()).toContain("Settled by a test payment. No money moved.");
  expect(text()).not.toMatch(/Paid in full|Confirmed by|payment provider/);
  expect($("[data-testid=invoice-state]")?.textContent).not.toBe("Paid");
  expect(f.payment).not.toHaveBeenCalled();
});

it("says the amount once: the requested amount only when it differs from what is due", async () => {
  f.payment.mockResolvedValue(ready({}));
  await render();
  expect(text()).not.toContain("has requested a payment of");
  expect(text().match(/\$1,250\.00/g)).toHaveLength(2); // "$1,250.00 due" and "Pay $1,250.00"
  act(() => root.unmount()); root = createRoot(host);
  f.payment.mockResolvedValue(ready({ amountMinor: 50000 }));
  await render();
  expect(text()).toContain("Northwind Studio has requested a payment of $500.00.");
});

// ── Round 3 ──────────────────────────────────────────────────────────────────────────────────────────

it("a partial payment request that was paid, with money still owed: no false 'updates once confirmed', and a way to pay the rest", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 75000, provider_verified_minor: 50000 })] };
  f.payment.mockResolvedValue(ready({ state: "settled", url: null, amountMinor: 50000 }, 75000));
  await render();
  expect(text()).toContain("$750.00 due");
  expect(text()).toContain("Your payment of $500.00 was confirmed.");
  expect(text()).not.toContain("updates once the payment is confirmed");
  expect($("[data-testid=ask-payment-link]")).not.toBeNull();
  expect($("[data-testid=pay-now]")).toBeNull();
});

it("a paid partial request in test mode says the test payment moved no money, once", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 75000, provider_verified_minor: 50000, test_provider_minor: 50000 })] };
  f.payment.mockResolvedValue({ ...ready({ state: "settled", url: null, amountMinor: 50000 }, 75000, "test"), testProviderMinor: 50000 });
  await render();
  expect(text()).toContain("Your test payment of $500.00 went through. The test payment moved no money.");
  expect(text()).not.toMatch(/Payment confirmed|was confirmed|updates once the payment is confirmed/);
  expect(text().match(/moved no money/g)).toHaveLength(1);
  expect($("[data-testid=ask-payment-link]")).not.toBeNull();
});

it("a test-mode request in flight says no money will move, even without a link", async () => {
  for (const state of ["provider_accepted", "outcome_unknown"]) {
    f.payment.mockResolvedValue(ready({ state, url: null }, 125000, "test"));
    await render();
    expect($("[data-testid=test-request]")?.textContent).toBe("Test payment: no money will move");
    expect(text()).toContain("Your balance here updates once the payment is confirmed.");
    act(() => root.unmount()); root = createRoot(host);
    f.payment.mockResolvedValue(ready({ state, url: null }, 125000, "live"));
    await render();
    expect($("[data-testid=test-request]")).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
  }
});

it("paid by the business's own records plus a test payment never credits the payment provider", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 0, manual_recorded_minor: 75000, provider_verified_minor: 50000, test_provider_minor: 50000 })] };
  await render();
  expect(text()).toContain("Settled, partly by a test payment.");
  expect(text()).toContain("Recorded by Northwind Studio. The test payment moved no money.");
  expect(text()).not.toMatch(/Confirmed by|payment provider/);
  expect($("[data-testid=invoice-state]")?.textContent).toBe("Partially paid");
});

it("money still owed with a test payment in it says which part moved nothing", async () => {
  f.state = { ...f.state, invoices: [inv({ remaining_minor: 25000, manual_recorded_minor: 50000, provider_verified_minor: 50000, test_provider_minor: 50000 })] };
  await render();
  expect($("[data-testid=test-caution]")?.textContent).toBe("Includes a test payment of $500.00. The test payment moved no money.");
});
