import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ tenant: '11111111-1111-4111-8111-111111111111', rpc: vi.fn() }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeTenantId: state.tenant, accountContextLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
import { useSalesBillingDrafts } from './useSalesBillingDrafts';
let root: Root, host: HTMLDivElement, latest: ReturnType<typeof useSalesBillingDrafts>;
function Probe() { latest = useSalesBillingDrafts(); return null; }
const empty = { data: { rows: [], has_more: false, next_cursor: null }, error: null };
async function render() { await act(async () => { root.render(<Probe />); }); }
beforeEach(() => { state.tenant = '11111111-1111-4111-8111-111111111111'; state.rpc.mockReset().mockResolvedValue(empty); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('billing draft workspace lifecycle', () => {
  it('distinguishes unavailable storage from a confirmed empty list', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await render(); expect(latest.phase).toBe('unavailable');
    state.rpc.mockResolvedValue(empty); await act(async () => latest.retry());
    expect(latest.phase).toBe('ready'); expect(latest.rows).toEqual([]);
  });
  it('discards an old A response after A to B to A', async () => {
    let resolve!: (value: typeof empty) => void;
    state.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await render(); const a = state.tenant;
    state.tenant = '22222222-2222-4222-8222-222222222222'; await render();
    state.tenant = a; state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } }); await render();
    await act(async () => resolve(empty)); expect(latest.phase).toBe('unavailable');
  });
  it('refuses a save opened in another workspace without issuing an RPC', async () => {
    await render(); state.rpc.mockClear();
    const result = await latest.save({ openedTenantId: '22222222-2222-4222-8222-222222222222', invoiceId: '', expectedVersion: 0, operationId: '', draft: {} as never });
    expect(result).toMatchObject({ ok: false, outcome: 'refused' }); expect(state.rpc).not.toHaveBeenCalled();
  });
});
