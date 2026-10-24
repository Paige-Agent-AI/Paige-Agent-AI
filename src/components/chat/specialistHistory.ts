import type { OriginalPreparationScope } from './curaPreparationHistory';

export interface OriginalSpecialistObservation {
  id: string; specialist: string;
  recorded_status: 'pending' | 'succeeded' | 'failed' | 'dispatched' | 'unknown';
  created_at: string; observed_at: string;
  receipt_state: 'verified' | 'unverified' | 'missing' | 'unavailable' | 'conflicting';
  receipt_id: string | null; receipt_at: string | null;
  response_text: string | null; response_truncated: boolean;
  completion_scope: 'specialist_response_only';
}
export interface OriginalSpecialistHistory {
  v: 1; status: 'recorded_assignment'; thread_id: string; turn_id: string;
  origin_intent_id: string; tenant_id: string; read_only: true; new_effect_possible: false;
  results: OriginalSpecialistObservation[]; limited: boolean;
}
/** A UI locator only. The native status reader must prove its authority again. */
export function originalSpecialistOrigin(turn: unknown, scope: { threadId: string; tenantId: string }): OriginalPreparationScope | null {
  if (!object(turn) || ![scope.threadId, scope.tenantId, turn.id, turn.interactive_intent_id].every(uuid)
    || turn.role !== 'assistant' || !['FINAL', 'INTERRUPTED', 'LIMIT_REACHED', 'WAIT_WORK', 'WAIT_APPROVAL', 'ASK_USER'].includes(String(turn.interactive_terminal_state))
    || !object(turn.bundle_ref) || !object(turn.bundle_ref.turn_state) || turn.bundle_ref.turn_state.v !== 1
    || turn.bundle_ref.turn_state.state !== turn.interactive_terminal_state || !object(turn.bundle_ref.interactive)
    || turn.bundle_ref.interactive.request_intent_id !== turn.interactive_intent_id
    || !Array.isArray(turn.bundle_ref.interactive.effects) || turn.bundle_ref.interactive.effects.length > 20) return null;
  const original = turn.bundle_ref.interactive.effects.some(effect => object(effect) && effect.tool === 'delegate_to_subagent'
    && Array.isArray(effect.record_refs) && effect.record_refs.length <= 8
    && effect.record_refs.some(ref => object(ref) && ref.kind === 'subagent_invocation' && uuid(ref.id)));
  return original ? { ...scope, turnId: turn.id as string, intentId: turn.interactive_intent_id as string } : null;
}

/** Only a dedicated, freshly scoped native status response may populate this
 * projection. A stored bundle, model statement or copied receipt is not proof. */
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function readOriginalSpecialistHistory(raw: unknown, scope: OriginalPreparationScope): OriginalSpecialistHistory | null {
  if (![scope.threadId, scope.turnId, scope.intentId, scope.tenantId].every(uuid) || !object(raw)
    || !closed(raw, ['v', 'status', 'thread_id', 'turn_id', 'origin_intent_id', 'tenant_id', 'read_only', 'new_effect_possible', 'results', 'limited'])
    || raw.v !== 1 || raw.status !== 'recorded_assignment' || raw.thread_id !== scope.threadId || raw.turn_id !== scope.turnId
    || raw.origin_intent_id !== scope.intentId || raw.tenant_id !== scope.tenantId || raw.read_only !== true
    || raw.new_effect_possible !== false || typeof raw.limited !== 'boolean' || !Array.isArray(raw.results)
    || raw.results.length < 1 || raw.results.length > 3) return null;
  const results: OriginalSpecialistObservation[] = [], seen = new Set<string>();
  for (const item of raw.results) {
    if (!object(item) || !closed(item, ['id', 'specialist', 'recorded_status', 'created_at', 'observed_at', 'receipt_state',
      'receipt_id', 'receipt_at', 'response_text', 'response_truncated', 'completion_scope'])
      || !uuid(item.id) || seen.has(item.id.toLowerCase()) || typeof item.specialist !== 'string'
      || !/^[a-z][a-z0-9-]{0,95}$/.test(item.specialist) || !instant(item.created_at) || !instant(item.observed_at)
      || item.completion_scope !== 'specialist_response_only' || typeof item.response_truncated !== 'boolean'
      || !(item.response_text === null || typeof item.response_text === 'string' && item.response_text.length <= 8000)) return null;
    const status = (['pending', 'succeeded', 'failed', 'dispatched', 'unknown'] as const).find(value => value === item.recorded_status);
    const receipt = (['verified', 'unverified', 'missing', 'unavailable', 'conflicting'] as const).find(value => value === item.receipt_state);
    if (!status || !receipt || (receipt === 'verified'
      ? !['succeeded', 'failed'].includes(status) || !uuid(item.receipt_id) || !instant(item.receipt_at)
      : item.receipt_id !== null || item.receipt_at !== null)
      || status !== 'succeeded' && item.response_text !== null || item.response_text === null && item.response_truncated) return null;
    seen.add(item.id.toLowerCase());
    results.push({ id: item.id, specialist: item.specialist, recorded_status: status, created_at: item.created_at,
      observed_at: item.observed_at, receipt_state: receipt, receipt_id: typeof item.receipt_id === 'string' ? item.receipt_id : null,
      receipt_at: typeof item.receipt_at === 'string' ? item.receipt_at : null, response_text: item.response_text,
      response_truncated: item.response_truncated, completion_scope: 'specialist_response_only' });
  }
  return { v: 1, status: 'recorded_assignment', thread_id: scope.threadId, turn_id: scope.turnId,
    origin_intent_id: scope.intentId, tenant_id: scope.tenantId, read_only: true, new_effect_possible: false, results, limited: raw.limited };
}
