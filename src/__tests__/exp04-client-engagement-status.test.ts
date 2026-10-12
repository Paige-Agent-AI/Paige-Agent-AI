import { describe, expect, it } from 'vitest';
import source from './fixtures/exp04-client-status-source.json';
import {
  composeClientEngagementStatus,
  parseClientEngagementSource,
  type ClientEngagementSource,
} from '../../supabase/functions/_shared/client-engagement/status';

// The fixture is the REAL output of public.read_client_engagement_status from the full-schema
// rollback proof (supabase/tests/exp04_client_engagement_status.sql), captured by
// scripts/proof/exp04-client-status-parity.mjs --write-fixture. Its ledger is writer-legal: E4-0001
// is the contract invoice bound to the $3,500 terms (whole amount, deposit due now), E4-0002 an
// add-on outside the terms, E4-0003 a draft, E4-0004 void. Edge cases below mutate a copy.
const base = (): ClientEngagementSource => structuredClone(source) as ClientEngagementSource;
const invoice = (s: ClientEngagementSource, n: string) => s.invoices.find(i => i.invoice_number === n)!;

describe('Experience 04 · where this client stands', () => {
  it('composes the $3,500 / $500 / 10 × $300 engagement from the real read', () => {
    const status = composeClientEngagementStatus(parseClientEngagementSource(base()));
    expect(status.money).toMatchObject({
      currency: 'usd', contracted_minor: 350000, invoiced_minor: 362000, invoiced_against_terms_minor: 350000,
      not_yet_invoiced_minor: 0,
      received_against_terms: { verified_minor: 10000, recorded_by_owner_minor: 50000 }, outstanding_minor: 302000,
      overdue_minor: 32000, due_to_date_minor: 80000, behind_schedule_minor: 20000, awaiting_confirmation_minor: 20000,
      outcome_unknown_count: 1, failed_request_count: 1, disputes: 'not_recorded',
      received: { verified_minor: 10000, recorded_by_owner_minor: 50000, test_environment_minor: 30000 },
    });
    expect(status.agreement).toMatchObject({ state: 'signed', bound_to_terms: true, effective: 'not_recorded' });
    expect(status.work.state).toBe('behind');
  });

  it('takes what is past due on the contract invoice from the schedule, not from its whole balance', () => {
    const status = composeClientEngagementStatus(base());
    const contract = status.invoices.find(i => i.number === 'E4-0001')!;
    expect(contract.outstanding_minor).toBe(290000);
    expect(contract.past_due_minor).toBe(20000);
    // Paying what was due clears past due while the rest of the contract stays outstanding.
    const s = base();
    invoice(s, 'E4-0001').manual_recorded_minor += 20000;
    const caughtUp = composeClientEngagementStatus(s);
    expect(caughtUp.invoices.find(i => i.number === 'E4-0001')!.past_due_minor).toBe(0);
    expect(caughtUp.money.overdue_minor).toBe(12000);
    expect(caughtUp.money.behind_schedule_minor).toBe(0);
    expect(caughtUp.money.outstanding_minor).toBe(282000);
  });

  it('never counts test-environment money as received or as reducing what is owed', () => {
    const s = base();
    invoice(s, 'E4-0001').provider_verified_test_minor = 350000;
    const status = composeClientEngagementStatus(s);
    expect(status.invoices.find(i => i.number === 'E4-0001')!.outstanding_minor).toBe(290000);
    expect(status.money.received.verified_minor).toBe(10000);
    expect(status.money.behind_schedule_minor).toBe(20000);
  });

  it('never counts an in-flight or unknown payment request as received', () => {
    const s = base();
    for (const i of s.invoices) i.open_payment_requests = i.open_payment_requests.map(r => ({ ...r, state: 'outcome_unknown' }));
    const status = composeClientEngagementStatus(s);
    expect(status.money.awaiting_confirmation_minor).toBe(0);
    expect(status.money.outcome_unknown_count).toBe(2);
    expect(status.money.outstanding_minor).toBe(302000);
  });

  it('does not call a request still being prepared a payment in progress', () => {
    const s = base();
    invoice(s, 'E4-0001').open_payment_requests[0].state = 'prepared';
    const status = composeClientEngagementStatus(s);
    expect(status.money.awaiting_confirmation_minor).toBe(0);
    expect(status.invoices.find(i => i.number === 'E4-0001')!.payment_state).toBe('partially_paid');
  });

  it('stops counting requests once their invoice is paid', () => {
    const s = base();
    invoice(s, 'E4-0001').manual_recorded_minor = 340000;
    const status = composeClientEngagementStatus(s);
    expect(status.money.failed_request_count).toBe(0);
    expect(status.money.awaiting_confirmation_minor).toBe(0);
    expect(status.attention).not.toContain('payment_request_failed');
  });

  it('separates the agreed schedule from invoices: an unrelated invoice is not progress on the terms', () => {
    const s = base();
    invoice(s, 'E4-0002').manual_recorded_minor = 12000;
    const status = composeClientEngagementStatus(s);
    expect(status.money.received.recorded_by_owner_minor).toBe(62000);
    expect(status.money.behind_schedule_minor).toBe(20000);
  });

  it('refuses to guess when the terms are invoiced twice', () => {
    const s = base();
    s.invoices.push({ ...structuredClone(invoice(s, 'E4-0001')), id: 'dup', invoice_number: 'E4-0009',
      manual_recorded_minor: 0, provider_verified_live_minor: 0, provider_verified_test_minor: 0, open_payment_requests: [] });
    const status = composeClientEngagementStatus(s);
    expect(status.attention).toContain('terms_invoiced_more_than_once');
    expect(status.money.overdue_minor).toBeNull();
    expect(status.money.behind_schedule_minor).toBeNull();
    expect(status.money.not_yet_invoiced_minor).toBeNull();
  });

  it('reports a completed signing without sealed evidence as not signed', () => {
    const s = base();
    s.signings[0].sealed = false;
    const status = composeClientEngagementStatus(s);
    expect(status.agreement.state).toBe('partially_signed');
    expect(status.attention).toContain('agreement_not_signed');
  });

  it('keeps a signed agreement signed when a newer amendment is voided', () => {
    const s = base();
    s.signings.unshift({ ...structuredClone(s.signings[0]), id: 'amend', status: 'voided', sealed: false,
      created_at: new Date(Date.parse(s.signings[0].created_at) + 1000).toISOString() });
    expect(composeClientEngagementStatus(s).agreement.state).toBe('signed');
  });

  it('degrades unreadable and stale terms to a named state, never to confident numbers', () => {
    const unreadable = base();
    unreadable.terms[0].collection_terms = { schema_version: 99 };
    const u = composeClientEngagementStatus(unreadable);
    expect(u.terms?.state).toBe('unreadable');
    expect(u.money.contracted_minor).toBeNull();
    expect(u.money.behind_schedule_minor).toBeNull();
    expect(u.money.overdue_minor).toBeNull();
    expect(u.attention).toContain('terms_unreadable');

    const stale = base();
    stale.terms[0].agreed_amount_minor = 400000;
    const st = composeClientEngagementStatus(stale);
    expect(st.terms?.state).toBe('stale');
    expect(st.money.due_to_date_minor).toBeNull();
    expect(st.attention).toContain('terms_stale');
  });

  it('withholds every money total rather than understating it when a list is truncated', () => {
    for (const key of ['invoices_has_more', 'terms_has_more'] as const) {
      const s = base();
      s[key] = true;
      const { money, attention } = composeClientEngagementStatus(s);
      expect([money.contracted_minor, money.behind_schedule_minor, money.invoiced_minor, money.outstanding_minor,
        money.overdue_minor, money.awaiting_confirmation_minor, money.received.verified_minor,
        money.received.recorded_by_owner_minor, money.received_against_terms.verified_minor]).toEqual(Array(9).fill(null));
      expect(attention).toContain('list_truncated');
    }
  });

  it('refuses to add different currencies together', () => {
    const s = base();
    // A draft in another currency is not billed and must not mix the totals; a billed one must.
    invoice(s, 'E4-0003').currency = 'eur';
    expect(composeClientEngagementStatus(structuredClone(s)).money.mixed_currency).toBe(false);
    invoice(s, 'E4-0002').currency = 'eur';
    const { money } = composeClientEngagementStatus(s);
    expect(money.mixed_currency).toBe(true);
    expect(money.currency).toBeNull();
    expect([money.invoiced_minor, money.outstanding_minor, money.overdue_minor, money.received.verified_minor,
      money.behind_schedule_minor]).toEqual(Array(5).fill(null));
  });

  it('reads a client with no records as an honest empty state', () => {
    const s = base();
    s.terms = []; s.signings = []; s.invoices = [];
    s.work = { ...s.work, total: 0, done: 0, open: 0, overdue: 0, blocked: 0, cancelled: 0, undated_open: 0, items: [] };
    const status = composeClientEngagementStatus(s);
    expect(status.terms).toBeNull();
    expect(status.agreement.state).toBe('none');
    expect(status.work.state).toBe('none');
    expect(status.money.outstanding_minor).toBe(0);
    expect(status.attention).toEqual([]);
  });

  it('fails closed on a malformed envelope instead of rendering zeros', () => {
    expect(() => parseClientEngagementSource({ terms: [] })).toThrow(/CLIENT_STATUS_SOURCE_INVALID/);
    const s = base();
    (invoice(s, 'E4-0001') as unknown as Record<string, unknown>).amount_minor = '350000';
    expect(() => composeClientEngagementStatus(s)).toThrow(/CLIENT_STATUS_SOURCE_INVALID/);
    const negative = base();
    invoice(negative, 'E4-0001').manual_recorded_minor = -100;
    expect(() => composeClientEngagementStatus(negative)).toThrow(/CLIENT_STATUS_SOURCE_INVALID/);
  });
});
