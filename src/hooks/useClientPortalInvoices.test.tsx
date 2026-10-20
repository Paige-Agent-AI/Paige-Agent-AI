import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  invoiceDisplayState,
  liveProviderMinor,
  isMultipleRelationships,
  owedPhrase,
  parseInvoicePage,
  paymentLinkRequestHref,
  PORTAL_INVOICES_LOAD_ERROR,
  PORTAL_INVOICES_REFRESH_ERROR,
  readPortalInvoicePayment,
  useClientPortalInvoices,
  usePortalInvoicesGlance,
  type ClientPortalInvoicesState,
  type PortalInvoicesGlance,
} from "./useClientPortalInvoices";

const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => f.rpc(...args),
    auth: {
      getUser: () => f.getUser(),
      onAuthStateChange: (cb: typeof f.authListener) => {
        f.authListener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Synthetic test tenants (Northwind Studio and a second business); never real accounts.
const T = "e0950000-0000-4000-8000-000000000001";
const T2 = "e0950000-0000-4000-8000-000000000009";
const id = (n: number) => `e0950000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const inv = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), invoice_number: `INV-00${n}`, status: "issued", currency: "usd", issued_at: "2026-10-02T15:00:00Z",
  due_date: "2026-10-30", amount_minor: "125000", remaining_minor: "125000", provider_verified_minor: "0",
  manual_recorded_minor: "0", test_provider_minor: "0", payable: false, past_due: false, ...extra,
});
const bal = (extra: Record<string, unknown> = {}) => ({
  currency: "usd", remaining_minor: "125000", provider_verified_minor: "0", manual_recorded_minor: "0", test_provider_minor: "0", ...extra,
});
const page = (invoices: unknown[], extra: Record<string, unknown> = {}) => ({
  schema_version: 1, tenant_id: T, business_name: "Northwind Studio", invoices, invoice_count: invoices.length,
  has_more: false, next_cursor: null, balances: [bal()], open_count: 1, read_at: "2026-10-17T12:00:00Z", ...extra,
});
const ok = (data: unknown) => ({ data, error: null });
const MULTI = { code: "42501", message: "select an authorized customer relationship" };

let root: Root, host: HTMLDivElement;
let state: ClientPortalInvoicesState;
function Probe() { state = useClientPortalInvoices(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const mount = async () => { await act(async () => root.render(<Probe />)); await flush(); };
const reads = () => f.rpc.mock.calls.filter((c) => c[0] === "client_portal_invoices");

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  f.rpc.mockResolvedValue(ok(page([inv(1), inv(2, { status: "void", remaining_minor: "0", amount_minor: "40000" })])));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("reads the caller's invoices with no tenant on the first read and parses money from strings", async () => {
  await mount();
  expect(state.loading).toBe(false);
  expect(state.invoices.map((i) => i.id)).toEqual([id(1), id(2)]);
  expect(state.invoices[0].amount_minor).toBe(125000);
  expect(state.balances).toEqual([{ currency: "usd", remaining_minor: 125000, provider_verified_minor: 0, manual_recorded_minor: 0, test_provider_minor: 0 }]);
  expect(state.openCount).toBe(1);
  expect(state.businessName).toBe("Northwind Studio");
  expect(reads()[0][1]).toEqual({ p_tenant_id: null, p_limit: 20, p_after: null });
});

it("pins the server-resolved business and never shows another one's invoices", async () => {
  await mount();
  await act(async () => { await state.refresh(); });
  expect(reads()[1][1]).toEqual({ p_tenant_id: T, p_limit: 20, p_after: null });
  f.rpc.mockResolvedValue(ok(page([inv(9)], { tenant_id: T2 })));
  await act(async () => { await state.refresh(); });
  expect(state.invoices.map((i) => i.id)).toEqual([id(1), id(2)]);
  expect(state.error).toBe(PORTAL_INVOICES_REFRESH_ERROR);
});

it("reports no relationship as unavailable and a multiple-business refusal as its own state", async () => {
  f.rpc.mockResolvedValue(ok(null));
  await mount();
  expect(state.unavailable).toBe(true);
  expect(state.error).toBeNull();
  act(() => root.unmount()); root = createRoot(host);
  f.rpc.mockResolvedValue({ data: null, error: MULTI });
  await mount();
  expect(state.multipleBusinesses).toBe(true);
  // Asking again cannot change the answer: focus does not re-read.
  const before = reads().length;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  expect(reads().length).toBe(before);
});

it("a first read that fails is a failed load; a later one keeps the list as a failed refresh", async () => {
  f.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST000", message: "network" } });
  await mount();
  expect(state.error).toBe(PORTAL_INVOICES_LOAD_ERROR);
  f.rpc.mockResolvedValue(ok(page([inv(1)])));
  await act(async () => { await state.refresh(); });
  expect(state.error).toBeNull();
  f.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  expect(state.invoices.map((i) => i.id)).toEqual([id(1)]);
  expect(state.error).toBe(PORTAL_INVOICES_REFRESH_ERROR);
});

it("refuses a widened payload rather than showing it", async () => {
  f.rpc.mockResolvedValue(ok(page([{ ...inv(1), memo: "Internal: chase hard" }])));
  await mount();
  expect(state.invoices).toEqual([]);
  expect(state.error).toBe(PORTAL_INVOICES_LOAD_ERROR);
  expect(() => parseInvoicePage(page([{ ...inv(1), provider_url: "https://checkout.stripe.com/c/pay/cs_test_x" }]))).toThrow();
  expect(() => parseInvoicePage({ ...page([inv(1)]), created_by: "e0950000-0000-4000-8000-00000000000a" })).toThrow();
  expect(() => parseInvoicePage(page([inv(1)], { balances: [{ ...bal(), merchant_id: "acct_TEST" }] }))).toThrow();
  // Draft and imported records are never a customer status; a negative or fractional amount is never money.
  expect(() => parseInvoicePage(page([inv(1, { status: "draft" })]))).toThrow();
  expect(() => parseInvoicePage(page([inv(1, { status: "recorded" })]))).toThrow();
  expect(() => parseInvoicePage(page([inv(1, { amount_minor: "-1" })]))).toThrow();
  expect(() => parseInvoicePage(page([inv(1, { amount_minor: 125000 })]))).toThrow();
  // A voided or settled invoice can never be payable.
  expect(() => parseInvoicePage(page([inv(1, { status: "void", remaining_minor: "0", payable: true })]))).toThrow();
  // has_more and next_cursor must agree.
  expect(() => parseInvoicePage(page([inv(1)], { has_more: true }))).toThrow();
});

it("pages older invoices through the cursor and appends them once", async () => {
  const cursor = { issued_at: "2026-09-01T00:00:00Z", id: id(2) };
  f.rpc.mockResolvedValueOnce(ok(page([inv(1), inv(2)], { has_more: true, next_cursor: cursor, invoice_count: 3 })));
  await mount();
  expect(state.hasMore).toBe(true);
  f.rpc.mockResolvedValueOnce(ok(page([inv(2), inv(3)], { invoice_count: 3 })));
  await act(async () => { await state.loadMore(); });
  expect(reads()[1][1]).toEqual({ p_tenant_id: T, p_limit: 20, p_after: cursor });
  expect(state.invoices.map((i) => i.id)).toEqual([id(1), id(2), id(3)]);
  expect(state.hasMore).toBe(false);
  // A refresh then re-reads as many as are on screen.
  f.rpc.mockResolvedValue(ok(page([inv(1), inv(2), inv(3)], { invoice_count: 3 })));
  await act(async () => { await state.refresh(); });
  expect(reads()[2][1]).toEqual({ p_tenant_id: T, p_limit: 20, p_after: null });
});

it("a new signed-in identity drops the old list and the pinned business", async () => {
  await mount();
  const epoch = state.scopeEpoch;
  f.rpc.mockResolvedValue(ok(page([inv(7)], { tenant_id: T2 })));
  await act(async () => { f.authListener?.("SIGNED_IN", { user: { id: "u2" } }); });
  await flush();
  expect(state.scopeEpoch).toBe(epoch + 1);
  expect(state.tenantId).toBe(T2);
  expect(state.invoices.map((i) => i.id)).toEqual([id(7)]);
  expect(reads().at(-1)?.[1]).toEqual({ p_tenant_id: null, p_limit: 20, p_after: null });
});

it("classifies refusals precisely: only the relationship refusal is multiple businesses", () => {
  expect(isMultipleRelationships(MULTI)).toBe(true);
  expect(isMultipleRelationships({ code: "42501", message: "customer authentication required" })).toBe(false);
  expect(isMultipleRelationships({ code: "42501", message: "CLIENT_INVOICE_UNAVAILABLE" })).toBe(false);
});

it("derives the customer's words from the balance, the way the owner side does", () => {
  const p = parseInvoicePage(page([
    inv(1), inv(2, { remaining_minor: "50000" }), inv(3, { remaining_minor: "0" }),
    inv(4, { past_due: true }), inv(5, { status: "void", remaining_minor: "0" }),
  ]))!;
  expect(p.invoices.map(invoiceDisplayState)).toEqual(["open", "partially_paid", "paid", "past_due", "voided"]);
  expect(owedPhrase(p.balances)).toBe("$1,250.00");
  expect(owedPhrase([{ currency: "usd", remaining_minor: 0, provider_verified_minor: 0, manual_recorded_minor: 0, test_provider_minor: 0 }])).toBeNull();
});

it("reads one invoice's payment link through the one existing parser, and never as a write", async () => {
  const request = {
    state: "customer_action_required", amount_minor: 125000, currency: "usd", provider: "stripe",
    expires_at: "2099-01-01T00:00:00Z", provider_url: "https://checkout.stripe.com/c/pay/cs_test_a1",
  };
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), invoice_number: "INV-001", remaining_cents: 125000, test_provider_cents: 0, payment_request: request }));
  const r = await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T });
  expect(f.rpc).toHaveBeenCalledWith("client_portal_invoice_payment_request", { p_invoice_id: id(1), p_tenant_id: T });
  expect(r).toMatchObject({ state: "ready", request: { url: "https://checkout.stripe.com/c/pay/cs_test_a1", amountMinor: 125000 } });
  // A link that is not the hosted checkout is never offered.
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), remaining_cents: 125000, test_provider_cents: 0, payment_request: { ...request, provider_url: "https://evil.example/pay" } }));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toMatchObject({ state: "ready", request: { url: null } });
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), remaining_cents: 125000, test_provider_cents: 0, payment_request: null }));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toEqual({ state: "ready", request: null, remainingMinor: 125000, testProviderMinor: 0, environment: null });
  f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "CLIENT_INVOICE_UNAVAILABLE" } });
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toEqual({ state: "unavailable" });
  f.rpc.mockResolvedValueOnce(ok(null));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toEqual({ state: "unavailable" });
  // An answer for another invoice is never shown as this one's.
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(2), remaining_cents: 1, test_provider_cents: 0, payment_request: null }));
  await expect(readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).rejects.toThrow();
});

it("drafts the 'ask for a payment link' message for the customer to edit", () => {
  const href = paymentLinkRequestHref("INV-0042");
  const url = new URL(href, "https://x.test");
  expect(url.pathname).toBe("/app/messages");
  expect(url.searchParams.get("draft")).toBe("Could you send me a payment link for invoice INV-0042?");
});

it("the Home glance counts past due only when one page holds every invoice", async () => {
  let glance: PortalInvoicesGlance = { state: "loading" };
  function G() { glance = usePortalInvoicesGlance(true); return null; }
  f.rpc.mockResolvedValueOnce(ok(page([inv(1, { past_due: true }), inv(2)], { open_count: 2 })));
  await act(async () => root.render(<G />)); await flush();
  expect(glance).toMatchObject({ state: "ready", openCount: 2, pastDue: 1 });
  expect(reads()[0][1]).toEqual({ p_tenant_id: null, p_limit: 40, p_after: null });
  act(() => root.unmount()); root = createRoot(host);
  f.rpc.mockResolvedValueOnce(ok(page([inv(1, { past_due: true })], {
    has_more: true, next_cursor: { issued_at: "2026-09-01T00:00:00Z", id: id(1) }, open_count: 50, invoice_count: 60,
  })));
  await act(async () => root.render(<G />)); await flush();
  expect(glance).toMatchObject({ state: "ready", openCount: 50, pastDue: null });
});

it("refuses counts that contradict each other", () => {
  expect(() => parseInvoicePage(page([inv(1)], { past_due_count: 0 }))).toThrow();
  expect(() => parseInvoicePage(page([inv(1)], { open_count: 5, invoice_count: 1 }))).toThrow();
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("a balance below zero is shown as nothing owed, never as a failed list", () => {
  // No constraint stops allocations exceeding the invoice total; every governed writer refuses it today.
  const p = parseInvoicePage(page([inv(1, { remaining_minor: "-500", provider_verified_minor: "125500" })], {
    balances: [bal({ remaining_minor: "-500", provider_verified_minor: "125500" })], open_count: 0,
  }))!;
  expect(p.invoices[0].remaining_minor).toBe(0);
  expect(p.balances[0].remaining_minor).toBe(0);
  expect(invoiceDisplayState(p.invoices[0])).toBe("paid");
  expect(owedPhrase(p.balances)).toBeNull();
  // The invoice total itself is still never negative.
  expect(() => parseInvoicePage(page([inv(1, { amount_minor: "-1" })]))).toThrow();
  expect(() => parseInvoicePage(page([inv(1, { remaining_minor: "-1.5" })]))).toThrow();
});

it("test money never reads as money received", () => {
  const p = parseInvoicePage(page([
    // Settled only because a test payment was allocated.
    inv(1, { remaining_minor: "0", provider_verified_minor: "125000", test_provider_minor: "125000" }),
    // Part-settled by test money only: nothing real has been paid.
    inv(2, { remaining_minor: "25000", provider_verified_minor: "100000", test_provider_minor: "100000" }),
    // Part-settled by real money and test money.
    inv(3, { remaining_minor: "25000", provider_verified_minor: "100000", test_provider_minor: "50000" }),
    // Settled by live money and test money together: only the live part was paid.
    inv(4, { remaining_minor: "0", provider_verified_minor: "125000", test_provider_minor: "50000" }),
    inv(5, { remaining_minor: "0", manual_recorded_minor: "75000", provider_verified_minor: "50000", test_provider_minor: "50000" }),
  ]))!;
  expect(p.invoices.map(invoiceDisplayState)).toEqual(["test_settled", "open", "partially_paid", "partially_paid", "partially_paid"]);
  expect(liveProviderMinor(p.invoices[1])).toBe(0);
  expect(liveProviderMinor(p.invoices[2])).toBe(50000);
});

it("reads which environment the business's payment link is in", async () => {
  const request = {
    state: "customer_action_required", amount_minor: 125000, currency: "usd", provider: "stripe",
    expires_at: "2099-01-01T00:00:00Z", provider_url: "https://checkout.stripe.com/c/pay/cs_test_a1",
  };
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), remaining_cents: 125000, test_provider_cents: 0, payment_request: { ...request, environment: "test" } }));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toMatchObject({ state: "ready", environment: "test" });
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), remaining_cents: 125000, test_provider_cents: 0, payment_request: { ...request, environment: "live" } }));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toMatchObject({ state: "ready", environment: "live" });
  // Anything else is not known to be live, and is never claimed to be.
  f.rpc.mockResolvedValueOnce(ok({ invoice_id: id(1), remaining_cents: 125000, test_provider_cents: 0, payment_request: { ...request, environment: "sandbox" } }));
  expect(await readPortalInvoicePayment({ invoiceId: id(1), tenantId: T })).toMatchObject({ state: "ready", environment: null });
});
