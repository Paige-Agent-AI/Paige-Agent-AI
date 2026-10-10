import { DURABLE_JOB_STATES, type DurableJobState } from './mod.ts';

/** Internal canonical envelope fields, not the owner-safe get_paige_durable_work
 * projection (which intentionally omits identity and terminal evidence).
 * The future server adapter must select these fields under fresh authorization.
 * Passing request JSON or a client-side status card here establishes no authority. */
export interface ContinuationBinding {
  workId: string;
  tenantId: string;
  actorId: string;
  threadId: string;
  intentId: string;
  scopeEpoch: string;
  capabilityKey: string;
  workKind: string;
  originalObjective: string;
}
export interface ContinuationContext {
  authorized: boolean;
  budgetAllowed: boolean;
  capabilityAvailable: boolean;
  approvalPending: boolean;
  interrupted: boolean;
  superseded: boolean;
  alreadyContinued: boolean;
}
export interface ContinuationInput {
  work: Record<string, unknown> | null;
  binding: ContinuationBinding;
  /** Objective read from the capability's canonical record, never reconstructed
   * from a new prompt. E.g. document request_payload.brief or research_runs.question. */
  canonicalObjective: string;
  /** Results of current server checks; authority_context is an audit snapshot,
   * not reusable authorization. This pure function does not perform those checks. */
  context: ContinuationContext;
  now: string;
}
export type ContinuationReason = 'canonical_unavailable' | 'binding_mismatch' |
  'authorization_unavailable' | 'budget_unavailable' | 'capability_unavailable' |
  'approval_pending' | 'context_interrupted' | 'context_superseded' | 'replay' |
  'revalidation_unavailable' | 'nonterminal' | 'reconciliation_required' |
  'terminal_unverified' | 'canonical_terminal';
export interface ContinuationProjection {
  eligibleForContext: boolean;
  state: DurableJobState | 'unavailable';
  reason: ContinuationReason;
  workId?: string;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const continuationObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Non-activating C4d foundation. Eligibility means only that bounded terminal
 * context may be explained. It never permits dispatch, wake, settlement, approval,
 * retry or exactly-once consumption; those still require existing server seams. */
export function projectDurableContinuation(input: ContinuationInput): ContinuationProjection {
  const unavailable = (reason: ContinuationReason): ContinuationProjection => ({ eligibleForContext: false, state: 'unavailable', reason });
  if (!continuationObject(input?.work)) return unavailable('canonical_unavailable');
  const work = input.work;
  const binding = input.binding;
  if (!continuationObject(binding)) return unavailable('binding_mismatch');
  const fields = { workId: 'id', tenantId: 'tenant_id', actorId: 'initiating_user_id', threadId: 'thread_id', intentId: 'intent_id', scopeEpoch: 'scope_epoch', capabilityKey: 'capability_key', workKind: 'work_kind' } as const;
  for (const [pin, column] of Object.entries(fields)) {
    const value = binding[pin as keyof typeof fields];
    if (!text(value) || work[column] !== value) return unavailable('binding_mismatch');
  }
  if (!text(binding.originalObjective) || input.canonicalObjective !== binding.originalObjective) return unavailable('binding_mismatch');
  const context = input.context;
  if (!continuationObject(context) || Object.keys({ authorized: 0, budgetAllowed: 0, capabilityAvailable: 0, approvalPending: 0, interrupted: 0, superseded: 0, alreadyContinued: 0 }).some(key => typeof context[key] !== 'boolean')) return unavailable('revalidation_unavailable');
  if (context.authorized !== true) return unavailable('authorization_unavailable');
  if (context.budgetAllowed !== true) return unavailable('budget_unavailable');
  if (context.capabilityAvailable !== true) return unavailable('capability_unavailable');
  if (context.approvalPending) return unavailable('approval_pending');
  if (context.interrupted) return unavailable('context_interrupted');
  if (context.superseded) return unavailable('context_superseded');
  if (context.alreadyContinued) return unavailable('replay');
  const state = DURABLE_JOB_STATES.includes(work.status as DurableJobState) ? work.status as DurableJobState : 'unavailable';
  const deny = (reason: ContinuationReason): ContinuationProjection => ({ eligibleForContext: false, state, reason, workId: binding.workId });
  if (state === 'expired' || state === 'outcome_unknown') return deny('reconciliation_required');
  if (state !== 'succeeded' && state !== 'failed') return deny('nonterminal');
  const now = typeof input.now === 'string' ? Date.parse(input.now) : NaN;
  const settled = typeof work.settled_at === 'string' ? Date.parse(work.settled_at) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(settled) || settled > now || !continuationObject(work.terminal_outcome)) return deny('terminal_unverified');
  if (state === 'succeeded' && work.terminal_outcome.verified_readback !== true) return deny('terminal_unverified');
  if (state === 'failed' && !text(work.error_code)) return deny('terminal_unverified');
  return { eligibleForContext: true, state, reason: 'canonical_terminal', workId: binding.workId };
}
