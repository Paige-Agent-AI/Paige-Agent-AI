import { MAX_MINOR, UUID, object, parseCollectionTerms } from './contract.ts';
import { previewCollectionSchedule } from './model.ts';

const fail = (): never => { throw new TypeError('COLLECTION_CONTEXT_UNVERIFIED'); };
const id = (value: unknown): string => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail();
const nullableId = (value: unknown): string | null => value === null ? null : id(value);
const minor = (value: unknown): number | null => value === null ? null
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR ? value : fail();
function label(value: unknown, truncated: unknown): { value: string | null; truncated: boolean } {
  if (typeof truncated !== 'boolean' || (value !== null && (typeof value !== 'string' || value.length > 200))) return fail();
  if (value === null && truncated) return fail();
  return { value: value as string | null, truncated };
}

/** Recorded commercial facts, not a signing agreement, executable mandate or balance.
 * Fee doctrine, notes, storage/provider references and raw record extensions are omitted.
 * The callable layer uses the caller-JWT reader; this projector grants no authority.
 */
export function projectCollectionAgreement(value: unknown, tenantId: string): Record<string, unknown> {
  if (!object(value) || id(value.tenant_id) !== id(tenantId)) return fail();
  const agreementId = id(value.id), clientId = id(value.client_id), offerId = nullableId(value.offer_id);
  const title = label(value.title, value.title_truncated), client = label(value.client_name, value.client_name_truncated);
  if (typeof value.status !== 'string' || !['draft', 'active', 'paused', 'completed', 'cancelled'].includes(value.status)) return fail();
  const amount = minor(value.agreed_amount_minor);
  const currency = value.agreed_currency;
  if (currency !== null && (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency))) return fail();
  const version = value.collection_terms_version;
  if (!Number.isSafeInteger(version) || Number(version) < 0 || typeof value.terms_current !== 'boolean') return fail();
  const terms = value.collection_terms === null ? null : parseCollectionTerms(value.collection_terms);
  if ((terms === null) !== (version === 0)) return fail();
  const current = terms !== null && terms.total_cents === amount && terms.currency === currency;
  if (value.terms_current !== current) return fail();
  const schedule = terms ? previewCollectionSchedule(terms, 20) : null;
  return {
    id: agreementId, client_id: clientId, offer_id: offerId, title: title.value,
    title_truncated: title.truncated, client_name: client.value, client_name_truncated: client.truncated,
    status: value.status, amount_cents: amount, currency, version, terms_current: current,
    terms_state: terms === null ? 'absent' : current ? 'current' : 'stale',
    record_owner: 'commercial_collection_terms', signing_agreement_resolved: false,
    recorded_terms: terms ? {
      schema_version: terms.schema_version, kind: terms.kind, currency: terms.currency,
      total_cents: terms.total_cents, anchor_date: terms.anchor_date, cadence: terms.cadence,
      count: terms.count, end_date: terms.end_date, deposit_cents: terms.deposit_cents,
      dates: terms.dates.map(row => ({ due_date: row.due_date, amount_cents: row.amount_cents })),
      late_fee: { fixed_cents: terms.late_fee.fixed_cents, rate_bps: terms.late_fee.rate_bps,
        grace_days: terms.late_fee.grace_days, agreement_basis_recorded: Boolean(terms.late_fee.agreement_basis?.trim()) },
      interest: { annual_bps: terms.interest.annual_bps, agreement_basis_recorded: Boolean(terms.interest.agreement_basis?.trim()) },
    } : null,
    schedule_preview: schedule ? { amount_basis: schedule.amount_basis, has_more: schedule.has_more,
      rows: schedule.rows.map(({ sequence, due_date, amount_cents, currency: rowCurrency }) => ({ sequence, due_date, amount_cents, currency: rowCurrency })) } : null,
    authority: 'not_evaluated', provider_execution: 'not_verified',
  };
}
