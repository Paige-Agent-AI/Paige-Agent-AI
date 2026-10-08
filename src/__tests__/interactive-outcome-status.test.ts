// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readInteractiveOutcomeStatus } from '../../supabase/functions/_shared/paige-turn/outcome-status';

describe('authenticated status outcome enrichment', () => {
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
