import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../__tests__/fixtures/exp04-client-status-source.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), context: {
  activeTenantId: '', activeUserId: '', accountContextLoading: false,
  accountContextStatus: 'ready' as 'ready' | 'resolving' | 'error' | 'signed_out',
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mock.rpc(...args), auth: { getSession: () => mock.session() } } }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => mock.context }));
vi.mock('@/hooks/usePlanList', () => ({ usePlanList: () => ({ plans: [], forbidden: false, error: null, loading: false }) }));
vi.mock('@/solo/operations/useOperationsPeople', () => ({ useOperationsPeople: () => ({ members: [], loading: false, error: null }) }));
vi.mock('@/solo/operations/OperationsWorkCreator', () => ({ OperationsWorkCreator: () => <div data-client-work-editor /> }));
import { ClientStanding } from './ClientStanding';
import { ClientSharedWork } from './ClientSharedWork';
import * as readModule from '../../solo/engagement/useClientEngagementStatus';
import { composeClientEngagementStatus, parseClientEngagementSource } from '../../../supabase/functions/_shared/client-engagement/status';

const ACTOR = 'e0400000-0000-4000-8000-000000000001';
const OTHER = 'e0400000-0000-4000-8000-000000000002';
const TITLE = source.work.items[0].title;
function reply() { return { data: { ...structuredClone(source), receipt_id: undefined,
  work: { ...source.work, shared: 0, items: source.work.items.map(item => ({ ...item, shared: false, updated_at: '2026-10-14T12:00:00.123456+00:00' })) },
}, error: null }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

describe('original client standing and shared work · scope continuity', () => {
  let host: HTMLDivElement, root: Root;
  const paints: string[] = [];
  function Page({ contact = source.contact_id }: { contact?: string }) {
    useLayoutEffect(() => { paints.push(host.textContent ?? ''); });
    return <MemoryRouter><ClientStanding contactId={contact} clientName="Synthetic consulting client" account="42" openPaige={vi.fn()} />
      <ClientSharedWork contactId={contact} clientName="Synthetic consulting client" portalConnected /></MemoryRouter>;
  }
  const render = async (contact?: string) => { await act(async () => root.render(<Page contact={contact} />)); };
  const settle = async () => { await act(async () => { await Promise.resolve(); }); };
  const clickShare = async () => {
    const button = host.querySelector<HTMLButtonElement>('button[role="switch"]'); expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  beforeEach(() => {
    paints.length = 0; mock.rpc.mockReset().mockResolvedValue(reply());
    mock.session.mockReset().mockResolvedValue({ data: { session: { user: { id: ACTOR } } }, error: null });
    Object.assign(mock.context, { activeTenantId: source.tenant_id, activeUserId: ACTOR, accountContextLoading: false, accountContextStatus: 'ready' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('preserves the original two-sections / one governed read contract', async () => {
    await render(); expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(host.querySelector('#client-standing')?.textContent).toContain(TITLE);
    expect(host.querySelector('#client-shared-work')?.textContent).toContain(TITLE);
  });

  for (const [name, patch, contact] of [
    ['actor', { activeUserId: OTHER }, undefined],
    ['workspace', { activeTenantId: OTHER }, undefined],
    ['client', {}, OTHER],
    ['resolving account', { accountContextLoading: true, accountContextStatus: 'resolving' }, undefined],
  ] as const) {
    it(`removes the old standing AND shared items before paint when changing ${name}`, async () => {
      await render(); expect(host.textContent).toContain(TITLE);
      mock.rpc.mockImplementation(() => new Promise(() => {})); paints.length = 0;
      Object.assign(mock.context, patch); await render(contact);
      expect(paints[0]).not.toContain(TITLE);
      expect(host.querySelector('#client-standing')?.textContent).not.toContain(TITLE);
      expect(host.querySelector('#client-shared-work')?.textContent).not.toContain(TITLE);
      expect(host.querySelector('button[role="switch"]')).toBeNull();
    });
  }

  it('keeps the same-scope status visible while Check again is pending', async () => {
    await render(); mock.rpc.mockImplementation(() => new Promise(() => {}));
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('#client-standing button')].find(button => button.textContent?.includes('Check again'));
    expect(refresh).toBeDefined(); await act(async () => refresh!.click());
    expect(host.querySelector('#client-standing')?.textContent).toContain(TITLE);
  });

  it('closes a work editor instead of retargeting it to a new client', async () => {
    await render(); const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('Add work'));
    expect(add).toBeDefined(); await act(async () => add!.click());
    expect(host.querySelector('[data-client-work-editor]')).not.toBeNull();
    mock.rpc.mockImplementation(() => new Promise(() => {})); await render(OTHER);
    expect(host.querySelector('[data-client-work-editor]')).toBeNull();
  });

  it('does not dispatch an old share after account retirement during session resolution', async () => {
    await render(); const session = deferred<{ data: { session: { user: { id: string } } }; error: null }>();
    mock.session.mockReturnValueOnce(session.promise); await clickShare();
    mock.context.activeUserId = OTHER; await render();
    await act(async () => { session.resolve({ data: { session: { user: { id: ACTOR } } }, error: null }); }); await settle();
    expect(mock.rpc.mock.calls.filter(([name]) => name === 'plan_item_set_client_share')).toHaveLength(0);
  });

  it('does not run an old confirmation read or show old success after a share crosses scopes', async () => {
    await render(); const write = deferred<{ data: { ok: boolean }; error: null }>();
    mock.rpc.mockImplementation((name: string) => name === 'plan_item_set_client_share' ? write.promise : Promise.resolve(reply()));
    await clickShare(); expect(mock.rpc.mock.calls.filter(([name]) => name === 'plan_item_set_client_share')).toHaveLength(1);
    mock.context.activeUserId = OTHER; await render(); const calls = mock.rpc.mock.calls.length;
    await act(async () => { write.resolve({ data: { ok: true }, error: null }); }); await settle();
    expect(mock.rpc).toHaveBeenCalledTimes(calls);
    expect(host.textContent).not.toContain('The change couldn’t be confirmed');
    expect(host.textContent).not.toContain('Shared. Synthetic');
  });

  it('does not revive a refused snapshot while access is being checked again', async () => {
    const status = composeClientEngagementStatus(parseClientEngagementSource(reply().data));
    let view: ReturnType<typeof readModule.useClientEngagementStatus> = { phase: 'ready', status, error: '', retry: vi.fn(), reload: async () => status, isCurrent: () => true };
    const spy = vi.spyOn(readModule, 'useClientEngagementStatus').mockImplementation(() => view);
    try {
      await render(); expect(host.textContent).toContain(TITLE);
      view = { ...view, phase: 'refused', status: null, error: 'Access refused' }; await render();
      expect(host.textContent).not.toContain(TITLE);
      view = { ...view, phase: 'loading', status: null, error: '' }; await render();
      expect(host.querySelector('#client-standing')?.textContent).not.toContain(TITLE);
      expect(host.querySelector('#client-shared-work')?.textContent).not.toContain(TITLE);
    } finally { spy.mockRestore(); }
  });

  it('does not claim that nothing changed when a write acknowledgement cannot be checked', async () => {
    await render();
    const refreshing = deferred<{ data: null; error: { code: string } }>(); let firstRead = true;
    mock.rpc.mockImplementation((name: string) => {
      if (name === 'plan_item_set_client_share') return Promise.resolve({ data: { ok: true }, error: null });
      if (firstRead) { firstRead = false; return refreshing.promise; }
      return Promise.resolve({ data: null, error: { code: '57014' } });
    });
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('#client-shared-work button')].find(button => button.textContent === 'Refresh');
    expect(refresh).toBeDefined(); await act(async () => refresh!.click());
    await clickShare();
    await act(async () => { refreshing.resolve({ data: null, error: { code: '57014' } }); });
    expect(mock.rpc.mock.calls.filter(([name]) => name === 'plan_item_set_client_share')).toHaveLength(1);
    const section = host.querySelector('#client-shared-work')!;
    expect(section.querySelector('.trc-shared-state')).not.toBeNull();
    expect(section.textContent).not.toContain('Nothing has been shared or unshared');
    expect(section.textContent).toContain('Try again');
  });
});
