import {
  readApprovedReminderHistory, resolveApprovedReminder,
  type ReminderExecutionBinding, type ReminderExecutionPort, type ReminderHistoryResult, type ReminderResolutionPort,
} from './approved-reminder.ts';

type NoNewEffect = Readonly<{
  callMode: 'history_only'; newEffectPossible: false; freshDispatchAllowed: false;
  retryAllowed: false; legacyFallbackEligible: false;
}>;
type VerifiedHistory = Extract<ReminderHistoryResult, { kind: 'succeeded' }>;
export type OriginalReminderOutcome = NoNewEffect & (
  Readonly<{ kind: 'verified_original' }> & Pick<VerifiedHistory,
    'workId' | 'proposalId' | 'receiptVersion' | 'historical' | 'replayed' | 'originalResult' | 'originalReadback'>
  | Readonly<{ kind: 'unverified'; outcome: 'unverified';
    reason: 'invalid_input' | 'scope_withdrawn' | 'resolution_unverified' | 'not_succeeded' | 'original_receipt_unverified' }>
);
export type OriginalReminderOutcomeInput = Readonly<{
  /** Original caller-JWT port; this type does not establish caller authority. */
  caller: ReminderResolutionPort & ReminderExecutionPort;
  binding: Readonly<Omit<ReminderExecutionBinding, 'workId'>>;
  /** Withdrawal only. The server must supply a monotonic generation/scope/abort
   * fence. No callback here can detect an unobserved actor/tenant ABA by itself. */
  current(): boolean;
}>;

const noNewEffect: NoNewEffect = Object.freeze({ callMode: 'history_only', newEffectPossible: false,
  freshDispatchAllowed: false, retryAllowed: false, legacyFallbackEligible: false });

type UnverifiedReason = Extract<OriginalReminderOutcome, { kind: 'unverified' }>['reason'];
const unverified = (reason: UnverifiedReason): OriginalReminderOutcome =>
  Object.freeze({ ...noNewEffect, kind: 'unverified', outcome: 'unverified', reason });
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function closedInput(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)
    && 'value' in descriptors[key] && descriptors[key].enumerable);
}

/** Observe one original sealed result through the incumbent parsers/native
 * authority. No proposal read/claim, new runtime, effect, retry or settlement.
 * Verified ORIGINAL data is never an assertion about the current Planning row. */
export async function observeOriginalReminderOutcome(input: OriginalReminderOutcomeInput): Promise<OriginalReminderOutcome> {
  let phase: UnverifiedReason = 'invalid_input';
  let withdrawn = false;
  try {
    // A runtime, caller workId or dispatch flag is not an optional mode here.
    if (!closedInput(input, ['caller', 'binding', 'current'])
      || !closedInput(input.binding, ['proposalId', 'actorId', 'tenantId', 'threadId', 'clientId'])
      || ![input.binding.proposalId, input.binding.actorId, input.binding.tenantId, input.binding.threadId].every(uuid)
      || input.binding.clientId !== null || typeof input.current !== 'function'
      || typeof input.caller?.rpc !== 'function') return unverified('invalid_input');

    const binding = Object.freeze({ proposalId: input.binding.proposalId, actorId: input.binding.actorId,
      tenantId: input.binding.tenantId, threadId: input.binding.threadId, clientId: null });
    const originalCaller = input.caller, originalRpc = originalCaller.rpc;
    const caller = Object.freeze({ rpc: originalRpc.bind(originalCaller) });
    const withdrawal = input.current;
    const current = () => {
      if (!withdrawn) {
        try { withdrawn = withdrawal() !== true; } catch { withdrawn = true; }
      }
      return !withdrawn;
    };
    if (!current()) return unverified('scope_withdrawn');
    phase = 'resolution_unverified';
    const resolved = await resolveApprovedReminder({ caller, binding, current });
    if (!current()) return unverified('scope_withdrawn');
    if (resolved.kind !== 'resolved') return unverified('resolution_unverified');
    if (resolved.state !== 'succeeded') return unverified('not_succeeded');

    // State is only eligibility to ask for the original proof. The existing
    // history helper supplies BOTH NULLs and verifies the closed original receipt.
    phase = 'original_receipt_unverified';
    const original = await readApprovedReminderHistory({ caller,
      binding: { ...binding, workId: resolved.workId }, current });
    if (!current()) return unverified('scope_withdrawn');
    if (original.kind !== 'succeeded') return unverified('original_receipt_unverified');
    return Object.freeze({ ...noNewEffect, kind: 'verified_original', workId: original.workId,
      proposalId: original.proposalId, receiptVersion: original.receiptVersion,
      historical: original.historical, replayed: original.replayed,
      originalResult: original.originalResult, originalReadback: original.originalReadback });
  } catch {
    // An unavailable history observation never proves the original did not apply.
    return unverified(withdrawn ? 'scope_withdrawn' : phase);
  }
}
