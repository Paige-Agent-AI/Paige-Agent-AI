import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../__tests__/fixtures/exp04-client-status-source.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ rpc: vi.fn(), context: {
  activeTenantId: '', activeUserId: '', accountContextLoading: false,
  accountContextStatus: 'ready' as 'ready' | 'resolving' | 'error' | 'signed_out',
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mock.rpc(...args) } }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => mock.context }));
import { readClientEngagementStatus, useClientEngagementStatus } from './useClientEngagementStatus';

const ACTOR = 'e0400000-0000-4000-8000-000000000001';
const OTHER = 'e0400000-0000-4000-8000-000000000002';
const reply = () => ({ data: structuredClone(source), error: null });
function deferred() {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const promise = new Promise<ReturnType<typeof reply>>(done => { resolve = done; });
  return { promise, resolve };
}

describe('client standing · canonical scope lifetime', () => {
  let host: HTMLDivElement, root: Root;
  let latest: ReturnType<typeof useClientEngagementStatus>;
  const frames: Array<{ phase: string; hasStatus: boolean }> = [];
  function Probe({ contact = source.contact_id }: { contact?: string }) {
    latest = useClientEngagementStatus(contact);
    frames.push({ phase: latest.phase, hasStatus: latest.status !== null });
    return null;
  }
  async function render(contact?: string) { await act(async () => root.render(<Probe contact={contact} />)); }
  beforeEach(() => {
    mock.rpc.mockReset().mockResolvedValue(reply()); frames.length = 0;
    Object.assign(mock.context, { activeTenantId: source.tenant_id, activeUserId: ACTOR, accountContextLoading: false, accountContextStatus: 'ready' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  for (const [name, patch, contact] of [
    ['another actor in the same workspace', { activeUserId: OTHER }, undefined],
    ['another workspace', { activeTenantId: OTHER }, undefined],
    ['another client', {}, OTHER],
    ['resolving the account', { accountContextLoading: true, accountContextStatus: 'resolving' }, undefined],
    ['an account error', { accountContextStatus: 'error' }, undefined],
    ['signing out', { activeUserId: '', accountContextStatus: 'signed_out' }, undefined],
  ] as const) {
    it(`retires the answer on the FIRST render for ${name}`, async () => {
      await render(); expect(latest.phase).toBe('ready');
      mock.rpc.mockImplementation(() => new Promise(() => {})); frames.length = 0;
      Object.assign(mock.context, patch); await render(contact);
      expect(frames[0].hasStatus).toBe(false);
      expect(latest.status).toBeNull();
      if (name === 'another actor in the same workspace') expect(mock.rpc).toHaveBeenCalledTimes(2);
    });
  }

  it('does not read when canonical authenticated identity is absent', async () => {
    mock.context.activeUserId = ''; await render();
    expect(mock.rpc).not.toHaveBeenCalled(); expect(latest.status).toBeNull();
  });

  it('does not read when canonical account resolution failed', async () => {
    mock.context.accountContextStatus = 'error'; await render();
    expect(mock.rpc).not.toHaveBeenCalled(); expect(latest.phase).toBe('error');
  });

  it('rejects an old reload callback BEFORE dispatch after an actor changes', async () => {
    await render(); const retired = latest.reload;
    mock.context.activeUserId = OTHER; await render(); const calls = mock.rpc.mock.calls.length;
    await expect(retired()).rejects.toThrow(); expect(mock.rpc).toHaveBeenCalledTimes(calls);
  });

  it('does not return a retired in-flight answer as write confirmation', async () => {
    await render(); const pending = deferred(); mock.rpc.mockReturnValueOnce(pending.promise);
    const result = latest.reload().then(() => 'resolved', () => 'retired');
    mock.context.activeUserId = OTHER; await render();
    await act(async () => { pending.resolve(reply()); expect(await result).toBe('retired'); });
  });

  it('does not revive a reload when the same actor returns after another account', async () => {
    await render(); const pending = deferred(); mock.rpc.mockReturnValueOnce(pending.promise);
    const result = latest.reload().then(() => 'resolved', () => 'retired');
    mock.context.activeUserId = OTHER; await render();
    mock.context.activeUserId = ACTOR; await render();
    await act(async () => { pending.resolve(reply()); expect(await result).toBe('retired'); });
  });

  it('rejects a superseded reload instead of returning its older confirmation', async () => {
    await render(); const pending = deferred(); mock.rpc.mockReturnValueOnce(pending.promise);
    const older = latest.reload().then(() => 'resolved', () => 'retired');
    await act(async () => { await latest.reload(); });
    await act(async () => { pending.resolve(reply()); expect(await older).toBe('retired'); });
  });

  it('retires a pending reload after unmount', async () => {
    await render(); const pending = deferred(); mock.rpc.mockReturnValueOnce(pending.promise);
    const result = latest.reload().then(() => 'resolved', () => 'retired');
    await act(async () => root.render(null));
    pending.resolve(reply()); expect(await result).toBe('retired');
  });

  it('retires an unmounted callback during commit, before passive cleanup', async () => {
    let retired!: typeof latest.reload;
    let result: Promise<boolean> | undefined;
    function Boundary({ show }: { show: boolean }) {
      useLayoutEffect(() => {
        if (!show) result = retired().then(() => false, () => true);
      }, [show]);
      return show ? <Probe /> : null;
    }
    await act(async () => root.render(<Boundary show />));
    expect(latest.phase).toBe('ready'); retired = latest.reload;
    const calls = mock.rpc.mock.calls.length;
    await act(async () => root.render(<Boundary show={false} />));
    expect(await result).toBe(true);
    expect(mock.rpc).toHaveBeenCalledTimes(calls);
  });

  it('lets the current refresh finish after a separate fresh read fails', async () => {
    await render(); const refreshing = deferred(); mock.rpc.mockReturnValueOnce(refreshing.promise);
    await act(async () => latest.retry()); expect(latest.phase).toBe('loading');
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014' } });
    await act(async () => { await expect(latest.reload()).rejects.toThrow(); });
    await act(async () => { refreshing.resolve(reply()); });
    expect(latest.phase).toBe('ready');
  });

  it('never lets an earlier refresh overwrite a newer successful confirmation', async () => {
    await render(); const refreshing = deferred(); mock.rpc.mockReturnValueOnce(refreshing.promise);
    await act(async () => latest.retry());
    const newer = reply(); newer.data.work.items[0].title = 'Current confirmed work';
    mock.rpc.mockResolvedValueOnce(newer);
    await act(async () => { await latest.reload(); });
    await act(async () => { refreshing.resolve(reply()); });
    expect(latest.status?.work.items[0].title).toBe('Current confirmed work');
  });

  it('clears a ready answer after an authoritative fresh permission refusal', async () => {
    await render(); mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await act(async () => { await expect(latest.reload()).rejects.toThrow(); });
    expect(latest.phase).toBe('refused'); expect(latest.status).toBeNull();
  });

  it('keeps an older refresh from reviving data after a fresh permission refusal', async () => {
    await render(); const refreshing = deferred(); mock.rpc.mockReturnValueOnce(refreshing.promise);
    await act(async () => latest.retry());
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await act(async () => { await expect(latest.reload()).rejects.toThrow(); });
    await act(async () => { refreshing.resolve(reply()); });
    expect(latest.phase).toBe('refused'); expect(latest.status).toBeNull();
  });

  it('ignores an older refusal after a newer successful permission read', async () => {
    await render(); const older = deferred(); mock.rpc.mockReturnValueOnce(older.promise);
    const result = latest.reload().catch(() => undefined);
    await act(async () => { await latest.reload(); });
    await act(async () => { older.resolve({ data: null, error: { code: '42501' } } as unknown as ReturnType<typeof reply>); await result; });
    expect(latest.phase).toBe('ready');
  });

  it('honors a permission refusal when a later read failed without confirming access', async () => {
    await render(); const older = deferred(); mock.rpc.mockReturnValueOnce(older.promise);
    const result = latest.reload().catch(() => undefined);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014' } });
    await act(async () => { await expect(latest.reload()).rejects.toThrow(); });
    await act(async () => { older.resolve({ data: null, error: { code: '42501' } } as unknown as ReturnType<typeof reply>); await result; });
    expect(latest.phase).toBe('refused'); expect(latest.status).toBeNull();
  });

  it('keeps same-turn read joining inside the authenticated actor, not across actors', async () => {
    await Promise.all([
      readClientEngagementStatus(source.tenant_id, source.contact_id, { actorId: ACTOR }),
      readClientEngagementStatus(source.tenant_id, source.contact_id, { actorId: ACTOR }),
      readClientEngagementStatus(source.tenant_id, source.contact_id, { actorId: OTHER }),
    ]);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
});
