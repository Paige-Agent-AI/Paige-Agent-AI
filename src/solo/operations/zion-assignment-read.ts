import type { OriginalSpecialistObservation } from '@/components/chat/specialistHistory';
import { FunctionsHttpError, isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { createWeeklyDraftDeadline } from '../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline';

export type ZionReadScope = { actorId: string; tenantId: string; epoch: number; actAsClientId?: string | null };
export type ZionAssignmentSummary = Pick<OriginalSpecialistObservation, 'id' | 'specialist' | 'recorded_status'> & { created_at: string | null };
export type ZionAssignment = Omit<OriginalSpecialistObservation, 'created_at'> & { created_at: string | null; note: string };
export type ZionAssignmentRead = { status: 'ready'; entries: ZionAssignmentSummary[] }
  | { status: 'ready'; invocation: ZionAssignment } | { status: 'refused' | 'unavailable' };
type Caller = {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: unknown }> };
  functions: { invoke(name: string, options: { body: Record<string, unknown> }): PromiseLike<{ data: unknown; error: unknown }> };
};
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const closed = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length
  && keys.every(k => Object.prototype.hasOwnProperty.call(x, k));
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const instant = (x: unknown): x is string => typeof x === 'string' && x.length <= 40
  && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const statuses: OriginalSpecialistObservation['recorded_status'][] = ['pending', 'succeeded', 'failed', 'dispatched', 'unknown'];
const receipts: OriginalSpecialistObservation['receipt_state'][] = ['verified', 'unverified', 'missing', 'unavailable', 'conflicting'];
function summary(x: unknown, exact = true): ZionAssignmentSummary | null {
  if (!object(x) || exact && !closed(x, ['id', 'specialist', 'recorded_status', 'created_at'])
    || !uuid(x.id) || typeof x.specialist !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/.test(x.specialist)
    || x.created_at !== null && !instant(x.created_at)) return null;
  const status = statuses.find(s => s === x.recorded_status);
  return status ? { id: x.id, specialist: x.specialist, recorded_status: status, created_at: x.created_at as string | null } : null;
}
function sample(raw: unknown): ZionAssignmentSummary[] | null {
  if (!object(raw) || !closed(raw, ['ok', 'matches', 'recent_invocations', 'sample_only', 'limit', 'note']) || raw.ok !== true
    || !Array.isArray(raw.matches) || raw.matches.length !== 0 || raw.sample_only !== true || raw.limit !== 5
    || typeof raw.note !== 'string' || raw.note.length > 1000 || !Array.isArray(raw.recent_invocations) || raw.recent_invocations.length > 5) return null;
  const result: ZionAssignmentSummary[] = [], seen = new Set<string>();
  for (const entry of raw.recent_invocations) {
    const parsed = summary(entry);
    if (!parsed || seen.has(parsed.id.toLowerCase())) return null;
    seen.add(parsed.id.toLowerCase());
    if (parsed.specialist === 'zion') result.push(parsed);
  }
  return result;
}
function original(raw: unknown, expected: ZionAssignmentSummary): ZionAssignment | null {
  if (!object(raw) || !closed(raw, ['ok', 'matches', 'invocation']) || raw.ok !== true
    || !Array.isArray(raw.matches) || raw.matches.length || !object(raw.invocation)) return null;
  const x = raw.invocation, entry = summary(x, false);
  if (!entry || !closed(x, ['id', 'specialist', 'recorded_status', 'created_at', 'observed_at', 'receipt_state', 'receipt_id',
    'receipt_at', 'response_text', 'response_truncated', 'completion_scope', 'note']) || entry.id !== expected.id || entry.specialist !== 'zion'
    || !instant(x.observed_at) || x.completion_scope !== 'specialist_response_only'
    || typeof x.note !== 'string' || x.note.length > 1000 || typeof x.response_truncated !== 'boolean'
    || !(x.response_text === null || typeof x.response_text === 'string' && x.response_text.length <= 8000)
    || entry.recorded_status !== 'succeeded' && x.response_text !== null || x.response_text === null && x.response_truncated) return null;
  const receipt = receipts.find(s => s === x.receipt_state);
  if (!receipt || (receipt === 'verified'
    ? !['succeeded', 'failed'].includes(entry.recorded_status) || !uuid(x.receipt_id) || !instant(x.receipt_at)
    : x.receipt_id !== null || x.receipt_at !== null)) return null;
  return { ...entry, observed_at: x.observed_at, receipt_state: receipt,
    receipt_id: x.receipt_id as string | null, receipt_at: x.receipt_at as string | null,
    response_text: x.response_text as string | null, response_truncated: x.response_truncated,
    completion_scope: 'specialist_response_only', note: x.note };
}
const denied = (error: unknown) => error instanceof FunctionsHttpError
  && error.context instanceof globalThis.Response && [401, 403].includes(error.context.status);
const sessionDenied = (error: unknown) => isAuthSessionMissingError(error)
  || isAuthApiError(error) && [401, 403].includes(error.status);

/** A new UI consumer of the ORIGINAL caller-JWT inspector, never a dispatch,
 * approval, settlement or retry. One elapsed budget also retires late preflight. */
export async function readZionAssignments(scope: ZionReadScope, caller: Caller, current: () => ZionReadScope | null,
  selected?: unknown): Promise<ZionAssignmentRead> {
  const origin = { ...scope }, chosen = selected === undefined ? null : summary(selected);
  let retired = false;
  const matches = () => {
    try { const now = current(); return !retired && now?.actorId === origin.actorId && now.tenantId === origin.tenantId
      && now.epoch === origin.epoch && (now.actAsClientId ?? null) === null && (origin.actAsClientId ?? null) === null; }
    catch { return false; }
  };
  if (![origin.actorId, origin.tenantId].every(uuid) || !Number.isSafeInteger(origin.epoch) || !matches()
    || selected !== undefined && (!chosen || chosen.specialist !== 'zion')) return { status: 'refused' };
  const stage = createWeeklyDraftDeadline(8000, matches);
  try {
    const before = await stage(() => caller.auth.getSession());
    if (!matches()) return { status: 'refused' };
    if (before.error) return { status: sessionDenied(before.error) ? 'refused' : 'unavailable' };
    if (before.data.session?.user.id !== origin.actorId) return { status: 'refused' };
    const read = await stage(() => caller.functions.invoke('paige-orchestrator', { body: { action: 'tool_search', tenant_id: origin.tenantId,
      ...(chosen ? { invocation_id: chosen.id } : { recent_assignments: true }) } }));
    if (!matches()) return { status: 'refused' };
    if (read.error) return { status: denied(read.error) ? 'refused' : 'unavailable' };
    const after = await stage(() => caller.auth.getSession());
    if (!matches()) return { status: 'refused' };
    if (after.error) return { status: sessionDenied(after.error) ? 'refused' : 'unavailable' };
    if (after.data.session?.user.id !== origin.actorId) return { status: 'refused' };
    if (chosen) { const result = original(read.data, chosen); return result ? { status: 'ready', invocation: result } : { status: 'unavailable' }; }
    const entries = sample(read.data);
    return entries ? { status: 'ready', entries } : { status: 'unavailable' };
  } catch { return { status: matches() ? 'unavailable' : 'refused' }; }
  finally { retired = true; }
}
