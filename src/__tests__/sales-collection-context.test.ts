import { describe, expect, it } from 'vitest';
import { projectCollectionAgreement } from '../../supabase/functions/_shared/sales-collections/agreement-context.ts';
import { assembleFixedRepaymentSchedule } from '../../supabase/functions/_shared/sales-collections/model.ts';
const tenant = '20000000-0000-4000-8000-000000000001';
const client = '30000000-0000-4000-8000-000000000001';
const offer = '40000000-0000-4000-8000-000000000001';
const agreement = '50000000-0000-4000-8000-000000000001';
const assembled = assembleFixedRepaymentSchedule({ total_cents: 350000, deposit_cents: 50000,
  installment_cents: 30000, currency: 'usd', deposit_date: '2026-10-05', first_installment_date: '2026-11-01', cadence: 'monthly' });
if (assembled.state !== 'ready') throw Error('Fixture schedule must use canonical math');
const row = { id: agreement, tenant_id: tenant, client_id: client, offer_id: offer,
  client_name: 'Client X', client_name_truncated: false, title: 'Agreed collection terms', title_truncated: false,
  status: 'active', agreed_amount_minor: 350000, agreed_currency: 'usd',
  collection_terms: assembled.terms, collection_terms_version: 1, terms_current: true };
describe('canonical commercial collection context', () => {
  it('uses canonical math for the deposit and ten installments, without signing/mandate authority', () => {
    const facts = projectCollectionAgreement(row, tenant);
    expect(facts).toMatchObject({ id: agreement, client_id: client, offer_id: offer,
      amount_cents: 350000, terms_state: 'current', signing_agreement_resolved: false,
      authority: 'not_evaluated', provider_execution: 'not_verified',
      schedule_preview: { amount_basis: 'total', has_more: false } });
    const schedule = (facts.schedule_preview as { rows: { amount_cents: number; due_date: string }[] }).rows;
    expect(schedule).toHaveLength(11); expect(schedule[0]).toMatchObject({ amount_cents: 50000 });
    expect(schedule.slice(1).every(x => x.amount_cents === 30000)).toBe(true);
    expect(schedule[1].due_date).toBe('2026-11-01');
  });
  it('distinguishes missing terms and an awaiting-quote record without inventing a schedule', () => {
    expect(projectCollectionAgreement({ ...row, agreed_amount_minor: null, agreed_currency: null,
      collection_terms: null, collection_terms_version: 0, terms_current: false, offer_id: null }, tenant))
      .toMatchObject({ amount_cents: null, currency: null, offer_id: null, terms_state: 'absent', recorded_terms: null, schedule_preview: null });
  });
  it('retains stale source terms as stale; never substitutes the commercial amount', () => {
    const facts = projectCollectionAgreement({ ...row, agreed_amount_minor: 360000, terms_current: false }, tenant);
    expect(facts).toMatchObject({ amount_cents: 360000, terms_state: 'stale', recorded_terms: { total_cents: 350000 } });
  });
  it('marks bounded recurring preview as per-cycle and incomplete', () => {
    const terms = { ...assembled.terms, kind: 'recurring', total_cents: 30000, cadence: 'monthly', count: null,
      dates: [], deposit_cents: null, anchor_date: '2026-11-01', end_date: null };
    expect(projectCollectionAgreement({ ...row, agreed_amount_minor: 30000, collection_terms: terms }, tenant))
      .toMatchObject({ schedule_preview: { amount_basis: 'per_cycle', has_more: true } });
  });
  it('omits raw notes, provider/document extensions, fee doctrine and schedule labels', () => {
    const terms = { ...assembled.terms, dates: assembled.terms.dates.map(x => ({ ...x, label: 'PRIVATE' })),
      late_fee: { fixed_cents: 100, rate_bps: 0, grace_days: 3, agreement_basis: 'PRIVATE' },
      interest: { annual_bps: 100, agreement_basis: 'PRIVATE' } };
    const facts = projectCollectionAgreement({ ...row, collection_terms: terms, notes: 'PRIVATE', storage_key: 'PRIVATE', stripe_id: 'PRIVATE' }, tenant);
    expect(JSON.stringify(facts)).not.toContain('PRIVATE');
    expect(facts).toMatchObject({ recorded_terms: { late_fee: { fixed_cents: 100, agreement_basis_recorded: true }, interest: { annual_bps: 100, agreement_basis_recorded: true } } });
  });
  it('retains explicit label truncation so names cannot silently stand in for exact context', () => {
    expect(projectCollectionAgreement({ ...row, title: 'A'.repeat(200), title_truncated: true }, tenant)).toMatchObject({ title_truncated: true });
  });
  it('preserves canonical zero or large safe recorded amounts without treating them as payable schedules', () => {
    for (const amount of [0, 2147483648]) expect(projectCollectionAgreement({ ...row, agreed_amount_minor: amount,
      collection_terms: null, collection_terms_version: 0, terms_current: false }, tenant))
      .toMatchObject({ amount_cents: amount, terms_state: 'absent', schedule_preview: null, authority: 'not_evaluated' });
  });
  it('uses the same Unicode character bound as PostgreSQL for multilingual source labels', () => {
    expect(projectCollectionAgreement({ ...row, title: '😀'.repeat(200), title_truncated: true }, tenant)).toMatchObject({ title: '😀'.repeat(200) });
    expect(() => projectCollectionAgreement({ ...row, title: '😀'.repeat(201) }, tenant)).toThrow();
  });
  it.each([
    { tenant_id: client }, { client_id: 'private' }, { offer_id: 'private' }, { id: 'private' },
    { title: 'A'.repeat(201) }, { title_truncated: undefined }, { client_name: null, client_name_truncated: true },
    { agreed_amount_minor: -1 }, { agreed_currency: 'USD' }, { status: 'completed_payment' },
    { agreed_amount_minor: null }, { agreed_currency: null }, { title: 'short', title_truncated: true },
    { collection_terms_version: 0 }, { collection_terms_version: 1.5 }, { terms_current: false },
    { collection_terms: { ...assembled.terms, currency: 'private' } },
  ])('refuses malformed, foreign or contradictory canonical context %j', change => {
    expect(() => projectCollectionAgreement({ ...row, ...change }, tenant)).toThrow();
  });
});
