import { afterEach, describe, expect, it } from 'vitest';
import source from './fixtures/exp04-client-status-source.json';
import { localDateInZone } from '../../supabase/functions/_shared/paige-context/snapshot';
import {
  composeClientEngagementStatus,
  type ClientEngagementSource,
} from '../../supabase/functions/_shared/client-engagement/status';

// Owner ruling 2026-10-12: due, upcoming and overdue are classified in the BUSINESS OWNER's configured
// IANA zone — never UTC, server time or the viewer's zone. The fixture is the real database read
// (owner configured America/New_York); these cases move the read instant and the zone.
const base = (): ClientEngagementSource => structuredClone(source) as ClientEngagementSource;
const at = (iso: string, zone: string | null, state: ClientEngagementSource['business_time_zone']['state'] = 'configured') => {
  const s = base();
  s.read_at = iso;
  s.business_time_zone = { state, zone };
  return s;
};
const ms = (iso: string) => Date.parse(iso);

describe('the owner-local calendar date', () => {
  it('crosses midnight in the owner zone, not at UTC midnight', () => {
    // 02:30 UTC on 1 Nov is still 31 Oct in New York (EDT, UTC-4) and already 1 Nov in London.
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), 'America/New_York')).toBe('2026-10-31');
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), 'Europe/London')).toBe('2026-11-01');
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), 'UTC')).toBe('2026-11-01');
    // Just before and after New York midnight.
    expect(localDateInZone(ms('2026-10-31T03:59:59Z'), 'America/New_York')).toBe('2026-10-30');
    expect(localDateInZone(ms('2026-10-31T04:00:00Z'), 'America/New_York')).toBe('2026-10-31');
  });

  it('follows the spring-forward and fall-back changes', () => {
    // US clocks spring forward at 02:00 on 14 Mar 2027: midnight is still 05:00 UTC (EST).
    expect(localDateInZone(ms('2027-03-14T04:59:59Z'), 'America/New_York')).toBe('2027-03-13');
    expect(localDateInZone(ms('2027-03-14T05:00:00Z'), 'America/New_York')).toBe('2027-03-14');
    // The next midnight is 04:00 UTC (EDT).
    expect(localDateInZone(ms('2027-03-15T03:59:59Z'), 'America/New_York')).toBe('2027-03-14');
    expect(localDateInZone(ms('2027-03-15T04:00:00Z'), 'America/New_York')).toBe('2027-03-15');
    // Fall back on 1 Nov 2026: 01:30 happens twice, both on 1 Nov; the day ends at 05:00 UTC.
    expect(localDateInZone(ms('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    expect(localDateInZone(ms('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    expect(localDateInZone(ms('2026-11-02T04:59:59Z'), 'America/New_York')).toBe('2026-11-01');
    expect(localDateInZone(ms('2026-11-02T05:00:00Z'), 'America/New_York')).toBe('2026-11-02');
    // Southern hemisphere: Sydney leaves daylight time on 4 Apr 2027 (UTC+11 → UTC+10).
    expect(localDateInZone(ms('2027-04-03T12:59:59Z'), 'Australia/Sydney')).toBe('2027-04-03');
    expect(localDateInZone(ms('2027-04-03T13:00:00Z'), 'Australia/Sydney')).toBe('2027-04-04');
    expect(localDateInZone(ms('2027-04-04T13:59:59Z'), 'Australia/Sydney')).toBe('2027-04-04');
  });

  it('refuses names that are not IANA zones rather than guessing', () => {
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), 'Mars/Olympus_Mons')).toBeNull();
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), '+05:30')).toBeNull();
    expect(localDateInZone(ms('2026-11-01T02:30:00Z'), '')).toBeNull();
    expect(localDateInZone(Number.NaN, 'UTC')).toBeNull();
  });
});

describe('client status uses the owner zone', () => {
  const originalTz = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTz; });

  it('does not call an invoice late at UTC midnight when it is still its due date for the owner', () => {
    const s = at('2026-11-01T02:30:00Z', 'America/New_York');
    s.invoices.find(i => i.invoice_number === 'E4-0002')!.due_date = '2026-10-31';
    const ny = composeClientEngagementStatus(s);
    expect(ny.as_of_date).toBe('2026-10-31');
    expect(ny.invoices.find(i => i.number === 'E4-0002')!.overdue).toBe(false);

    // The same instant for an owner who configured UTC: now it is late.
    const utcOwner = at('2026-11-01T02:30:00Z', 'UTC');
    utcOwner.invoices.find(i => i.invoice_number === 'E4-0002')!.due_date = '2026-10-31';
    const utc = composeClientEngagementStatus(utcOwner);
    expect(utc.as_of_date).toBe('2026-11-01');
    expect(utc.invoices.find(i => i.number === 'E4-0002')!.overdue).toBe(true);
  });

  it.each([
    // [due date, instant just before owner midnight, instant just after]
    ['2027-03-13', '2027-03-14T04:30:00Z', '2027-03-14T05:30:00Z'], // spring-forward day (EST at midnight)
    ['2027-03-14', '2027-03-15T03:30:00Z', '2027-03-15T04:30:00Z'], // first EDT midnight
    ['2026-10-31', '2026-11-01T03:30:00Z', '2026-11-01T04:30:00Z'], // fall-back day (EDT at midnight)
    ['2026-11-01', '2026-11-02T04:30:00Z', '2026-11-02T05:30:00Z'], // first EST midnight
  ])('an invoice due %s turns late at New York midnight, across daylight saving changes', (due, before, after) => {
    const late = (iso: string) => {
      const s = at(iso, 'America/New_York');
      s.invoices.find(i => i.invoice_number === 'E4-0002')!.due_date = due;
      return composeClientEngagementStatus(s).invoices.find(i => i.number === 'E4-0002')!.overdue;
    };
    expect(late(before)).toBe(false);
    expect(late(after)).toBe(true);
  });

  it('gives the same answer to people viewing the same business from different zones', () => {
    const outputs = ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'America/Los_Angeles'].map(viewer => {
      process.env.TZ = viewer;
      return JSON.stringify(composeClientEngagementStatus(at('2026-11-01T02:30:00Z', 'America/New_York')));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it.each(['missing', 'ambiguous', 'invalid'] as const)('withholds every due judgement when the owner zone is %s', state => {
    const status = composeClientEngagementStatus(at('2026-11-01T02:30:00Z', null, state));
    expect(status.as_of_date).toBeNull();
    expect(status.time_zone).toEqual({ state, zone: null });
    expect(status.attention).toContain('business_time_zone_unset');
    expect(status.terms!.schedule.every(r => r.due === null)).toBe(true);
    expect([status.money.overdue_minor, status.money.due_to_date_minor, status.money.behind_schedule_minor])
      .toEqual([null, null, null]);
    const dated = status.invoices.filter(i => i.due_date !== null && i.outstanding_minor > 0);
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every(i => i.overdue === null && i.past_due_minor === null)).toBe(true);
    expect(status.attention).not.toContain('payment_overdue');
    expect(status.attention).not.toContain('behind_schedule');
    // Contractual due dates and money already received are untouched.
    const reference = composeClientEngagementStatus(base());
    expect(status.terms!.schedule.map(r => r.due_date)).toEqual(reference.terms!.schedule.map(r => r.due_date));
    expect(status.invoices.map(i => i.due_date)).toEqual(reference.invoices.map(i => i.due_date));
    expect(status.money.received).toEqual(reference.money.received);
    expect(status.money.outstanding_minor).toBe(reference.money.outstanding_minor);
  });

  it('treats a zone this runtime cannot resolve as invalid, never as UTC', () => {
    const status = composeClientEngagementStatus(at('2026-11-01T02:30:00Z', 'Mars/Olympus_Mons'));
    expect(status.time_zone).toEqual({ state: 'invalid', zone: null });
    expect(status.as_of_date).toBeNull();
    expect(status.money.overdue_minor).toBeNull();
  });
});
