// Deterministic data boundary for the customer portal Payments harness (E09 Slice 5).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera",
// "Sam Okafor"); every payment link is a test-mode checkout URL that is never opened; no charge exists. The
// signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientPortalInvoices / usePortalInvoicesGlance hooks (exact-key
// parsers included), the REAL readCustomerPaymentRequest parser, the REAL shared invoice renderer
// (supabase/functions/_shared/sales-invoice-document.ts, for the document the edge function would serve), the
// REAL brand/config readers, the REAL playbook resolver and NotificationBell all run against this client. The
// payloads follow 20271110230000_e09_customer_portal_payments.sql as it stands in the worktree, computed from an
// invoice store that deliberately holds rows the customer must NOT see:
//
//   client_portal_invoices(p_tenant_id, p_limit, p_after)
//     visible = tenant AND this contact AND status IN (issued, void) AND issued snapshot AND document
//     -> { schema_version:1, tenant_id, business_name, invoices:[13 keys], invoice_count, has_more, next_cursor,
//          balances:[5 keys], open_count, read_at } | null
//   client_portal_invoice_payment_request(p_invoice_id, p_tenant_id)
//     -> { invoice_id, invoice_number, remaining_cents, test_provider_cents, payment_request } | 42501 unavailable
//   GET {VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?portal=1&invoice_id&tenant_id[&format=pdf]
//     answered in-page (window.fetch) with the real renderer's HTML, or a minimal PDF. The projection has the
//     portal ledger's shape (client_portal_invoice_ledger): receipt rows without provider_operation_id, each
//     provider receipt carrying its provider_environment, and the top-level test_provider_cents.
//
//   get_client_portal_config() -> { modules: [], _catalog: { slug, authored_usable, modules } } (Slice M's customer read;
//     the generic catalog, which lists `billing`), so the REAL AppNav assembles its grouped menu — Payments under
//     Paperwork — through the REAL useCustomerPortalNav / assemblePortalNav, as it does for a signed-in customer.
//
//   client_portal_conversation / client_portal_send_message (Slice 1's contract), for the "Ask for a payment
//     link" step: an empty thread, and sends recorded on window.__harnessSends so the drive can prove nothing
//     is sent until the customer presses Send.
//
//   /app/billing?state=populated|empty|loading|unavailable|multiple|error|hasmore|paidup|test|test-settled|mixed-settled
//   /app/billing/<invoice>?state=populated|test|testlink|test-settled|mixed-settled|pay-unavailable|other-processor|doc-error|pay-error|corrected
//     |part-settled|part-settled-test|inflight-test
//   /app?state=home|home-empty   /app/messages (reached from an invoice's Ask)
import { renderSalesInvoiceDocument } from "../../../../supabase/functions/_shared/sales-invoice-document";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "populated";

export const TENANT = "e0950000-0000-4000-8000-00000000b001";
const OTHER_TENANT = "e0950000-0000-4000-8000-00000000b002";
const CONTACT = "e0950000-0000-4000-8000-00000000d001"; // Jordan Rivera, the signed-in customer
const OTHER_CONTACT = "e0950000-0000-4000-8000-00000000d002"; // Sam Okafor, another customer of the business
const USER = { id: "e0950000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };
const UNAVAILABLE = { code: "42501", message: "CLIENT_INVOICE_UNAVAILABLE" };
const DAY = 86_400_000;
const FUTURE = Date.now() + 3 * 3_600_000;

const at = (days: number, h = 15) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
const day = (days: number) => at(days).slice(0, 10);

type Op = { state: string; amount: number; url: string; expires: string; provider: string };
type Row = {
  id: string; tenant_id: string; contact_id: string; number: string; status: "draft" | "issued" | "void" | "recorded";
  issued: boolean; issued_at: string; due_date: string | null; amount: number; manual: number; provider: number; test: number;
  /** Round 5: business money recorded and later corrected (a receipt and its reversal); it nets to zero. */
  corrected: number;
  op: Op | null; memo: string;
};
export const IDS = {
  payable: "e0950000-0000-4000-9000-000000000107",
  partial: "e0950000-0000-4000-9000-000000000104",
  paid: "e0950000-0000-4000-9000-000000000101",
  void: "e0950000-0000-4000-9000-000000000098",
  expired: "e0950000-0000-4000-9000-000000000095",
};
/** Every string the customer must never see, whatever the state. The drive asserts each is absent. */
export const NEVER = ["INV-0110", "CSV-", "INV-0090", "INV-9001", "Internal memo", "acct_TEST", "Stripe", "stripe", "cs_test"];

const link = (n: string) => `https://checkout.stripe.com/c/pay/cs_test_harness_${n}`;
const row = (o: Partial<Row> & Pick<Row, "id" | "number">): Row => ({
  tenant_id: TENANT, contact_id: CONTACT, status: "issued", issued: true, issued_at: at(-3), due_date: day(14), amount: 125_000,
  manual: 0, provider: 0, test: 0, corrected: 0, op: null, memo: "Internal memo: chase on the 15th", ...o,
});

function store(): Row[] {
  const hidden: Row[] = [
    row({ id: "e0950000-0000-4000-9000-000000000110", number: "INV-0110", status: "draft", issued: false }), // a draft
    row({ id: "e0950000-0000-4000-9000-000000000111", number: "CSV-e0950000", status: "recorded", issued: false }), // a CSV import
    row({ id: "e0950000-0000-4000-9000-000000000090", number: "INV-0090", contact_id: OTHER_CONTACT }), // Sam's invoice
    row({ id: "e0950000-0000-4000-9000-000000009001", number: "INV-9001", tenant_id: OTHER_TENANT }), // another business
  ];
  if (state === "empty" || state === "home-empty") return hidden;
  if (state === "paidup" || state === "test-settled" || state === "mixed-settled") {
    return [...hidden,
      // test-settled: the only receipt on it came from a test-mode checkout (allocated, but no money moved).
      // mixed-settled: $400 of live provider money, and $200 from a test-mode checkout that moved nothing.
      row({ id: IDS.paid, number: "INV-0101", issued_at: at(-40), due_date: day(-26), amount: 60_000, provider: 60_000,
        test: state === "test-settled" ? 60_000 : state === "mixed-settled" ? 20_000 : 0 }),
      row({ id: IDS.void, number: "INV-0098", status: "void", issued_at: at(-55), amount: 40_000 }),
    ];
  }
  // part-settled(-test): the business asked for $500 of INV-0107 and that payment landed (live, or a test-mode
  // checkout); $750 is still owed and no newer request exists. inflight-test: a test-mode payment the provider
  // accepted and has not confirmed yet.
  const partSettled = state === "part-settled" || state === "part-settled-test";
  const visible: Row[] = [
    row({ id: IDS.payable, number: "INV-0107", issued_at: at(-2), due_date: day(12), amount: 125_000,
      test: state === "test" ? 25_000 : state === "part-settled-test" ? 50_000 : 0,
      provider: state === "test" ? 25_000 : partSettled ? 50_000 : 0,
      // other-processor: the business sent the request through a processor the projection does not open here.
      op: { state: partSettled ? "settled" : state === "inflight-test" ? "provider_accepted" : "customer_action_required",
        amount: state === "test" ? 100_000 : partSettled ? 50_000 : 125_000, url: link("107"), expires: new Date(FUTURE).toISOString(), provider: state === "other-processor" ? "paypal" : "stripe" },
      // corrected: a $250 business-recorded payment the business later corrected away in full.
      corrected: state === "corrected" ? 25_000 : 0 }),
    // corrected: on top of the $1,500 recorded, a further $500 was recorded and then corrected.
    row({ id: IDS.partial, number: "INV-0104", issued_at: at(-30), due_date: day(-6), amount: 240_000, manual: 150_000, corrected: state === "corrected" ? 50_000 : 0 }),
    row({ id: IDS.paid, number: "INV-0101", issued_at: at(-40), due_date: day(-26), amount: 60_000, provider: 60_000 }),
    // corrected: a voided invoice whose only recorded payment was corrected away.
    row({ id: IDS.void, number: "INV-0098", status: "void", issued_at: at(-55), amount: 40_000, corrected: state === "corrected" ? 10_000 : 0 }),
    row({ id: IDS.expired, number: "INV-0095", issued_at: at(-62), due_date: day(20), amount: 80_000,
      op: { state: "expired", amount: 80_000, url: link("095"), expires: at(-1), provider: "stripe" } }),
  ];
  const many: Row[] = state === "hasmore"
    ? Array.from({ length: 24 }, (_, k) => row({ id: `e0950000-0000-4000-9000-0000000005${String(k).padStart(2, "0")}`, number: `INV-00${String(k + 10).padStart(2, "0")}`, issued_at: at(-70 - k), amount: 20_000, provider: 20_000 }))
    : [];
  return [...hidden, ...visible, ...many];
}

const rows = store();
const visibleRows = () => rows
  .filter((r) => r.tenant_id === TENANT && r.contact_id === CONTACT && (r.status === "issued" || r.status === "void") && r.issued)
  .sort((a, b) => (a.issued_at === b.issued_at ? (a.id < b.id ? 1 : -1) : a.issued_at < b.issued_at ? 1 : -1));
/** _sales_invoice_balance_rows: amount less allocated receipts, whatever the status (a void invoice keeps its figure; it is
 * excluded from balances and counts by status, exactly as the SQL does). */
const remaining = (r: Row) => r.amount - r.manual - r.provider;
const today = () => new Date().toISOString().slice(0, 10);
/** _sales_invoice_payment_projection's guards, as the harness can hold them: a live Stripe-hosted request only. */
const usable = (r: Row) => !!r.op && r.status === "issued" && r.op.provider === "stripe" && r.op.state === "customer_action_required"
  && Date.parse(r.op.expires) > Date.now() && r.op.amount <= remaining(r) && /^https:\/\/checkout[.]stripe[.]com\/c\/pay\//.test(r.op.url);

function invoices(args: Record<string, unknown>) {
  const limit = typeof args.p_limit === "number" ? args.p_limit : 20;
  const after = args.p_after as { issued_at: string; id: string } | null;
  const facts = visibleRows();
  const candidates = facts.filter((r) => !after || r.issued_at < after.issued_at || (r.issued_at === after.issued_at && r.id < after.id));
  const page = candidates.slice(0, limit);
  const more = candidates.length > limit;
  const owing = facts.filter((r) => r.status === "issued" && remaining(r) > 0);
  const live = facts.filter((r) => r.status !== "void");
  return {
    schema_version: 1, tenant_id: TENANT, business_name: "Northwind Studio",
    invoices: page.map((r) => ({
      id: r.id, invoice_number: r.number, status: r.status, currency: "usd", issued_at: r.issued_at, due_date: r.due_date,
      amount_minor: String(r.amount), remaining_minor: String(remaining(r)), provider_verified_minor: String(r.provider),
      manual_recorded_minor: String(r.manual), test_provider_minor: String(r.test), payable: usable(r),
      past_due: r.status === "issued" && remaining(r) > 0 && !!r.due_date && r.due_date < today(),
    })),
    invoice_count: facts.length, has_more: more,
    next_cursor: more ? { issued_at: page[page.length - 1].issued_at, id: page[page.length - 1].id } : null,
    balances: live.length ? [{
      currency: "usd", remaining_minor: String(live.reduce((s, r) => s + remaining(r), 0)),
      provider_verified_minor: String(live.reduce((s, r) => s + r.provider, 0)), manual_recorded_minor: String(live.reduce((s, r) => s + r.manual, 0)),
      test_provider_minor: String(live.reduce((s, r) => s + r.test, 0)),
    }] : [],
    open_count: owing.length,
    read_at: new Date().toISOString(),
  };
}

function paymentRequest(args: Record<string, unknown>) {
  if (state === "pay-error") return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  // The list still shows the invoice as owed, but the per-invoice read now refuses (access changed meanwhile).
  if (state === "pay-unavailable") return Promise.resolve({ data: null, error: UNAVAILABLE });
  const r = visibleRows().find((x) => x.id === args.p_invoice_id && x.status === "issued");
  if (!r) return Promise.resolve({ data: null, error: UNAVAILABLE });
  const request = r.op ? {
    state: r.op.state, amount_minor: r.op.amount, currency: "usd", provider: r.op.provider,
    // The request's provider environment. testlink, part-settled-test and inflight-test frame a test-mode request; the others a live one
    // (the URL is still a fictional test-mode string that is never opened).
    environment: ["testlink", "part-settled-test", "inflight-test"].includes(state) ? "test" : "live", expires_at: r.op.expires,
    provider_url: usable(r) ? r.op.url : null,
  } : null;
  return Promise.resolve({ data: { invoice_id: r.id, invoice_number: r.number, remaining_cents: remaining(r), test_provider_cents: r.test, payment_request: request }, error: null });
}

let invoiceReads = 0;
function invoicesRpc(args: Record<string, unknown>) {
  invoiceReads += 1;
  if (state === "loading") return new Promise(() => {});
  if (state === "unavailable") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  // A first read that lands, then a connection that drops: the page must keep the list and say so.
  if (state === "error" && invoiceReads > 1) return Promise.resolve({ data: null, error: { code: "PGRST000", message: "harness: network" } });
  return Promise.resolve({ data: invoices(args), error: null });
}

/** The scoped document function, answered in-page: the real renderer for HTML, a minimal real PDF for format=pdf. */
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (url.hostname !== "harness.invalid") return realFetch(input, init);
  if (url.pathname !== "/functions/v1/sales-invoice-document" || url.searchParams.get("portal") !== "1") return new Response("not found", { status: 404 });
  if (state === "doc-error") return new Response("unavailable", { status: 404 });
  const r = visibleRows().find((x) => x.id === url.searchParams.get("invoice_id"));
  if (!r) return new Response("unavailable", { status: 404 });
  if (url.searchParams.get("format") === "pdf") {
    return new Response(new Blob(["%PDF-1.4\n%harness\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"]), { headers: { "content-type": "application/pdf" } });
  }
  // The portal ledger: the business's own receipt, then live provider money, then test-mode money, in posting order.
  // Round 5: a corrected business payment is its receipt followed by its reversal.
  const posted = at(-20);
  const ledgerRows = [
    ...(r.corrected ? [{ kind: "receipt", amount_cents: r.corrected, provenance: "human_recorded", method: "bank_transfer" }, { kind: "reversal", amount_cents: r.corrected, provenance: "human_recorded", method: "other" }] : []),
    ...(r.manual ? [{ kind: "receipt", amount_cents: r.manual, provenance: "human_recorded", method: "bank_transfer" }] : []),
    ...(r.provider - r.test ? [{ kind: "receipt", amount_cents: r.provider - r.test, provenance: "provider_verified", provider: "stripe", method: "stripe", provider_verified_at: posted, provider_environment: "live" }] : []),
    ...(r.test ? [{ kind: "receipt", amount_cents: r.test, provenance: "provider_verified", provider: "stripe", method: "stripe", provider_verified_at: posted, provider_environment: "test" }] : []),
  ].map((x, i) => ({ id: `e0950000-0000-4000-a000-00000000000${i + 1}`, currency: "usd", received_at: posted, posted_at: posted, ordinal: i + 1, ...x }));
  const html = renderSalesInvoiceDocument({
    document_input_digest: "0".repeat(64), status: r.status, current_invoice_number: r.number,
    remaining_cents: remaining(r), manual_recorded_cents: r.manual, provider_verified_cents: r.provider, allocated_cents: r.manual + r.provider,
    test_provider_cents: r.test,
    payment_ledger: { rows: ledgerRows, count: ledgerRows.length, complete: true, as_of: new Date().toISOString(), receipt_total_cents: r.manual + r.provider + r.corrected, reversal_total_cents: r.corrected },
    document: {
      renderer_version: "paige-invoice-html-v2", invoice_number: r.number, published_at: r.issued_at.slice(0, 10),
      issuer_name: "Northwind Studio", client_name: "Jordan Rivera", total_cents: r.amount, currency: "usd",
      presentation: { template: "modern", accent: "#26483e", issuer_email: "hello@northwind.example", footer: "Thank you for working with Northwind Studio." },
      snapshot: {
        items: [{ item: "Brand identity sprint", description: "Discovery, two logo concepts and a type and colour system.", quantity: 1, unit_minor: r.amount }],
        recipient_email: USER.email, billing_address: null, due_now_minor: r.amount, remainder_minor: 0, due_date: r.due_date,
        memo: null, payment_method_intents: ["card"], kind: "one_time",
      },
    },
  });
  if (!html) return new Response("render failed", { status: 500 });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
};

const PROFILE = {
  id: CONTACT, tenant_id: TENANT, linked_user_id: USER.id, first_name: "Jordan", last_name: "Rivera", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false,
  paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: at(-30), email: USER.email,
  phone: null, contact_methods: [],
};

function brand() {
  if (state === "unavailable") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

/** Table reads all resolve empty (the home tiles count nothing here). */
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

/** Slice 1's conversation, empty, so the Ask step lands in a real composer. Sends are recorded, never delivered. */
const sends: { body: string; kind: string }[] = [];
(window as unknown as { __harnessSends: typeof sends }).__harnessSends = sends;
function conversation() {
  return Promise.resolve({ data: { tenant_id: TENANT, messages: [], has_more: false }, error: null });
}
function sendMessage(args: Record<string, unknown>) {
  sends.push({ body: String(args.p_body ?? ""), kind: String(args.p_kind ?? "") });
  return Promise.resolve({ data: { ok: true, replayed: false, message_id: "e0950000-0000-4000-8000-00000000e001", created_at: new Date().toISOString() }, error: null });
}

/** The catalog every generic Playbook ships: `billing` is listed, so Payments is placed by it, in the Paperwork group. */
export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_invoices") return invoicesRpc(args);
    if (name === "client_portal_invoice_payment_request") return paymentRequest(args);
    if (name === "client_portal_self_profile") {
      if (state === "unavailable") return Promise.resolve({ data: null, error: null });
      if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
      return Promise.resolve({ data: PROFILE, error: null });
    }
    if (name === "client_portal_sessions") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), sessions: [], next_before: null }, error: null });
    }
    if (name === "client_portal_progress") {
      return Promise.resolve({ data: { tenant_id: TENANT, server_now: new Date().toISOString(), summary: { shared: 0, done: 0, open: 0, overdue: 0 }, items: [], has_more: false }, error: null });
    }
    if (name === "client_portal_conversation") return conversation();
    if (name === "client_portal_send_message") return sendMessage(args);
    if (name === "get_client_portal_brand") return brand();
    // The Slice M customer read (20271110060000_e09_customer_portal_menu.sql): the business's overlay (none saved
    // here) and its server-owned `_catalog` (a generic Playbook, which lists `billing`). AppNav's grouped menu and
    // the Home line both assemble from it, exactly as for a signed-in customer.
    if (name === "get_client_portal_config") {
      if (state === "unavailable") return Promise.resolve({ data: {}, error: null });
      if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
      return Promise.resolve({ data: { modules: [], _catalog: { slug: null, authored_usable: false, modules: null } }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: () => chain(),
  auth: {
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: { user: USER, access_token: "harness-not-a-real-token" } }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      queueMicrotask(() => cb("INITIAL_SESSION", { user: USER }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => undefined }; return c; },
  removeChannel: () => undefined,
  functions: { invoke: async (name: string) => ({ data: null, error: { message: `harness: unstubbed function ${name}` } }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
