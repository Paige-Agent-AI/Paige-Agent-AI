// Experience 04 · E4-S1 "Where this client stands" — the composer.
//
// Input: the read-only source projection returned by public.read_client_engagement_status.
// Output: one truthful client status. Every derived number names its evidence class.
//
// Invariants this module exists to hold (each has a test that fails if it is broken):
//   * Provider-verified money (live), money the owner recorded by hand, and test-environment
//     provider money are three different things and are never summed into one "received".
//   * A contractual obligation (the agreed schedule) is not an invoice; an invoice is not money.
//   * A payment request in flight or with an unknown outcome is never counted as received.
//   * Facts the platform does not record (disputes, refunds, an "effective" transition,
//     installment-level allocation) are declared as not recorded — never inferred as zero.
//   * Unreadable or inconsistent sources degrade to a named state, never to a confident number.
//   * "Today" is the calendar date in the BUSINESS OWNER's configured time zone (owner ruling,
//     2026-10-12) — never UTC, server time or the viewer's zone. Without a usable zone every due,
//     upcoming and overdue judgement is withheld (null) and `business_time_zone_unset` is raised.
//     Contractual due dates and payment timestamps are passed through unchanged.
//   * An invoice bound to the terms always carries the WHOLE agreed amount (the Sales writer refuses
//     anything else: _sales_validate_invoice_terms_reference), so what is past due on it comes from
//     the agreed schedule, never from the invoice total against its first due date.
// The schedule is expanded by the canonical Collections model; nothing here re-derives it.
import { parseCollectionTerms, MAX_SCHEDULE } from '../sales-collections/contract.ts';
import { previewCollectionSchedule } from '../sales-collections/model.ts';
import { localDateInZone } from '../paige-context/snapshot.ts';

type Json = Record<string, unknown>;

export type SourceTerms = {
  id: string; offer_id: string | null; offer_name: string | null; title: string | null; status: string;
  agreed_amount_minor: number | null; agreed_currency: string | null;
  collection_terms: unknown; collection_terms_version: number;
  starts_on: string | null; ends_on: string | null; created_at: string; updated_at: string;
};
export type SourceSigning = {
  id: string; commercial_terms_id: string | null; offer_id: string | null; title: string | null; status: string;
  version: number | null; sent_at: string | null; viewed_at: string | null; completed_at: string | null;
  declined_at: string | null; voided_at: string | null; expires_at: string | null; sealed: boolean; created_at: string;
};
export type SourcePaymentRequest = {
  state: string; amount_minor: number; currency: string; environment: 'test' | 'live'; purpose: string; updated_at: string;
};
export type SourceInvoice = {
  id: string; invoice_number: string; status: string; amount_minor: number; currency: string;
  due_date: string | null; issued_at: string | null; created_at: string;
  commercial_terms_reference: { id: string; version: number } | null;
  allocated_minor: number; remaining_minor: number; manual_recorded_minor: number;
  provider_verified_live_minor: number; provider_verified_test_minor: number;
  reversal_count: number; open_payment_requests: SourcePaymentRequest[]; failed_payment_requests: number;
};
export type SourceWorkItem = {
  id: string; plan_id: string | null; item_type: 'milestone' | 'task'; title: string | null; status: string;
  due_at: string | null; completed_at: string | null; assigned: boolean;
};
export type ClientEngagementSource = {
  tenant_id: string; contact_id: string; client_name: string | null; read_at: string;
  /** The business owner's configured zone, resolved by the read for the workspace (not the caller). */
  business_time_zone: { state: TimeZoneState; zone: string | null };
  /** Owner-local date computed by the database; informational. The composer computes its own. */
  as_of_date: string | null;
  terms: SourceTerms[]; terms_has_more: boolean;
  signings: SourceSigning[]; signings_has_more: boolean;
  invoices: SourceInvoice[]; invoices_has_more: boolean;
  work: { total: number; done: number; cancelled: number; blocked: number; open: number; overdue: number;
    undated_open: number; items: SourceWorkItem[]; items_has_more: boolean };
  not_recorded: string[]; receipt_id: string;
};

export type TimeZoneState = 'configured' | 'missing' | 'ambiguous' | 'invalid';
export type AgreementState = 'none' | 'draft' | 'sent' | 'viewed' | 'partially_signed' | 'signed'
  | 'declined' | 'voided' | 'expired';
export type TermsState = 'absent' | 'current' | 'stale' | 'unreadable';
export type InvoicePaymentState = 'draft' | 'void' | 'written_off' | 'paid' | 'partially_paid' | 'unpaid'
  | 'awaiting_confirmation' | 'outcome_unknown';
export type WorkState = 'none' | 'complete' | 'on_schedule' | 'behind' | 'undated';
export type Attention = 'agreement_not_signed' | 'agreement_not_bound_to_terms' | 'terms_stale'
  | 'terms_unreadable' | 'payment_overdue' | 'behind_schedule' | 'payment_outcome_unknown'
  | 'payment_request_failed' | 'invoice_status_legacy' | 'work_overdue' | 'work_blocked'
  | 'mixed_currency' | 'list_truncated' | 'terms_invoiced_more_than_once' | 'other_terms_not_shown'
  | 'business_time_zone_unset';

/** `due` is true when the row falls due on or before today in the owner's zone; null when today is unknown. */
export type ScheduleRow = { sequence: number; due_date: string; amount_minor: number; due: boolean | null; label: string | null };

export type ClientEngagementStatus = {
  client: { id: string; name: string | null };
  /** Today in the business owner's zone; null when that zone is missing, ambiguous or invalid. */
  as_of_date: string | null;
  time_zone: { state: TimeZoneState; zone: string | null };
  agreement: {
    state: AgreementState; signing_id: string | null; title: string | null; sent_at: string | null;
    completed_at: string | null; sealed: boolean; bound_to_terms: boolean;
    /** The platform has no "effective" transition yet: signing and active terms are reported separately. */
    effective: 'not_recorded';
  };
  terms: null | {
    id: string; state: TermsState; status: string; version: number; offer_name: string | null; title: string | null;
    currency: string | null; agreed_minor: number | null; kind: string | null; recurring: boolean;
    schedule: ScheduleRow[]; schedule_has_more: boolean;
  };
  money: {
    currency: string | null; mixed_currency: boolean;
    /** Agreed total for a finite (non-recurring) schedule whose terms are current; otherwise null. */
    contracted_minor: number | null;
    /** Sum of schedule rows due on or before as_of_date; null when it cannot be known exactly. */
    due_to_date_minor: number | null;
    // Every money total below is null when currencies are mixed or the invoice list is truncated:
    // a sum across currencies is meaningless and a sum over a partial list is a lower bound.
    /** Billed on invoices (issued, imported or legacy sent/paid); drafts, voids and write-offs excluded. */
    invoiced_minor: number | null;
    /** Billed on invoices that reference the agreed terms. */
    invoiced_against_terms_minor: number | null;
    /** Real receipts on invoices that reference the agreed terms, still kept apart by evidence class. */
    received_against_terms: { verified_minor: number | null; recorded_by_owner_minor: number | null };
    /** contracted − invoiced against the terms, when both are known; agreed but not yet invoiced. */
    not_yet_invoiced_minor: number | null;
    received: {
      /** Settled by the payment provider in its LIVE environment and verified by readback. */
      verified_minor: number | null;
      /** Recorded by the owner by hand (net of reversals). Real, but not provider-verified. */
      recorded_by_owner_minor: number | null;
      /** Provider TEST environment. Never real money; excluded from every total. */
      test_environment_minor: number | null;
    };
    /** invoiced − (verified + recorded by owner): the remaining balance, including schedule rows not
     *  yet due on an invoice bound to the terms. Test money never reduces what is owed. */
    outstanding_minor: number | null;
    /** Past due: on a bound invoice, schedule rows due before today less real receipts on it; on any
     *  other invoice, its remaining balance once its due date has passed. Null when not knowable. */
    overdue_minor: number | null;
    /** Payment requests in flight (live, dispatched) on invoices still owed. Not received until settled. */
    awaiting_confirmation_minor: number | null;
    outcome_unknown_count: number;
    failed_request_count: number;
    /** due_to_date − real receipts on invoices referencing the terms; positive means behind. Null when unknown. */
    behind_schedule_minor: number | null;
    reversal_count: number;
    disputes: 'not_recorded';
  };
  invoices: Array<{
    id: string; number: string; status: string; payment_state: InvoicePaymentState; amount_minor: number;
    outstanding_minor: number; verified_minor: number; recorded_by_owner_minor: number; test_environment_minor: number;
    /** What is past due on this invoice; null for a bound invoice whose schedule cannot be read. */
    past_due_minor: number | null;
    due_date: string | null; overdue: boolean | null; bound_to_terms: boolean; legacy_status: boolean;
  }>;
  work: {
    state: WorkState; total: number; done: number; open: number; overdue: number; blocked: number;
    next: null | { title: string | null; due_at: string; item_type: 'milestone' | 'task' };
    items: SourceWorkItem[];
  };
  attention: Attention[];
  not_recorded: string[];
  truncated: { terms: boolean; signings: boolean; invoices: boolean; work: boolean };
  receipt_id: string;
};

const BILLED = new Set(['issued', 'recorded', 'sent', 'paid']);
const LEGACY = new Set(['sent', 'paid']);
const TERMS_PRIORITY: Record<string, number> = { active: 0, paused: 1, draft: 2, completed: 3, cancelled: 4 };
const SIGNING_STATE: Record<string, AgreementState> = {
  draft: 'draft', sent: 'sent', viewed: 'viewed', partially_signed: 'partially_signed', completed: 'signed',
  declined: 'declined', voided: 'voided', expired: 'expired',
};

const fail = (code: string): never => { throw new TypeError(`CLIENT_STATUS_SOURCE_INVALID:${code}`); };
const minor = (value: unknown, code: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fail(code);

function pickTerms(rows: SourceTerms[]): SourceTerms | null {
  const ranked = rows.filter(row => row.status in TERMS_PRIORITY)
    .sort((a, b) => TERMS_PRIORITY[a.status] - TERMS_PRIORITY[b.status] || b.created_at.localeCompare(a.created_at));
  return ranked[0] ?? null;
}

function composeTerms(row: SourceTerms | null, asOf: string | null): ClientEngagementStatus['terms'] {
  if (!row) return null;
  const base = {
    id: row.id, status: row.status, version: row.collection_terms_version, offer_name: row.offer_name, title: row.title,
    currency: row.agreed_currency, agreed_minor: row.agreed_amount_minor,
  };
  if (row.collection_terms === null) {
    return { ...base, state: 'absent', kind: null, recurring: false, schedule: [], schedule_has_more: false };
  }
  let terms;
  try { terms = parseCollectionTerms(row.collection_terms); } catch {
    return { ...base, state: 'unreadable', kind: null, recurring: false, schedule: [], schedule_has_more: false };
  }
  const current = terms.total_cents === row.agreed_amount_minor && terms.currency === row.agreed_currency;
  const preview = previewCollectionSchedule(terms, MAX_SCHEDULE);
  return {
    ...base, state: current ? 'current' : 'stale', kind: terms.kind, recurring: terms.kind === 'recurring',
    schedule: preview.rows.map(r => ({ sequence: r.sequence, due_date: r.due_date, amount_minor: r.amount_cents,
      due: asOf === null ? null : r.due_date <= asOf, label: r.label })),
    schedule_has_more: preview.has_more,
  };
}

function composeAgreement(signings: SourceSigning[], termsId: string | null): ClientEngagementStatus['agreement'] {
  const newest = (rows: SourceSigning[]) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const forTerms = termsId ? signings.filter(s => s.commercial_terms_id === termsId) : [];
  // A newer draft or voided amendment does not unsign the agreement already signed for these terms.
  const bound = newest(forTerms.filter(s => s.status === 'completed' && s.sealed)) ?? newest(forTerms);
  const chosen = bound ?? newest(signings);
  if (!chosen) {
    return { state: 'none', signing_id: null, title: null, sent_at: null, completed_at: null, sealed: false,
      bound_to_terms: false, effective: 'not_recorded' };
  }
  const state = SIGNING_STATE[chosen.status] ?? fail('signing_status');
  return {
    // A "completed" signing without its sealed evidence is not reported as signed.
    state: state === 'signed' && !chosen.sealed ? 'partially_signed' : state,
    signing_id: chosen.id, title: chosen.title, sent_at: chosen.sent_at, completed_at: chosen.completed_at,
    sealed: chosen.sealed, bound_to_terms: Boolean(bound), effective: 'not_recorded',
  };
}

function invoicePaymentState(row: SourceInvoice, outstanding: number): InvoicePaymentState {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'void') return 'void';
  if (row.status === 'uncollectible') return 'written_off';
  if (row.open_payment_requests.some(r => r.environment === 'live' && r.state === 'outcome_unknown')) return 'outcome_unknown';
  if (outstanding <= 0) return 'paid';
  // A request still being prepared has not reached the client, so it is not a payment in progress.
  if (row.open_payment_requests.some(r => r.environment === 'live' && r.state !== 'prepared')) return 'awaiting_confirmation';
  return outstanding < row.amount_minor ? 'partially_paid' : 'unpaid';
}

export function composeClientEngagementStatus(source: ClientEngagementSource): ClientEngagementStatus {
  if (!source || typeof source !== 'object') fail('envelope');
  const readAt = Date.parse(String(source.read_at));
  if (!Number.isFinite(readAt)) fail('read_at');
  const zoneSource = source.business_time_zone;
  if (!zoneSource || !['configured', 'missing', 'ambiguous', 'invalid'].includes(zoneSource.state)) fail('time_zone');
  // Today is the owner's calendar date. A zone the database accepted but this runtime cannot resolve
  // is reported as invalid, never replaced by UTC or by whatever zone this code happens to run in.
  const localToday = zoneSource.state === 'configured' && typeof zoneSource.zone === 'string'
    ? localDateInZone(readAt, zoneSource.zone) : null;
  const timeZone = { state: localToday === null && zoneSource.state === 'configured' ? 'invalid' as const : zoneSource.state,
    zone: localToday === null ? null : zoneSource.zone };
  const asOf = localToday;
  const termsRow = pickTerms(source.terms);
  const terms = composeTerms(termsRow, asOf);
  const agreement = composeAgreement(source.signings, termsRow?.id ?? null);
  const attention = new Set<Attention>();

  const currencies = new Set<string>();
  if (terms?.currency) currencies.add(terms.currency.toLowerCase());

  // The terms' schedule: what was due before today (past due) and on or before today (due to date).
  const usable = terms?.state === 'current';
  const lastShown = terms?.schedule.at(-1)?.due_date;
  // A truncated schedule can only be summed exactly if every unseen row falls after as_of.
  const scheduleKnown = usable && asOf !== null
    && (!terms!.schedule_has_more || (lastShown !== undefined && lastShown > asOf));
  const pastDueOnSchedule = scheduleKnown
    ? terms!.schedule.filter(r => r.due_date < asOf!).reduce((sum, r) => sum + r.amount_minor, 0) : null;
  const billedBound = termsRow ? source.invoices.filter(i => BILLED.has(i.status)
    && i.commercial_terms_reference?.id === termsRow.id).length : 0;
  // Two billed invoices each carrying the whole agreed amount cannot both be the obligation.
  if (billedBound > 1) attention.add('terms_invoiced_more_than_once');

  let invoiced = 0, verified = 0, recorded = 0, test = 0, outstanding = 0;
  let overdue: number | null = 0;
  // Totals against the agreed terms only: an unrelated invoice for the same client is neither
  // progress on the schedule nor part of what remains to be invoiced under it.
  let termsInvoiced = 0, termsVerified = 0, termsRecorded = 0;
  let awaiting = 0, unknown = 0, failed = 0, reversals = 0;
  const invoices: ClientEngagementStatus['invoices'] = source.invoices.map(row => {
    const amount = minor(row.amount_minor, 'amount');
    const live = minor(row.provider_verified_live_minor, 'live');
    const manual = minor(row.manual_recorded_minor, 'manual');
    const testMinor = minor(row.provider_verified_test_minor, 'test');
    if (live < 0 || testMinor < 0 || manual < 0) fail('negative_receipts');
    const billed = BILLED.has(row.status);
    // Test money never reduces what is owed: outstanding is measured against real receipts only.
    const owed = billed ? Math.max(0, amount - live - manual) : 0;
    const paymentState = invoicePaymentState(row, owed);
    const bound = Boolean(termsRow && row.commercial_terms_reference?.id === termsRow.id);
    let pastDue: number | null = 0;
    if (billed && owed > 0) {
      if (bound) {
        pastDue = pastDueOnSchedule === null || billedBound > 1 ? null
          : Math.min(owed, Math.max(0, pastDueOnSchedule - live - manual));
      } else if (row.due_date !== null) {
        // Without the owner's today, whether a dated invoice is late is unknown, not "not late".
        pastDue = asOf === null ? null : row.due_date < asOf ? owed : 0;
      }
    }
    if (billed) {
      currencies.add(row.currency.toLowerCase());
      invoiced += amount; verified += live; recorded += manual; outstanding += owed;
      if (bound) { termsInvoiced += amount; termsVerified += live; termsRecorded += manual; }
      overdue = overdue === null || pastDue === null ? null : overdue + pastDue;
      if (LEGACY.has(row.status)) attention.add('invoice_status_legacy');
    }
    test += testMinor;
    reversals += minor(row.reversal_count, 'reversals');
    // Requests matter only while the invoice is still owed; once it is paid, void or a draft they are history.
    if (billed && owed > 0) {
      failed += minor(row.failed_payment_requests, 'failed');
      for (const request of row.open_payment_requests) {
        if (request.environment !== 'live') continue;
        if (request.state === 'outcome_unknown') { unknown += 1; continue; }
        // A request still being prepared has not reached the client.
        if (request.state === 'prepared') continue;
        currencies.add(request.currency.toLowerCase());
        awaiting += minor(request.amount_minor, 'request');
      }
    }
    return {
      id: row.id, number: row.invoice_number, status: row.status, payment_state: paymentState, amount_minor: amount,
      outstanding_minor: owed, verified_minor: live, recorded_by_owner_minor: manual, test_environment_minor: testMinor,
      past_due_minor: pastDue, due_date: row.due_date, overdue: pastDue === null ? null : pastDue > 0,
      bound_to_terms: bound,
      legacy_status: LEGACY.has(row.status),
    };
  });

  const mixed = currencies.size > 1;
  const termsUsable = usable && !mixed && billedBound <= 1;
  const finite = termsUsable && !terms!.recurring && !terms!.schedule_has_more;
  const contracted = finite ? terms!.agreed_minor : null;
  const dueToDate = termsUsable && scheduleKnown
    ? terms!.schedule.filter(r => r.due === true).reduce((sum, r) => sum + r.amount_minor, 0) : null;
  const behind = dueToDate === null ? null : dueToDate - (termsVerified + termsRecorded);

  const truncated = { terms: source.terms_has_more, signings: source.signings_has_more,
    invoices: source.invoices_has_more, work: source.work.items_has_more };
  // A truncated or mixed list makes every money total a lower bound or a sum of unlike units.
  const totalsKnown = !mixed && !truncated.invoices && !truncated.terms;
  const known = (value: number | null) => (totalsKnown ? value : null);
  // Several live contracts (one per offer) can exist; only the first is composed, so say so.
  if (source.terms.filter(row => row.status === 'active' || row.status === 'paused').length > 1) attention.add('other_terms_not_shown');

  if (terms?.state === 'stale') attention.add('terms_stale');
  if (terms?.state === 'unreadable') attention.add('terms_unreadable');
  if (terms && agreement.state !== 'signed') attention.add('agreement_not_signed');
  if (agreement.state !== 'none' && terms && !agreement.bound_to_terms) attention.add('agreement_not_bound_to_terms');
  if ((overdue ?? 0) > 0) attention.add('payment_overdue');
  if (totalsKnown && behind !== null && behind > 0) attention.add('behind_schedule');
  if (unknown > 0) attention.add('payment_outcome_unknown');
  if (failed > 0) attention.add('payment_request_failed');
  if (mixed) attention.add('mixed_currency');
  if (asOf === null) attention.add('business_time_zone_unset');

  const w = source.work;
  const upcoming = w.items
    .filter(i => (i.status === 'open' || i.status === 'in_progress' || i.status === 'blocked') && i.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
  const workState: WorkState = w.total === 0 ? 'none'
    : w.open === 0 ? 'complete'
    : w.overdue > 0 ? 'behind'
    : w.open === w.undated_open ? 'undated'
    : 'on_schedule';
  if (w.overdue > 0) attention.add('work_overdue');
  if (w.blocked > 0) attention.add('work_blocked');

  if (truncated.invoices || truncated.terms || truncated.signings) attention.add('list_truncated');

  return {
    client: { id: source.contact_id, name: source.client_name },
    as_of_date: asOf,
    time_zone: timeZone,
    agreement,
    terms,
    money: {
      currency: mixed ? null : [...currencies][0] ?? null, mixed_currency: mixed,
      contracted_minor: known(contracted),
      due_to_date_minor: known(dueToDate),
      invoiced_minor: known(invoiced),
      invoiced_against_terms_minor: known(termsInvoiced),
      received_against_terms: { verified_minor: known(termsVerified), recorded_by_owner_minor: known(termsRecorded) },
      not_yet_invoiced_minor: totalsKnown && contracted !== null ? Math.max(0, contracted - termsInvoiced) : null,
      received: { verified_minor: known(verified), recorded_by_owner_minor: known(recorded), test_environment_minor: known(test) },
      outstanding_minor: known(outstanding),
      overdue_minor: known(overdue),
      awaiting_confirmation_minor: known(awaiting),
      outcome_unknown_count: unknown,
      failed_request_count: failed,
      behind_schedule_minor: known(behind),
      reversal_count: reversals,
      disputes: 'not_recorded',
    },
    invoices,
    work: {
      state: workState, total: w.total, done: w.done, open: w.open, overdue: w.overdue, blocked: w.blocked,
      next: upcoming ? { title: upcoming.title, due_at: upcoming.due_at!, item_type: upcoming.item_type } : null,
      items: w.items,
    },
    attention: [...attention],
    not_recorded: source.not_recorded,
    truncated,
    receipt_id: source.receipt_id,
  };
}

/** Narrow runtime guard for the RPC envelope; shape errors fail closed instead of rendering zeros. */
export function parseClientEngagementSource(value: unknown): ClientEngagementSource {
  const v = value as Json;
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('object');
  for (const key of ['terms', 'signings', 'invoices']) if (!Array.isArray(v[key])) fail(key);
  const work = v.work as Json;
  if (!work || typeof work !== 'object' || !Array.isArray(work.items)) fail('work');
  if (typeof v.contact_id !== 'string' || typeof v.receipt_id !== 'string' || !Array.isArray(v.not_recorded)) fail('identity');
  return value as ClientEngagementSource;
}
