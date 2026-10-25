import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  rpc: vi.fn(),
  from: vi.fn(),
  reads: [] as Array<{ table: string; selection: string; filters: unknown[][]; signal?: AbortSignal }>,
  result: null as unknown,
  error: null as unknown,
  held: null as Promise<{ data: unknown; error: unknown }> | null,
}));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => h.context }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { useSystemsCheck, type SystemsCheckScope } from './useSystemsCheck';

const TENANT = 'a1000000-0000-0000-0000-000000001111';
const OTHER = 'b2000000-0000-0000-0000-000000002222';
const FINDING = 'a1000000-0000-0000-0000-00000000f001';
const RUN = 'a1000000-0000-0000-0000-00000000a001';
const CURRENT_RUN = 'a1000000-0000-0000-0000-00000000a002';
const current = { run: { id: CURRENT_RUN, started_at: '2026-10-20T01:00:00Z', completed_at: '2026-10-20T01:01:00Z', check_count: 2, pass_count: 1, fail_count: 1 }, findings: [] };
const recorded = () => ({ id: FINDING, tenant_id: TENANT, run_id: RUN, check_id: 'company_info_populated', status: 'fail',
  severity_at_finding: 'medium', evidence: { source: 'original-record' }, paige_interpretation: 'Recorded setup gap.',
  paige_drafted_fix: { body: 'Original draft.' }, department_id: 'operations_pmo', resolved_at: null,
  resolution: null, resolution_action_id: null, created_at: '2026-10-10T01:00:30Z',
  reg: { check_name: 'Business profile', domain: 'data_product', priority: 3 },
  run: { id: RUN, tenant_id: TENANT, started_at: '2026-10-10T01:00:00Z', completed_at: '2026-10-10T01:01:00Z' } });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null, host: HTMLDivElement, client: QueryClient;
let result: ReturnType<typeof useSystemsCheck>;
let sourceId: string | null | undefined, scope: SystemsCheckScope;
let useOptions: boolean;
function Probe() { result = useSystemsCheck(scope, useOptions ? { findingId: sourceId } : undefined); return null; }
const render = () => act(() => root!.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
async function waitFor(check: () => void) {
  const start = Date.now();
  for (;;) { try { check(); return; } catch (e) {
    if (Date.now() - start > 3000) throw e;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  } }
}
beforeEach(() => {
  h.context = { activeTenantId: TENANT, activeUserId: 'actor-a', accountContextStatus: 'ready', loading: false, isPlatformStaff: false, activeTenant: { id: TENANT, account_type: 'standalone', parent_tenant_id: null } };
  h.reads.length = 0; h.held = null; h.error = null; h.result = recorded();
  h.rpc.mockReset().mockResolvedValue({ data: current, error: null });
  h.from.mockReset().mockImplementation(table => {
    const read = { table, selection: '', filters: [] as unknown[][], signal: undefined as AbortSignal | undefined };
    h.reads.push(read);
    const chain = {
      select(value: string) { read.selection = value; return chain; },
      eq(key: string, value: unknown) { read.filters.push([key, value]); return chain; },
      abortSignal(value: AbortSignal) { read.signal = value; return chain; },
      maybeSingle() { return h.held ?? Promise.resolve({ data: h.result, error: h.error }); },
    };
    return chain;
  });
  sourceId = FINDING; scope = 'tenant'; useOptions = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root?.unmount()); client.clear(); host.remove(); root = null; vi.restoreAllMocks(); });

describe('original recorded Systems Check source', () => {
  it('keeps the unrequested default as one original snapshot RPC without a table read', async () => {
    useOptions = false; render(); await waitFor(() => expect(result.loading).toBe(false));
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('systems_check_snapshot', { p_scope: 'tenant' });
    expect(h.from).not.toHaveBeenCalled(); expect(result.run).toEqual(current.run);
    expect(result).not.toHaveProperty('recordedFinding');
  });
  it('represents an explicit null reference as not requested without a table read', async () => {
    sourceId = null; render(); await waitFor(() => expect(result.loading).toBe(false));
    expect(result.recordedFinding).toEqual({ state: 'not_requested' }); expect(h.from).not.toHaveBeenCalled();
  });
  it('reads one original record with both tenant filters and a bounded original relation', async () => {
    render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('ready'));
    expect(h.reads).toHaveLength(1); expect(h.reads[0].table).toBe('paige_systems_check_finding');
    expect(h.reads[0].filters).toEqual([['id', FINDING], ['tenant_id', TENANT], ['run.tenant_id', TENANT]]);
    expect(h.reads[0].selection).toContain('run:paige_systems_check_run!inner');
    expect(h.reads[0].selection).not.toContain('*');
    expect(result.run).toEqual(current.run); expect(result.findings).toEqual([]);
    expect(result.recordedFinding).toMatchObject({ state: 'ready', finding: { id: FINDING, run_id: RUN, check_name: 'Business profile', status: 'fail' }, run: { id: RUN } });
    expect(result.recordedFinding).not.toHaveProperty('tenant_id');
    expect(result.recordedFinding).not.toHaveProperty('finding.reg');
    expect(result.recordedFinding).not.toHaveProperty('finding.run');
    expect(result.recordedFinding).not.toHaveProperty('run.pass_count');
  });
  it('keeps the original current finding projection unchanged for default callers', async () => {
    useOptions = false;
    h.rpc.mockResolvedValue({ data: { ...current, findings: [recorded()] }, error: null });
    render(); await waitFor(() => expect(result.loading).toBe(false));
    const { tenant_id: _tenant, run: _run, reg, ...original } = recorded();
    expect(result.findings).toEqual([{ ...original, check_name: reg.check_name, domain: reg.domain, priority: reg.priority }]);
    expect(h.from).not.toHaveBeenCalled();
  });
  it('normalizes the same canonical UUID reference before selecting', async () => {
    sourceId = FINDING.toUpperCase(); render(); await waitFor(() => expect(h.reads).toHaveLength(1));
    expect(h.reads[0].filters[0]).toEqual(['id', FINDING]);
  });
  it.each(['not-an-id', 'https://elsewhere.invalid/finding', ` ${FINDING}`, ''])('refuses malformed references without reading %s', async value => {
    sourceId = value; render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
    expect(h.from).not.toHaveBeenCalled();
  });
  it.each([
    { activeTenantId: null }, { activeUserId: null }, { accountContextStatus: 'resolving' },
    { accountContextStatus: 'signed_out' }, { accountContextStatus: 'error' },
    { activeTenant: { id: OTHER, account_type: 'standalone' } },
    { activeTenant: { id: TENANT, account_type: 'agency' } },
    { activeTenant: { id: TENANT, account_type: 'standalone', parent_tenant_id: OTHER } },
    { isPlatformStaff: true, activeTenantId: null, activeTenant: null }, { loading: true },
    { activeTenant: { id: TENANT, account_type: null } },
  ])('does not read before the original SOLO identity is ready %#', async change => {
    h.context = { ...h.context, ...change }; render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
    expect(h.from).not.toHaveBeenCalled();
  });
  it('does not widen an operator snapshot into a tenant historical read', async () => {
    scope = 'operator'; render(); await waitFor(() => expect(result.loading).toBe(false));
    expect(h.from).not.toHaveBeenCalled(); expect(result.recordedFinding?.state).toBe('unavailable');
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('systems_check_snapshot', { p_scope: 'operator' });
  });
  it('does not turn a missing or RLS-withheld record into current evidence', async () => {
    h.result = null; render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
    expect(result.run).toEqual(current.run); expect(result.recordedFinding).toEqual({ state: 'unavailable' });
  });
  it.each([
    (r: ReturnType<typeof recorded>) => ({ ...r, tenant_id: OTHER }),
    (r: ReturnType<typeof recorded>) => ({ ...r, id: OTHER }),
    (r: ReturnType<typeof recorded>) => ({ ...r, run: { ...r.run, tenant_id: OTHER } }),
    (r: ReturnType<typeof recorded>) => ({ ...r, run: { ...r.run, id: OTHER } }),
    (r: ReturnType<typeof recorded>) => ({ ...r, run: null }),
    (r: ReturnType<typeof recorded>) => ({ ...r, status: 'invented' }),
  ])('refuses a response that contradicts its original source binding %#', async change => {
    h.result = change(recorded()); render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
    expect(result.recordedFinding).toEqual({ state: 'unavailable' });
  });
  it('reports a read error without exposing its payload or claiming absence', async () => {
    h.result = null; h.error = { code: '42501', message: 'private source details' }; render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('error'));
    expect(result.recordedFinding).toEqual({ state: 'error' });
  });
  it.each([
    (r: ReturnType<typeof recorded>) => ({ ...r, created_at: 'invalid date' }),
    (r: ReturnType<typeof recorded>) => ({ ...r, run: { ...r.run, started_at: 'invalid date' } }),
    (r: ReturnType<typeof recorded>) => ({ ...r, run: { ...r.run, completed_at: 'invalid date' } }),
  ])('does not return an unreadable original timestamp %#', async change => {
    h.result = change(recorded()); render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
  });
  it('hides a previously read record while original identity is resolving and revalidates on return', async () => {
    render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('ready'));
    h.context = { ...h.context, accountContextStatus: 'resolving' }; render();
    expect(result.recordedFinding).toEqual({ state: 'unavailable' });
    let finish!: (value: { data: unknown; error: unknown }) => void;
    h.held = new Promise(resolve => { finish = resolve; });
    h.context = { ...h.context, accountContextStatus: 'ready' }; render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('loading'));
    expect(result.recordedFinding).toEqual({ state: 'loading' });
    await act(async () => finish({ data: null, error: null }));
    await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
  });
  it('retains an unfinished original run as recorded evidence without current counts', async () => {
    h.result = { ...recorded(), run: { ...recorded().run, completed_at: null } }; render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('ready'));
    expect(result.recordedFinding).toMatchObject({ run: { completed_at: null } });
    expect(result.run).toEqual(current.run); expect(result.scanInProgressSince).toBeNull();
  });
  it('can read the original record when the latest snapshot itself is unavailable', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'latest read failed' } }); render();
    await waitFor(() => expect(result.recordedFinding?.state).toBe('ready'));
    await waitFor(() => expect(result.isError).toBe(true)); expect(result.run).toBeNull();
  });
  it('uses the original refresh for the record and hides stale data while rereading', async () => {
    render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('ready'));
    let finish!: (value: { data: unknown; error: unknown }) => void;
    h.held = new Promise(resolve => { finish = resolve; });
    act(() => result.refresh()); await waitFor(() => expect(result.recordedFinding?.state).toBe('loading'));
    expect(result.recordedFinding).toEqual({ state: 'loading' });
    await act(async () => finish({ data: { ...recorded(), resolution: 'deferred' }, error: null }));
    await waitFor(() => expect(result.recordedFinding).toMatchObject({ state: 'ready', finding: { resolution: 'deferred' } }));
    expect(h.reads).toHaveLength(2);
  });
  it.each(['tenant', 'actor'])('retires a late original read after changing %s', async identity => {
    let finish!: (value: { data: unknown; error: unknown }) => void;
    h.held = new Promise(resolve => { finish = resolve; }); render();
    await waitFor(() => expect(h.reads).toHaveLength(1)); const original = h.reads[0];
    h.held = null; h.result = null;
    h.context = identity === 'tenant' ? { ...h.context, activeTenantId: OTHER, activeTenant: { id: OTHER, account_type: 'standalone' } } : { ...h.context, activeUserId: 'actor-b' };
    render(); await waitFor(() => expect(result.recordedFinding?.state).toBe('unavailable'));
    await act(async () => finish({ data: recorded(), error: null }));
    expect(original.signal?.aborted).toBe(true); expect(result.recordedFinding).toEqual({ state: 'unavailable' });
  });
});
