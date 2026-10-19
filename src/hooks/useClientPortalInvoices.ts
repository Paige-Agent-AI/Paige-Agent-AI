import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatPaymentMinor, readCustomerPaymentRequest, type CustomerPaymentRequest } from "@/solo/sales/customerPaymentRequest";

/**
 * The invoices a business has issued to the signed-in customer (E09 Slice 5, "Payments").
 *
 * Reads go through client_portal_invoices(), which resolves the customer relationship from the auth
 * subject server-side (§9) and returns only managed invoices the business ISSUED to this client
 * (issued or voided; never a draft, a CSV import, another client's or another business's). It never
 * returns a payment link: `payable` only says the business has sent one. The link itself is read per
 * invoice through client_portal_invoice_payment_request() and parsed by the one existing parser,
 * readCustomerPaymentRequest (§18), which also re-checks that it is a hosted checkout URL.
 *
 * Read-only by design. The customer pays only through a link the business sent, on the business's own
 * payment provider (§38). Nothing here creates a payment request, a charge or a share link.
 *
 * Every payload is checked against the exact key allowlist the server promises. Anything wider is
 * refused, so a widened projection fails closed instead of being shown. No polling: invoices change
 * rarely, so the list refreshes on window focus and when the tab becomes visible.
 */

export type PortalInvoiceStatus = "issued" | "void";

export interface PortalInvoice {
  id: string;
  invoice_number: string | null;
  status: PortalInvoiceStatus;
  currency: string;
  issued_at: string;
  /** Calendar date (YYYY-MM-DD) or null. */
  due_date: string | null;
  amount_minor: number;
  remaining_minor: number;
  provider_verified_minor: number;
  manual_recorded_minor: number;
  test_provider_minor: number;
  /** The business has sent a payment link that is usable right now. The link is not in the list. */
  payable: boolean;
  past_due: boolean;
}

export interface PortalInvoiceBalance {
  currency: string;
  remaining_minor: number;
  provider_verified_minor: number;
  manual_recorded_minor: number;
  test_provider_minor: number;
}

export interface PortalInvoiceCursor { issued_at: string; id: string }

export interface PortalInvoicePage {
  tenant_id: string;
  business_name: string | null;
  invoices: PortalInvoice[];
  /** Every invoice the customer can see, across all pages. */
  invoice_count: number;
  has_more: boolean;
  next_cursor: PortalInvoiceCursor | null;
  /** Per currency, over every non-void invoice, across all pages. */
  balances: PortalInvoiceBalance[];
  /** Issued invoices with something still owed, across all pages. */
  open_count: number;
  read_at: string;
}

/**
 * The customer's own words for where an invoice stands. Whether anything is still owed comes from the
 * balance, as on the owner side; whether money was RECEIVED counts only money that moved. A test payment
 * is allocated on the business's books (so nothing more is asked for), but it is never told to the
 * customer as a payment: an invoice it settled is "test_settled", and one it only part-settled is still
 * open or past due unless real money also arrived. An invoice settled by real money AND test money is
 * "partially_paid": the real money paid part of it; the rest was a test that moved nothing.
 */
export type PortalInvoiceDisplay = "open" | "past_due" | "partially_paid" | "paid" | "test_settled" | "voided";

/** Provider-confirmed money that actually moved: provider-verified receipts minus test-mode ones. */
export function liveProviderMinor(i: Pick<PortalInvoice, "provider_verified_minor" | "test_provider_minor">): number {
  return Math.max(0, i.provider_verified_minor - i.test_provider_minor);
}

export function invoiceDisplayState(i: PortalInvoice): PortalInvoiceDisplay {
  if (i.status === "void") return "voided";
  if (i.remaining_minor === 0) {
    if (i.test_provider_minor === 0) return "paid";
    return i.amount_minor - i.test_provider_minor > 0 ? "partially_paid" : "test_settled";
  }
  if (i.past_due) return "past_due";
  // Part-paid only if something other than test money brought the balance down.
  if (i.amount_minor - i.remaining_minor - i.test_provider_minor > 0) return "partially_paid";
  return "open";
}

export const INVOICE_DISPLAY_LABEL: Record<PortalInvoiceDisplay, string> = {
  open: "Open", past_due: "Past due", partially_paid: "Partially paid", paid: "Paid", test_settled: "Test payment", voided: "Voided",
};

export const PORTAL_INVOICES_PAGE = 20;
export const PORTAL_INVOICES_MAX_PAGE = 40;

const PAGE_KEYS = ["schema_version", "tenant_id", "business_name", "invoices", "invoice_count", "has_more", "next_cursor", "balances", "open_count", "read_at"];
const INVOICE_KEYS = ["id", "invoice_number", "status", "currency", "issued_at", "due_date", "amount_minor", "remaining_minor",
  "provider_verified_minor", "manual_recorded_minor", "test_provider_minor", "payable", "past_due"];
const BALANCE_KEYS = ["currency", "remaining_minor", "provider_verified_minor", "manual_recorded_minor", "test_provider_minor"];
const CURSOR_KEYS = ["issued_at", "id"];

type RpcResult = { data: unknown; error: unknown };
type PortalRpc = "client_portal_invoices" | "client_portal_invoice_payment_request";
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: PortalRpc, args: Record<string, unknown>) {
  return supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
}

const errorParts = (err: unknown) => {
  if (!err || typeof err !== "object") return { code: null, message: "" };
  const e = err as { code?: unknown; message?: unknown };
  return { code: typeof e.code === "string" ? e.code : null, message: typeof e.message === "string" ? e.message : "" };
};

/**
 * The relationship resolver raises 42501 "select an authorized customer relationship" when the account
 * is linked to more than one business. 42501 also carries "not signed in" and, on the per-invoice reads,
 * CLIENT_INVOICE_UNAVAILABLE; neither of those is a multiple-business answer.
 */
export function isMultipleRelationships(err: unknown): boolean {
  const { code, message } = errorParts(err);
  return code === "42501" && /authorized customer relationship/i.test(message);
}

/** The per-invoice reads answer "not yours" and "doesn't exist" with the same refusal. */
export function isInvoiceUnavailable(err: unknown): boolean {
  const { code, message } = errorParts(err);
  return code === "42501" && /CLIENT_INVOICE_UNAVAILABLE/.test(message);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Exactly these keys: nothing missing, nothing extra. */
const exactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isInstant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const isCalendarDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isCurrency = (v: unknown): v is string => typeof v === "string" && /^[a-z]{3}$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
/** Money arrives as a decimal string of minor units (bigint-safe on the server); refuse anything else. */
function minor(v: unknown): number {
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v)) throw new Error("Unexpected invoice amount");
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("Unexpected invoice amount");
  return n;
}
/**
 * What is still owed, never below zero. The balance owner computes total minus allocations, and no
 * table constraint stops allocations exceeding the total (every governed receipt writer refuses it
 * today, and the owner's sales metrics already set aside a `negative_balance`). An over-allocated
 * invoice owes nothing; it is shown as such rather than failing the customer's whole list.
 */
function remainingMinor(v: unknown): number {
  if (typeof v === "string" && /^-\d{1,15}$/.test(v)) return 0;
  return minor(v);
}

function parseInvoice(raw: unknown): PortalInvoice {
  if (!isObject(raw) || !exactKeys(raw, INVOICE_KEYS)) throw new Error("Unexpected invoice");
  const { id, invoice_number, status, currency, issued_at, due_date, payable, past_due } = raw;
  if (!isId(id) || (invoice_number !== null && typeof invoice_number !== "string") || (status !== "issued" && status !== "void")
    || !isCurrency(currency) || !isInstant(issued_at) || (due_date !== null && !isCalendarDate(due_date))
    || typeof payable !== "boolean" || typeof past_due !== "boolean") {
    throw new Error("Unexpected invoice");
  }
  const amount = minor(raw.amount_minor), remaining = remainingMinor(raw.remaining_minor);
  if (remaining > amount) throw new Error("Unexpected invoice");
  // A voided invoice is never payable or past due; an invoice with nothing owed cannot be either.
  if ((status === "void" || remaining === 0) && (payable || past_due)) throw new Error("Unexpected invoice");
  return {
    id, status, currency, issued_at, payable, past_due,
    due_date: typeof due_date === "string" ? due_date : null,
    invoice_number: typeof invoice_number === "string" && invoice_number.trim() ? invoice_number.trim() : null,
    amount_minor: amount,
    remaining_minor: remaining,
    provider_verified_minor: minor(raw.provider_verified_minor),
    manual_recorded_minor: minor(raw.manual_recorded_minor),
    test_provider_minor: minor(raw.test_provider_minor),
  };
}

function parseBalance(raw: unknown): PortalInvoiceBalance {
  if (!isObject(raw) || !exactKeys(raw, BALANCE_KEYS) || !isCurrency(raw.currency)) throw new Error("Unexpected balance");
  return {
    currency: raw.currency,
    remaining_minor: remainingMinor(raw.remaining_minor),
    provider_verified_minor: minor(raw.provider_verified_minor),
    manual_recorded_minor: minor(raw.manual_recorded_minor),
    test_provider_minor: minor(raw.test_provider_minor),
  };
}

/** Null = no customer relationship. Throws on any payload outside the promised shape. */
export function parseInvoicePage(data: unknown): PortalInvoicePage | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || !exactKeys(data, PAGE_KEYS) || data.schema_version !== 1) throw new Error("Unexpected invoices response");
  const { tenant_id, business_name, invoices, invoice_count, has_more, next_cursor, balances, open_count, read_at } = data;
  if (!isId(tenant_id) || (business_name !== null && typeof business_name !== "string") || !Array.isArray(invoices)
    || invoices.length > PORTAL_INVOICES_MAX_PAGE || !isCount(invoice_count) || typeof has_more !== "boolean"
    || !Array.isArray(balances) || !isCount(open_count) || open_count > invoice_count || !isInstant(read_at)) {
    throw new Error("Unexpected invoices response");
  }
  let cursor: PortalInvoiceCursor | null = null;
  if (next_cursor !== null) {
    if (!isObject(next_cursor) || !exactKeys(next_cursor, CURSOR_KEYS) || !isInstant(next_cursor.issued_at) || !isId(next_cursor.id)) {
      throw new Error("Unexpected invoices response");
    }
    cursor = { issued_at: next_cursor.issued_at, id: next_cursor.id };
  }
  // A page that says there is more must say where it continues, and only then.
  if (has_more !== (cursor !== null)) throw new Error("Unexpected invoices response");
  const parsed = invoices.map(parseInvoice);
  if (new Set(parsed.map((i) => i.id)).size !== parsed.length) throw new Error("Unexpected invoices response");
  const parsedBalances = balances.map(parseBalance);
  if (new Set(parsedBalances.map((b) => b.currency)).size !== parsedBalances.length) throw new Error("Unexpected invoices response");
  return {
    tenant_id, has_more, invoice_count, open_count, read_at,
    business_name: typeof business_name === "string" && business_name.trim() ? business_name.trim() : null,
    invoices: parsed,
    next_cursor: cursor,
    balances: parsedBalances,
  };
}

/** One read of the caller's invoices. Null = no customer relationship. Throws on a failed read. */
export async function readPortalInvoices(args: { tenantId?: string | null; limit?: number; after?: PortalInvoiceCursor | null } = {}): Promise<PortalInvoicePage | null> {
  const { data, error } = await portalRpc("client_portal_invoices", {
    p_tenant_id: args.tenantId ?? null,
    p_limit: args.limit ?? PORTAL_INVOICES_PAGE,
    p_after: args.after ?? null,
  });
  if (error) throw error;
  return parseInvoicePage(data);
}

export type PortalPaymentRead =
  /**
   * The server's answer, parsed by the one parser. `request` is null when the business sent no payment
   * request. `environment` is the request's provider environment: "test" means paying moves no money;
   * null when there is no request or the value is not one the contract names (never assumed live).
   */
  | { state: "ready"; request: CustomerPaymentRequest | null; remainingMinor: number; testProviderMinor: number; environment: "test" | "live" | null }
  /** Not this customer's invoice, not issued (voided), or gone. */
  | { state: "unavailable" };

/**
 * The payment request the business sent for one issued invoice, read-only. Never creates or dispatches
 * anything. The top-level shape is what readCustomerPaymentRequest already parses for the bearer page.
 */
export async function readPortalInvoicePayment(args: { invoiceId: string; tenantId: string | null }): Promise<PortalPaymentRead> {
  const { data, error } = await portalRpc("client_portal_invoice_payment_request", {
    p_invoice_id: args.invoiceId,
    p_tenant_id: args.tenantId,
  });
  if (error) {
    if (isInvoiceUnavailable(error)) return { state: "unavailable" };
    throw error;
  }
  // Null = the caller has no customer relationship (any more): nothing here is theirs to pay.
  if (data === null || data === undefined) return { state: "unavailable" };
  if (!isObject(data) || data.invoice_id !== args.invoiceId || !Number.isSafeInteger(data.remaining_cents) || Number(data.remaining_cents) < 0) {
    throw new Error("Unexpected payment response");
  }
  const testCents = data.test_provider_cents;
  const testProviderMinor = Number.isSafeInteger(testCents) && Number(testCents) >= 0 ? Number(testCents) : 0;
  if (data.payment_request === null) return { state: "ready", request: null, remainingMinor: Number(data.remaining_cents), testProviderMinor, environment: null };
  const request = readCustomerPaymentRequest(data);
  // A request the parser cannot read is never shown as "no request": that would hide a link the business sent.
  if (!request) throw new Error("Unexpected payment response");
  const env = isObject(data.payment_request) ? data.payment_request.environment : null;
  const environment = env === "test" || env === "live" ? env : null;
  return { state: "ready", request, remainingMinor: request.remainingMinor, testProviderMinor, environment };
}

export interface ClientPortalInvoicesState {
  /** Newest first; older pages appended by loadMore. */
  invoices: PortalInvoice[];
  balances: PortalInvoiceBalance[];
  openCount: number;
  /**
   * Past-due invoices among those loaded. The server sends no all-page past-due count, so this is the
   * whole figure only once every page is loaded (hasMore false); the page shows it only then.
   */
  pastDueCount: number;
  invoiceCount: number;
  hasMore: boolean;
  /** The business's name as the server read it, or null. */
  businessName: string | null;
  /** First read in flight with nothing loaded yet. */
  loading: boolean;
  loadingMore: boolean;
  /** The last read failed; loaded invoices (if any) are kept but may be stale. */
  error: string | null;
  /** Resolved: the caller has no customer relationship (the read returned null). */
  unavailable: boolean;
  /** Resolved: the account is linked to more than one business, which Payments doesn't support yet. */
  multipleBusinesses: boolean;
  /** Tenant of the loaded invoices (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes. */
  scopeEpoch: number;
  /** True once a read for this identity has landed. */
  loaded: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const PORTAL_INVOICES_LOAD_ERROR = "We couldn't load your invoices. Check your connection and try again.";
/** A failed re-read while the last list is still on screen: the list is there, it may just be behind. */
export const PORTAL_INVOICES_REFRESH_ERROR = "We couldn't refresh your invoices, so this may be out of date.";

export function useClientPortalInvoices(): ClientPortalInvoicesState {
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [balances, setBalances] = useState<PortalInvoiceBalance[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const cursorRef = useRef<PortalInvoiceCursor | null>(null);
  const countRef = useRef(0);
  const readSeq = useRef(0);
  const alive = useRef(true);
  const moreInFlight = useRef(false);
  /** Set once the server refused for multiple relationships: no further reads for this identity. */
  const halted = useRef(false);
  /** A list for this identity is on screen, so a failed read is a failed refresh, not a failed load. */
  const shown = useRef(false);

  const clearData = useCallback(() => {
    shown.current = false;
    cursorRef.current = null;
    countRef.current = 0;
    setInvoices([]);
    setBalances([]);
    setOpenCount(0);
    setInvoiceCount(0);
    setHasMore(false);
    setBusinessName(null);
    setLoaded(false);
  }, []);

  const resetScope = useCallback(() => {
    epoch.current += 1;
    readSeq.current += 1;
    tenantRef.current = null;
    halted.current = false;
    moreInFlight.current = false;
    clearData();
    setError(null);
    setUnavailable(false);
    setMultipleBusinesses(false);
    setLoading(true);
    setLoadingMore(false);
    setTenantId(null);
    setScopeEpoch(epoch.current);
  }, [clearData]);

  const apply = useCallback((page: PortalInvoicePage, append: boolean) => {
    tenantRef.current = page.tenant_id;
    cursorRef.current = page.next_cursor;
    setTenantId(page.tenant_id);
    setUnavailable(false);
    setBusinessName(page.business_name);
    setBalances(page.balances);
    setOpenCount(page.open_count);
    setInvoiceCount(page.invoice_count);
    setHasMore(page.has_more);
    setInvoices((prev) => {
      if (!append) { countRef.current = page.invoices.length; return page.invoices; }
      const seen = new Set(prev.map((i) => i.id));
      const next = [...prev, ...page.invoices.filter((i) => !seen.has(i.id))];
      countRef.current = next.length;
      return next;
    });
    setLoaded(true);
    shown.current = true;
  }, []);

  const fail = useCallback((err: unknown) => {
    if (isMultipleRelationships(err)) {
      halted.current = true;
      clearData();
      setError(null);
      setMultipleBusinesses(true);
    } else {
      setError(shown.current ? PORTAL_INVOICES_REFRESH_ERROR : PORTAL_INVOICES_LOAD_ERROR);
    }
  }, [clearData]);

  const refresh = useCallback(async () => {
    if (halted.current) return;
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    const pinned = tenantRef.current;
    // Re-read as many as are on screen (up to one full page), so a refresh never folds away older invoices
    // the customer just opened, unless they had opened more than one page holds.
    const limit = Math.min(PORTAL_INVOICES_MAX_PAGE, Math.max(PORTAL_INVOICES_PAGE, countRef.current));
    try {
      const page = await readPortalInvoices({ tenantId: pinned, limit });
      if (!current()) return;
      if (!page) {
        clearData();
        setUnavailable(true);
      } else {
        // The first read pins the business; a later answer for another one is never shown.
        if (pinned && page.tenant_id !== pinned) throw new Error("Invoice business changed");
        apply(page, false);
      }
      setError(null);
    } catch (err) {
      if (!current()) return;
      fail(err);
    } finally {
      if (current()) setLoading(false);
    }
  }, [apply, clearData, fail]);

  const loadMore = useCallback(async () => {
    const after = cursorRef.current;
    const pinned = tenantRef.current;
    if (halted.current || !after || !pinned || moreInFlight.current) return;
    moreInFlight.current = true;
    const myEpoch = epoch.current;
    const seq = readSeq.current;
    // A refresh that started meanwhile owns the list; this page is then dropped.
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    setLoadingMore(true);
    try {
      const page = await readPortalInvoices({ tenantId: pinned, after });
      if (!current()) return;
      if (!page || page.tenant_id !== pinned) throw new Error("Invoice business changed");
      apply(page, true);
      setError(null);
    } catch (err) {
      if (!current()) return;
      fail(err);
    } finally {
      if (myEpoch === epoch.current) { moreInFlight.current = false; if (alive.current) setLoadingMore(false); }
    }
  }, [apply, fail]);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      actor.current = user?.id ?? null;
      if (!user) { setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor.current) return;
      if (next === actor.current && event !== "SIGNED_OUT") return;
      actor.current = next;
      resetScope();
      if (!next || event === "SIGNED_OUT") { setLoading(false); setUnavailable(true); return; }
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => { if (!cancelled) void refresh(); });
    });
    return () => {
      cancelled = true;
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [refresh, resetScope]);

  // Freshness without realtime or polling: window focus, and the tab becoming visible again (for
  // example, coming back from the business's payment page).
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const live = () => !!actor.current && !halted.current;
    const onFocus = () => { if (live()) void refresh(); };
    const onVisibility = () => { if (visible() && live()) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const pastDueCount = invoices.filter((i) => i.past_due).length;
  return {
    invoices, balances, openCount, pastDueCount, invoiceCount, hasMore, businessName, loading, loadingMore, error, unavailable,
    multipleBusinesses, tenantId, scopeEpoch, loaded, refresh, loadMore,
  };
}

export type PortalInvoicesGlance =
  | { state: "loading" }
  /** `pastDue` is null when one page could not hold every invoice, so a count would be a guess. */
  | { state: "ready"; openCount: number; balances: PortalInvoiceBalance[]; pastDue: number | null }
  | { state: "unavailable" }
  | { state: "error" };

/**
 * The Home balance line: open invoices and what is due, from one read of up to a full page. The open
 * count and balances cover every invoice; the past-due count is exact only when that page holds them all.
 */
export function usePortalInvoicesGlance(enabled = true): PortalInvoicesGlance {
  const [glance, setGlance] = useState<PortalInvoicesGlance>({ state: "loading" });
  useEffect(() => {
    if (!enabled) { setGlance({ state: "unavailable" }); return; }
    let cancelled = false;
    setGlance({ state: "loading" });
    readPortalInvoices({ limit: PORTAL_INVOICES_MAX_PAGE })
      .then((page) => {
        if (cancelled) return;
        if (!page) { setGlance({ state: "unavailable" }); return; }
        setGlance({
          state: "ready",
          openCount: page.open_count,
          balances: page.balances,
          pastDue: page.has_more ? null : page.invoices.filter((i) => i.past_due).length,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setGlance(isMultipleRelationships(err) ? { state: "unavailable" } : { state: "error" });
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return glance;
}

/** "Mon, Nov 3" for an instant in the viewer's zone; the year only when it is not this year. */
export function invoiceInstantLabel(iso: string, nowMs: number, tz?: string): string {
  const d = new Date(iso);
  const year = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(x);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, month: "short", day: "numeric", ...(year(d) === year(new Date(nowMs)) ? {} : { year: "numeric" }),
  }).format(d);
}

/** A calendar date (due date) as written, never shifted by the viewer's zone. */
export function invoiceDateLabel(date: string, nowMs: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const sameYear = date.slice(0, 4) === new Date(nowMs).toISOString().slice(0, 4);
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

/** Where "Message {business}" goes from Payments. */
export const PAYMENTS_MESSAGE_HREF = "/app/messages?topic=payments";

/** "$1,250.00 and €300.00": every currency with something still owed, or null when nothing is. */
export function owedPhrase(balances: PortalInvoiceBalance[]): string | null {
  const owed = balances.filter((b) => b.remaining_minor > 0).map((b) => formatPaymentMinor(b.remaining_minor, b.currency));
  if (owed.length === 0) return null;
  return owed.length === 1 ? owed[0] : `${owed.slice(0, -1).join(", ")} and ${owed[owed.length - 1]}`;
}

/** The Messages draft a customer can edit and send when no payment link has arrived. */
export function paymentLinkRequestHref(invoiceNumber: string | null): string {
  const text = invoiceNumber
    ? `Could you send me a payment link for invoice ${invoiceNumber}?`
    : "Could you send me a payment link for my invoice?";
  return `/app/messages?${new URLSearchParams({ topic: "payments", draft: text })}`;
}
