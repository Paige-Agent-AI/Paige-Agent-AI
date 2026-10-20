import { describe, expect, it } from 'vitest';
import { readOriginalReminderHistory } from './reminderHistory';

// Pure projection controls: no native/JWT, current record, delivery or approval proof.
const id = (n: number) => `a2342000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { threadId: id(1), turnId: id(2), intentId: id(3), tenantId: id(4) };
const original = (n = 0) => ({ item_id: id(10 + n), title: 'Original service review',
  remind_at: '2030-01-02T10:00:00.123456+00:00', source_version: '2026-10-18T06:40:00.765432Z',
  receipt_run_id: id(30 + n) });
const result = (n = 0) => ({ tool: 'plan_set_reminder', receipt_version: 1, original: original(n) });
const projection = () => ({ v: 1, status: 'verified_original', thread_id: scope.threadId,
  turn_id: scope.turnId, origin_intent_id: scope.intentId, tenant_id: scope.tenantId,
  historical: true, replayed: true, new_effect_possible: false, confirmations_restored: false,
  results: [result()] });

describe('original Reminder history client projection', () => {
  it('accepts only the bound dedicated historical shape with the original receipt and source version', () => {
    const raw = projection();
    expect(readOriginalReminderHistory(raw, scope)).toEqual(raw);
    expect(readOriginalReminderHistory(raw, scope)?.results[0].original.source_version).toBe(original().source_version);
  });
  it('detaches every projected object/array from the response and scope input', () => {
    const raw = projection(), suppliedScope = { ...scope };
    const parsed = readOriginalReminderHistory(raw, suppliedScope);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toBe(raw); expect(parsed?.results).not.toBe(raw.results);
    expect(parsed?.results[0]).not.toBe(raw.results[0]);
    expect(parsed?.results[0].original).not.toBe(raw.results[0].original);
    raw.results[0].original.title = 'Changed response'; raw.results[0].original.source_version = '2035-01-01T00:00:00Z';
    raw.results.push(result(1)); raw.tenant_id = id(99); suppliedScope.threadId = id(99);
    expect(parsed).toEqual(projection());
    parsed!.results[0].original.title = 'Changed local projection';
    expect(raw.results[0].original.title).toBe('Changed response');
  });

  it.each(['thread_id', 'turn_id', 'origin_intent_id', 'tenant_id'])('rejects a foreign %s', field => {
    expect(readOriginalReminderHistory({ ...projection(), [field]: id(99) }, scope)).toBeNull();
  });
  it.each(['threadId', 'turnId', 'intentId', 'tenantId'])('rejects malformed expected binding %s', field => {
    expect(readOriginalReminderHistory(projection(), { ...scope, [field]: 'not-a-uuid' })).toBeNull();
  });
  it.each([
    { v: 2 }, { status: 'available' }, { historical: false }, { replayed: false },
    { new_effect_possible: true }, { confirmations_restored: true }, { historical: 'true' },
    { replayed: 1 }, { new_effect_possible: null }, { confirmations_restored: undefined },
  ])('refuses an unverified/effectful or malformed envelope %j', change => {
    expect(readOriginalReminderHistory({ ...projection(), ...change }, scope)).toBeNull();
  });
  it.each([null, undefined, [], {}, 'verified_original', { approval_history: projection() },
    { bundle_ref: { approval_history: projection() } }, { paige_confirm: [result()] },
    { v: 1, status: 'unavailable' }])('does not infer history from another container %j', raw => {
    expect(readOriginalReminderHistory(raw, scope)).toBeNull();
  });
  it.each(Object.keys(projection()))('requires envelope field %s', key => {
    const raw: Record<string, unknown> = projection(); delete raw[key];
    expect(readOriginalReminderHistory(raw, scope)).toBeNull();
  });

  const authorityKeys = ['fingerprint', 'command', 'idempotency_key', 'approval_id', 'runtime',
    'retryAllowed', 'freshDispatchAllowed', 'currentReadback', 'confirmations'];
  for (const level of ['envelope', 'result', 'original'] as const) {
    it.each(authorityKeys)('rejects extra ' + level + ' authority key %s even when undefined', key => {
      const raw = projection();
      const target = level === 'envelope' ? raw : level === 'result' ? raw.results[0] : raw.results[0].original;
      Object.assign(target, { [key]: undefined });
      expect(readOriginalReminderHistory(raw, scope)).toBeNull();
    });
  }
  it.each([null, {}, 'result', [result()], { ...result(), tool: 'crm_create_task' },
    { ...result(), receipt_version: 2 }, { ...result(), original: null }])('rejects malformed or another tool result %j', candidate => {
    expect(readOriginalReminderHistory({ ...projection(), results: [candidate] }, scope)).toBeNull();
  });
  it.each(['tool', 'receipt_version', 'original'])('requires result field %s', key => {
    const candidate: Record<string, unknown> = result(); delete candidate[key];
    expect(readOriginalReminderHistory({ ...projection(), results: [candidate] }, scope)).toBeNull();
  });
  it.each(Object.keys(original()))('requires original field %s', key => {
    const candidate: Record<string, unknown> = original(); delete candidate[key];
    expect(readOriginalReminderHistory({ ...projection(), results: [{ ...result(), original: candidate }] }, scope)).toBeNull();
  });
  it.each(['item_id', 'receipt_run_id'])('rejects malformed original UUID %s', key => {
    const raw = projection(); Object.assign(raw.results[0].original, { [key]: 'not-a-uuid' });
    expect(readOriginalReminderHistory(raw, scope)).toBeNull();
  });
  it.each(['item_id', 'receipt_run_id'] as const)('rejects duplicate %s even with different UUID case', key => {
    const raw = projection(), second = result(1);
    second.original[key] = raw.results[0].original[key].toUpperCase(); raw.results.push(second);
    expect(readOriginalReminderHistory(raw, scope)).toBeNull();
  });
  it('rejects empty/over-limit lists while accepting all ten distinct original records', () => {
    expect(readOriginalReminderHistory({ ...projection(), results: [] }, scope)).toBeNull();
    expect(readOriginalReminderHistory({ ...projection(), results: Array.from({ length: 11 }, (_, i) => result(i)) }, scope)).toBeNull();
    expect(readOriginalReminderHistory({ ...projection(), results: Array.from({ length: 10 }, (_, i) => result(i)) }, scope)?.results).toHaveLength(10);
  });
  it.each([null, 0, '', ' \n\t ', 'x'.repeat(16385)])('rejects invalid/beyond-limit original title %j', title => {
    const raw = projection(); Object.assign(raw.results[0].original, { title });
    expect(readOriginalReminderHistory(raw, scope)).toBeNull();
  });
  it('preserves the original title and microsecond instants without rewriting historical values', () => {
    const raw = projection(); raw.results[0].original.title = ' x'.repeat(8192);
    expect(readOriginalReminderHistory(raw, scope)?.results[0].original).toEqual(raw.results[0].original);
  });
  const malformedDates = ['', 'tomorrow', '2026-10-18', '2026-10-18T10:00:00',
    '2026-10-18T10:00:00.1234567Z', '2026-13-01T00:00:00Z', '2026-01-32T00:00:00Z',
    '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-10-18T24:00:00Z',
    '2026-10-18T10:60:00Z', '2026-10-18T10:00:60Z', '2026-10-18T10:00:00+24:00'];
  for (const field of ['remind_at', 'source_version'] as const) {
    it.each(malformedDates)('rejects a malformed calendar ' + field + ' %j', date => {
      const raw = projection(); raw.results[0].original[field] = date;
      expect(readOriginalReminderHistory(raw, scope)).toBeNull();
    });
  }
  it('accepts genuine leap-day and offset original instants without expiring history', () => {
    const raw = projection(); raw.results[0].original.remind_at = '2024-02-29T10:00:00-05:00';
    raw.results[0].original.source_version = '2024-02-28 09:00:00.000001Z';
    expect(readOriginalReminderHistory(raw, scope)?.results[0].original).toEqual(raw.results[0].original);
  });
});
