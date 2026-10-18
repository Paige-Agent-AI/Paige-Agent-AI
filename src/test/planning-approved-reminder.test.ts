import { describe, expect, it, vi } from 'vitest';
import { DURABLE_JOB_STATES } from '../../supabase/functions/_shared/durable-job/mod';
import { adoptApprovedReminder, executeApprovedReminder, readApprovedReminderHistory, resolveApprovedReminder, REMINDER_UNSUPPORTED_CLASSES,
  type ReminderAdoptionResult, type ReminderExecutionResult, type ReminderHistoryResult,
  type ReminderResolutionResult } from '../../supabase/functions/_shared/planning/approved-reminder';

// Deterministic transport fixtures only. These establish no real JWT, native
// approval, effect, provider delivery, handler acceptance or production readback.
const id = (n: number) => `a2340000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actorId: id(1), tenantId: id(2), threadId: id(3), clientId: null };
const args = { title: 'Review the service handoff', remind_at: '2030-01-02T10:00:00.123456Z', summary: null };
const selected = { id: id(4), fingerprint: '0123456789abcdef', issuedNonce: id(5), args };
const runtime = { intentId: id(6), requestNonce: id(7) };
const binding = { workId: id(9), proposalId: selected.id, ...scope };
const resolveBinding = { proposalId: selected.id, ...scope };
const resolution = () => ({ v: 1, proposal_id: selected.id, work_id: binding.workId, work_status: 'claimed' });
const adoption = () => ({ v: 1, status: 'adopted', work_id: binding.workId, proposal_id: selected.id,
  work_status: 'claimed', stored_args: { ...args } });
const receipt = () => ({ v: 1, status: 'succeeded', receipt_version: 1, work_id: binding.workId, proposal_id: selected.id,
  replayed: false, historical: false,
  original_result: { ok: true, item_id: id(10), item_type: 'reminder', remind_at: args.remind_at,
    railRecorded: true, receipt_status: 'recorded', receipt_run_id: id(11) },
  original_readback: { item_id: id(10), item_type: 'reminder', title: args.title, summary: null,
    tenant_id: scope.tenantId, created_by: scope.actorId, remind_at: '2030-01-02T10:00:00.123456+00:00',
    remind_target: 'user', remind_channel: 'in_app', assigned_to_user_id: scope.actorId, plan_id: null,
    contact_id: null, source_version: '2026-10-18T06:40:00.765432+00:00' } });
const service = (data: unknown = adoption()) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
const caller = (data: unknown = receipt()) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
const adoptInput = (p = service()) => ({ service: p, selectedProposal: selected, scope,
  confirmationRequestNonce: id(8), runtime, current: () => true });
const executeInput = (p = caller()) => ({ caller: p, binding, runtime, current: () => true });
const historyReceipt = () => ({ ...receipt(), historical: true, replayed: true });
const historyInput = (p = caller(historyReceipt())) => ({ caller: p, binding, current: () => true });
const resolveInput = (p = caller(resolution())) => ({ caller: p, binding: resolveBinding, current: () => true });
function unavailable(result: ReminderAdoptionResult | ReminderExecutionResult | ReminderHistoryResult | ReminderResolutionResult,
  phase: 'adoption' | 'resolution' | 'execution' | 'history', attempted = true) {
  expect(result).toMatchObject({ kind: 'unavailable', outcome: 'unverified', phase, rpcAttempted: attempted,
    legacyFallbackEligible: false, retryAllowed: false });
  expect(result).not.toHaveProperty('not_applied');
  expect(result).not.toHaveProperty('originalResult');
  expect(result).not.toHaveProperty('serverKey');
}

describe('approved reminder adoption transport', () => {
  describe('absent interactive runtime', () => {
    it('preserves the actual unbound intent and absent nonce for native compatibility', async () => {
      const p = service({ v: 1, status: 'unsupported', proposal_id: selected.id,
        unsupported_reason: 'unbound_runtime_compatibility' });
      const result = await adoptApprovedReminder({ ...adoptInput(p),
        runtime: { intentId: runtime.intentId, requestNonce: null } } as Parameters<typeof adoptApprovedReminder>[0]);
      expect(result).toMatchObject({ kind: 'unsupported', reason: 'unbound_runtime_compatibility',
        legacyFallbackEligible: true, retryAllowed: false });
      expect(p.rpc).toHaveBeenCalledExactlyOnceWith('adopt_paige_reminder_approval', expect.objectContaining({
        p_intent: runtime.intentId, p_runtime_request_nonce: null,
      }));
    });
    it('never accepts a fresh adopted acknowledgement for an intent without a bound nonce', async () => {
      const p = service();
      unavailable(await adoptApprovedReminder({ ...adoptInput(p),
        runtime: { intentId: runtime.intentId, requestNonce: null } } as Parameters<typeof adoptApprovedReminder>[0]), 'adoption');
      expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it('does not borrow a later nonce for an originally unbound intent', async () => {
      const p = service();
      const input = { ...adoptInput(p), runtime: { intentId: runtime.intentId, requestNonce: null } } as Parameters<typeof adoptApprovedReminder>[0];
      p.rpc.mockImplementation(async () => { input.runtime = runtime; return { data: adoption(), error: null }; });
      unavailable(await adoptApprovedReminder(input), 'adoption');
      expect(p.rpc).toHaveBeenCalledExactlyOnceWith('adopt_paige_reminder_approval', expect.objectContaining({
        p_intent: runtime.intentId, p_runtime_request_nonce: null,
      }));
    });
    it.each(['tenantless_native_compatibility', 'threadless_native_compatibility', 'nonmember_native_compatibility'] as const)(
      'passes actual NULLs to native %s eligibility without inventing an executor', async reason => {
        const p = service({ v: 1, status: 'unsupported', proposal_id: selected.id, unsupported_reason: reason });
        const result = await adoptApprovedReminder({ ...adoptInput(p), runtime: null });
        expect(result).toEqual({ kind: 'unsupported', proposalId: selected.id, reason,
          legacyFallbackEligible: true, retryAllowed: false });
        expect(p.rpc).toHaveBeenCalledExactlyOnceWith('adopt_paige_reminder_approval', expect.objectContaining({
          p_intent: null, p_runtime_request_nonce: null, p_request_nonce: id(8), p_issued_nonce: selected.issuedNonce,
        }));
      });
    it('keeps an answered refusal unverified and never turns runtime absence into fallback', async () => {
      const p = service(); p.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
      unavailable(await adoptApprovedReminder({ ...adoptInput(p), runtime: null }), 'adoption');
      expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it('refuses a fresh adopted acknowledgement without a real runtime pair', async () => {
      const p = service();
      unavailable(await adoptApprovedReminder({ ...adoptInput(p), runtime: null }), 'adoption');
      expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it('does not borrow a later runtime to validate an acknowledgement for a NULL-pair request', async () => {
      const p = service();
      const input: Parameters<typeof adoptApprovedReminder>[0] = { ...adoptInput(p), runtime: null };
      p.rpc.mockImplementation(async () => {
        input.runtime = runtime;
        return { data: adoption(), error: null };
      });
      unavailable(await adoptApprovedReminder(input), 'adoption');
      expect(p.rpc).toHaveBeenCalledExactlyOnceWith('adopt_paige_reminder_approval', expect.objectContaining({
        p_intent: null, p_runtime_request_nonce: null,
      }));
    });
    it('returns existing work only as observation even without a current execution pair', async () => {
      const p = service({ ...adoption(), status: 'existing' });
      expect(await adoptApprovedReminder({ ...adoptInput(p), runtime: null })).toMatchObject({
        kind: 'existing', observationOnly: true, freshDispatchAllowed: false, retryAllowed: false,
      });
      expect(p.rpc).toHaveBeenCalledTimes(1);
    });
  });
  it('calls only service adoption with exact selected identity and both separate nonces', async () => {
    const p = service();
    expect(await adoptApprovedReminder(adoptInput(p))).toEqual({ kind: 'adopted', workId: binding.workId,
      proposalId: selected.id, state: 'claimed', storedArgs: args, legacyFallbackEligible: false, retryAllowed: false });
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith('adopt_paige_reminder_approval', {
      p_proposal_id: selected.id, p_actor: scope.actorId, p_tenant: scope.tenantId, p_thread: scope.threadId,
      p_client: null, p_fingerprint: selected.fingerprint, p_issued_nonce: selected.issuedNonce,
      p_request_nonce: id(8), p_intent: runtime.intentId, p_runtime_request_nonce: runtime.requestNonce });
    expect(p.rpc.mock.calls[0][1]).not.toHaveProperty('args');
  });
  it('does not crosscompare the confirmation nonce with the independently bound runtime nonce', async () => {
    const p = service();
    expect((await adoptApprovedReminder({ ...adoptInput(p), confirmationRequestNonce: runtime.requestNonce })).kind).toBe('adopted');
    expect(p.rpc.mock.calls[0][1]).toMatchObject({ p_request_nonce: runtime.requestNonce, p_runtime_request_nonce: runtime.requestNonce });
  });
  it.each(DURABLE_JOB_STATES)('projects existing %s without calling an executor or asserting success', async state => {
    const p = service({ ...adoption(), status: 'existing', work_status: state });
    expect(await adoptApprovedReminder(adoptInput(p))).toMatchObject({ kind: 'existing', state,
      observationOnly: true, freshDispatchAllowed: false, legacyFallbackEligible: false, retryAllowed: false });
    expect(p.rpc).toHaveBeenCalledTimes(1);
    expect(p.rpc.mock.calls[0][0]).toBe('adopt_paige_reminder_approval');
  });
  it.each(REMINDER_UNSUPPORTED_CLASSES)('exposes only named %s compatibility eligibility', async reason => {
    const p = service({ v: 1, status: 'unsupported', proposal_id: selected.id, unsupported_reason: reason });
    expect(await adoptApprovedReminder(adoptInput(p))).toEqual({ kind: 'unsupported', proposalId: selected.id,
      reason, legacyFallbackEligible: true, retryAllowed: false });
    expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(REMINDER_UNSUPPORTED_CLASSES)('stale %s reply cannot grant compatibility eligibility', async reason => {
    let active = true; const p = service();
    p.rpc.mockImplementation(async () => { active = false; return { data: { v: 1, status: 'unsupported',
      proposal_id: selected.id, unsupported_reason: reason }, error: null }; });
    unavailable(await adoptApprovedReminder({ ...adoptInput(p), current: () => active }), 'adoption');
    expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves exact omitted/null/raw stored values rather than normalizing model args', async () => {
    const exact = { ...args, title: '  Exact original title  ', channel: 'sms', target_user_id: null };
    const p = service({ ...adoption(), stored_args: { channel: 'sms', ...exact } });
    const result = await adoptApprovedReminder({ ...adoptInput(p), selectedProposal: { ...selected, args: exact } });
    expect(result).toMatchObject({ kind: 'adopted', storedArgs: exact });
    if (result.kind === 'adopted') {
      expect(Object.isFrozen(result.storedArgs)).toBe(true);
      expect(result.storedArgs).not.toBe(exact);
    }
  });
  const malformed: [string, (r: Record<string, unknown>) => void][] = [
    ['wrong proposal', r => { r.proposal_id = id(99); }], ['invalid work UUID', r => { r.work_id = 'opaque-key'; }],
    ['missing work', r => { delete r.work_id; }], ['string version', r => { r.v = '1'; }],
    ['future version', r => { r.v = 2; }], ['unknown status', r => { r.status = 'retry'; }],
    ['unknown work status', r => { r.work_status = 'running'; }], ['new adoption falsely terminal', r => { r.work_status = 'succeeded'; }],
    ['extra server key', r => { r.server_idempotency_key = 'must-not-escape'; }],
    ['missing stored args', r => { delete r.stored_args; }], ['changed stored title', r => { r.stored_args = { ...args, title: 'New model title' }; }],
    ['omitted versus null changed', r => { r.stored_args = { title: args.title, remind_at: args.remind_at }; }],
    ['extra stored authority', r => { r.stored_args = { ...args, approved: true }; }],
    ['nested stored value', r => { r.stored_args = { ...args, summary: { text: 'untrusted' } }; }],
    ['object status coercion', r => { r.status = { toString: () => 'adopted' }; }],
  ];
  it.each(malformed)('refuses %s without fallback or automatic execution', async (_name, change) => {
    const data: Record<string, unknown> = adoption(); change(data);
    const p = service(data); unavailable(await adoptApprovedReminder(adoptInput(p)), 'adoption');
    expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { unsupported_reason: 'scope_denied' }, { unsupported_reason: 'unknown' }, { unsupported_reason: null },
    { unsupported_reason: REMINDER_UNSUPPORTED_CLASSES[0], server_key: 'secret' },
    { unsupported_reason: REMINDER_UNSUPPORTED_CLASSES[0], work_id: binding.workId },
    { unsupported_reason: REMINDER_UNSUPPORTED_CLASSES[0], proposal_id: id(99) },
  ])('rejects broad/extra/foreign unsupported response %#', async extra => {
    const p = service({ v: 1, status: 'unsupported', proposal_id: selected.id, ...extra });
    unavailable(await adoptApprovedReminder(adoptInput(p)), 'adoption');
  });
  it.each([
    { confirmationRequestNonce: selected.issuedNonce }, { confirmationRequestNonce: 'invalid' },
    { runtime: { ...runtime, intentId: 'not-an-intent' } }, { runtime: { ...runtime, requestNonce: 'invalid' } },
    { selectedProposal: { ...selected, fingerprint: 'uppercaseABCDEFG' } },
    { selectedProposal: { ...selected, args: { ...args, approved: true } } },
    { selectedProposal: { ...selected, args: { ...args, summary: 'x'.repeat(16385) } } },
    { scope: { ...scope, actorId: 'not-auth' } }, { scope: { ...scope, clientId: undefined } },
  ])('refuses malformed outbound selection %# before any RPC', async extra => {
    const p = service(); unavailable(await adoptApprovedReminder({ ...adoptInput(p), ...extra } as Parameters<typeof adoptApprovedReminder>[0]), 'adoption', false);
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it('allows explicit nullable compatibility scope through the native gate, never invents a tenant', async () => {
    const p = service({ v: 1, status: 'unsupported', proposal_id: selected.id,
      unsupported_reason: 'tenantless_native_compatibility' });
    const result = await adoptApprovedReminder({ ...adoptInput(p), scope: { ...scope, tenantId: null, threadId: null } });
    expect(result.kind).toBe('unsupported');
    expect(p.rpc.mock.calls[0][1]).toMatchObject({ p_tenant: null, p_thread: null });
  });
});

describe('original-JWT approved reminder receipt transport', () => {
  it.each([false, true])('keeps native historical=%s explicit and copies only the closed original receipt', async historical => {
    const data = { ...receipt(), historical, replayed: historical }, p = caller(data);
    const result = await executeApprovedReminder(executeInput(p));
    expect(result).toEqual({ kind: 'succeeded', workId: binding.workId, proposalId: selected.id, receiptVersion: 1,
      historical, replayed: historical, originalResult: data.original_result, originalReadback: data.original_readback,
      legacyFallbackEligible: false, retryAllowed: false });
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith('execute_paige_approved_reminder', { p_work_id: binding.workId,
      p_expected_tenant: scope.tenantId, p_expected_thread: scope.threadId, p_expected_client: null,
      p_intent: runtime.intentId, p_runtime_request_nonce: runtime.requestNonce });
    expect(result).not.toHaveProperty('currentReadback'); expect(result).not.toHaveProperty('readback');
    if (result.kind === 'succeeded') {
      data.original_readback.title = 'Changed later current record';
      expect(result.originalReadback.title).toBe(args.title);
      expect(Object.isFrozen(result.originalReadback)).toBe(true);
      expect(Object.isFrozen(result.originalResult)).toBe(true);
    }
  });
  it('keeps same actor/workspace binding across input object mutation during the await', async () => {
    const p = caller(), input = { ...executeInput(p), binding: { ...binding } };
    p.rpc.mockImplementation(async () => {
      input.binding.actorId = id(98); input.binding.tenantId = id(99);
      return { data: receipt(), error: null };
    });
    expect((await executeApprovedReminder(input)).kind).toBe('succeeded');
    expect(p.rpc.mock.calls[0][1]).toMatchObject({ p_expected_tenant: scope.tenantId });
  });
  it('accepts canonical team shape and exact microsecond-equivalent timezone representation', async () => {
    const data = receipt(); data.original_readback.remind_target = 'team'; data.original_readback.assigned_to_user_id = null;
    data.original_result.remind_at = '2030-01-02T05:00:00.123456-05:00';
    expect((await executeApprovedReminder(executeInput(caller(data)))).kind).toBe('succeeded');
  });
  const malformed: [string, (r: ReturnType<typeof receipt>) => void][] = [
    ['wrong work', r => { r.work_id = id(99); }], ['wrong proposal', r => { r.proposal_id = id(99); }],
    ['future version', r => { r.v = 2; }], ['future receipt', r => { r.receipt_version = 2; }],
    ['mixed replay history', r => { r.historical = true; }], ['mixed fresh history', r => { r.replayed = true; }],
    ['wrong record', r => { r.original_readback.item_id = id(99); }], ['foreign actor', r => { r.original_readback.created_by = id(99); }],
    ['foreign tenant', r => { r.original_readback.tenant_id = id(99); }], ['missing native Rail', r => { r.original_result.railRecorded = false; }],
    ['unrecorded receipt', r => { r.original_result.receipt_status = 'unconfirmed'; }], ['invalid audit UUID', r => { r.original_result.receipt_run_id = 'none'; }],
    ['not reminder', r => { r.original_result.item_type = 'task'; }], ['not canonical success', r => { r.original_result.ok = false; }],
    ['mismatched time', r => { r.original_result.remind_at = '2030-01-02T10:00:00.123455Z'; }],
    ['invalid timestamp', r => { r.original_readback.source_version = '2026-02-30T01:00:00Z'; }],
    ['nonfinite time', r => { r.original_result.remind_at = 'infinity'; }],
    ['unknown read target', r => { r.original_readback.remind_target = 'anyone'; }], ['unsupported channel', r => { r.original_readback.remind_channel = 'sms'; }],
    ['wrong nullable ID', r => { r.original_readback.plan_id = 'opaque'; }], ['user missing assignee', r => { r.original_readback.assigned_to_user_id = null; }],
    ['team assigned', r => { r.original_readback.remind_target = 'team'; }],
  ];
  it.each(malformed)('keeps %s unverified and never eligible for fallback', async (_name, change) => {
    const data = receipt(); change(data); const p = caller(data);
    unavailable(await executeApprovedReminder(executeInput(p)), 'execution'); expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['server key', (r: Record<string, unknown>) => { r.server_key = 'must-not-escape'; }],
    ['missing receipt version', (r: Record<string, unknown>) => { delete r.receipt_version; }],
    ['string replay', (r: Record<string, unknown>) => { r.replayed = 'false'; }],
    ['unknown status', (r: Record<string, unknown>) => { r.status = 'expired'; }],
    ['nested extra metadata', (r: Record<string, unknown>) => { (r.original_readback as Record<string, unknown>).private_profile = 'must-not-escape'; }],
    ['missing native receipt', (r: Record<string, unknown>) => { delete (r.original_result as Record<string, unknown>).receipt_run_id; }],
  ] as const)('rejects %s from an execution response', async (_name, change) => {
    const data: Record<string, unknown> = receipt(); change(data);
    unavailable(await executeApprovedReminder(executeInput(caller(data))), 'execution');
  });
  it.each(DURABLE_JOB_STATES.filter(s => s !== 'succeeded'))('does not turn native %s into a success or retry', async status => {
    unavailable(await executeApprovedReminder(executeInput(caller({ ...receipt(), status }))), 'execution');
  });
  it.each(REMINDER_UNSUPPORTED_CLASSES)('never offers execution fallback for %s', async reason => {
    unavailable(await executeApprovedReminder(executeInput(caller({ v: 1, status: 'unsupported', proposal_id: selected.id,
      unsupported_reason: reason }))), 'execution');
  });
  it.each(['workId', 'proposalId', 'actorId', 'tenantId', 'threadId', 'clientId'] as const)('invalid %s does not attempt a native execution', async key => {
    const p = caller();
    unavailable(await executeApprovedReminder({ ...executeInput(p), binding: { ...binding, [key]: 'invalid' } } as Parameters<typeof executeApprovedReminder>[0]), 'execution', false);
    expect(p.rpc).not.toHaveBeenCalled();
  });
});

describe('opaque original-JWT proposal lookup', () => {
  it.each(DURABLE_JOB_STATES)('projects %s as binding/status only, never a successful receipt', async state => {
    const p = caller({ ...resolution(), work_status: state });
    const result = await resolveApprovedReminder(resolveInput(p));
    expect(result).toEqual({ kind: 'resolved', workId: binding.workId, proposalId: selected.id, state,
      legacyFallbackEligible: false, retryAllowed: false });
    expect(result).not.toHaveProperty('originalReadback'); expect(result).not.toHaveProperty('storedArgs');
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith('resolve_paige_reminder_approval', {
      p_proposal_id: selected.id, p_expected_tenant: scope.tenantId, p_expected_thread: scope.threadId, p_expected_client: null });
  });
  it.each([
    { v: '1' }, { v: 2 }, { proposal_id: id(99) }, { work_id: 'opaque-key' }, { work_status: 'running' },
    { stored_args: args }, { server_idempotency_key: 'must-not-escape' }, { terminal_outcome: { verified_readback: true } },
    { status: 'unsupported', unsupported_reason: 'threadless_native_compatibility' },
  ])('refuses malformed/extra/foreign opaque lookup %#', async extra => {
    const p = caller({ ...resolution(), ...extra }); unavailable(await resolveApprovedReminder(resolveInput(p)), 'resolution');
    expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['v', 'proposal_id', 'work_id', 'work_status'])('requires native %s', async key => {
    const data: Record<string, unknown> = resolution(); delete data[key];
    unavailable(await resolveApprovedReminder(resolveInput(caller(data))), 'resolution');
  });
  it.each(['proposalId', 'actorId', 'tenantId', 'threadId', 'clientId'] as const)('invalid lookup %s never calls native RPC', async key => {
    const p = caller(); unavailable(await resolveApprovedReminder({ ...resolveInput(p), binding: { ...resolveBinding, [key]: 'invalid' } } as Parameters<typeof resolveApprovedReminder>[0]), 'resolution', false);
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it('rejects an unsupported response instead of converting read failure into adoption/fallback', async () => {
    const p = caller({ v: 1, proposal_id: selected.id, status: 'unsupported', unsupported_reason: REMINDER_UNSUPPORTED_CLASSES[0] });
    unavailable(await resolveApprovedReminder(resolveInput(p)), 'resolution');
    expect(p.rpc.mock.calls.map(c => c[0])).toEqual(['resolve_paige_reminder_approval']);
  });
});

describe('historical-only original receipt', () => {
  it('returns only original historical evidence without a current-record reader/adopter', async () => {
    // The canonical record may have been deleted. This fixture models ONLY the
    // native historical response; actual deletion/authorization has separate SQL proof.
    const data = historyReceipt(), p = caller(data);
    const result = await readApprovedReminderHistory(historyInput(p));
    expect(result).toEqual({ kind: 'succeeded', workId: binding.workId, proposalId: selected.id, receiptVersion: 1,
      historical: true, replayed: true, originalResult: data.original_result, originalReadback: data.original_readback,
      legacyFallbackEligible: false, retryAllowed: false, callMode: 'history_only', newEffectPossible: false });
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith('execute_paige_approved_reminder', { p_work_id: binding.workId,
      p_expected_tenant: scope.tenantId, p_expected_thread: scope.threadId, p_expected_client: null,
      p_intent: null, p_runtime_request_nonce: null });
    expect(result).not.toHaveProperty('currentReadback'); expect(result).not.toHaveProperty('readback');
  });
  it.each([
    { historical: false, replayed: false }, { historical: false, replayed: true }, { historical: true, replayed: false },
    { historical: 'true', replayed: true }, { historical: true, replayed: 'true' },
  ])('never relabels a fresh/mixed/malformed response as historical %#', async flags => {
    unavailable(await readApprovedReminderHistory(historyInput(caller({ ...historyReceipt(), ...flags }))), 'history');
  });
  it.each(DURABLE_JOB_STATES.filter(s => s !== 'succeeded'))('does not expose %s as a historical success', async status => {
    const p = caller({ ...historyReceipt(), status }); const result = await readApprovedReminderHistory(historyInput(p));
    unavailable(result, 'history'); expect(result).toMatchObject({ callMode: 'history_only', newEffectPossible: false });
    expect(p.rpc.mock.calls[0][1]).toMatchObject({ p_intent: null, p_runtime_request_nonce: null });
  });
  it.each([
    { work_id: id(99) }, { proposal_id: id(99) }, { receipt_version: 2 }, { server_key: 'must-not-escape' },
    { original_readback: { ...receipt().original_readback, tenant_id: id(99) } },
    { original_result: { ...receipt().original_result, receipt_run_id: null } },
  ])('requires the same closed native evidence in historical mode %#', async extra => {
    unavailable(await readApprovedReminderHistory(historyInput(caller({ ...historyReceipt(), ...extra }))), 'history');
  });
  it.each([null, { intentId: null, requestNonce: runtime.requestNonce }, { intentId: runtime.intentId, requestNonce: null }, runtime])(
    'never accepts a runtime input on the historical-only interface %#', async extraRuntime => {
      const p = caller(historyReceipt());
      unavailable(await readApprovedReminderHistory({ ...historyInput(p), runtime: extraRuntime } as Parameters<typeof readApprovedReminderHistory>[0]), 'history', false);
      expect(p.rpc).not.toHaveBeenCalled();
    });
  it.each([null, { intentId: null, requestNonce: runtime.requestNonce }, { intentId: runtime.intentId, requestNonce: null }])(
    'bound execution refuses NULL/mixed runtime before any native call %#', async extraRuntime => {
      const p = caller();
      unavailable(await executeApprovedReminder({ ...executeInput(p), runtime: extraRuntime } as Parameters<typeof executeApprovedReminder>[0]), 'execution', false);
      expect(p.rpc).not.toHaveBeenCalled();
    });
});

describe('withdrawal and ambiguous transport outcomes', () => {
  for (const phase of ['adoption', 'resolution', 'execution', 'history'] as const) {
    const invoke = (p: ReturnType<typeof service>, current: () => boolean) => phase === 'adoption'
      ? adoptApprovedReminder({ ...adoptInput(p), current }) : phase === 'resolution'
        ? resolveApprovedReminder({ ...resolveInput(p), current }) : phase === 'history'
          ? readApprovedReminderHistory({ ...historyInput(p), current }) : executeApprovedReminder({ ...executeInput(p), current });
    const response = () => phase === 'adoption' ? adoption() : phase === 'resolution' ? resolution() : phase === 'history' ? historyReceipt() : receipt();
    it(`${phase}: stale before and immediately before RPC does not call any port`, async () => {
      for (const fence of [() => false, vi.fn().mockReturnValueOnce(true).mockReturnValue(false), () => { throw Error('retired'); }]) {
        const p = service(); unavailable(await invoke(p, fence), phase, false); expect(p.rpc).not.toHaveBeenCalled();
      }
    });
    it(`${phase}: stale after await remains unverified, even if native success arrived`, async () => {
      let active = true; const p = service();
      p.rpc.mockImplementation(async () => { active = false; return { data: response(), error: null }; });
      unavailable(await invoke(p, () => active), phase); expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it.each(['42501', '55000', '55P03', '40001', 'P0001', 'network_unknown'])(`${phase}: answered %s never proves no previous effect`, async code => {
      const p = service(); p.rpc.mockResolvedValue({ data: response(), error: { code, message: 'Private detail' } });
      const result = await invoke(p, () => true); unavailable(result, phase);
      expect(JSON.stringify(result)).not.toContain('Private detail'); expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it(`${phase}: thrown/lost acknowledgement stays unverified with phase and attempted evidence`, async () => {
      const p = service(); p.rpc.mockRejectedValue(Error('lost acknowledgement private detail'));
      const result = await invoke(p, () => true); unavailable(result, phase);
      expect(result).toMatchObject({ reason: 'rpc_threw' }); expect(p.rpc).toHaveBeenCalledTimes(1);
    });
    it.each([null, [], 'succeeded', { data: null, error: null }])(`${phase}: malformed transport/data %# fails closed`, async reply => {
      const p = service(); p.rpc.mockResolvedValue(reply);
      unavailable(await invoke(p, () => true), phase); expect(p.rpc).toHaveBeenCalledTimes(1);
    });
  }
  it('captures the original withdrawal callback instead of borrowing a newer view callback', async () => {
    let active = true; const p = caller(), input = { ...executeInput(p), current: () => active };
    p.rpc.mockImplementation(async () => { active = false; input.current = () => true; return { data: receipt(), error: null }; });
    unavailable(await executeApprovedReminder(input), 'execution');
  });
});
