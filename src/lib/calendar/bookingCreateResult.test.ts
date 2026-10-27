import { describe, expect, it } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { readBookingCreateResult } from './bookingCreateResult';

const choice = { startAt: '2030-01-01T15:00:00.000Z', durationMin: 30, pageOrigin: 'https://portal.example.test', appOrigin: 'https://app.example.test' };
const row = () => ({ id: '10000000-0000-4000-8000-000000000001', start_at: choice.startAt, end_at: '2030-01-01T15:30:00.000Z', title: 'Client check-in' });
const valid = () => ({ ok: true, booking: row() });

describe('original booking receipt boundary', () => {
  it('projects only original receipt facts matching the confirmed choice', () => {
    expect(readBookingCreateResult({ ...valid(), private_context: 'withheld', booking: { ...row(), another_client: 'withheld' } }, null, choice)).toEqual({
      kind: 'confirmed', booking: { id: row().id, startAt: choice.startAt, endAt: row().end_at, title: row().title }, manageUrl: null,
    });
  });
  it.each([
    null, undefined, [], 'ok', {}, { ok: 1, booking: row() }, { ok: false, booking: row() }, { ok: true }, { ok: true, booking: [] },
    Object.assign(Object.create({ ok: true }), { booking: row() }),
    { ok: true, booking: Object.create(row()) },
    { ok: true, booking: { ...row(), id: '' } }, { ok: true, booking: { ...row(), id: 'not-an-id' } },
    { ok: true, booking: { ...row(), title: '' } }, { ok: true, booking: { ...row(), title: 'x'.repeat(501) } },
    { ok: true, booking: { ...row(), start_at: 'invalid' } },
    { ok: true, booking: { ...row(), start_at: '2030-01-01T16:00:00.000Z' } },
    { ok: true, booking: { ...row(), end_at: '2030-01-01T15:45:00.000Z' } },
    { ok: true, booking: { ...row(), end_at: choice.startAt } },
    { ok: false, status: 'blocked', code: 'COMMS_PROVIDER_EXECUTION_DISABLED' },
    { error: 'The external outcome is uncertain.' },
    { ...valid(), error: 'Uncertain result' }, { ...valid(), status: 'blocked' },
  ])('withholds absent, malformed or different-choice receipt %#', data => {
    expect(readBookingCreateResult(data, null, choice)).toEqual({ kind: 'unknown' });
  });
  it.each([400, 401, 403, 404, 409, 429])('recognizes the original actual HTTP%s refusal without reading its raw body', status => {
    const result = readBookingCreateResult(null, new FunctionsHttpError(new Response('private provider detail', { status })), choice);
    expect(result.kind).toBe('refused'); expect(JSON.stringify(result)).not.toContain('private provider detail');
    if (result.kind === 'refused') expect(result.chooseAnotherTime).toBe(status === 409);
  });
  it.each([new Error('network'), { context: { status: 409 } }, { context: new Response('', { status: 409 }) }, new FunctionsHttpError(new Response('', { status: 500 }))])('holds transport, shaped or post-write-capable errors %#', error => {
    expect(readBookingCreateResult(valid(), error, choice)).toEqual({ kind: 'unknown' });
  });
  it.each([
    'https://foreign.example.test/booking/manage?token=neutral', 'javascript:alert(1)',
    'https://user:pass@app.example.test/booking/manage?token=neutral', 'https://app.example.test/other?token=neutral',
    'https://app.example.test/booking/manage', 'https://app.example.test/booking/manage?token=neutral#fragment',
  ])('does not expose an unrelated optional management destination: %s', manageUrl => {
    const result = readBookingCreateResult({ ...valid(), manageUrl }, null, choice);
    expect(result.kind).toBe('confirmed'); if (result.kind === 'confirmed') expect(result.manageUrl).toBeNull();
  });
  it.each(['/booking/manage?token=neutral', 'https://portal.example.test/booking/manage?token=neutral'])('retains the original approved management path: %s', manageUrl => {
    const result = readBookingCreateResult({ ...valid(), manageUrl }, null, choice);
    expect(result.kind).toBe('confirmed'); if (result.kind === 'confirmed') expect(result.manageUrl).toBe(new URL(manageUrl, choice.appOrigin).href);
  });
  it('cannot confirm against an invalid original choice', () => {
    expect(readBookingCreateResult(valid(), null, { ...choice, durationMin: 0 })).toEqual({ kind: 'unknown' });
    expect(readBookingCreateResult(valid(), null, { ...choice, startAt: 'invalid' })).toEqual({ kind: 'unknown' });
  });
});
