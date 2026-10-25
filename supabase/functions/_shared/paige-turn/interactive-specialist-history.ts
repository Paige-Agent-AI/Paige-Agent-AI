import { createWeeklyDraftDeadline } from '../paige-orchestration/weekly-draft-deadline.ts';

interface OriginalQuery {
  select(columns: string): OriginalQuery;
  eq(column: string, value: unknown): OriginalQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
interface OriginalHistoryDb { from(table: string): OriginalQuery }
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value
  && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
// Keep the original database's microsecond ordering; millisecond rounding must
// not associate an assignment created AFTER its purported terminal receipt.
const instant = (value: unknown): bigint | null => {
  const match = typeof value === 'string'
    ? /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return match && Number.isFinite(ms) ? BigInt(ms) * 1000n + BigInt((match[1] ?? '').padEnd(6, '0').slice(3)) : null;
};

function originalObservation(value: unknown, id: string, terminalAt: bigint) {
  if (!object(value) || value.ok !== true || !object(value.invocation)) return null;
  const r = value.invocation, created = instant(r.created_at);
  const recorded = (['pending', 'succeeded', 'failed', 'dispatched', 'unknown'] as const).find(status => status === r.recorded_status);
  const receipt = (['verified', 'unverified', 'missing', 'unavailable', 'conflicting'] as const).find(state => state === r.receipt_state);
  if (r.id !== id || typeof r.specialist !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/.test(r.specialist)
    || !recorded || !receipt || typeof r.created_at !== 'string' || typeof r.observed_at !== 'string'
    || created === null || created > terminalAt || instant(r.observed_at) === null
    || r.completion_scope !== 'specialist_response_only' || typeof r.response_truncated !== 'boolean'
    || !(r.response_text === null || typeof r.response_text === 'string' && r.response_text.length <= 8000)) return null;
  if (receipt === 'verified') {
    if (!['succeeded', 'failed'].includes(recorded) || !uuid(r.receipt_id) || instant(r.receipt_at) === null) return null;
  } else if (r.receipt_id !== null || r.receipt_at !== null) return null;
  if (recorded !== 'succeeded' && r.response_text !== null || r.response_text === null && r.response_truncated) return null;
  // This existing inspector verifies its own actor/tenant/role, original row and
  // receipt. Publish only that closed projection, never input/error/provider data.
  return { id, specialist: r.specialist, recorded_status: recorded,
    created_at: r.created_at, observed_at: r.observed_at, receipt_state: receipt,
    receipt_id: typeof r.receipt_id === 'string' ? r.receipt_id : null,
    receipt_at: typeof r.receipt_at === 'string' ? r.receipt_at : null, response_text: r.response_text,
    response_truncated: r.response_truncated, completion_scope: 'specialist_response_only' as const };
}

/** Read original assignments named by a SERVER-ISSUED terminal, not model text,
 * historical JSON alone or conversation_id. No dispatch/approval/hold mutation.
 * The status caller supplies the existing current-workspace authority resolver
 * and the existing caller-JWT original-invocation inspector, never an executor. */
export async function readOriginalSpecialistHistory(input: {
  actorId: string; tenantId: string | null; threadId: string; intentId: string; turnId: string;
  caller: OriginalHistoryDb;
  authorize(): Promise<boolean>;
  inspectOriginal(invocationId: string): Promise<unknown>;
  current(): boolean;
}) {
  const unavailable = () => ({ v: 1 as const, status: 'unavailable' as const });
  try {
    const { actorId, tenantId, threadId, intentId, turnId, caller, authorize, inspectOriginal } = input;
    const currentCallback = input.current;
    let withdrawn = false;
    const current = () => {
      try { withdrawn ||= currentCallback() !== true; } catch { withdrawn = true; }
      return !withdrawn;
    };
    // One elapsed read budget, below the existing ten-second physical UI wait.
    // A late read may finish, but it cannot start another query or publish proof.
    const stage = createWeeklyDraftDeadline(8_000, current);
    const permitted = async () => {
      if (!current()) return false;
      withdrawn ||= await stage(authorize) !== true;
      return current();
    };
    if (![actorId, tenantId, threadId, intentId, turnId].every(uuid) || !await permitted()) return unavailable();
    const readThread = () => caller.from('paige_chat_threads')
      .select('id,tenant_id,caller_user_id,audience,is_archived')
      .eq('id', threadId).eq('tenant_id', tenantId).eq('caller_user_id', actorId).maybeSingle();
    const readTurn = () => caller.from('paige_chat_turns')
      .select('id,thread_id,role,created_at,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref')
      .eq('id', turnId).eq('thread_id', threadId).eq('interactive_intent_id', intentId).maybeSingle();
    const ownedThread = (row: unknown) => object(row) && row.id === threadId && row.tenant_id === tenantId
      && row.caller_user_id === actorId && row.audience === 'workspace' && row.is_archived === false;
    const thread = await stage(readThread);
    if (!await permitted() || thread.error || !ownedThread(thread.data)) return unavailable();
    const receipt = await stage(readTurn), turn = receipt.data;
    if (!await permitted() || receipt.error || !object(turn) || turn.id !== turnId || turn.thread_id !== threadId
      || turn.role !== 'assistant' || turn.interactive_intent_id !== intentId || turn.interactive_actor_id !== actorId
      || turn.interactive_tenant_id !== tenantId || typeof turn.interactive_terminal_state !== 'string'
      || !['FINAL', 'INTERRUPTED', 'LIMIT_REACHED', 'WAIT_WORK', 'WAIT_APPROVAL', 'ASK_USER'].includes(turn.interactive_terminal_state)
      || !object(turn.bundle_ref)) return unavailable();
    const terminalAt = instant(turn.created_at), bundle = turn.bundle_ref;
    if (terminalAt === null || !object(bundle.turn_state) || bundle.turn_state.v !== 1
      || bundle.turn_state.state !== turn.interactive_terminal_state || !object(bundle.interactive)
      || bundle.interactive.request_intent_id !== intentId || !Array.isArray(bundle.interactive.effects)
      || bundle.interactive.effects.length > 20) return unavailable();
    const ids = new Set<string>();
    for (const effect of bundle.interactive.effects) {
      if (!object(effect) || effect.tool !== 'delegate_to_subagent') continue;
      if (typeof effect.outcome !== 'string'
        || !['reported_success', 'reported_failure', 'outcome_unknown', 'durable_accepted', 'approval_required'].includes(effect.outcome)
        || !Array.isArray(effect.record_refs) || effect.record_refs.length > 8) return unavailable();
      for (const ref of effect.record_refs) {
        if (!object(ref) || ref.kind !== 'subagent_invocation') continue;
        if (!uuid(ref.id)) return unavailable();
        ids.add(ref.id);
      }
    }
    if (!ids.size) return unavailable();
    const results: NonNullable<ReturnType<typeof originalObservation>>[] = [];
    for (const id of [...ids].slice(0, 3)) {
      if (!await permitted()) return unavailable();
      const observed = originalObservation(await stage(() => inspectOriginal(id)), id, terminalAt);
      if (!await permitted() || !observed) return unavailable();
      results.push(observed);
    }
    const finalThread = await stage(readThread);
    if (!await permitted() || finalThread.error || !ownedThread(finalThread.data)) return unavailable();
    const finalTurn = await stage(readTurn);
    if (!await permitted() || finalTurn.error || stable(finalTurn.data) !== stable(turn)) return unavailable();
    return { v: 1 as const, status: 'recorded_assignment' as const, thread_id: threadId, turn_id: turnId,
      origin_intent_id: intentId, tenant_id: tenantId!, read_only: true as const, new_effect_possible: false as const,
      results, limited: ids.size > 3 };
  } catch { return unavailable(); }
}
