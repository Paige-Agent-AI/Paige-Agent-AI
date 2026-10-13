import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectionContactWindow,
  type RecipientContactFacts,
} from '../../supabase/functions/_shared/sales-collections/contact-window';

// Owner ruling 2026-10-12: the RECIPIENT's verified local zone governs when an automated email, text or
// call may go out — never the business owner's location, a phone prefix or a browser. Unknown
// location, zone or permission means no automated contact and a request to verify.
const us = (timezone: string, overrides: Partial<RecipientContactFacts> = {}): RecipientContactFacts => ({
  timezone, timezone_verified: true, jurisdiction: { country: 'US', verified: true },
  consent: 'granted', suppressed: false, dnd_active: false, ...overrides,
});
const at = (iso: string) => new Date(iso);
const reasonOf = (d: ReturnType<typeof collectionContactWindow>) => ('reason' in d ? d.reason : null);

describe('automated collections contact — recipient-local hours across the United States', () => {
  it('clears or holds the same instant differently for recipients in different US zones', () => {
    const instant = at('2026-10-13T00:30:00Z'); // 20:30 New York · 19:30 Chicago · 17:30 Los Angeles · 14:30 Honolulu
    expect(collectionContactWindow('sms', us('America/New_York'), instant)).toEqual({
      state: 'wait', recipient_zone: 'America/New_York', reason: 'outside_recipient_hours',
      next_allowed_at: '2026-10-13T12:00:00.000Z', // 08:00 EDT next morning
    });
    expect(collectionContactWindow('sms', us('America/Chicago'), instant).state).toBe('clear');
    expect(collectionContactWindow('sms', us('America/Los_Angeles'), instant).state).toBe('clear');
    expect(collectionContactWindow('email', us('Pacific/Honolulu'), instant).state).toBe('clear');
    // Three-level and hyphenated region names are real US recipients' zones.
    expect(collectionContactWindow('sms', us('America/Indiana/Indianapolis'), instant).state).toBe('wait');
    expect(collectionContactWindow('sms', us('America/North_Dakota/New_Salem'), instant).state).toBe('clear');
    expect(collectionContactWindow('email', us('America/Port-au-Prince'), at('2026-10-13T16:00:00Z')).state).toBe('clear');
  });

  it('opens at 08:00 recipient-local on both sides of a daylight saving change', () => {
    // Spring forward, 14 Mar 2027: 07:30 EDT is 11:30 UTC → hold until 08:00 EDT = 12:00 UTC.
    expect(collectionContactWindow('sms', us('America/New_York'), at('2027-03-14T11:30:00Z'))).toMatchObject({
      state: 'wait', next_allowed_at: '2027-03-14T12:00:00.000Z' });
    expect(collectionContactWindow('sms', us('America/New_York'), at('2027-03-14T12:30:00Z')).state).toBe('clear');
    // Fall back, 1 Nov 2026: 07:30 EST is 12:30 UTC → hold until 08:00 EST = 13:00 UTC.
    expect(collectionContactWindow('sms', us('America/New_York'), at('2026-11-01T12:30:00Z'))).toMatchObject({
      state: 'wait', next_allowed_at: '2026-11-01T13:00:00.000Z' });
    // Arizona keeps standard time all year: the same instant is already 05:30 there → still held.
    expect(collectionContactWindow('sms', us('America/Phoenix'), at('2026-11-01T12:30:00Z')).state).toBe('wait');
    // The evening boundary: 19:59 local clears, 20:00 local holds.
    expect(collectionContactWindow('email', us('America/Los_Angeles'), at('2026-10-13T02:59:00Z')).state).toBe('clear');
    expect(collectionContactWindow('email', us('America/Los_Angeles'), at('2026-10-13T03:00:00Z')).state).toBe('wait');
  });
});

describe('automated collections contact — refusals', () => {
  const noon = at('2026-10-13T16:00:00Z'); // midday everywhere in the continental US

  it('never contacts a recipient whose zone is missing, unverified or not an IANA zone', () => {
    for (const recipient of [
      us('', {}), us('America/New_York', { timezone_verified: false }),
      { ...us('America/New_York'), timezone: null }, us('Mars/Olympus_Mons'), us('+05:30'),
      // Verified, but not regional zones: no DST rules of a place, so the local hour can be wrong.
      us('EST'), us('EST5EDT'), us('Etc/GMT+5'), us('UTC'), us('Zulu'),
    ]) {
      expect(collectionContactWindow('email', recipient, noon)).toEqual({
        state: 'blocked', reason: 'recipient_time_zone_unverified', request_verification: true });
    }
  });

  it('reads an EST-"verified" recipient as unverified, so a 20:30 EDT text cannot slip through', () => {
    // 00:30 UTC on 13 Oct is 20:30 EDT in New York and 19:30 in fixed EST.
    expect(collectionContactWindow('sms', us('EST'), at('2026-10-13T00:30:00Z')).state).toBe('blocked');
    expect(collectionContactWindow('sms', us('America/New_York'), at('2026-10-13T00:30:00Z')).state).toBe('wait');
  });

  it('never contacts a recipient whose location is not verified', () => {
    expect(collectionContactWindow('email', us('America/New_York', { jurisdiction: null }), noon)).toMatchObject({
      state: 'blocked', reason: 'recipient_location_unverified', request_verification: true });
    expect(collectionContactWindow('email', us('America/New_York', { jurisdiction: { country: 'US', verified: false } }), noon))
      .toMatchObject({ reason: 'recipient_location_unverified' });
  });

  it('refuses international recipients until their jurisdiction rules are encoded', () => {
    const london = { timezone: 'Europe/London', timezone_verified: true, jurisdiction: { country: 'GB', verified: true },
      consent: 'granted' as const, suppressed: false, dnd_active: false };
    expect(collectionContactWindow('email', london, at('2026-10-13T11:00:00Z'))).toEqual({
      state: 'blocked', reason: 'jurisdiction_rules_unavailable', request_verification: false });
    expect(reasonOf(collectionContactWindow('sms', { ...london, timezone: 'Asia/Tokyo', jurisdiction: { country: 'JP', verified: true } },
      at('2026-10-13T03:00:00Z')))).toBe('jurisdiction_rules_unavailable');
    // A US customer temporarily abroad keeps US rules but THEIR verified zone decides the hour.
    expect(collectionContactWindow('email', us('Europe/Berlin'), at('2026-10-13T05:30:00Z')).state).toBe('wait');
    expect(collectionContactWindow('email', us('Europe/Berlin'), at('2026-10-13T07:30:00Z')).state).toBe('clear');
  });

  it('honours opt-out, do-not-disturb and withdrawn or missing permission before any hour check', () => {
    expect(collectionContactWindow('email', us('America/New_York', { suppressed: true }), noon)).toEqual({
      state: 'blocked', reason: 'opted_out', request_verification: false });
    expect(reasonOf(collectionContactWindow('sms', us('America/New_York', { dnd_active: true }), noon))).toBe('do_not_disturb');
    expect(reasonOf(collectionContactWindow('email', us('America/New_York', { consent: 'revoked' }), noon))).toBe('consent_revoked');
    expect(collectionContactWindow('sms', us('America/New_York', { consent: 'missing' }), noon)).toEqual({
      state: 'blocked', reason: 'consent_missing', request_verification: true });
    // A collections EMAIL needs no prior opt-in in the US — only that permission was not withdrawn.
    expect(collectionContactWindow('email', us('America/New_York', { consent: 'missing' }), noon).state).toBe('clear');
    // An opt-out wins even when the recipient's zone is also unknown.
    expect(reasonOf(collectionContactWindow('sms', us('', { suppressed: true }), noon))).toBe('opted_out');
  });

  it('never places an AI collection call, whatever else is true', () => {
    expect(collectionContactWindow('call', us('America/New_York'), noon)).toEqual({
      state: 'blocked', reason: 'calling_not_authorized', request_verification: false });
  });
});

describe('stays in step with the shared pre-send gate', () => {
  it('uses the same quiet window as the pre-send gate (pinned reviewed source, so compared by text)', () => {
    const gate = readFileSync('supabase/functions/_shared/pre-send-pipeline.ts', 'utf8');
    expect(gate).toMatch(/QUIET_HOURS_START = "20:00"/);
    expect(gate).toMatch(/QUIET_HOURS_END = "08:00"/);
    const mine = readFileSync('supabase/functions/_shared/sales-collections/contact-window.ts', 'utf8');
    expect(mine).toMatch(/US: \{ start: '08:00', end: '20:00' \}/);
  });
});

