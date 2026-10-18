// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetExceeded, enforceBudget } from '../../supabase/functions/_shared/router-budget/mod';

type Row = Record<string, unknown>;
type ResearchModule = { researchCompletion: (...args: unknown[]) => Promise<{ resp: unknown; route: Row | null }> };
type StrategyModule = { strategizeBeforeReasoning: (...args: unknown[]) => Promise<Row> };
// Execute complete incumbent modules. Only IO/budget reads/trace sinks are ports;
// candidate order, fallback classification and both provider translators are real.
function moduleAt<T = Row>(path: string, ports: Row = {}, flag?: boolean): T {
  let text = readFileSync(`supabase/functions/${path}`, 'utf8');
  if (flag !== undefined) text = text.replace('export const RESEARCH_FABRIC_ENABLED: boolean = false;', `export const RESEARCH_FABRIC_ENABLED: boolean = ${flag};`);
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const source = ast.statements.filter(n => !ts.isImportDeclaration(n) && !(ts.isExportDeclaration(n) && n.moduleSpecifier)).map(n => n.getText(ast)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Row = {};
  new Function('exports', ...Object.keys(ports), js)(exports, ...Object.values(ports));
  return exports as T;
}

const tenant = 'aa000000-0000-4000-8000-000000000002';
const run = '00000000-0000-4000-8000-000000000004';
const body = { messages: [{ role: 'system', content: 'Use only cited evidence.' }, { role: 'user', content: 'Controlled public fixture [1].' }], max_tokens: 700, response_format: { type: 'json_object' } };
const strategyText = JSON.stringify({ decomposition: ['Inspect evidence'], approach: 'Use the supplied sources', risks: [], successCriteria: ['Citations agree'] });
const phases = ['hop_query_planner', 'unit_planner', 'unit_synthesis', 'dossier_synthesis'] as const;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options: { primaryStatus?: number; budget?: () => Promise<number>; transport?: (signal: AbortSignal) => Promise<Response>; recall?: () => Promise<Row[]> } = {}) {
  const calls: Row[] = []; const traces: Row[] = [];
  const traceLLMCall = (row: Row) => { traces.push(row); };
  const fetchPort = vi.fn(async (url: string, init: RequestInit) => {
    const provider = url.includes('anthropic') ? 'anthropic' : 'openai';
    const requestBody = JSON.parse(String(init.body));
    calls.push({ provider, body: requestBody, signal: init.signal });
    if (options.transport) return options.transport(init.signal as AbortSignal);
    if (provider === 'openai' && options.primaryStatus) return Response.json({ error: { type: 'fixture', message: 'Controlled rejection' } }, { status: options.primaryStatus });
    return provider === 'openai' ? Response.json({ status: 'completed', model: `${requestBody.model}-fixture`, output: [{ type: 'message', content: [{ type: 'output_text', text: strategyText }] }], usage: { input_tokens: 13, output_tokens: 4, input_tokens_details: { cached_tokens: 5 } } })
      : Response.json({ model: 'claude-sonnet-5-5-fixture', content: [{ type: 'text', text: strategyText }], stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } });
  });
  const constants = { ...moduleAt('_shared/openai-models.ts'), ...moduleAt('_shared/claude-models.ts') };
  const failures = moduleAt('_shared/provider-failure.ts'); const types = moduleAt('_shared/provider-types.ts');
  const budget = { traceAdmin: () => ({}), resolveCeiling: async () => 10, accruedSpendToday: options.budget ?? (async () => 0), BudgetExceeded, enforceBudget };
  const ports = { ...constants, ...failures, ...types, ...budget, Deno: { env: { get: (key: string) => key.endsWith('API_KEY') ? 'controlled-not-a-secret' : undefined } }, fetch: fetchPort, traceLLMCall };
  const claude = moduleAt('_shared/claude.ts', ports);
  const openai = moduleAt('_shared/openai-responses.ts', { ...ports, envKey: () => 'controlled-not-a-secret', assertModelAllowed: () => {} });
  const policy = moduleAt('_shared/paige-turn/route.ts', constants);
  const fabric = moduleAt('_shared/model-fabric.ts', { ...ports, ...claude, ...openai, ...policy });
  const legacy = vi.fn(async (_job?: unknown, _body?: unknown, _trace?: unknown) => ({ model: 'controlled-legacy', choices: [{ message: { content: strategyText } }] }));
  const adapter = (flag: boolean) => moduleAt<ResearchModule>('paige-deep-research/fabric.ts', { routedChatCompletion: legacy, fabricCompletion: fabric.fabricCompletion }, flag);
  const recall = vi.fn(options.recall ?? (async () => []));
  const strategist = moduleAt<StrategyModule>('_shared/reasoning/strategize.ts', { routedChatCompletion: legacy, fabricCompletion: fabric.fabricCompletion, recallSimilar: recall });
  return { calls, traces, legacy, recall, adapter, strategist };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Research prepared Fabric uses actual shared attempts and recording transports', () => {
  it.each(phases)('%s forwards native scope and the same signal before provider dispatch', async phase => {
    const test = fixture(); const signal = new AbortController().signal;
    const gate = vi.fn(async () => false);
    await expect(test.adapter(true).researchCompletion(phase, phase.endsWith('synthesis') ? 'operational' : 'cheap', body, { tenantId: tenant, runId: run, beforeProviderAttempt: gate, signal })).rejects.toThrow('research_fabric_route_failed');
    expect(gate).toHaveBeenCalledOnce(); expect(test.calls).toHaveLength(0); expect(test.legacy).not.toHaveBeenCalled();
  });
  it('primary success retains exact JSON/output limit, actual served route and cache trace', async () => {
    const test = fixture(); const signal = new AbortController().signal; const gate = vi.fn(async () => true);
    const result = await test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, signal, beforeProviderAttempt: gate });
    expect(test.calls.map(c => c.provider)).toEqual(['openai']); expect(test.calls[0].signal).toBe(signal);
    expect(test.calls[0].body).toMatchObject({ store: false, max_output_tokens: 700, text: { format: { type: 'json_object' } } });
    expect(result.route).toMatchObject({ served_provider: 'openai', served_model: 'gpt-6.1-sol-fixture', fallback: false });
    expect(test.traces).toHaveLength(1); expect(test.traces[0]).toMatchObject({ tenant_id: tenant, task_id: run, job_kind: 'research_unit_synthesis', cache_read_input_tokens: 5, tokens_in: 8 });
  });
  it('revocation during the actual Fabric budget wait prevents first provider', async () => {
    const wait = deferred<number>(); let allowed = true; const test = fixture({ budget: () => wait.promise });
    const task = test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => allowed });
    const result = expect(task).rejects.toThrow('research_fabric_route_failed'); allowed = false; wait.resolve(0); await result;
    expect(test.calls).toHaveLength(0);
  });
  it('abort during an unresolved budget read settles the Research caller without late dispatch', async () => {
    const entered = deferred<void>(); const wait = deferred<number>(); const abort = new AbortController();
    const test = fixture({ budget: () => { entered.resolve(); return wait.promise; } });
    const task = test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, signal: abort.signal, beforeProviderAttempt: async () => true });
    const outcome = task.then(() => 'unexpected-success', () => 'stopped');
    await entered.promise; abort.abort();
    const settled = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('still-pending'), 40))]);
    wait.resolve(0); await outcome;
    expect(settled).toBe('stopped'); expect(test.calls).toHaveLength(0);
  });
  it('fresh authority blocks fallback after primary health failure', async () => {
    const test = fixture({ primaryStatus: 503 }); let checks = 0;
    await expect(test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => ++checks === 1 })).rejects.toThrow('research_fabric_route_failed');
    expect(checks).toBe(2); expect(test.calls.map(c => c.provider)).toEqual(['openai']);
  });
  it('allowed fallback uses actual Anthropic cache accounting without a second router trace', async () => {
    const test = fixture({ primaryStatus: 503 });
    const result = await test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => true });
    expect(test.calls.map(c => c.provider)).toEqual(['openai', 'anthropic']);
    expect((test.calls[1].body as Row).cache_control).toEqual({ type: 'ephemeral' });
    expect(result.route).toMatchObject({ served_provider: 'anthropic', fallback: true });
    expect(test.traces).toHaveLength(2); expect(test.traces[1]).toMatchObject({ cache_read_input_tokens: 5, cache_creation_input_tokens: 2 });
  });
  it.each([400, 422])('invalid/unknown primary %s is not retried elsewhere', async primaryStatus => {
    const test = fixture({ primaryStatus });
    await expect(test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => true })).rejects.toThrow();
    expect(test.calls.map(c => c.provider)).toEqual(['openai']);
  });
  it('real abort signal reaches pending provider and prevents fallback', async () => {
    const abort = new AbortController();
    const test = fixture({ transport: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Controlled abort', 'AbortError')), { once: true })) });
    const task = test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, signal: abort.signal, beforeProviderAttempt: async () => true });
    const rejected = expect(task).rejects.toThrow();
    await vi.waitFor(() => expect(test.calls).toHaveLength(1)); expect(test.calls[0].signal).toBe(abort.signal); abort.abort(); await rejected;
    expect(test.calls.map(c => c.provider)).toEqual(['openai']);
  });
  it('legacy false gate keeps original exact job/body/trace and never claims transport cancellation', async () => {
    const test = fixture(); const signal = AbortSignal.abort(); const gate = vi.fn(async () => false);
    const result = await test.adapter(false).researchCompletion('hop_query_planner', 'cheap', { ...body, fabricEnabled: true }, { tenantId: tenant, runId: run, beforeProviderAttempt: gate, signal });
    expect(test.legacy).toHaveBeenCalledWith('extract', { ...body, fabricEnabled: true }, { tenant_id: tenant, task_id: run, agent_id: 'paige-deep-research', job_kind: 'research_hop_planner' });
    expect(gate).not.toHaveBeenCalled(); expect(test.calls).toHaveLength(0); expect(result.route).toBeNull();
  });
  it('hard reasoning budget is terminal before either transport', async () => {
    const test = fixture({ budget: async () => 10 });
    await expect(test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => true })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(test.calls).toHaveLength(0); expect(test.traces).toHaveLength(1); expect(test.traces[0].error_class).toBe('budget_exceeded');
  });
  it('pre-aborted and throwing authority calls never enter provider fallback', async () => {
    for (const ctx of [{ signal: AbortSignal.abort(), beforeProviderAttempt: async () => true }, { beforeProviderAttempt: async () => { throw Error('Controlled authority unavailable'); } }]) {
      const test = fixture();
      await expect(test.adapter(true).researchCompletion('unit_synthesis', 'operational', body, { tenantId: tenant, runId: run, ...ctx })).rejects.toThrow();
      expect(test.calls).toHaveLength(0);
    }
  });
  it('cheap planner request inherits actual Luna class policy rather than a Research model override', async () => {
    const test = fixture(); await test.adapter(true).researchCompletion('hop_query_planner', 'cheap', body, { tenantId: tenant, runId: run, beforeProviderAttempt: async () => true });
    expect(test.calls[0].body).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 700, reasoning: { effort: 'none' } });
  });
});

describe('shared strategist remains behind the original Research release flag', () => {
  it('enabled existing consumer uses operational Fabric with original strategy trace', async () => {
    const test = fixture(); const signal = new AbortController().signal;
    const result = await test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, taskId: run, fabricEnabled: true, signal, beforeProviderAttempt: async () => true });
    expect(result.degraded).toBe(false); expect(test.legacy).not.toHaveBeenCalled(); expect(test.calls.map(c => c.provider)).toEqual(['openai']);
    expect(test.calls[0].signal).toBe(signal); expect(test.traces[0]).toMatchObject({ agent_id: 'paige-strategist', job_kind: 'reason:strategize', task_id: run });
  });
  it('false/default consumer retains legacy route and conservative parsing', async () => {
    const test = fixture(); const result = await test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, fabricEnabled: false });
    expect(result.degraded).toBe(false); expect(test.legacy.mock.calls[0][0]).toBe('plan'); expect(test.calls).toHaveLength(0);
  });
  it('refused initial scope cannot start recall or a model', async () => {
    const test = fixture(); const result = await test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, fabricEnabled: true, beforeProviderAttempt: async () => false });
    expect(result.degraded).toBe(true); expect(test.recall).not.toHaveBeenCalled(); expect(test.calls).toHaveLength(0); expect(test.legacy).not.toHaveBeenCalled();
  });
  it('scope revoked while recall awaits cannot pass recalled anchors to any model', async () => {
    const wait = deferred<Row[]>(); let allowed = true; const test = fixture({ recall: () => wait.promise });
    const task = test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, fabricEnabled: true, beforeProviderAttempt: async () => allowed });
    await vi.waitFor(() => expect(test.recall).toHaveBeenCalledOnce()); allowed = false; wait.resolve([{ user_intent: 'foreign-marker' }]);
    expect((await task).degraded).toBe(true); expect(test.calls).toHaveLength(0); expect(test.legacy).not.toHaveBeenCalled();
  });
  it('aborted pending recall settles and its later continuation cannot dispatch', async () => {
    const wait = deferred<Row[]>(); const abort = new AbortController(); const test = fixture({ recall: () => wait.promise });
    const task = test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, fabricEnabled: true, signal: abort.signal, beforeProviderAttempt: async () => true });
    await vi.waitFor(() => expect(test.recall).toHaveBeenCalledOnce()); abort.abort();
    const settled = await Promise.race([task, new Promise(resolve => setTimeout(() => resolve('still-pending'), 40))]);
    expect(settled).not.toBe('still-pending'); wait.resolve([{ user_intent: 'late-anchor' }]); await task;
    expect(test.calls).toHaveLength(0); expect(test.legacy).not.toHaveBeenCalled();
  });
  it('aborted deferred authority settles before recall and late true cannot dispatch', async () => {
    const wait = deferred<boolean>(); const abort = new AbortController(); const test = fixture(); const gate = vi.fn(() => wait.promise);
    const task = test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, fabricEnabled: true, signal: abort.signal, beforeProviderAttempt: gate });
    await vi.waitFor(() => expect(gate).toHaveBeenCalledOnce()); abort.abort(); expect((await task).degraded).toBe(true);
    wait.resolve(true); await Promise.resolve(); expect(test.recall).not.toHaveBeenCalled(); expect(test.calls).toHaveLength(0);
  });
  it('strategy authority revoked during the actual shared budget wait prevents primary', async () => {
    const entered = deferred<void>(); const wait = deferred<number>(); let allowed = true;
    const test = fixture({ budget: () => { entered.resolve(); return wait.promise; } });
    const task = test.strategist.strategizeBeforeReasoning({ task: 'Controlled public research', tenantId: tenant, taskId: run, fabricEnabled: true, beforeProviderAttempt: async () => allowed });
    await entered.promise; allowed = false; wait.resolve(0); expect((await task).degraded).toBe(true); expect(test.calls).toHaveLength(0);
  });
});
