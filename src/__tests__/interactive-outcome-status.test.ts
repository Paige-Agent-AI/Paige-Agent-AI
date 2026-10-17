// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readInteractiveOutcomeStatus } from '../../supabase/functions/_shared/paige-turn/outcome-status';
import { interactiveEffect, interactiveReceiptContext } from '../../supabase/functions/_shared/paige-turn/interactive';
import { PAIGE_SPINE_CAPABILITIES } from '../../supabase/functions/_shared/paige-spine/registry';
import type { SpineCapability } from '../../supabase/functions/_shared/paige-spine/contracts';

describe('authenticated status outcome enrichment', () => {
  it('uses final ownership after both original-operation and durable observations', async () => {
    let executor: string | null = 'original-owner';
    const calls: string[] = [];
    const result = await readInteractiveOutcomeStatus({
      state: async () => { calls.push('authority'); return { executor, terminal: true }; },
      readOutcome: async () => { calls.push('operation'); executor = null; return { outcome: 'confirmed_success', verified_readback: true }; },
      readWork: async () => { calls.push('work'); executor = 'concurrent-owner'; return { state: 'succeeded', artifactVerified: true }; },
    });
    expect(calls).toEqual(['authority', 'operation', 'work', 'authority']);
    expect(result.executor_active).toBe(true);
    expect(result.settled).toBe(false);
    expect(result.original_operation?.outcome).toBe('confirmed_success');
    expect(result.durable_work?.artifactVerified).toBe(true);
  });
  it('refuses a response if authority is revoked while durable evidence is awaited', async () => {
    let revoked = false;
    await expect(readInteractiveOutcomeStatus({
      state: async () => { if (revoked) throw Error('authority revoked'); return { executor: 'held' }; },
      readWork: async () => { revoked = true; return { state: 'succeeded', artifactVerified: true }; },
    })).rejects.toThrow('authority revoked');
  });
  it('observes durable work without consuming or releasing held execution', async () => {
    const state = vi.fn(async () => ({ executor: 'held', terminal: true }));
    const work = { workId: 'canonical-work', state: 'succeeded', artifactVerified: true };
    const result = await readInteractiveOutcomeStatus({ state, readWork: async () => work });
    expect(result).toEqual({ executor_active: true, settled: false, durable_work: work });
    expect(state).toHaveBeenCalledTimes(2);
  });
  it('contains unavailable durable evidence and retains the latest executor state', async () => {
    const state = vi.fn(async () => ({ executor: 'held' }));
    const result = await readInteractiveOutcomeStatus({ state, readWork: async () => { throw Error('private read failure'); } });
    expect(result).toEqual({ executor_active: true, settled: false, durable_work: null });
    expect(state).toHaveBeenCalledTimes(2);
  });
  it('keeps verified success separate from a held executor', async () => {
    const state = vi.fn(async () => ({ executor: 'held', terminal: true }));
    const result = await readInteractiveOutcomeStatus({ state, readOutcome: async () => ({ outcome: 'confirmed_success', verified_readback: true }) });
    expect(result).toEqual({ executor_active: true, settled: false, original_operation: { outcome: 'confirmed_success', verified_readback: true } });
    expect(state).toHaveBeenCalledTimes(2);
  });
  it('reads executor state again after asynchronous evidence changes ownership', async () => {
    let executor: string | null = null;
    const result = await readInteractiveOutcomeStatus({ state: async () => ({ executor, terminal: true }), readOutcome: async () => { executor = 'new-owner'; return { outcome: 'confirmed_success', verified_readback: true }; } });
    expect(result.executor_active).toBe(true);
    expect(result.settled).toBe(false);
  });
  it('contains evidence failures without converting them to failure or success', async () => {
    const result = await readInteractiveOutcomeStatus({ state: async () => ({ executor: 'held' }), readOutcome: async () => { throw Error('private database failure'); } });
    expect(result.original_operation).toEqual({ outcome: 'outcome_unknown', verified_readback: false });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.settled).toBe(false);
  });
  it('preserves ordinary status shape without an effect reference', async () => {
    const state = vi.fn(async () => ({ executor: null, stopped: true }));
    expect(await readInteractiveOutcomeStatus({ state })).toEqual({ executor_active: false, settled: true });
    expect(state).toHaveBeenCalledOnce();
  });
  it('fails closed on malformed executor evidence', async () => {
    expect(await readInteractiveOutcomeStatus({ state: async () => ({ terminal: true }) })).toEqual({ executor_active: true, settled: false });
  });
  it('does not conceal an unavailable authority reader', async () => {
    await expect(readInteractiveOutcomeStatus({ state: async () => { throw Error('authority unavailable'); } })).rejects.toThrow('authority unavailable');
  });
});

describe('automatic lookup preserves ordinary status and ownership',()=>{
 it('omits an absent original observation and still rereads executor authority',async()=>{
  const state=vi.fn().mockResolvedValueOnce({executor:null,terminal:true}).mockResolvedValueOnce({executor:'held',terminal:true});
  expect(await readInteractiveOutcomeStatus({state,readOutcome:async()=>undefined})).toEqual({executor_active:true,settled:false});
  expect(state).toHaveBeenCalledTimes(2);
 });
});

describe('canonical closed-read interactive receipt truth', () => {
  const statuses = ['available', 'needs_input', 'refused', 'unavailable'] as const;
  const currentReads = ['read_business_metric', 'get_business_snapshot', 'read_client_engagement_status', 'read_business_time_zone', 'read_calendar_booking'];
  // Pending Task2324 uses this reviewed read contract. This is a test declaration,
  // not a Task registration, offer, executor or claim of a current-main handler.
  const pendingTask: Pick<SpineCapability, 'action' | 'outcome'> = {
    action: { chatTool: 'crm_get_task', classification: 'read', executor: 'public.operations_crm_work_read',
      riskPolicyKey: 'read_only', approvalAuthority: 'none', idempotency: 'Exact caller-JWT native read.' },
    outcome: { kinds: statuses, projector: 'public.operations_crm_work_read', railVisibility: 'Read receipt only.' },
  };
  const spine = [...PAIGE_SPINE_CAPABILITIES, pendingTask];
  const envelope = { status: 'available', message: 'Authorized lookup. No business action ran.' };
  const id = '00000000-0000-4000-8000-000000000001';
  it.each([...currentReads, 'crm_get_task'].flatMap(tool => statuses.map(status => ({ tool, status }))))(
    'projects $tool $status as a read result rather than an uncertain effect', ({ tool, status }) => {
      expect(interactiveEffect(tool, { ...envelope, status }, spine)).toEqual({ tool, outcome: status === 'available' ? 'reported_success' : 'reported_failure' });
    });
  it.each([true, false])('records completed lookup with found=%s without asserting a record or copying its contents', found => {
    const effect = interactiveEffect('read_calendar_booking', { ...envelope, found, booking: found ? { id, title: 'PRIVATE' } : null }, spine);
    expect(effect).toEqual({ tool: 'read_calendar_booking', outcome: 'reported_success' });
    const context = interactiveReceiptContext({ interactive: { effects: [effect] } });
    expect(context).not.toContain('"outcome":"outcome_unknown"'); expect(context).not.toContain('PRIVATE'); expect(context).not.toContain(id);
  });
  it('requires the canonical server declaration, not result-authored metadata', () => {
    expect(interactiveEffect('read_calendar_booking', { ...envelope, classification: 'read', riskPolicyKey: 'read_only' })?.outcome).toBe('outcome_unknown');
  });
  it.each(['comms_send_email', 'crm_create_contact', 'unregistered_tool'])('never upgrades %s from an available-shaped result', tool => {
    expect(interactiveEffect(tool, envelope, spine)?.outcome).toBe('outcome_unknown');
  });
  it.each([
    { classification: 'mutate' }, { classification: 'external_effect' }, { riskPolicyKey: 'ordinary' },
    { riskPolicyKey: 'high' }, { approvalAuthority: 'chat-canonical' },
  ])('does not recognize a non-read canonical contract %j', patch => {
    const changed = { ...pendingTask, action: { ...pendingTask.action!, ...patch } } as typeof pendingTask;
    expect(interactiveEffect('crm_get_task', envelope, [changed])?.outcome).toBe('outcome_unknown');
  });
  it.each([
    undefined, ['available'], [...statuses, 'no_pipeline'], ['available', 'available', 'refused', 'unavailable'],
  ].map(kinds => ({ kinds })))('requires the complete unique closed status vocabulary $kinds', ({ kinds }) => {
    const changed = { ...pendingTask, outcome: kinds ? { ...pendingTask.outcome!, kinds } : undefined };
    expect(interactiveEffect('crm_get_task', envelope, [changed])?.outcome).toBe('outcome_unknown');
  });
  it('refuses ambiguous duplicate declarations', () => {
    expect(interactiveEffect('crm_get_task', envelope, [pendingTask, pendingTask])?.outcome).toBe('outcome_unknown');
  });
  it.each([
    [{ outcome_unknown: true }, 'outcome_unknown'], [{ code: 'RESULT_UNKNOWN' }, 'outcome_unknown'],
    [{ error: 'uncertain transport' }, 'outcome_unknown'], [{ needs_confirm: true }, 'approval_required'],
    [{ queued: true }, 'approval_required'], [{ accepted: true, work_id: id }, 'durable_accepted'],
    [{ work_id: id }, 'outcome_unknown'], [{ run_id: id }, 'outcome_unknown'], [{ task_id: id }, 'outcome_unknown'],
    [{ booking_id: id }, 'outcome_unknown'], [{ approval_id: id }, 'outcome_unknown'],
    [{ confirm_command: {} }, 'outcome_unknown'], [{ receipt_recorded: true }, 'outcome_unknown'],
    [{ verified_readback: true }, 'outcome_unknown'], [{ success: false }, 'reported_failure'],
    [{ ok: false }, 'outcome_unknown'], [{ outcome: 'failed' }, 'reported_failure'],
  ])('retains the existing effect contract for contradiction %j', (patch, expected) => {
    expect(interactiveEffect('read_calendar_booking', { ...envelope, ...patch }, spine)?.outcome).toBe(expected);
  });
  it.each([
    { status: ['available'] }, { status: { value: 'available' } }, { status: true }, { status: null },
    { message: undefined }, { message: ['data'] }, { message: null },
  ])('does not normalize malformed envelope %j', patch => {
    expect(interactiveEffect('read_calendar_booking', { ...envelope, ...patch }, spine)?.outcome).toBe('outcome_unknown');
  });
});
