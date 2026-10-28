// Experience 04 — the client-engagement words, in ONE pure module (E4-S3 PR-0).
//
// The chat projection (`chat.ts`) and the client record read the SAME sentences and link to the SAME
// places, so PAIGE and the page can never describe one client two ways. Moved verbatim from chat.ts
// (byte-identical text); the record-link decisions sit beside the words they belong to.
//
// Pure: no Supabase client, no Deno URL import — both the edge bundle and the Vite app import it.
import type { Attention, ClientEngagementStatus } from './status.ts';
import type { ReadLinkDestination, ReadRecordLink } from '../paige-turn/record-links.ts';
import { readRecordLinks } from '../paige-turn/record-links.ts';

export const INVOICE_TERMS_VERSION_REASON = 'Invoice and plan versions differ';

/** One explanation for the existing Clients and PAIGE reads, not a new source. */
export function standingTimingReason(s: ClientEngagementStatus): string | null {
  if (s.attention.includes('effective_terms_unverified')) return 'Original invoice terms need verification';
  if (s.attention.includes('invoice_terms_version_mismatch')) return INVOICE_TERMS_VERSION_REASON;
  if (s.attention.some(key => ['invoice_terms_unavailable','invoice_terms_amount_mismatch','effective_terms_unverified'].includes(key)))
    return 'Original invoice terms need verification';
  if (s.attention.includes('terms_stale') || s.attention.includes('terms_unreadable')) return 'The payment schedule is not established';
  return null;
}

export function standingTermsEvidence(s: ClientEngagementStatus): string | null {
  if (s.agreement.effective === 'unverified') return 'Original effective agreement evidence is not verified.';
  if (s.agreement.effective !== 'verified' || s.terms?.basis !== 'accepted') return null;
  return `Accepted revision ${s.terms.version}${s.terms.working_differs
    ? ` · Working draft revision ${s.terms.working_version} differs` : ''}`;
}

export const AGREEMENT_TEXT: Record<string, string> = {
  none: 'no agreement has been sent', draft: 'agreement drafted, not sent', sent: 'agreement sent, not yet viewed',
  viewed: 'agreement viewed, not signed', partially_signed: 'agreement partially signed', signed: 'agreement signed',
  declined: 'agreement declined', voided: 'agreement voided', expired: 'agreement expired before signing',
};

export const ATTENTION_TEXT: Record<Attention, string> = {
  agreement_not_signed: 'The agreement is not signed.',
  agreement_not_bound_to_terms: 'The signed agreement is not linked to the agreed terms.',
  terms_stale: 'The agreed terms changed after the agreement or invoices were made.',
  terms_unreadable: 'The installment schedule could not be read.',
  payment_overdue: 'A payment is overdue.',
  behind_schedule: 'Payments are behind the agreed schedule.',
  payment_outcome_unknown: 'A payment attempt has an unknown outcome; it is not counted as paid.',
  payment_request_failed: 'A payment request failed.',
  invoice_status_legacy: 'An invoice uses an older status, so its balance may be incomplete.',
  work_overdue: 'Delivery work is overdue.',
  work_blocked: 'Delivery work is blocked.',
  mixed_currency: 'Invoices use more than one currency, so totals are not added up.',
  list_truncated: 'There are more records than one read returns, so totals are not added up.',
  terms_invoiced_more_than_once: 'The agreed terms were invoiced more than once.',
  invoice_terms_version_mismatch: 'The invoice and payment plan refer to different agreement versions. Review the original terms before checking payment timing.',
  invoice_terms_unavailable: 'An invoice refers to agreement terms that this read could not establish. Payment timing is not known.',
  invoice_terms_amount_mismatch: 'An invoice amount or currency differs from its original agreement terms. Review those records before checking payment timing.',
  effective_terms_unverified: 'The original effective agreement evidence could not be verified. Accepted terms and payment timing are not established.',
  other_terms_not_shown: 'This client has other terms that are not shown.',
  business_time_zone_unset: 'The business time zone is not set, so due and overdue dates are on hold.',
};

export const PAYMENT_STATE_TEXT: Record<string, string> = {
  draft: 'draft', void: 'void', written_off: 'written off', paid: 'paid', partially_paid: 'partly paid',
  unpaid: 'unpaid', awaiting_confirmation: 'payment awaiting provider confirmation', outcome_unknown: 'payment outcome unknown',
};

/** Facts this read does not establish, in the owner's words (status.ts `not_recorded` keys). */
export const NOT_RECORDED_TEXT: Record<string, string> = {
  payment_disputes: 'payment disputes',
  provider_refunds: 'refunds made at your payment provider',
  terms_effective_transition: 'when an agreement takes effect',
  installment_allocation: 'which installment a payment paid',
};

/**
 * Where the owner goes to act on each attention line, or null when there is nothing to open (a
 * statement about the read itself). Shared by the chat links and the client record, so neither keeps
 * a second hand-written table.
 */
export const ATTENTION_DESTINATION: Record<Attention, ReadLinkDestination | null> = {
  agreement_not_signed: 'sales_agreements',
  agreement_not_bound_to_terms: 'sales_agreements',
  terms_stale: 'sales_agreements',
  terms_unreadable: 'sales_agreements',
  payment_overdue: 'sales_invoices',
  behind_schedule: 'sales_invoices',
  payment_outcome_unknown: 'sales_invoices',
  payment_request_failed: 'sales_invoices',
  invoice_status_legacy: 'sales_invoices',
  terms_invoiced_more_than_once: 'sales_invoices',
  invoice_terms_version_mismatch: 'sales_agreements',
  invoice_terms_unavailable: 'sales_agreements',
  invoice_terms_amount_mismatch: 'sales_invoices',
  effective_terms_unverified: 'sales_agreements',
  work_overdue: 'operations_work',
  work_blocked: 'operations_work',
  business_time_zone_unset: 'business_time_zone',
  mixed_currency: null,
  list_truncated: null,
  other_terms_not_shown: null,
};

/**
 * The records one client-standing answer drew on, as REFERENCES (never an address): always the client,
 * then each record family the read actually returned something for, then the business time zone
 * setting while due dates are on hold. The address is built from the current account on the client.
 */
/** Only a complete single managed invoice is unambiguous enough for an exact record link.
 * Legacy/imported records retain the register destination; no different record is substituted. */
export function standingInvoiceLink(s: ClientEngagementStatus): ReadRecordLink {
  const only = !s.truncated.invoices && s.invoices.length === 1 ? s.invoices[0] : null;
  return { destination: 'sales_invoices', record_id: only && ['draft', 'issued', 'void'].includes(only.status) ? only.id : null };
}

/** The original signing document, never the commercial-terms ID or a later draft. */
export function standingAgreementLink(s: ClientEngagementStatus): ReadRecordLink {
  return readRecordLinks([{ destination: 'sales_agreements', record_id: s.agreement.state === 'none' ? null : s.agreement.signing_id }])[0];
}

export function standingRecordLinks(s: ClientEngagementStatus): ReadRecordLink[] {
  const links: ReadRecordLink[] = [{ destination: 'contacts', record_id: s.client.id, ...(s.client.name ? { subject: s.client.name } : {}) }];
  if (s.terms || s.agreement.state !== 'none') links.push(standingAgreementLink(s));
  if (s.invoices.length || s.truncated.invoices) links.push(standingInvoiceLink(s));
  if (s.terms?.schedule.length) links.push({ destination: 'sales_collections', record_id: null });
  if (s.work.state !== 'none' && s.work.total > 0) links.push({ destination: 'operations_work', record_id: null });
  if (s.time_zone.state !== 'configured') links.push({ destination: 'business_time_zone', record_id: null });
  return links;
}
