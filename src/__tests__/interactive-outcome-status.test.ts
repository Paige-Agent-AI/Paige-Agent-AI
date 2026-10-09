// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readInteractiveOutcomeStatus } from '../../supabase/functions/_shared/paige-turn/outcome-status';

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
