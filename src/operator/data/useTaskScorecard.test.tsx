import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import canonical from '@/test/fixtures/canonical-task-scorecard.json';
import { useTaskScorecard } from './useTaskScorecard';
import type { TaskScorecardRead } from './taskScorecardContract';
import { summarizeEvaluatorVerdicts } from '../../../supabase/functions/_shared/eval/trajectory-registry';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
let read: TaskScorecardRead; let root: Root; let host: HTMLDivElement; let cache: QueryClient;
const refused = vi.fn();
const allowed = { subject: 'test-operator', epoch: 1, access: 'allowed' as const };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function oneRun() {
  const page = structuredClone(canonical.v2); page.items = [page.items.find(i => i.mode === 'observation')!];
  page.sample = { evaluations: 1, task_subjects: 1, observations: 1, replays: 0 }; page.next_cursor = null;
  for (const c of page.criteria) Object.assign(c, summarizeEvaluatorVerdicts(page.items[0].results.filter(r => r.scorer === c.scorer).map(r => r.verdict) as Parameters<typeof summarizeEvaluatorVerdicts>[0]));
  return page;
}
function Probe({ scope = allowed }: { scope?: typeof allowed }) { read = useTaskScorecard(scope, refused); return <span>{read.page.data?.sample.evaluations}</span>; }
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); }
async function mount(scope = allowed) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={cache}><Probe scope={scope} /></QueryClientProvider>)); await flush();
}
const answer = (data: unknown, error: unknown = null) => ({ abortSignal: () => Promise.resolve({ data, error }) });
beforeEach(() => { rpc.mockReset(); refused.mockReset(); rpc.mockImplementation(() => answer(canonical.v2)); });
afterEach(async () => { if (root) await act(async () => root.unmount()); cache?.clear(); host?.remove(); });
it('reads the released versioned RPC and preserves evidence denominators', async () => {
  await mount(); expect(rpc).toHaveBeenCalledWith('operator_intelligence_task_scorecard', expect.objectContaining({ p_set_version: '1.1.0', p_limit: 25 }));
  expect(read.page.data?.criteria.find(c => c.scorer === 'approval_decision')?.criterion_pass_rate).toBeNull();
  expect(read.page.data?.sample).toEqual(canonical.v2.sample);
});
it('hides a malformed projection and stale evidence after failed refresh', async () => {
  await mount(); rpc.mockImplementation(() => answer({ ...canonical.v2, contract_version: 2 }));
  await act(async () => read.page.refresh()); await flush(); expect(read.page.error).toBe(true); expect(read.page.data).toBeUndefined();
});
it('calls only the selected canonical work and reads back the recorded evaluation', async () => {
  await mount(); const single = oneRun(); const item = single.items[0];
  rpc.mockImplementation((name: string, args: { p_run_id?: string }) => name === 'operator_intelligence_evaluate_task'
    ? answer({ run_ref: item.run_ref }) : answer(args.p_run_id ? single : canonical.v2));
  await act(async () => { void read.evaluate({ version: '1.1.0', workId: item.work_ref }); }); await flush();
  expect(rpc).toHaveBeenCalledWith('operator_intelligence_evaluate_task', { p_work_id: item.work_ref, p_replay_run_id: null, p_set_version: '1.1.0' });
  expect(rpc).toHaveBeenCalledWith('operator_intelligence_task_scorecard', expect.objectContaining({ p_run_id: item.run_ref }));
  expect(read.action.status).toBe('recorded'); expect(read.action.item?.run_ref).toBe(item.run_ref);
});
it('keeps a committed write unconfirmed when its source readback fails', async () => {
  await mount(); rpc.mockImplementation((name: string) => name === 'operator_intelligence_evaluate_task' ? answer({ run_ref: canonical.v2.items[0].run_ref }) : answer(null, { code: '22023' }));
  await act(async () => { await read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); });
  expect(read.action.status).toBe('unconfirmed'); expect(read.action.message).not.toContain('No evaluation was recorded');
});
it('does not issue writes while Operator authority is absent', async () => {
  await mount({ ...allowed, access: 'denied' as typeof allowed.access });
  await act(async () => { await read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); }); expect(rpc).not.toHaveBeenCalled();
});
it('refuses mismatched work/mode provenance even when a run ID was returned', async () => {
  await mount(); rpc.mockImplementation((name: string) => name === 'operator_intelligence_evaluate_task' ? answer({ run_ref: canonical.v2.items[0].run_ref }) : answer(oneRun()));
  await act(async () => { await read.evaluate({ version: '1.1.0', workId: '10000000-0000-4000-8000-000000000001' }); });
  expect(read.action.status).toBe('unconfirmed'); expect(read.action.item).toBeUndefined();
});
it('never retries an uncertain write and blocks duplicate evaluation until refreshed', async () => {
  await mount(); rpc.mockImplementation(() => ({ abortSignal: () => Promise.reject(new Error('connection lost')) }));
  await act(async () => { await read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); });
  expect(read.action.status).toBe('unconfirmed'); const calls = rpc.mock.calls.length;
  await act(async () => { await read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); }); expect(rpc.mock.calls.length).toBe(calls);
  rpc.mockImplementation(() => answer(canonical.v2)); await act(async () => read.page.refresh()); await flush(); expect(read.action.status).toBe('idle');
});
it('stop waiting fences a late response without claiming rollback', async () => {
  await mount(); let finish: (v: unknown) => void = () => {};
  rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { finish = resolve; }) }));
  await act(async () => { void read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); });
  await act(async () => read.stopWaiting()); expect(read.action.status).toBe('unconfirmed');
  finish({ data: { run_ref: canonical.v2.items[0].run_ref }, error: null }); await flush(); expect(read.action.item).toBeUndefined();
});
it('refuses the entire Operator scope on scorecard authority loss', async () => {
  rpc.mockImplementation(() => answer(null, { code: '42501' })); await mount();
  expect(refused).toHaveBeenCalledWith('test-operator', 1); expect(read.page.data).toBeUndefined();
});
it('uses both server cursor anchors and resets the cursor on version change', async () => {
  await mount(); const cursor = { at: canonical.v2.items.at(-1)!.created_at, id: canonical.v2.items.at(-1)!.run_ref };
  await act(async () => read.pageOlder(cursor)); await flush();
  expect(rpc).toHaveBeenLastCalledWith('operator_intelligence_task_scorecard', expect.objectContaining({ p_before_at: cursor.at, p_before_id: cursor.id }));
  rpc.mockImplementation(() => answer(canonical.v1)); await act(async () => read.selectVersion('1.0.0')); await flush();
  expect(rpc).toHaveBeenLastCalledWith('operator_intelligence_task_scorecard', expect.objectContaining({ p_set_version: '1.0.0', p_before_at: null, p_before_id: null }));
});
it('does not expose an old account result after scope changes', async () => {
  await mount(); let finish: (v: unknown) => void = () => {};
  rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { finish = resolve; }) }));
  await act(async () => { void read.evaluate({ version: '1.1.0', workId: canonical.v2.items[0].work_ref }); });
  await act(async () => root.render(<QueryClientProvider client={cache}><Probe scope={{ ...allowed, subject: 'test-operator-b', epoch: 2 }} /></QueryClientProvider>));
  finish({ data: { run_ref: canonical.v2.items[0].run_ref }, error: null }); await flush(); expect(read.action.item).toBeUndefined(); expect(read.action.status).toBe('idle');
});
