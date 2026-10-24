// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readOriginalSpecialistHistory } from './specialistHistory';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { threadId: id(1), turnId: id(2), intentId: id(3), tenantId: id(4) };
const history = () => ({ v: 1, status: 'recorded_assignment', thread_id: scope.threadId, turn_id: scope.turnId,
  origin_intent_id: scope.intentId, tenant_id: scope.tenantId, read_only: true, new_effect_possible: false, limited: false,
  results: [{ id: id(5), specialist: 'zion', recorded_status: 'succeeded', created_at: '2026-10-23T12:00:00Z',
    observed_at: '2026-10-23T12:01:00Z', receipt_state: 'verified', receipt_id: id(6), receipt_at: '2026-10-23T12:00:01Z',
    response_text: 'Original specialist response', response_truncated: false, completion_scope: 'specialist_response_only' }] });
describe('original specialist status response projection', () => {
  it('copies only the closed original scope and observations', () => {
    const raw = history(), result = readOriginalSpecialistHistory(raw, scope);
    expect(result).toEqual(raw); raw.results[0].response_text = 'Changed'; raw.results.length = 0;
    expect(result).toEqual(history());
  });
  it.each(['pending', 'dispatched', 'unknown'])('retains %s without inventing completion or retry authority', status => {
    const raw = history(); Object.assign(raw.results[0], { recorded_status: status, receipt_state: 'missing',
      receipt_id: null, receipt_at: null, response_text: null });
    expect(readOriginalSpecialistHistory(raw, scope)).toEqual(raw);
  });
  it.each(['thread_id', 'turn_id', 'origin_intent_id', 'tenant_id'])('refuses foreign %s', key => {
    expect(readOriginalSpecialistHistory({ ...history(), [key]: id(99) }, scope)).toBeNull();
  });
  it.each(['effect', 'private', 'duplicate', 'large', 'wrong_id', 'wrong_status', 'wrong_scope', 'false_receipt', 'leaked_failure', 'date'])('refuses %s evidence', kind => {
    const raw = history();
    if (kind === 'effect') Object.assign(raw, { new_effect_possible: true });
    if (kind === 'private') Object.assign(raw.results[0], { input: 'PRIVATE' });
    if (kind === 'duplicate') raw.results.push({ ...raw.results[0] });
    if (kind === 'large') raw.results[0].response_text = 'x'.repeat(8001);
    if (kind === 'wrong_id') raw.results[0].id = 'untrusted';
    if (kind === 'wrong_status') raw.results[0].recorded_status = 'completed';
    if (kind === 'wrong_scope') raw.results[0].completion_scope = 'business_action';
    if (kind === 'false_receipt') raw.results[0].receipt_id = 'untrusted';
    if (kind === 'leaked_failure') raw.results[0].recorded_status = 'failed';
    if (kind === 'date') raw.results[0].observed_at = 'untrusted';
    expect(readOriginalSpecialistHistory(raw, scope)).toBeNull();
  });
  it.each([null, [], {}, { bundle_ref: history() }, { ...history(), confirmations: [] }])('refuses unrelated containers or expanded authority %j', raw => {
    expect(readOriginalSpecialistHistory(raw, scope)).toBeNull();
  });
});
