import { DURABLE_JOB_STATES, type DurableJobState } from '../durable-job/mod.ts';

/** Transport/response adapter only. Ports must be supplied by the server: adoption
 * uses service_role, execution the original caller JWT. Types/doubles establish
 * neither identity nor approval. Native RPCs own every permission/effect check.
 * Each function makes one explicit named RPC. No chaining, execution retry,
 * policy, settlement or new receipt is introduced. */
type RpcReply = { data: unknown; error: unknown };
export type ReminderAdoptionPort = {
  rpc(name: 'adopt_paige_reminder_approval', args: Record<string, unknown>): PromiseLike<RpcReply>;
};
export type ReminderExecutionPort = {
  rpc(name: 'execute_paige_approved_reminder', args: Record<string, unknown>): PromiseLike<RpcReply>;
};
export type ReminderResolutionPort = {
  rpc(name: 'resolve_paige_reminder_approval', args: Record<string, unknown>): PromiseLike<RpcReply>;
};
export type ReminderRuntime = { intentId: string; requestNonce: string };
export type ReminderScope = { actorId: string; tenantId: string | null; threadId: string | null; clientId: string | null };
export type ReminderStoredArgs = Readonly<{ title: string; remind_at: string;
  target?: string | null; target_user_id?: string | null; channel?: string | null;
  plan_id?: string | null; summary?: string | null; contact_id?: string | null }>;
export type SelectedReminderProposal = { id: string; fingerprint: string; issuedNonce: string; args: unknown };
export const REMINDER_UNSUPPORTED_CLASSES = [
  'tenantless_native_compatibility', 'nonmember_native_compatibility', 'threadless_native_compatibility',
  'client_focus_compatibility', 'unbound_runtime_compatibility',
] as const;
export type ReminderUnsupportedClass = typeof REMINDER_UNSUPPORTED_CLASSES[number];
type NoRetry = { retryAllowed: false };
export type ReminderAdapterFailure = NoRetry & {
  kind: 'unavailable'; outcome: 'unverified'; phase: 'adoption' | 'resolution' | 'execution' | 'history'; rpcAttempted: boolean;
  reason: 'invalid_input' | 'stale' | 'rpc_returned_error' | 'rpc_threw' | 'malformed_response';
  legacyFallbackEligible: false;
};
export type ReminderAdoptionResult = ReminderAdapterFailure | NoRetry & (
  { workId: string; proposalId: string; state: DurableJobState; storedArgs: ReminderStoredArgs; legacyFallbackEligible: false } & (
    { kind: 'adopted' } | { kind: 'existing'; observationOnly: true; freshDispatchAllowed: false }
  ) |
  { kind: 'unsupported'; proposalId: string; reason: ReminderUnsupportedClass; legacyFallbackEligible: true }
);
export type ReminderNativeResult = Readonly<{ ok: true; item_id: string; item_type: 'reminder'; remind_at: string;
  railRecorded: true; receipt_status: 'recorded'; receipt_run_id: string }>;
export type ReminderOriginalReadback = Readonly<{ item_id: string; item_type: 'reminder'; title: string;
  summary: string | null; tenant_id: string; created_by: string; remind_at: string;
  remind_target: 'user' | 'team'; remind_channel: 'in_app' | 'email'; assigned_to_user_id: string | null;
  plan_id: string | null; contact_id: string | null; source_version: string }>;
export type ReminderExecutionResult = ReminderAdapterFailure | NoRetry & {
  kind: 'succeeded'; workId: string; proposalId: string; receiptVersion: 1;
  replayed: boolean; historical: boolean; originalResult: ReminderNativeResult;
  originalReadback: ReminderOriginalReadback; legacyFallbackEligible: false;
};
export type ReminderExecutionBinding = {
  workId: string; proposalId: string; actorId: string; tenantId: string; threadId: string; clientId: null;
};
export type ReminderHistoryResult = (ReminderAdapterFailure | Extract<ReminderExecutionResult, { kind: 'succeeded' }> & {
  historical: true; replayed: true;
}) & { callMode: 'history_only'; newEffectPossible: false };
export type ReminderResolutionResult = ReminderAdapterFailure | NoRetry & {
  kind: 'resolved'; workId: string; proposalId: string; state: DurableJobState; legacyFallbackEligible: false;
};

const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const nullableUuid = (v: unknown): v is string | null => v === null || uuid(v);
const sameId = (v: unknown, expected: string) => uuid(v) && v.toLowerCase() === expected.toLowerCase();
const boundedText = (v: unknown): v is string => typeof v === 'string' && v.length <= 16384;
const record = (v: unknown): Record<string, unknown> | null => {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(v).some(k => typeof k !== 'string' || !('value' in descriptors[k]) || !descriptors[k].enumerable)) return null;
  return v as Record<string, unknown>;
};
const closed = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
function storedArgs(v: unknown): ReminderStoredArgs | null {
  const r = record(v);
  const keys = ['title', 'remind_at', 'target', 'target_user_id', 'channel', 'plan_id', 'summary', 'contact_id'];
  if (!r || Object.keys(r).some(k => !keys.includes(k)) || !boundedText(r.title) || !boundedText(r.remind_at)
    || Object.entries(r).some(([k, value]) => k !== 'title' && k !== 'remind_at' && value !== null && !boundedText(value))
    || JSON.stringify(r).length > 16384) return null;
  // Preserve exact stored values/omitted keys, including native channel normalization
  // inputs. This is sanitation, not an alternate argument/permission resolver.
  return Object.freeze(Object.fromEntries(Object.entries(r))) as ReminderStoredArgs;
}
const equalArgs = (a: ReminderStoredArgs, b: ReminderStoredArgs) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k as keyof ReminderStoredArgs] === v);
function instant(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 80) return false;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || Number(m[2]) >= 24 || Number(m[3]) >= 60 || Number(m[4]) >= 60) return false;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === m[1] && Number.isFinite(Date.parse(v));
}
const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b)
  && (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(a)?.[1] ?? '').padEnd(6, '0')
    === (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(b)?.[1] ?? '').padEnd(6, '0');
const current = (read: unknown) => { try { return typeof read === 'function' && read() === true; } catch { return false; } };
const failure = (phase: ReminderAdapterFailure['phase'], rpcAttempted: boolean, reason: ReminderAdapterFailure['reason']): ReminderAdapterFailure =>
  ({ kind: 'unavailable', outcome: 'unverified', phase, rpcAttempted, reason, legacyFallbackEligible: false, retryAllowed: false });
const validRuntime = (r: ReminderRuntime | null | undefined): r is ReminderRuntime => !!r && uuid(r.intentId) && uuid(r.requestNonce);
const validScope = (s: ReminderScope) => !!s && uuid(s.actorId) && nullableUuid(s.tenantId)
  && nullableUuid(s.threadId) && nullableUuid(s.clientId);

export async function adoptApprovedReminder(input: {
  service: ReminderAdoptionPort; selectedProposal: SelectedReminderProposal; scope: ReminderScope;
  confirmationRequestNonce: string; runtime: ReminderRuntime | null;
  /** Withdrawal only: never interpreted as authentication, approval or authority. */
  current(): boolean;
}): Promise<ReminderAdoptionResult> {
  let attempted = false;
  const fence = input?.current;
  try {
    if (!current(fence)) return failure('adoption', false, 'stale');
    const p = input.selectedProposal, s = input.scope;
    const args = storedArgs(p?.args);
    const requestRuntime = input.runtime;
    const hasRequestRuntime = validRuntime(requestRuntime);
    if (!p || !uuid(p.id) || !uuid(p.issuedNonce) || typeof p.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(p.fingerprint)
      || !uuid(input.confirmationRequestNonce) || sameId(p.issuedNonce, input.confirmationRequestNonce)
      || (requestRuntime !== null && !hasRequestRuntime) || !validScope(s) || !args || typeof input.service?.rpc !== 'function')
      return failure('adoption', false, 'invalid_input');
    const proposalId = p.id.toLowerCase();
    const rpcArgs = { p_proposal_id: proposalId, p_actor: s.actorId.toLowerCase(), p_tenant: s.tenantId?.toLowerCase() ?? null,
      p_thread: s.threadId?.toLowerCase() ?? null, p_client: s.clientId?.toLowerCase() ?? null,
      p_fingerprint: p.fingerprint, p_issued_nonce: p.issuedNonce.toLowerCase(), p_request_nonce: input.confirmationRequestNonce.toLowerCase(),
      // Some incumbent compatibility classes have no interactive executor. Pass
      // that actual absence to the native eligibility check; never mint a pair.
      p_intent: requestRuntime?.intentId.toLowerCase() ?? null,
      p_runtime_request_nonce: requestRuntime?.requestNonce.toLowerCase() ?? null };
    if (!current(fence)) return failure('adoption', false, 'stale');
    attempted = true;
    const reply = await input.service.rpc('adopt_paige_reminder_approval', rpcArgs);
    if (!current(fence)) return failure('adoption', true, 'stale');
    if (!reply || reply.error !== null) return failure('adoption', true, 'rpc_returned_error');
    const data = record(reply.data);
    if (!data || data.v !== 1 || !sameId(data.proposal_id, proposalId)) return failure('adoption', true, 'malformed_response');
    if (data.status === 'unsupported') {
      if (!closed(data, ['v', 'status', 'proposal_id', 'unsupported_reason'])
        || !REMINDER_UNSUPPORTED_CLASSES.includes(data.unsupported_reason as ReminderUnsupportedClass))
        return failure('adoption', true, 'malformed_response');
      // Compatibility eligibility only. Root still owes every incumbent gate.
      return { kind: 'unsupported', proposalId, reason: data.unsupported_reason as ReminderUnsupportedClass,
        legacyFallbackEligible: true, retryAllowed: false };
    }
    const returnedArgs = storedArgs(data.stored_args);
    if (!closed(data, ['v', 'status', 'work_id', 'proposal_id', 'work_status', 'stored_args'])
      || data.status !== 'adopted' && data.status !== 'existing' || !uuid(data.work_id)
      || !DURABLE_JOB_STATES.includes(data.work_status as DurableJobState)
      || data.status === 'adopted' && (!hasRequestRuntime || data.work_status !== 'claimed')
      || !returnedArgs || !equalArgs(args, returnedArgs))
      return failure('adoption', true, 'malformed_response');
    const observed = { workId: data.work_id.toLowerCase(), proposalId, state: data.work_status as DurableJobState,
      storedArgs: returnedArgs, legacyFallbackEligible: false as const, retryAllowed: false as const };
    // Existing `claimed` is an observation too, not proof of an unspent approval
    // or fresh dispatch authority. There is no automatic execution/retry path.
    return data.status === 'existing' ? { kind: 'existing', ...observed, observationOnly: true, freshDispatchAllowed: false }
      : { kind: 'adopted', ...observed };
  } catch {
    return failure('adoption', attempted, !current(fence) ? 'stale' : 'rpc_threw');
  }
}

/** Native opaque binding lookup only. A canonical state, even `succeeded`, is not
 * a verified original outcome; only the separate receipt path establishes that. */
export async function resolveApprovedReminder(input: {
  caller: ReminderResolutionPort; binding: Omit<ReminderExecutionBinding, 'workId'>; current(): boolean;
}): Promise<ReminderResolutionResult> {
  let attempted = false;
  const fence = input?.current;
  try {
    if (!current(fence)) return failure('resolution', false, 'stale');
    const b = input.binding;
    if (!b || ![b.proposalId, b.actorId, b.tenantId, b.threadId].every(uuid) || b.clientId !== null
      || typeof input.caller?.rpc !== 'function') return failure('resolution', false, 'invalid_input');
    const proposalId = b.proposalId.toLowerCase();
    const rpcArgs = { p_proposal_id: proposalId, p_expected_tenant: b.tenantId.toLowerCase(),
      p_expected_thread: b.threadId.toLowerCase(), p_expected_client: null };
    if (!current(fence)) return failure('resolution', false, 'stale');
    attempted = true;
    const reply = await input.caller.rpc('resolve_paige_reminder_approval', rpcArgs);
    if (!current(fence)) return failure('resolution', true, 'stale');
    if (!reply || reply.error !== null) return failure('resolution', true, 'rpc_returned_error');
    const data = record(reply.data);
    if (!data || !closed(data, ['v', 'proposal_id', 'work_id', 'work_status']) || data.v !== 1
      || !sameId(data.proposal_id, proposalId) || !uuid(data.work_id)
      || !DURABLE_JOB_STATES.includes(data.work_status as DurableJobState)) return failure('resolution', true, 'malformed_response');
    return { kind: 'resolved', workId: data.work_id.toLowerCase(), proposalId, state: data.work_status as DurableJobState,
      legacyFallbackEligible: false, retryAllowed: false };
  } catch {
    return failure('resolution', attempted, !current(fence) ? 'stale' : 'rpc_threw');
  }
}

type ExecutionInput = {
  caller: ReminderExecutionPort; binding: ReminderExecutionBinding; runtime: ReminderRuntime;
  /** Withdrawal only. Every native authority/effect gate stays inside the RPC. */
  current(): boolean;
};
export function executeApprovedReminder(input: ExecutionInput): Promise<ReminderExecutionResult> {
  return requestReminder(input, false);
}

/** Same native RPC, BOTH runtime arguments NULL. Native nonterminal dispatch
 * refuses that pair; verified terminal history does not require current intent.
 * No new effect in this call says nothing about an unverified ORIGINAL outcome. */
export async function readApprovedReminderHistory(input: Omit<ExecutionInput, 'runtime'>): Promise<ReminderHistoryResult> {
  const mode = { callMode: 'history_only' as const, newEffectPossible: false as const };
  if (input && Object.prototype.hasOwnProperty.call(input, 'runtime'))
    return { ...failure('history', false, 'invalid_input'), ...mode };
  const result = await requestReminder({ ...input, runtime: null }, true);
  if (result.kind === 'succeeded') {
    if (result.historical !== true || result.replayed !== true) return { ...failure('history', true, 'malformed_response'), ...mode };
    return { ...result, historical: result.historical, replayed: result.replayed, ...mode };
  }
  return { ...result, ...mode };
}

async function requestReminder(input: Omit<ExecutionInput, 'runtime'> & { runtime: ReminderRuntime | null }, historyOnly: boolean): Promise<ReminderExecutionResult> {
  let attempted = false;
  const fence = input?.current;
  const phase = historyOnly ? 'history' : 'execution';
  try {
    if (!current(fence)) return failure(phase, false, 'stale');
    const b = input.binding;
    if (!b || ![b.workId, b.proposalId, b.actorId, b.tenantId, b.threadId].every(uuid) || b.clientId !== null
      || (historyOnly ? input.runtime !== null : !validRuntime(input.runtime)) || typeof input.caller?.rpc !== 'function')
      return failure(phase, false, 'invalid_input');
    // Snapshot the original binding before the await; newer view input cannot lend
    // this response its actor/workspace/proposal identity.
    const workId = b.workId.toLowerCase(), proposalId = b.proposalId.toLowerCase();
    const actorId = b.actorId.toLowerCase(), tenantId = b.tenantId.toLowerCase();
    const rpcArgs = { p_work_id: workId, p_expected_tenant: tenantId, p_expected_thread: b.threadId.toLowerCase(),
      p_expected_client: null, p_intent: historyOnly ? null : input.runtime!.intentId.toLowerCase(),
      p_runtime_request_nonce: historyOnly ? null : input.runtime!.requestNonce.toLowerCase() };
    if (!current(fence)) return failure(phase, false, 'stale');
    attempted = true;
    const reply = await input.caller.rpc('execute_paige_approved_reminder', rpcArgs);
    if (!current(fence)) return failure(phase, true, 'stale');
    if (!reply || reply.error !== null) return failure(phase, true, 'rpc_returned_error');
    const data = record(reply.data);
    if (!data || !closed(data, ['v', 'status', 'receipt_version', 'work_id', 'proposal_id', 'replayed', 'historical', 'original_result', 'original_readback'])
      || data.v !== 1 || data.status !== 'succeeded' || data.receipt_version !== 1 || !sameId(data.work_id, workId)
      || !sameId(data.proposal_id, proposalId) || typeof data.replayed !== 'boolean' || data.historical !== data.replayed
      || historyOnly && (data.historical !== true || data.replayed !== true))
      return failure(phase, true, 'malformed_response');
    const result = record(data.original_result), read = record(data.original_readback);
    if (!result || !closed(result, ['ok', 'item_id', 'item_type', 'remind_at', 'railRecorded', 'receipt_status', 'receipt_run_id'])
      || result.ok !== true || result.item_type !== 'reminder' || !uuid(result.item_id) || !instant(result.remind_at)
      || result.railRecorded !== true || result.receipt_status !== 'recorded' || !uuid(result.receipt_run_id)
      || !read || !closed(read, ['item_id', 'item_type', 'title', 'summary', 'tenant_id', 'created_by', 'remind_at',
        'remind_target', 'remind_channel', 'assigned_to_user_id', 'plan_id', 'contact_id', 'source_version'])
      || !sameId(read.item_id, result.item_id) || read.item_type !== 'reminder' || !boundedText(read.title)
      || read.summary !== null && !boundedText(read.summary) || !sameId(read.tenant_id, tenantId) || !sameId(read.created_by, actorId)
      || !instant(read.remind_at) || !sameInstant(result.remind_at, read.remind_at) || !instant(read.source_version)
      || read.remind_target !== 'user' && read.remind_target !== 'team'
      || read.remind_channel !== 'in_app' && read.remind_channel !== 'email'
      || !nullableUuid(read.plan_id) || !nullableUuid(read.contact_id) || !nullableUuid(read.assigned_to_user_id)
      || (read.remind_target === 'team' ? read.assigned_to_user_id !== null : !uuid(read.assigned_to_user_id)))
      return failure(phase, true, 'malformed_response');
    // Bounded copies only. Original history has no `currentReadback` alias.
    return { kind: 'succeeded', workId, proposalId, receiptVersion: 1, replayed: data.replayed, historical: data.historical,
      originalResult: Object.freeze({ ...result }) as ReminderNativeResult,
      originalReadback: Object.freeze({ ...read }) as ReminderOriginalReadback, legacyFallbackEligible: false, retryAllowed: false };
  } catch {
    // An attempted execution, even with an answered native error, is not evidence
    // that a previous sealed execution never committed. Do not claim not_applied.
    return failure(phase, attempted, !current(fence) ? 'stale' : 'rpc_threw');
  }
}
