import { date, integer, MAX_SCHEDULE, UUID } from './contract.ts';
import { assembleFixedRepaymentSchedule } from './model.ts';

type RecordValue = Record<string, unknown>;
const keys = ['agreement_id', 'deposit_cents', 'deposit_date', 'installment_cents', 'first_installment_date', 'cadence', 'custom_dates'];

/** Validate intent before reading. Commercial amount/currency and authority are never caller inputs. */
export function parseRepaymentRead(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid');
  const input = value as RecordValue;
  if (Object.keys(input).some(key => !keys.includes(key)) || typeof input.agreement_id !== 'string' || !UUID.test(input.agreement_id)) throw Error('invalid');
  for (const key of ['deposit_cents', 'installment_cents']) if (input[key] != null) integer(input[key], key === 'deposit_cents' ? 0 : 1);
  for (const key of ['deposit_date', 'first_installment_date']) if (input[key] != null) date(input[key]);
  if (input.cadence != null && !['monthly', 'quarterly', 'custom'].includes(String(input.cadence))) throw Error('invalid');
  if (input.custom_dates != null) {
    if (!Array.isArray(input.custom_dates) || input.custom_dates.length > MAX_SCHEDULE) throw Error('invalid');
    input.custom_dates.forEach(value => date(value));
  }
  return { ...input, agreement_id: input.agreement_id.toLowerCase() };
}

/** Uses only authenticated, closed agreement projections. Never writes or grants authority. */
export function previewRepaymentRead(input: RecordValue, rows: RecordValue[]): RecordValue {
  const candidates = rows.filter(row => row.id === input.agreement_id);
  if (candidates.length > 1) throw Error('ambiguous');
  const row = candidates[0];
  if (!row) return { state: 'needs_input', fields: ['commercial_terms_reference_in_read_page'] };
  if (!['draft', 'active'].includes(String(row.status))) return { state: 'refused', code: 'COMMERCIAL_TERMS_INACTIVE' };
  const source = { commercial_terms_id: row.id, client_id: row.client_id, offer_id: row.offer_id, collection_terms_version: row.version };
  if (row.offer_id === null) return { state: 'needs_input', fields: ['canonical_offer'], source };
  if (row.terms_state === 'stale') return { state: 'conflict', code: 'RECORDED_TERMS_STALE', source };
  const { agreement_id: _reference, ...intent } = input;
  const calculation = assembleFixedRepaymentSchedule({ ...intent, total_cents: row.amount_cents, currency: row.currency });
  if (calculation.state !== 'ready') return { ...calculation, source };
  if (row.recorded_terms != null) {
    const recorded = row.recorded_terms as RecordValue;
    const preview = row.schedule_preview as { rows: { due_date: string; amount_cents: number; currency: string }[]; has_more: boolean; amount_basis: string };
    if (preview.has_more) return { state: 'needs_input', fields: ['complete_recorded_schedule_comparison'], source };
    const exact = recorded.kind !== 'recurring' && preview.amount_basis === 'total' && !preview.has_more
      && preview.rows.length === calculation.rows.length
      && preview.rows.every((saved, index) => saved.due_date === calculation.rows[index].due_date && saved.amount_cents === calculation.rows[index].amount_cents && saved.currency === calculation.rows[index].currency);
    if (!exact) return { state: 'conflict', code: 'RECORDED_SCHEDULE_DIFFERS', source };
  }
  return {
    state: 'ready_for_review', basis: 'principal_only', source,
    total_cents: row.amount_cents, currency: row.currency,
    deposit_cents: calculation.deposit_cents, remaining_after_deposit_cents: calculation.remaining_after_deposit_cents,
    installment_count: calculation.installment_count, cadence: calculation.cadence, rows: calculation.rows,
    authority: 'not_evaluated', execution: 'not_started',
    caveats: ['Tax and fee treatment, signing-document compatibility and delivery remain separate unresolved package facts.', 'This preview is not saved collection terms, a payment mandate, invoice balance or authorization. Re-read source versions before a governed write.'],
  };
}
