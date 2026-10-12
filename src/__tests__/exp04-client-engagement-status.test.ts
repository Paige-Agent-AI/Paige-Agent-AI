import { describe, expect, it } from 'vitest';
import source from './fixtures/exp04-client-status-source.json';
import {
  composeClientEngagementStatus,
  parseClientEngagementSource,
  type ClientEngagementSource,
} from '../../supabase/functions/_shared/client-engagement/status';

// The fixture is the REAL output of public.read_client_engagement_status from the full-schema
// rollback proof (supabase/tests/exp04_client_engagement_status.sql), captured by
// scripts/proof/exp04-client-status-parity.mjs --write-fixture. Edge cases below mutate a copy.
const base = (): ClientEngagementSource => structuredClone(source) as ClientEngagementSource;

describe('Experience 04 · where this client stands', () => {
  it('composes the $3,500 / $500 / 10 × $300 engagement from the real read', () => {
    const status = composeClientEngagementStatus(parseClientEngagementSource(base()));
    expect(status.money).toMatchObject({
      currency: 'usd', contracted_minor: 350000, invoiced_minor: 122000, invoiced_against_terms_minor: 110000,
      not_yet_invoiced_minor: 240000, outstanding_minor: 62000, overdue_minor: 32000,
      due_to_date_minor: 80000, behind_schedule_minor: 20000, awaiting_confirmation_minor: 20000,
      outcome_unknown_count: 1, failed_request_count: 1, disputes: 'not_recorded',
      received: { verified_minor: 10000, recorded_by_owner_minor: 50000, test_environment_minor: 30000 },
    });
    expect(status.agreement).toMatchObject({ state: 'signed', bound_to_terms: true, effective: 'not_recorded' });
    expect(status.work.state).toBe('behind');
  });

  it('never counts test-environment money as received or as reducing what is owed', () => {
    const s = base();
    const inv = s.invoices.find(i => i.invoice_number === 'E4-0003')!;
    inv.provider_verified_test_minor = inv.amount_minor;
    const status = composeClientEngagementStatus(s);
    expect(status.invoices.find(i => i.number === 'E4-0003')!.payment_state).toBe('unpaid');
    expect(status.money.received.verified_minor).toBe(10000);
  });

  it('never counts an in-flight or unknown payment request as received', () => {
    const s = base();
    for (const i of s.invoices) i.open_payment_requests = i.open_payment_requests.map(r => ({ ...r, state: 'outcome_unknown' }));
    const status = composeClientEngagementStatus(s);
    expect(status.money.awaiting_confirmation_minor).toBe(0);
    expect(status.money.outcome_unknown_count).toBe(2);
    expect(status.money.outstanding_minor).toBe(62000);
  });

  it('separates the agreed schedule from invoices: an unrelated invoice is not progress on the terms', () => {
    const s = base();
    const unrelated = s.invoices.find(i => i.invoice_number === 'E4-0004')!;
    unrelated.manual_recorded_minor = 12000;
    const status = composeClientEngagementStatus(s);
    expect(status.money.received.recorded_by_owner_minor).toBe(62000);
    expect(status.money.behind_schedule_minor).toBe(20000);
  });

  it('reports a completed signing without sealed evidence as not signed', () => {
    const s = base();
    s.signings[0].sealed = false;
    const status = composeClientEngagementStatus(s);
    expect(status.agreement.state).toBe('partially_signed');
    expect(status.attention).toContain('agreement_not_signed');
  });

  it('degrades unreadable and stale terms to a named state, never to confident numbers', () => {
    const unreadable = base();
    unreadable.terms[0].collection_terms = { schema_version: 99 };
    const u = composeClientEngagementStatus(unreadable);
    expect(u.terms?.state).toBe('unreadable');
    expect(u.money.contracted_minor).toBeNull();
    expect(u.money.behind_schedule_minor).toBeNull();
    expect(u.attention).toContain('terms_unreadable');

    const stale = base();
    stale.terms[0].agreed_amount_minor = 400000;
    const st = composeClientEngagementStatus(stale);
    expect(st.terms?.state).toBe('stale');
    expect(st.money.due_to_date_minor).toBeNull();
    expect(st.attention).toContain('terms_stale');
  });

  it('withholds money totals rather than understating them when the invoice list is truncated', () => {
    const s = base();
    s.invoices_has_more = true;
    const status = composeClientEngagementStatus(s);
    expect(status.money.contracted_minor).toBeNull();
    expect(status.money.behind_schedule_minor).toBeNull();
    expect(status.attention).toContain('list_truncated');
  });

  it('refuses to add different currencies together', () => {
    const s = base();
    // A draft in another currency is not billed and must not mix the totals; a billed one must.
    s.invoices.find(i => i.invoice_number === 'E4-0005')!.currency = 'eur';
    expect(composeClientEngagementStatus(structuredClone(s)).money.mixed_currency).toBe(false);
    s.invoices.find(i => i.invoice_number === 'E4-0001')!.currency = 'eur';
    const status = composeClientEngagementStatus(s);
    expect(status.money.mixed_currency).toBe(true);
    expect(status.money.currency).toBeNull();
    expect(status.money.behind_schedule_minor).toBeNull();
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
    (s.invoices.find(i => i.invoice_number === 'E4-0001') as unknown as Record<string, unknown>).amount_minor = '50000';
    expect(() => composeClientEngagementStatus(s)).toThrow(/CLIENT_STATUS_SOURCE_INVALID/);
  });
});
