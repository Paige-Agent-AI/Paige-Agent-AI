import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";
import { captureClientPortalAuthorization, withClientPortalBusiness } from "@/lib/client-portal-scope";
import { formatPaymentMinor, readCustomerPaymentRequest, type CustomerPaymentRequest } from "@/solo/sales/customerPaymentRequest";

/**
 * The invoices a business has issued to the signed-in customer (E09 Slice 5, "Payments").
 *
 * Selected-business reads go through client_portal_invoices_calendar_scoped(); compatible legacy
 * reads retain client_portal_invoices(). Both reuse the original financial query and resolve the relationship from the auth
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
export type PortalFinancialStanding = "recorded" | "needs_review" | "allocation_required" | "unavailable" | "not_applicable";
type PortalCurrentFinancial = {
  financial_evidence_version?: 3;
  financial_standing?: PortalFinancialStanding;
  refund_payable_minor?: number | null;
  credit_minor?: number | null;
  provider_net_minor?: number | null;
};

export interface PortalInvoice extends PortalCurrentFinancial {
  id: string;
  invoice_number: string | null;
  status: PortalInvoiceStatus;
  currency: string;
  issued_at: string;
  /** Calendar date (YYYY-MM-DD) or null. */
  due_date: string | null;
  amount_minor: number;
  remaining_minor: number | null;
  provider_verified_minor: number;
  manual_recorded_minor: number;
  test_provider_minor: number;
  /** Native real-receivable representation; absent on compatible legacy TEST simulation. */
  payment_evidence_version?: 2;
  /** The business has sent a payment link that is usable right now. The link is not in the list. */
  payable: boolean;
  past_due: boolean | null;
  /** Original immutable issued version, present only in the calendar-aware projection. */
  issued_snapshot_version?: number | null;
  /** Opaque original financial source identity, never an access credential. */
  financial_revision?: string | null;
  /** The original all-invoice snapshot used for this loaded row. */
  financial_page_revision?: string;
}

export interface PortalInvoiceBalance extends PortalCurrentFinancial {
  currency: string;
  remaining_minor: number | null;
  provider_verified_minor: number;
  manual_recorded_minor: number;
  test_provider_minor: number;
  payment_evidence_version?: 2;
}

export interface PortalInvoiceCursor { issued_at: string; id: string }

export type PortalInvoiceCalendar = Readonly<{
  state: "configured" | "missing" | "invalid";
  zone: string | null;
  local_date: string | null;
}>;

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
  open_count: number | null;
  read_at: string;
  /** Absent on the compatible legacy UTC reader. Never derived from the viewer's clock. */
  calendar?: PortalInvoiceCalendar;
  /** Retain the native representation even when this page has no invoice rows. */
  payment_evidence_version?: 2;
  financial_evidence_version?: 3;
  financial_revision?: string;
}

/**
 * The customer's own words for where an invoice stands. Whether anything is still owed comes from the
 * balance, as on the owner side; whether money was RECEIVED counts only money that moved. In the retained
 * legacy v1/v2 representation, a test payment
 * is allocated on the business's books (so nothing more is asked for), but it is never told to the
 * customer as a payment: an invoice it settled is "test_settled", and one it only part-settled is still
 * open or past due unless real money also arrived. An invoice settled by real money AND test money is
 * "partially_paid": the real money paid part of it; the rest was a test that moved nothing.
 * The explicitly versioned v3 representation instead carries native actual business remaining and
 * LIVE provider amounts: separate TEST evidence never reduces that debt or gets subtracted twice.
 */
export type PortalInvoiceDisplay = "open" | "past_due" | "partially_paid" | "paid" | "test_settled" | "voided" | "verification_pending" | "no_amount_due" | "refund_owed";

/** v3 already contains native LIVE money; older representations include TEST in their provider total. */
export function liveProviderMinor(i: Pick<PortalInvoice, "provider_verified_minor" | "test_provider_minor" | "payment_evidence_version">): number {
  if (i.payment_evidence_version === 2) return i.provider_verified_minor;
  return Math.max(0, i.provider_verified_minor - i.test_provider_minor);
}

export function invoiceDisplayState(i: PortalInvoice): PortalInvoiceDisplay {
  if (i.status === "void") return "voided";
  if (i.financial_evidence_version === 3) {
    if (i.financial_standing !== "recorded" || i.remaining_minor === null) return "verification_pending";
    if ((i.refund_payable_minor ?? 0) > 0) return "refund_owed";
    if (i.remaining_minor === 0) return "no_amount_due";
    if (i.past_due) return "past_due";
    return i.manual_recorded_minor > 0 || (i.provider_net_minor ?? 0) > 0 ? "partially_paid" : "open";
  }
  if (i.payment_evidence_version === 2) {
    if (i.remaining_minor === 0) return "paid";
    if (i.past_due) return "past_due";
    return i.manual_recorded_minor > 0 || i.provider_verified_minor > 0 ? "partially_paid" : "open";
  }
  if (i.remaining_minor === 0) {
    if (i.test_provider_minor === 0) return "paid";
    return i.amount_minor - i.test_provider_minor > 0 ? "partially_paid" : "test_settled";
  }
  if (i.past_due) return "past_due";
  // Part-paid only if something other than test money brought the balance down.
  if (i.remaining_minor !== null && i.amount_minor - i.remaining_minor - i.test_provider_minor > 0) return "partially_paid";
  return "open";
}

export const INVOICE_DISPLAY_LABEL: Record<PortalInvoiceDisplay, string> = {
  open: "Open", past_due: "Past due", partially_paid: "Partially paid", paid: "Paid", test_settled: "Test payment", voided: "Voided",
  verification_pending: "Verification pending", no_amount_due: "No amount due", refund_owed: "Refund due",
};

export const PORTAL_INVOICES_PAGE = 20;
export const PORTAL_INVOICES_MAX_PAGE = 40;

const PAGE_KEYS = ["schema_version", "tenant_id", "business_name", "invoices", "invoice_count", "has_more", "next_cursor", "balances", "open_count", "read_at"];
const INVOICE_KEYS = ["id", "invoice_number", "status", "currency", "issued_at", "due_date", "amount_minor", "remaining_minor",
  "provider_verified_minor", "manual_recorded_minor", "test_provider_minor", "payable", "past_due"];
const BALANCE_KEYS = ["currency", "remaining_minor", "provider_verified_minor", "manual_recorded_minor", "test_provider_minor"];
const CURRENT_FINANCIAL_KEYS = ["financial_standing", "refund_payable_minor", "credit_minor", "provider_net_minor"];
const CURSOR_KEYS = ["issued_at", "id"];

type RpcResult = { data: unknown; error: unknown };
type PortalRpc = "client_portal_invoices" | "client_portal_invoice_payment_request";
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: PortalRpc, args: Record<string, unknown>) {
  return supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
}


/** Original customer/business intent, never a permission or stored credential. */
export type PortalBillingScope = {actorId: string; tenantId: string; clientId: string};
export type PortalBillingReadContext = {scope: PortalBillingScope; current: () => boolean};
export class PortalBillingAccessFailure extends Error {}
type BillingRequest = PromiseLike<RpcResult> & {setHeader(name: string, value: string): BillingRequest};
/** One bounded original SDK read. Native Auth/CRM/commercial functions remain authority. */
async function scopedBillingRpc(name: string, args: Record<string, unknown>, context: PortalBillingReadContext, financialVersion?: 3): Promise<RpcResult> {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => active && context.current();
  const check = () => {if (!current()) throw new PortalBillingAccessFailure("Customer context changed");};
  const read = async () => {
    check();
    let authorization: string;
    try {authorization = await captureClientPortalAuthorization(supabase.auth, context.scope.actorId, current);}
    catch {throw new PortalBillingAccessFailure("Customer session could not be checked");}
    check();
    const query = supabase.rpc(name as never, {...args, p_tenant_id: context.scope.tenantId, p_expected_client_id: context.scope.clientId} as never) as unknown as BillingRequest;
    const selected = withClientPortalBusiness(query, context.scope.tenantId).setHeader("Authorization", authorization);
    // Representation negotiation only: the original RPC, actor, relationship
    // and native permission checks remain authority. Older servers return v2.
    const result = await (financialVersion === 3 || name === "client_portal_invoices_calendar_scoped"
      ? selected.setHeader("X-PAIGE-Invoice-Evidence-Version", financialVersion === 3 ? "3" : "2") : selected); // customer-identity-exempt: original technical representation header, never customer-facing assistant identity.
    check();
    const [captured, actual] = await Promise.all([supabase.auth.getUser(authorization.slice(7)), supabase.auth.getUser()]);
    check();
    if (captured.error || actual.error || captured.data.user?.id !== context.scope.actorId || actual.data.user?.id !== context.scope.actorId)
      throw new PortalBillingAccessFailure("Customer session changed");
    if (errorParts(result.error).code === "42501") throw new PortalBillingAccessFailure("Customer financial access unavailable");
    return result;
  };
  try {return await Promise.race([read(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => {active = false; reject(new Error("Invoice read timed out"));}, 20_000);
  })]);} finally {active = false; clearTimeout(timer);}
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
const isRevision = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
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

/** Decode the existing native facts only; no allocation or refund math belongs here. */
function currentFinancial(raw: Record<string, unknown>, numeric = false): Required<PortalCurrentFinancial> & {remaining_minor: number | null} {
  const standing = raw.financial_standing;
  if (!["recorded", "needs_review", "allocation_required", "unavailable", "not_applicable"].includes(String(standing))) throw new Error("Unexpected financial standing");
  const decode = (value: unknown, signed = false): number => {
    if (numeric) {
      if (!Number.isSafeInteger(value) || (!signed && Number(value) < 0)) throw new Error("Unexpected financial amount");
      return Number(value);
    }
    if (signed && typeof value === "string" && /^-\d{1,15}$/.test(value)) return -minor(value.slice(1));
    return minor(value);
  };
  const names = ["remaining_minor", "refund_payable_minor", "credit_minor", "provider_net_minor"];
  const amounts = names.map((key) => {
    if (standing === "recorded") return decode(raw[key], key === "provider_net_minor");
    if (raw[key] !== null) throw new Error("Unexpected unresolved financial amount");
    return null;
  });
  return {financial_evidence_version: 3, financial_standing: standing as PortalFinancialStanding,
    remaining_minor: amounts[0], refund_payable_minor: amounts[1], credit_minor: amounts[2], provider_net_minor: amounts[3]};
}

function parseInvoice(raw: unknown, calendar?: PortalInvoiceCalendar, paymentEvidenceVersion?: 2, financialVersion?: 3, pageRevision?: string): PortalInvoice {
  const keys = calendar ? [...INVOICE_KEYS, "issued_snapshot_version"] : INVOICE_KEYS;
  if (!isObject(raw) || !exactKeys(raw, financialVersion ? [...keys, ...CURRENT_FINANCIAL_KEYS, "financial_revision"] : keys)) throw new Error("Unexpected invoice");
  const { id, invoice_number, status, currency, issued_at, due_date, payable, past_due } = raw;
  if (!isId(id) || (invoice_number !== null && typeof invoice_number !== "string") || (status !== "issued" && status !== "void")
    || !isCurrency(currency) || !isInstant(issued_at) || (due_date !== null && !isCalendarDate(due_date))
    || typeof payable !== "boolean" || (typeof past_due !== "boolean" && !(calendar && past_due === null))) {
    throw new Error("Unexpected invoice");
  }
  const financial = financialVersion ? currentFinancial(raw) : undefined;
  if (financial && (!isRevision(pageRevision) || !(raw.financial_revision === null && financial.financial_standing !== "recorded") && !isRevision(raw.financial_revision))) throw new Error("Unexpected financial revision");
  const amount = minor(raw.amount_minor), remaining = financial ? financial.remaining_minor : remainingMinor(raw.remaining_minor);
  if (!financial && remaining !== null && remaining > amount) throw new Error("Unexpected invoice");
  if (financial && (status === "void" ? financial.financial_standing !== "not_applicable" : financial.financial_standing === "not_applicable")) throw new Error("Unexpected financial standing");
  const held = status === "issued" && !!financial && financial.financial_standing !== "recorded";
  if (held && (payable || past_due !== null)) throw new Error("Unexpected unresolved invoice");
  // A voided invoice is never payable or past due; an invoice with nothing owed cannot be either.
  if ((status === "void" || remaining === 0) && (payable || past_due)) throw new Error("Unexpected invoice");
  if (calendar) {
    if (raw.issued_snapshot_version !== null && (!Number.isSafeInteger(raw.issued_snapshot_version) || Number(raw.issued_snapshot_version) < 1)) throw new Error("Unexpected invoice version");
    if (held) {
      if (past_due !== null) throw new Error("Unexpected invoice date state");
    } else if (calendar.state === "configured") {
      if (past_due === null) throw new Error("Unexpected invoice date state");
    } else {
      const unknown = status === "issued" && remaining !== null && remaining > 0 && due_date !== null;
      if (unknown ? past_due !== null : past_due !== false) throw new Error("Unexpected invoice date state");
    }
  }
  return {
    id, status, currency, issued_at, payable, past_due: past_due as boolean | null,
    due_date: typeof due_date === "string" ? due_date : null,
    invoice_number: typeof invoice_number === "string" && invoice_number.trim() ? invoice_number.trim() : null,
    amount_minor: amount,
    remaining_minor: remaining,
    provider_verified_minor: minor(raw.provider_verified_minor),
    manual_recorded_minor: minor(raw.manual_recorded_minor),
    test_provider_minor: minor(raw.test_provider_minor),
    ...(calendar ? {issued_snapshot_version: raw.issued_snapshot_version as number | null} : {}),
    ...(paymentEvidenceVersion ? {payment_evidence_version: paymentEvidenceVersion} : {}),
    ...financial,
    ...(financial ? {financial_revision: raw.financial_revision as string | null, financial_page_revision: pageRevision} : {}),
  };
}

function parseBalance(raw: unknown, paymentEvidenceVersion?: 2, financialVersion?: 3): PortalInvoiceBalance {
  if (!isObject(raw) || !exactKeys(raw, financialVersion ? [...BALANCE_KEYS, ...CURRENT_FINANCIAL_KEYS] : BALANCE_KEYS) || !isCurrency(raw.currency)) throw new Error("Unexpected balance");
  const financial = financialVersion ? currentFinancial(raw) : undefined;
  if (financial && !["recorded", "needs_review"].includes(financial.financial_standing)) throw new Error("Unexpected aggregate financial standing");
  return {
    currency: raw.currency,
    remaining_minor: financial ? financial.remaining_minor : remainingMinor(raw.remaining_minor),
    provider_verified_minor: minor(raw.provider_verified_minor),
    manual_recorded_minor: minor(raw.manual_recorded_minor),
    test_provider_minor: minor(raw.test_provider_minor),
    ...(paymentEvidenceVersion ? {payment_evidence_version: paymentEvidenceVersion} : {}),
    ...financial,
  };
}

/** Null = no customer relationship. Throws on any payload outside the promised shape. */
export function parseInvoicePage(data: unknown): PortalInvoicePage | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || ![1,2,3,4].includes(Number(data.schema_version)) || typeof data.schema_version !== "number") throw new Error("Unexpected invoices response");
  const financialVersion = data.schema_version === 4 ? 3 : undefined;
  const paymentEvidenceVersion = data.schema_version === 3 || financialVersion ? 2 : undefined;
  const calendarAware = data.schema_version !== 1;
  const keys = financialVersion ? [...PAGE_KEYS, "calendar", "payment_evidence_version", "financial_evidence_version", "financial_revision"] : paymentEvidenceVersion ? [...PAGE_KEYS, "calendar", "payment_evidence_version"] : calendarAware ? [...PAGE_KEYS, "calendar"] : PAGE_KEYS;
  if (!exactKeys(data, keys) || (paymentEvidenceVersion && data.payment_evidence_version !== paymentEvidenceVersion) || (financialVersion && (data.financial_evidence_version !== 3 || !isRevision(data.financial_revision)))) throw new Error("Unexpected invoices response");
  let calendar: PortalInvoiceCalendar | undefined;
  if (calendarAware) {
    const c = data.calendar;
    if (!isObject(c) || !exactKeys(c, ["state", "zone", "local_date"]) || !["configured", "missing", "invalid"].includes(String(c.state))) throw new Error("Unexpected invoice calendar");
    if (c.state === "configured") {
      if (typeof c.zone !== "string" || !c.zone || c.zone.length > 100 || Array.from(c.zone).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || !isCalendarDate(c.local_date) || new Date(`${c.local_date}T00:00:00Z`).toISOString().slice(0, 10) !== c.local_date) throw new Error("Unexpected invoice calendar");
    } else if (c.zone !== null || c.local_date !== null) throw new Error("Unexpected invoice calendar");
    calendar = {state: c.state as PortalInvoiceCalendar["state"], zone: c.zone as string | null, local_date: c.local_date as string | null};
  }
  const { tenant_id, business_name, invoices, invoice_count, has_more, next_cursor, balances, open_count, read_at } = data;
  if (!isId(tenant_id) || (business_name !== null && typeof business_name !== "string") || !Array.isArray(invoices)
    || invoices.length > PORTAL_INVOICES_MAX_PAGE || !isCount(invoice_count) || typeof has_more !== "boolean"
    || !Array.isArray(balances) || (!(financialVersion && open_count === null) && (!isCount(open_count) || open_count > invoice_count)) || !isInstant(read_at)) {
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
  const parsed = invoices.map((invoice) => parseInvoice(invoice, calendar, paymentEvidenceVersion, financialVersion, data.financial_revision as string | undefined));
  if (new Set(parsed.map((i) => i.id)).size !== parsed.length) throw new Error("Unexpected invoices response");
  const parsedBalances = balances.map((balance) => parseBalance(balance, paymentEvidenceVersion, financialVersion));
  if (new Set(parsedBalances.map((b) => b.currency)).size !== parsedBalances.length) throw new Error("Unexpected invoices response");
  if (financialVersion && (open_count === null) !== parsedBalances.some((b) => b.financial_standing !== "recorded")) throw new Error("Unexpected aggregate financial standing");
  return {
    tenant_id, has_more, invoice_count, open_count: open_count as number | null, read_at,
    business_name: typeof business_name === "string" && business_name.trim() ? business_name.trim() : null,
    invoices: parsed,
    next_cursor: cursor,
    balances: parsedBalances,
    ...(calendar ? {calendar} : {}),
    ...(paymentEvidenceVersion ? {payment_evidence_version: paymentEvidenceVersion} : {}),
    ...(financialVersion ? {financial_evidence_version: financialVersion, financial_revision: data.financial_revision as string} : {}),
  };
}

/** One read of the caller's invoices. Null = no customer relationship. Throws on a failed read. */
export async function readPortalInvoices(args: { tenantId?: string | null; limit?: number; after?: PortalInvoiceCursor | null; context?: PortalBillingReadContext; financialVersion?: 3 } = {}): Promise<PortalInvoicePage | null> {
  const params = {
    p_tenant_id: args.tenantId ?? null,
    p_limit: args.limit ?? PORTAL_INVOICES_PAGE,
    p_after: args.after ?? null,
  };
  if (args.financialVersion && !args.context) throw new Error("Current financial read requires the original customer context");
  const {data, error} = await (args.context ? scopedBillingRpc("client_portal_invoices_calendar_scoped", params, args.context, args.financialVersion) : portalRpc("client_portal_invoices", params));
  if (error) throw error;
  if (data !== null && data !== undefined && (!isObject(data) || (args.context ? ![2,3,4].includes(Number(data.schema_version)) : data.schema_version !== 1)
    || args.financialVersion === 3 && (data.schema_version !== 4 || data.financial_evidence_version !== 3))) throw new Error("Unexpected invoices response");
  const page = parseInvoicePage(data);
  if (args.context && (!page || page.tenant_id !== args.context.scope.tenantId)) throw new PortalBillingAccessFailure("Customer financial scope changed");
  return page;
}


/** Recheck the exact original invoice/customer through EXP04's unchanged ledger projection.
 * Used before and after the existing document renderer; no bearer grant, ledger write or new renderer. */
export async function verifyPortalInvoiceAccess(invoiceId: string, context: PortalBillingReadContext): Promise<void> {
  const reply = await scopedBillingRpc("client_portal_invoice_ledger_scoped", {p_invoice_id: invoiceId, _limit: 1, _cursor: null}, context, 3);
  if (reply.error || !isObject(reply.data) || reply.data.invoice_id !== invoiceId)
    throw new PortalBillingAccessFailure("Customer invoice access unavailable");
}

export type PortalPaymentRead =
  /**
   * The server's answer, parsed by the one parser. `request` is null when the business sent no payment
   * request. `environment` is the request's provider environment: "test" means paying moves no money;
   * null when there is no request or the value is not one the contract names (never assumed live).
   */
  | { state: "ready"; request: CustomerPaymentRequest | null; remainingMinor: number | null; testProviderMinor: number; environment: "test" | "live" | null; paymentEvidenceVersion?: 2;
      financialEvidenceVersion?: 3; financialStanding?: PortalFinancialStanding; refundPayableMinor?: number | null; creditMinor?: number | null; providerNetMinor?: number | null; financialRevision?: string | null }
  /** Not this customer's invoice, not issued (voided), or gone. */
  | { state: "unavailable" };

/**
 * The payment request the business sent for one issued invoice, read-only. Never creates or dispatches
 * anything. The top-level shape is what readCustomerPaymentRequest already parses for the bearer page.
 */
export async function readPortalInvoicePayment(args: { invoiceId: string; tenantId: string | null; context?: PortalBillingReadContext; financialVersion?: 3 }): Promise<PortalPaymentRead> {
  const params = {p_invoice_id: args.invoiceId, p_tenant_id: args.tenantId};
  if (args.financialVersion && !args.context) throw new Error("Current financial read requires the original customer context");
  const {data, error} = await (args.context ? scopedBillingRpc("client_portal_invoice_payment_request_scoped", params, args.context, args.financialVersion) : portalRpc("client_portal_invoice_payment_request", params));
  if (error) {
    if (isInvoiceUnavailable(error)) return { state: "unavailable" };
    throw error;
  }
  // Null = the caller has no customer relationship (any more): nothing here is theirs to pay.
  if (data === null || data === undefined) return { state: "unavailable" };
  if (!isObject(data) || data.invoice_id !== args.invoiceId) {
    throw new Error("Unexpected payment response");
  }
  const current = data.financial_evidence_version === 3;
  if (args.financialVersion === 3 && !current || data.financial_evidence_version !== undefined && !current) throw new Error("Unexpected payment representation");
  let financial: Pick<Extract<PortalPaymentRead, {state: "ready"}>, "financialEvidenceVersion" | "financialStanding" | "refundPayableMinor" | "creditMinor" | "providerNetMinor" | "financialRevision"> = {};
  if (current) {
    if (!exactKeys(data, ["invoice_id", "invoice_number", "remaining_cents", "test_provider_cents", "payment_request", "payment_evidence_version", "financial_evidence_version", "financial_revision", ...CURRENT_FINANCIAL_KEYS])
      || data.payment_evidence_version !== 2 || data.invoice_number !== null && typeof data.invoice_number !== "string") throw new Error("Unexpected payment response");
    const facts = currentFinancial({...data, remaining_minor: data.remaining_cents}, true);
    if (!(data.financial_revision === null && facts.financial_standing !== "recorded") && !isRevision(data.financial_revision)) throw new Error("Unexpected financial revision");
    if (facts.financial_standing === "not_applicable" || (facts.financial_standing !== "recorded" || facts.remaining_minor === 0) && data.payment_request !== null) throw new Error("Unexpected current payment request");
    financial = {financialEvidenceVersion: 3, financialStanding: facts.financial_standing, refundPayableMinor: facts.refund_payable_minor, creditMinor: facts.credit_minor, providerNetMinor: facts.provider_net_minor, financialRevision: data.financial_revision as string | null};
  } else if (!Number.isSafeInteger(data.remaining_cents) || Number(data.remaining_cents) < 0) throw new Error("Unexpected payment response");
  const testCents = data.test_provider_cents;
  const evidenceVersion = data.payment_evidence_version;
  if (evidenceVersion !== undefined && (evidenceVersion !== 2 || !Number.isSafeInteger(testCents) || Number(testCents) < 0)) {
    throw new Error("Unexpected payment representation");
  }
  const evidence = evidenceVersion === 2 ? {paymentEvidenceVersion: 2 as const} : {};
  const testProviderMinor = Number.isSafeInteger(testCents) && Number(testCents) >= 0 ? Number(testCents) : 0;
  if (data.payment_request === null) return { state: "ready", request: null, remainingMinor: data.remaining_cents === null ? null : Number(data.remaining_cents), testProviderMinor, environment: null, ...evidence, ...financial };
  const request = readCustomerPaymentRequest(data);
  // A request the parser cannot read is never shown as "no request": that would hide a link the business sent.
  if (!request) throw new Error("Unexpected payment response");
  const env = isObject(data.payment_request) ? data.payment_request.environment : null;
  const environment = env === "test" || env === "live" ? env : null;
  return { state: "ready", request, remainingMinor: request.remainingMinor, testProviderMinor, environment, ...evidence, ...financial };
}

export interface ClientPortalInvoicesState {
  /** Newest first; older pages appended by loadMore. */
  invoices: PortalInvoice[];
  balances: PortalInvoiceBalance[];
  openCount: number | null;
  /**
   * Past-due invoices among those loaded. The server sends no all-page past-due count, so this is the
   * whole figure only once every page is loaded (hasMore false); the page shows it only then.
   */
  pastDueCount: number;
  /** False when any loaded dated obligation has unknown overdue status. */
  pastDueKnown?: boolean;
  calendar?: PortalInvoiceCalendar;
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
  /** Resolved: the original resolver requires an authorized business choice. */
  multipleBusinesses: boolean;
  /** Tenant of the loaded invoices (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes. */
  scopeEpoch: number;
  /** True once a read for this identity has landed. */
  loaded: boolean;
  /** Exact original selected intent for this mounted page; contains no credential. */
  requestContext?: PortalBillingReadContext;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const PORTAL_INVOICES_LOAD_ERROR = "We couldn't load your invoices. Check your connection and try again.";
/** A failed re-read while the last list is still on screen: the list is there, it may just be behind. */
export const PORTAL_INVOICES_REFRESH_ERROR = "We couldn't refresh your invoices, so this may be out of date.";

export function useClientPortalInvoices(enabled = true, initialLimit = PORTAL_INVOICES_PAGE): ClientPortalInvoicesState {
  const identity = useShellCustomerIdentity();
  const frame = identity?.viewer === "customer" ? identity.frame : null;
  const requested = frame && isId(frame.actorId) && isId(frame.profile.tenant_id) && isId(frame.profile.id)
    && frame.profile.linked_user_id === frame.actorId
    ? {actorId: frame.actorId, tenantId: frame.profile.tenant_id, clientId: frame.profile.id} : undefined;
  const requestedKey = identity ? JSON.stringify([identity.viewer, requested?.actorId, requested?.tenantId, requested?.clientId]) : "legacy";
  const available = enabled && (!identity || identity.viewer === "staff" || !!requested && identity.phase === "ready" && !identity.checking);
  const alive = useRef(true);
  const origin = useRef({key: requestedKey, available, generation: 0, signedOut: false});
  if (origin.current.key !== requestedKey || origin.current.available !== available) {
    origin.current = {...origin.current, key: requestedKey, available, generation: origin.current.generation + 1};
  }
  const generation = origin.current.generation;
  const dataGeneration = useRef(-1);
  const requestedActor = requested?.actorId, requestedTenant = requested?.tenantId, requestedClient = requested?.clientId;
  const scopeCurrent = useCallback(() => alive.current && origin.current.generation === generation && origin.current.available && !origin.current.signedOut, [generation]);
  const requestContext = useMemo<PortalBillingReadContext | undefined>(() => requestedActor && requestedTenant && requestedClient
    ? {scope: {actorId: requestedActor, tenantId: requestedTenant, clientId: requestedClient}, current: scopeCurrent} : undefined,
  [requestedActor, requestedTenant, requestedClient, scopeCurrent]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [balances, setBalances] = useState<PortalInvoiceBalance[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(0);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [, setScopeEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [calendar, setCalendar] = useState<PortalInvoiceCalendar>();
  const calendarRef = useRef<PortalInvoiceCalendar | undefined>(undefined);
  const financialVersionRef = useRef<string | undefined>(undefined);

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const cursorRef = useRef<PortalInvoiceCursor | null>(null);
  const countRef = useRef(0);
  const readSeq = useRef(0);
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
    setCalendar(undefined);
    calendarRef.current = undefined;
    financialVersionRef.current = undefined;
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
    setCalendar(page.calendar);
    calendarRef.current = page.calendar;
    financialVersionRef.current = `${page.payment_evidence_version ?? "legacy"}:${page.financial_evidence_version ?? "legacy"}:${page.financial_revision ?? "legacy"}`;
    setInvoices((prev) => {
      if (!append) { countRef.current = page.invoices.length; return page.invoices; }
      const seen = new Set(prev.map((i) => i.id));
      const next = [...prev, ...page.invoices.filter((i) => !seen.has(i.id))];
      countRef.current = next.length;
      return next;
    });
    dataGeneration.current = generation;
    setLoaded(true);
    shown.current = true;
  }, [generation]);

  const fail = useCallback((err: unknown) => {
    dataGeneration.current = generation;
    if (err instanceof PortalBillingAccessFailure) {
      halted.current = true; clearData(); setUnavailable(true); setError(null);
    } else if (isMultipleRelationships(err)) {
      halted.current = true;
      clearData();
      setError(null);
      setMultipleBusinesses(true);
    } else {
      setError(shown.current ? PORTAL_INVOICES_REFRESH_ERROR : PORTAL_INVOICES_LOAD_ERROR);
    }
  }, [clearData, generation]);

  const refresh = useCallback(async () => {
    if (halted.current || !scopeCurrent()) return;
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && scopeCurrent() && myEpoch === epoch.current && seq === readSeq.current;
    const pinned = tenantRef.current;
    // Re-read as many as are on screen (up to one full page), so a refresh never folds away older invoices
    // the customer just opened, unless they had opened more than one page holds.
    const limit = Math.min(PORTAL_INVOICES_MAX_PAGE, Math.max(initialLimit, countRef.current));
    try {
      const page = await readPortalInvoices({ tenantId: requestContext?.scope.tenantId ?? pinned, limit, context: requestContext, ...(requestContext ? {financialVersion: 3 as const} : {}) });
      if (!current()) return;
      if (!page) {
        clearData(); dataGeneration.current = generation;
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
  }, [apply, clearData, fail, scopeCurrent, initialLimit, requestContext, generation]);

  const loadMore = useCallback(async () => {
    const after = cursorRef.current;
    const pinned = tenantRef.current;
    if (halted.current || !scopeCurrent() || !after || !pinned || moreInFlight.current) return;
    moreInFlight.current = true;
    const myEpoch = epoch.current;
    const seq = readSeq.current;
    // A refresh that started meanwhile owns the list; this page is then dropped.
    const current = () => alive.current && scopeCurrent() && myEpoch === epoch.current && seq === readSeq.current;
    setLoadingMore(true);
    try {
      const page = await readPortalInvoices({ tenantId: pinned, after, context: requestContext, ...(requestContext ? {financialVersion: 3 as const} : {}) });
      if (!current()) return;
      if (!page || page.tenant_id !== pinned) throw new Error("Invoice business changed");
      // Never blend invoice-date states from different original business days.
      // This is a fresh read, not a retry of any financial or provider action.
      if (JSON.stringify(page.calendar) !== JSON.stringify(calendarRef.current)
        || `${page.payment_evidence_version ?? "legacy"}:${page.financial_evidence_version ?? "legacy"}:${page.financial_revision ?? "legacy"}` !== financialVersionRef.current) {
        clearData();
        setLoading(true);
        await refresh();
        return;
      }
      apply(page, true);
      setError(null);
    } catch (err) {
      if (!current()) return;
      fail(err);
    } finally {
      if (myEpoch === epoch.current) { moreInFlight.current = false; if (alive.current) setLoadingMore(false); }
    }
  }, [apply, clearData, fail, refresh, requestContext, scopeCurrent]);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    resetScope();
    let cancelled = false;
    const start = async () => {
      if (!available || origin.current.signedOut) return;
      if (requestedActor) {actor.current = requestedActor; await refresh(); return;}
      let user: {id: string} | null;
      try {const result = await supabase.auth.getUser(); if (result.error) throw result.error; user = result.data.user;}
      catch {if (!cancelled && scopeCurrent()) {fail(new PortalBillingAccessFailure("Customer session could not be checked")); setLoading(false);} return;}
      if (cancelled || !scopeCurrent()) return;
      if (requestedActor && user?.id !== requestedActor) {fail(new PortalBillingAccessFailure("Customer session changed")); setLoading(false); return;}
      actor.current = user?.id ?? null;
      if (!user) { dataGeneration.current = generation; setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (origin.current.signedOut && event !== "SIGNED_IN") return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor.current) return;
      if (next === actor.current && event !== "SIGNED_OUT") return;
      ++origin.current.generation;
      origin.current.signedOut = event === "SIGNED_OUT" || !next;
      actor.current = next;
      resetScope();
      if (!next || event === "SIGNED_OUT") { dataGeneration.current = generation; setLoading(false); setUnavailable(true); return; }
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => { if (!cancelled) void refresh(); });
    });
    return () => {
      cancelled = true;
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [refresh, resetScope, available, scopeCurrent, fail, generation, requestedActor]);

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

  const refused = !!identity && (identity.viewer === "inactive" || ["unavailable", "paused", "ended"].includes(identity.phase));
  const heldError = !available && identity?.phase === "error";
  const masked = !available || origin.current.signedOut || dataGeneration.current !== generation;
  const pastDueCount = invoices.filter((i) => i.past_due).length;
  if (masked) return {invoices: [], balances: [], openCount: 0, pastDueCount: 0, invoiceCount: 0, hasMore: false, businessName: null,
    loading: !origin.current.signedOut && !refused && !heldError, loadingMore: false, error: heldError ? PORTAL_INVOICES_LOAD_ERROR : null, unavailable: origin.current.signedOut || refused, multipleBusinesses: false, tenantId: null,
    scopeEpoch: generation, loaded: false, requestContext, refresh, loadMore};
  return {
    invoices, balances, openCount, pastDueCount, pastDueKnown: invoices.every((i) => i.past_due !== null), calendar, invoiceCount, hasMore, businessName, loading, loadingMore, error, unavailable,
    multipleBusinesses, tenantId, scopeEpoch: generation, loaded, requestContext, refresh, loadMore,
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
  const source = useClientPortalInvoices(enabled, PORTAL_INVOICES_MAX_PAGE);
  if (!enabled || source.unavailable || source.multipleBusinesses) return {state: "unavailable"};
  if (source.error) return {state: "error"};
  if (source.loading || !source.loaded) return {state: "loading"};
  if (source.openCount === null || source.balances.some((balance) => balance.remaining_minor === null)) return {state: "error"};
  return {state: "ready", openCount: source.openCount, balances: source.balances, pastDue: source.hasMore || source.pastDueKnown === false ? null : source.pastDueCount};
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
  if (balances.some((b) => b.remaining_minor === null)) return "Balance awaiting verification";
  const owed = balances.flatMap((b) => b.remaining_minor !== null && b.remaining_minor > 0 ? [formatPaymentMinor(b.remaining_minor, b.currency)] : []);
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
