import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import canonical from '@/test/fixtures/canonical-regression-corpus.json';
import { useRegressionCorpus } from './useRegressionCorpus';
import type { RegressionCorpusRead } from './regressionCorpusContract';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const allowed = { subject: 'test-operator', epoch: 1, access: 'allowed' as 'allowed' | 'denied' };
let read: RegressionCorpusRead; let root: Root; let host: HTMLDivElement; let cache: QueryClient;
const refused = vi.fn();
const answer = (data: unknown, error: unknown = null) => ({ abortSignal: () => Promise.resolve({ data, error }) });
function Probe({ scope = allowed }: { scope?: typeof allowed }) { read = useRegressionCorpus(scope, refused); return <span>{read.page.data?.items.length}</span>; }
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 40)); }); }
async function mount(scope = allowed) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={cache}><Probe scope={scope} /></QueryClientProvider>)); await flush();
}
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }));
beforeEach(() => { rpc.mockReset(); refused.mockReset(); rpc.mockImplementation(() => answer(canonical)); });
afterEach(async () => { if (root) await act(async () => root.unmount()); cache?.clear(); host?.remove(); });
it('calls only the protected reader with bounded paired cursor and no tenant or execution arguments', async () => {
  await mount(); expect(rpc).toHaveBeenCalledExactlyOnceWith('operator_intelligence_regression_corpus', { p_limit: 25, p_before_at: null, p_before_id: null });
  expect(read.page.data?.items[0].history).toHaveLength(3);
});
it.each(['denied', 'checking', 'error'])('does not request corpus evidence without allowed scope: %s', async access => {
  await mount({ ...allowed, access: access as typeof allowed.access }); expect(rpc).not.toHaveBeenCalled(); expect(read.page.data).toBeUndefined();
});
it('clears evidence during refresh and after failure instead of showing cached success', async () => {
  await mount(); let finish: (v: unknown) => void = () => {};
  rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { finish = resolve; }) }));
  await act(async () => read.page.refresh()); await flush(); expect(read.page.data).toBeUndefined();
  finish({ data: null, error: { code: '55000' } }); await flush(); expect(read.page.error).toBe(true); expect(read.page.data).toBeUndefined();
});
it('refuses the whole existing Operator scope on 42501 and labels missing RPC unavailable', async () => {
  rpc.mockImplementation(() => answer(null, { code: '42501' })); await mount(); expect(refused).toHaveBeenCalledWith('test-operator', 1);
  rpc.mockImplementation(() => answer(null, { code: 'PGRST202' })); await act(async () => read.page.refresh()); await flush(); expect(read.page.unavailable).toBe(true);
});
it('rejects malformed RPC evidence rather than exposing a synthetic fallback', async () => {
  rpc.mockImplementation(() => answer({ ...canonical, contract_version: 2 })); await mount(); expect(read.page.error).toBe(true); expect(read.page.data).toBeUndefined();
});
it('fences late old-actor reads and resets paging across authority epochs', async () => {
  await mount(); let finish: (v: unknown) => void = () => {};
  rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { finish = resolve; }) }));
  await act(async () => read.page.refresh()); await flush(); const oldFinish = finish;
  await act(async () => root.render(<QueryClientProvider client={cache}><Probe scope={{ ...allowed, subject: 'test-operator-b', epoch: 2 }} /></QueryClientProvider>));
  oldFinish({ data: canonical, error: null }); await flush(); expect(read.page.data).toBeUndefined(); expect(read.cursor).toBeNull();
});
