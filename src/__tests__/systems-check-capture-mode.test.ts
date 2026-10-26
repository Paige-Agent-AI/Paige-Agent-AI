// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execute the entire original core. Only its actually declared runtime import is
// supplied at the model port; undeclared or newly added imports fail this harness.
const source = readFileSync(resolve('supabase/functions/_shared/systems-check-runner.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
if (compiled.diagnostics?.length) throw new Error('Original core did not compile');
const forge = vi.fn();
const imports: string[] = [];
const loaded: Record<string, unknown> = {};
new Function('exports', 'require', compiled.outputText)(loaded, (name: string) => {
  imports.push(name);
  if (name !== './prompt-forge.ts') throw new Error('Unbound original dependency: ' + name);
  return { forge };
});
expect(imports).toEqual(['./prompt-forge.ts']);

// Load the thin adapter against this SAME whole original Core, not a replacement
// runner. Native RPC replies are controlled transport fixtures; original native
// SQL/permissions are covered separately and this is not authenticated acceptance.
const adapterSource = readFileSync(resolve('supabase/functions/_shared/systems-check-manual-work.ts'), 'utf8');
const adapterCompiled = ts.transpileModule(adapterSource, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
if (adapterCompiled.diagnostics?.length) throw new Error('Original Systems adapter did not compile');
const adapterLoaded: Record<string, unknown> = {};
new Function('exports', 'require', adapterCompiled.outputText)(adapterLoaded, (name: string) => {
  if (name !== './systems-check-runner.ts') throw new Error('Unbound adapter dependency: ' + name);
  return loaded;
});
const consumeWork = adapterLoaded.consumeManualSystemsCheckWork as (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Summary = { run_id: string; check_count: number; pass_count: number; fail_count: number; skip_count: number; error_count: number; actions_filed: number; findings: Array<{ finding_id: string; resolution_action_id: string | null; status: string }> };
const run = loaded.runSystemsCheck as (options: Record<string, unknown>) => Promise<Summary>;
const TENANT = 'b4000000-0000-4000-8000-000000001111';
const RUN = 'b4000000-0000-4000-8000-00000000a001';
const captureUuid = vi.fn((): ReturnType<Crypto['randomUUID']> => RUN);
const PRIOR = 'b4000000-0000-4000-8000-00000000a002';
const MANUAL_PRIOR = 'b4000000-0000-4000-8000-00000000a003';
const ACTION = 'b4000000-0000-4000-8000-00000000c001';
type Call = { table: string; operation: 'read' | 'insert' | 'update'; payload?: Record<string, unknown>; selected?: string; filters: unknown[][]; signal?: AbortSignal };
type Result = { data: unknown; error: { message: string } | null };
type Query = {
  select(columns?: string): Query; insert(payload: Record<string, unknown>): Query; update(payload: Record<string, unknown>): Query;
  eq(...args: unknown[]): Query; neq(...args: unknown[]): Query; not(...args: unknown[]): Query; is(...args: unknown[]): Query;
  in(...args: unknown[]): Query; order(...args: unknown[]): Query; limit(...args: unknown[]): Query;
  abortSignal(signal: AbortSignal): Query;
  maybeSingle(): Promise<Result>; single(): Promise<Result>; then(fulfilled: (result: Result) => unknown, rejected?: (error: unknown) => unknown): Promise<unknown>;
};

function fixture(statuses: string[] = ['fail'], options: {
  previous?: string; manualBaseline?: string; scope?: 'tenant' | 'operator'; catalogError?: boolean; insertError?: boolean;
  findingError?: boolean; missing?: boolean; throws?: boolean; finalizeError?: boolean; finalizeNoop?: boolean;
  findingReadError?: boolean; runReadError?: boolean; findingReadPatch?: Record<string, unknown>;
  runReadPatch?: Record<string, unknown>; findingRows?: 'missing' | 'duplicate'; findingWriteLostAck?: boolean;
  finalizeLostAck?: boolean; runInsertLostAck?: boolean; runInsertResponse?: unknown;
  pauseResponse?: (call: Readonly<Call>) => Promise<void>;
  pauseRunner?: () => Promise<void>;
} = {}) {
  const calls: Call[] = [], rpcs: Array<{ name: string; input: Record<string, unknown> }> = [], dispatched: Record<string, unknown>[] = [];
  let finding = 0;
  let savedRun: Record<string, unknown> | null = null;
  const savedFindings: Array<Record<string, unknown>> = [];
  const rows = statuses.map((status, index) => ({ check_id: 'check_' + index, runner_key: 'runner_' + index, check_name: 'Recorded check ' + index, domain: 'data_product', severity: 'medium', department: 'operations_pmo', data_source: 'original_source', nl_prompt: null, remediation_prompt: 'Review {{tenant.business_name}}', priority: index, status }));
  const admin = {
    from(table: string) {
      const call: Call = { table, operation: 'read', filters: [] }; calls.push(call);
      const answer = (): Result => {
        if (table === 'tenants') return { data: { name: 'Example Services' }, error: null };
        if (table === 'paige_systems_check_registry') {
          if (options.catalogError) return { data: null, error: { message: 'Source unavailable' } };
          const filter = call.filters.find(item => item[0] === 'in' && item[1] === 'runner_key');
          const selected = filter ? rows.filter(row => (filter[2] as string[]).includes(row.runner_key)) : rows;
          // The real registry SELECT returns no observation status. Only dispatch supplies it.
          return { data: selected.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'status'))), error: null };
        }
        if (table === 'paige_systems_check_run' && call.operation === 'read') {
          if (!call.filters.some(item => item[0] === 'eq' && item[1] === 'id' && item[2] === (savedRun?.id ?? RUN))) {
            const manualExcluded = call.filters.some(item => item[0] === 'neq' && item[1] === 'scan_flavor' && item[2] === 'manual');
            return { data: options.manualBaseline && !manualExcluded ? { id: MANUAL_PRIOR } : options.previous ? { id: PRIOR } : null, error: null };
          }
          if (options.runReadError) return { data: null, error: { message: 'Synthetic read unavailable' } };
          return { data: savedRun ? { ...savedRun, ...options.runReadPatch } : null, error: null };
        }
        if (table === 'paige_systems_check_finding' && call.operation === 'read') {
          if (!call.filters.some(item => item[0] === 'eq' && item[1] === 'run_id' && item[2] === (savedRun?.id ?? RUN))) {
            const manual = call.filters.some(item => item[0] === 'eq' && item[1] === 'run_id' && item[2] === MANUAL_PRIOR);
            return { data: rows.map(row => ({ check_id: row.check_id, status: manual ? options.manualBaseline : options.previous })), error: null };
          }
          if (options.findingReadError) return { data: null, error: { message: 'Synthetic read unavailable' } };
          const persisted = savedFindings.map((row, index) => ({ ...row, ...(index === 0 ? options.findingReadPatch : {}) }));
          return { data: options.findingRows === 'missing' ? persisted.slice(1) : options.findingRows === 'duplicate' ? persisted.map(() => persisted[0]) : persisted, error: null };
        }
        if (call.operation === 'insert' && table === 'paige_systems_check_run') {
          if (options.insertError) return { data: null, error: { message: 'Write unavailable' } };
          // The original table accepts an explicitly supplied primary key. Keep
          // this native INSERT behavior separate from any worker's authority.
          savedRun = { ...call.payload, id: call.payload?.id ?? RUN, completed_at: null };
          if (options.runInsertLostAck) throw new Error('Synthetic acknowledgement lost after run insert');
          return { data: Object.prototype.hasOwnProperty.call(options, 'runInsertResponse') ? options.runInsertResponse : { id: savedRun.id }, error: null };
        }
        if (call.operation === 'insert' && table === 'paige_systems_check_finding') {
          if (options.findingError) return { data: null, error: { message: 'Finding write unavailable' } };
          const id = `b4000000-0000-4000-8000-${String(++finding).padStart(12, '0')}`;
          savedFindings.push({ ...call.payload, id, resolution_action_id: null });
          if (options.findingWriteLostAck) throw new Error('Synthetic acknowledgement lost after write');
          return { data: { id }, error: null };
        }
        if (call.operation === 'update') {
          if (table === 'paige_systems_check_run') {
            if (options.finalizeError) return { data: null, error: { message: 'Synthetic finalization unavailable' } };
            if (!options.finalizeNoop) Object.assign(savedRun!, call.payload);
            if (options.finalizeLostAck) throw new Error('Synthetic acknowledgement lost after finalization');
          }
          return { data: null, error: null };
        }
        throw new Error('Unbound original source operation: ' + table);
      };
      const respond = async (): Promise<Result> => {
        // Commit the original operation BEFORE withholding its acknowledgement.
        // Deliberately ignore cancellation: late source replies must be safe too.
        const result = answer();
        await options.pauseResponse?.(call);
        return result;
      };
      const query: Query = {
        select(columns?: string) { call.selected = columns; return query; }, insert(payload: Record<string, unknown>) { call.operation = 'insert'; call.payload = payload; return query; }, update(payload: Record<string, unknown>) { call.operation = 'update'; call.payload = payload; return query; },
        eq(...args: unknown[]) { call.filters.push(['eq', ...args]); return query; }, neq(...args: unknown[]) { call.filters.push(['neq', ...args]); return query; }, not(...args: unknown[]) { call.filters.push(['not', ...args]); return query; }, is(...args: unknown[]) { call.filters.push(['is', ...args]); return query; },
        in(...args: unknown[]) { call.filters.push(['in', ...args]); return query; }, order(...args: unknown[]) { call.filters.push(['order', ...args]); return query; }, limit(...args: unknown[]) { call.filters.push(['limit', ...args]); return query; },
        abortSignal(signal: AbortSignal) { call.signal = signal; return query; },
        maybeSingle: respond, single: respond, then: (fulfilled, rejected) => respond().then(fulfilled, rejected),
      };
      return query;
    },
    async rpc(name: string, input: Record<string, unknown>) { rpcs.push({ name, input }); return { data: { ok: true, action_id: ACTION }, error: null }; },
  };
  const dispatch = Object.fromEntries(rows.filter(() => !options.missing).map(row => [row.runner_key, async (context: Record<string, unknown>) => {
    dispatched.push(context);
    await options.pauseRunner?.();
    if (options.throws) throw new Error('Original source failed');
    return { status: row.status, evidence: { source: 'original_record' }, interpretation: 'Recorded observation' };
  }]));
  const scope = options.scope ?? 'tenant';
  const base = { admin, tenantId: scope === 'tenant' ? TENANT : null, scope, scanFlavor: 'onboarding', dispatch };
  return { admin, dispatch, calls, rpcs, dispatched, persisted: () => ({ run: savedRun, findings: savedFindings }), execute: (extra: Record<string, unknown> = {}) => run({ ...base, ...extra }), inserted: (table: string) => calls.filter(call => call.table === table && call.operation === 'insert'), updated: (table: string) => calls.filter(call => call.table === table && call.operation === 'update') };
}
beforeEach(() => {
  vi.restoreAllMocks(); captureUuid.mockClear();
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(captureUuid);
  forge.mockReset().mockResolvedValue({ result: { content: 'Synthetic original draft', needs_config: false, model: 'synthetic' } });
});

describe('Unused manual capture purpose does not grant invocation or remediation', () => {
  it.each([undefined, 'all', 'delta'])('refuses manual remediation mode %j before every source/effect', async actionFiling => {
    const h = fixture();
    await expect(h.execute({ scanFlavor: 'manual', actionFiling })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_CAPTURE_ONLY');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it('refuses an operator manual purpose before source reads or persistence', async () => {
    const h = fixture(['fail'], { scope: 'operator' });
    await expect(h.execute({ scanFlavor: 'manual', actionFiling: 'none' })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_TENANT_ONLY');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(h.rpcs).toEqual([]);
  });
  it('records the explicit tenant purpose without drafts or actions', async () => {
    const h = fixture(['pass', 'fail']);
    expect(await h.execute({ scanFlavor: 'manual', actionFiling: 'none' })).toMatchObject({ run_id: RUN, check_count: 2, actions_filed: 0 });
    expect(h.persisted().run).toMatchObject({ id: RUN, tenant_id: TENANT, scan_flavor: 'manual', selected_runner_keys: null, triggered_by: { scope: 'tenant', action_filing: 'none' } });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it('retains the original selected-runner marker for a partial manual capture', async () => {
    const h = fixture(['pass', 'fail']);
    expect(await h.execute({ scanFlavor: 'manual', actionFiling: 'none', runnerKeys: ['runner_0'] })).toMatchObject({ check_count: 1, actions_filed: 0 });
    expect(h.persisted().run).toMatchObject({ scan_flavor: 'manual', selected_runner_keys: ['runner_0'] });
    expect(h.dispatched).toHaveLength(1);
  });
  it.each([
    { previous: 'pass', manualBaseline: 'fail', actions: 1 },
    { previous: 'fail', manualBaseline: 'pass', actions: 0 },
    { previous: undefined, manualBaseline: 'fail', actions: 1 },
  ])('preserves the original scheduled delta decision with a newer manual record: %j', async scenario => {
    const h = fixture(['fail'], scenario);
    expect(await h.execute({ scanFlavor: 'scheduled', actionFiling: 'delta' })).toMatchObject({ actions_filed: scenario.actions });
    expect(h.rpcs).toHaveLength(scenario.actions); expect(forge).toHaveBeenCalledTimes(scenario.actions);
  });
});

describe('Original Systems capture mode: observations are separate from remediation', () => {
  it('records original pass/fail/skip/error findings without a model or action', async () => {
    const h = fixture(['pass', 'fail', 'skip', 'error']);
    const result = await h.execute({ actionFiling: 'none', triggeredBy: { source: 'synthetic_capture', scope: 'operator', action_filing: 'all' } });
    expect(result).toMatchObject({ run_id: RUN, check_count: 4, pass_count: 1, fail_count: 1, skip_count: 1, error_count: 1, actions_filed: 0 });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
    expect(h.inserted('paige_systems_check_finding')).toHaveLength(4);
    expect(h.dispatched).toHaveLength(4);
    for (const call of h.inserted('paige_systems_check_finding')) expect(call.payload).toMatchObject({ run_id: RUN, tenant_id: TENANT, evidence: { source: 'original_record' }, paige_drafted_fix: null });
    expect(h.inserted('paige_systems_check_run')[0].payload?.triggered_by).toEqual({ source: 'synthetic_capture', scope: 'tenant', action_filing: 'none' });
    expect(result.findings.every(item => item.finding_id && item.resolution_action_id === null)).toBe(true);
    expect(h.updated('paige_systems_check_run')[0].payload).toMatchObject({ check_count: 4, pass_count: 1, fail_count: 1 });
    expect(h.dispatched.every(context => context.tenantId === TENANT && context.scope === 'tenant')).toBe(true);
    expect(h.calls.find(call => call.table === 'paige_systems_check_registry')?.filters).toContainEqual(['eq', 'scope', 'tenant']);
  });
  it.each([{ runnerKeys: ['runner_0'] }, { runnerKeys: [] }])('retains the original subset marker for %j', async ({ runnerKeys }) => {
    const h = fixture(['fail', 'fail']); const result = await h.execute({ actionFiling: 'none', runnerKeys });
    expect(result.check_count).toBe(runnerKeys.length || 2);
    expect(h.inserted('paige_systems_check_run')[0].payload?.selected_runner_keys).toEqual(runnerKeys.length ? runnerKeys : null);
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it('does not invent a passing check for an empty catalog', async () => {
    const h = fixture([]); expect(await h.execute({ actionFiling: 'none' })).toMatchObject({ check_count: 0, pass_count: 0, fail_count: 0, actions_filed: 0, findings: [] });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it.each([{ missing: true }, { throws: true }])('records an actual source error instead of a pass: %j', async option => {
    const h = fixture(['fail'], option); const result = await h.execute({ actionFiling: 'none' });
    expect(result).toMatchObject({ error_count: 1, pass_count: 0, fail_count: 0, actions_filed: 0 });
    expect(h.inserted('paige_systems_check_finding')[0].payload?.status).toBe('error'); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it('fails loudly before allocating a capture identity when the catalog cannot be read', async () => {
    const h = fixture(['fail'], { catalogError: true }); await expect(h.execute({ actionFiling: 'none' })).rejects.toThrow('SYSTEMS_CHECK_CATALOG_READ_FAILED');
    expect(captureUuid).not.toHaveBeenCalled();
    expect(h.dispatched).toEqual([]); expect(h.inserted('paige_systems_check_finding')).toEqual([]); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it.each(['', 'NONE', 'audit', null, 37, {}, []])('refuses an unknown remediation mode before any source or effect: %j', async actionFiling => {
    const h = fixture(); await expect(h.execute({ actionFiling })).rejects.toThrow('SYSTEMS_CHECK_INVALID_ACTION_FILING');
    expect(h.calls).toEqual([]); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it.each([{ scope: 'tenant', tenantId: null }, { scope: 'operator', tenantId: TENANT }])('preserves the original scope refusal: %j', async scope => {
    const h = fixture(); await expect(h.execute({ actionFiling: 'none', ...scope })).rejects.toThrow(/SYSTEMS_CHECK_(NO_TENANT|OPERATOR_HAS_TENANT)/);
    expect(h.calls).toEqual([]); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it.each(['', 'TENANT', 37, null, {}])('refuses an unsupported scope before every source/effect: %j', async scope => {
    const h = fixture(); await expect(h.execute({ actionFiling: 'none', scope })).rejects.toThrow('SYSTEMS_CHECK_INVALID_SCOPE');
    expect(h.calls).toEqual([]); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it('does not fabricate a saved finding when its original insert fails', async () => {
    const h = fixture(['fail'], { findingError: true });
    await expect(h.execute({ actionFiling: 'none' })).rejects.toMatchObject({ runId: RUN, reason: 'finding_write' });
    expect(h.persisted().run?.completed_at).toBeNull(); expect(h.updated('paige_systems_check_run')).toEqual([]);
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
});

describe('Capture completion requires original persisted records, never acknowledgements alone', () => {
  const unknown = (reason: string) => ({ name: 'SystemsCheckCaptureUnconfirmed', message: 'SYSTEMS_CHECK_CAPTURE_UNCONFIRMED', runId: RUN, reason });
  it('allocates the original run identity before its first write and retains it through completion', async () => {
    const h = fixture(['pass']); expect(await h.execute({ actionFiling: 'none' })).toMatchObject({ run_id: RUN });
    expect(captureUuid).toHaveBeenCalledTimes(1);
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1);
    expect(h.inserted('paige_systems_check_run')[0].payload?.id).toBe(RUN);
    expect(h.persisted().run?.id).toBe(RUN);
  });
  it('does not send a run write if original identity allocation fails', async () => {
    captureUuid.mockImplementationOnce(() => { throw new Error('Synthetic UUID source unavailable'); });
    const h = fixture(['fail']); await expect(h.execute({ actionFiling: 'none' })).rejects.toThrow('Synthetic UUID source unavailable');
    expect(h.inserted('paige_systems_check_run')).toEqual([]); expect(h.dispatched).toEqual([]);
    expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it('keeps the same unknown original identity and null-tenant scope for an internal operator capture', async () => {
    const h = fixture(['fail'], { scope: 'operator', runInsertLostAck: true });
    await expect(h.execute({ actionFiling: 'none' })).rejects.toMatchObject(unknown('run_insert'));
    expect(h.persisted().run).toMatchObject({ id: RUN, tenant_id: null, completed_at: null });
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.dispatched).toEqual([]);
    expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it.each([
    { insertError: true }, { runInsertLostAck: true }, { runInsertResponse: null },
    { runInsertResponse: {} }, { runInsertResponse: { id: PRIOR } },
    { runInsertResponse: [{ id: RUN }] }, { runInsertResponse: { id: '' } },
  ])('retains the original identity on unconfirmed run insertion without dispatch or replay: %j', async option => {
    const h = fixture(['fail'], option);
    await expect(h.execute({ actionFiling: 'none' })).rejects.toMatchObject(unknown('run_insert'));
    expect(captureUuid).toHaveBeenCalledTimes(1);
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1);
    expect(h.inserted('paige_systems_check_run')[0].payload?.id).toBe(RUN);
    expect(h.dispatched).toEqual([]); expect(h.inserted('paige_systems_check_finding')).toEqual([]);
    expect(h.updated('paige_systems_check_run')).toEqual([]); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
    if ('runInsertLostAck' in option) expect(h.persisted().run).toMatchObject({ id: RUN, completed_at: null });
    if ('insertError' in option) expect(h.persisted().run).toBeNull();
  });
  it('reads back original run/findings with the same tenant scope and no remediation', async () => {
    const h = fixture(['pass', 'fail']); await h.execute({ actionFiling: 'none' });
    const reads = h.calls.filter(call => call.operation === 'read' && ['paige_systems_check_run', 'paige_systems_check_finding'].includes(call.table));
    expect(reads).toHaveLength(2);
    for (const call of reads) expect(call.filters).toContainEqual(['eq', 'tenant_id', TENANT]);
    expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it.each([
    ['finding_readback', { findingReadError: true }], ['finding_readback', { findingRows: 'missing' as const }],
    ['finding_readback', { findingRows: 'duplicate' as const }], ['finding_readback', { findingReadPatch: { tenant_id: ACTION } }],
    ['finding_readback', { findingReadPatch: { run_id: PRIOR } }], ['finding_readback', { findingReadPatch: { status: 'pass' } }],
    ['finding_readback', { findingReadPatch: { paige_drafted_fix: { content: 'Unexpected draft' } } }],
    ['finding_readback', { findingReadPatch: { resolution_action_id: ACTION } }],
    ['run_finalize', { finalizeError: true }], ['run_readback', { finalizeNoop: true }],
    ['run_readback', { runReadError: true }], ['run_readback', { runReadPatch: { tenant_id: ACTION } }],
    ['run_readback', { runReadPatch: { check_count: 99 } }], ['run_readback', { runReadPatch: { completed_at: null } }],
    ['run_readback', { runReadPatch: { triggered_by: { scope: 'tenant', action_filing: 'all' } } }],
  ] as const)('keeps the original identity and refuses unverified %s: %j', async (reason, options) => {
    const h = fixture(['fail', 'pass'], options);
    await expect(h.execute({ actionFiling: 'none' })).rejects.toMatchObject(unknown(reason));
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
    if (reason === 'finding_readback') expect(h.persisted().run?.completed_at).toBeNull();
  });
  it('uses original null-tenant readback for the explicit operator capture scope', async () => {
    const h = fixture(['fail'], { scope: 'operator' }); expect(await h.execute({ actionFiling: 'none' })).toMatchObject({ check_count: 1, actions_filed: 0 });
    const reads = h.calls.filter(call => call.operation === 'read' && ['paige_systems_check_run', 'paige_systems_check_finding'].includes(call.table));
    expect(reads).toHaveLength(2); for (const read of reads) expect(read.filters).toContainEqual(['is', 'tenant_id', null]);
    expect(h.persisted().run?.tenant_id).toBeNull(); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it.each([['finding_write', { findingWriteLostAck: true }], ['run_finalize', { finalizeLostAck: true }]] as const)('does not replay an uncertain %s acknowledgement', async (reason, option) => {
    const h = fixture(['fail'], option); await expect(h.execute({ actionFiling: 'none' })).rejects.toMatchObject(unknown(reason));
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.inserted('paige_systems_check_finding')).toHaveLength(1);
    expect(h.persisted().findings).toHaveLength(1); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it('keeps the original all-mode partial-persistence compatibility', async () => {
    const h = fixture(['fail'], { findingError: true }); expect(await h.execute()).toMatchObject({ findings: [{ finding_id: '' }] });
    expect(h.updated('paige_systems_check_run')).toHaveLength(1);
  });
  it.each([{ finalizeError: true }, { finalizeNoop: true }])('does not silently change existing remediation finalization behavior: %j', async option => {
    const h = fixture(['fail'], option); expect(await h.execute()).toMatchObject({ actions_filed: 1, fail_count: 1 });
    expect(forge).toHaveBeenCalledTimes(1); expect(h.rpcs).toHaveLength(1);
    expect(h.calls.filter(call => call.operation === 'read' && ['paige_systems_check_run', 'paige_systems_check_finding'].includes(call.table))).toEqual([]);
  });
});

describe('Existing remediation contracts remain active at their original ports', () => {
  it.each([{}, { actionFiling: 'all' }, { actionFiling: 'delta' }])('preserves database-assigned identity and initial errors for legacy %j', async choice => {
    const h = fixture(['pass']); expect(await h.execute(choice)).toMatchObject({ run_id: RUN });
    expect(h.inserted('paige_systems_check_run')[0].payload).not.toHaveProperty('id'); expect(captureUuid).not.toHaveBeenCalled();
    const refused = fixture(['pass'], { insertError: true });
    await expect(refused.execute(choice)).rejects.toThrow('SYSTEMS_CHECK_RUN_INSERT_FAILED');
    expect(refused.dispatched).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
    const lost = fixture(['pass'], { runInsertLostAck: true });
    await expect(lost.execute(choice)).rejects.toThrow('Synthetic acknowledgement lost after run insert');
    expect(lost.dispatched).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });
  it.each([{}, { actionFiling: 'all' }])('keeps original default/all drafting, filing and linkage: %j', async choice => {
    const h = fixture(['fail', 'pass']); const result = await h.execute(choice);
    expect(forge).toHaveBeenCalledTimes(1); expect(h.rpcs).toHaveLength(1); expect(h.rpcs[0]).toMatchObject({ name: 'file_action', input: { p_action_kind: 'systems.remediate', p_tenant_id: TENANT } });
    expect(result.actions_filed).toBe(1); expect(result.findings[0].resolution_action_id).toBe(ACTION);
    expect(h.updated('paige_systems_check_finding')[0].payload).toEqual({ resolution_action_id: ACTION });
  });
  it('keeps delta suppression for the original completed failing baseline', async () => {
    const h = fixture(['fail'], { previous: 'fail' }); const result = await h.execute({ actionFiling: 'delta' });
    expect(result.fail_count).toBe(1); expect(result.actions_filed).toBe(0); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
    const previous = h.calls.find(call => call.table === 'paige_systems_check_run' && call.operation === 'read');
    expect(previous?.filters).toContainEqual(['neq', 'scan_flavor', 'change_triggered']); expect(previous?.filters).toContainEqual(['not', 'completed_at', 'is', null]); expect(previous?.filters).toContainEqual(['eq', 'tenant_id', TENANT]);
  });
  it('keeps the newly degraded delta finding eligible for original remediation', async () => {
    const h = fixture(['fail'], { previous: 'pass' }); expect(await h.execute({ actionFiling: 'delta' })).toMatchObject({ fail_count: 1, actions_filed: 1 }); expect(forge).toHaveBeenCalledTimes(1); expect(h.rpcs).toHaveLength(1);
  });
  it('does not silently stop filing when the original model draft fails', async () => {
    forge.mockRejectedValue(new Error('Synthetic model refusal')); const h = fixture();
    expect(await h.execute()).toMatchObject({ fail_count: 1, actions_filed: 1 }); expect(h.rpcs).toHaveLength(1);
    expect(h.inserted('paige_systems_check_finding')[0].payload?.paige_drafted_fix).not.toMatchObject({ content: 'Synthetic original draft' });
  });
  it('does not let a context label misrepresent actual remediation', async () => {
    const h = fixture(); const result = await h.execute({ triggeredBy: { action_filing: 'none' } });
    expect(result.actions_filed).toBe(1); expect(forge).toHaveBeenCalledTimes(1); expect(h.rpcs).toHaveLength(1);
    expect(h.inserted('paige_systems_check_run')[0].payload?.triggered_by).toMatchObject({ scope: 'tenant', action_filing: 'all' });
  });
  it('preserves the original tenant-less operator brief without using tenant actions', async () => {
    const h = fixture(['fail'], { scope: 'operator' }); const result = await h.execute();
    expect(result.actions_filed).toBe(0); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
    expect(h.inserted('paige_systems_check_finding')[0].payload).toMatchObject({ tenant_id: null, paige_drafted_fix: { source: 'operator_registry_brief', operator_scope: true } });
  });
});

describe('Internal original-Work identity binding, never caller authority', () => {
  it('uses the supplied original Work UUID for the one insert and every original readback', async () => {
    const h = fixture(['fail', 'pass']);
    const result = await h.execute({ scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: PRIOR });
    expect(result).toMatchObject({ run_id: PRIOR, check_count: 2, actions_filed: 0 });
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1);
    expect(h.inserted('paige_systems_check_run')[0].payload).toMatchObject({id:PRIOR,work_id:PRIOR});
    expect(h.persisted().run?.id).toBe(PRIOR);
    expect(h.persisted().findings.every(f => f.run_id === PRIOR)).toBe(true);
    const reads = h.calls.filter(c => c.operation === 'read' && ['paige_systems_check_run','paige_systems_check_finding'].includes(c.table));
    expect(reads).toHaveLength(2);
    expect(reads[0].filters).toContainEqual(['eq', 'run_id', PRIOR]);
    expect(reads[1].filters).toContainEqual(['eq', 'id', PRIOR]);
    expect(reads[1].selected?.split(',')).toContain('work_id');
    expect(captureUuid).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled();
  });
  it.each([null, 17, {}, '', 'not-a-uuid', RUN + 'x', PRIOR.toUpperCase(), 'b4000000-0000-0000-8000-00000000a002', 'b4000000-0000-4000-0000-00000000a002'])('rejects malformed internal identity before any I/O: %j', async id => {
    const h = fixture(['fail']);
    await expect(h.execute({ scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: id })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_ID_INVALID');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });
  it.each([
    { scanFlavor: 'onboarding', actionFiling: 'none' },
    { scanFlavor: 'scheduled', actionFiling: 'none' },
    { scanFlavor: 'change_triggered', actionFiling: 'none' },
    { scanFlavor: 'manual' }, { scanFlavor: 'manual', actionFiling: 'delta' },
    { scanFlavor: 'manual', actionFiling: 'none', scope: 'operator', tenantId: null },
  ])('refuses an internal manual identity in every other execution context: %j', async extra => {
    const h = fixture(['fail']);
    await expect(h.execute({ ...extra, manualCaptureRunId: PRIOR })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_ID_CONTEXT');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(h.rpcs).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });
  it('does not take an identity from audit labels or invent an authoritative Work claim', async () => {
    const h = fixture(['pass']);
    expect(await h.execute({ scanFlavor: 'manual', actionFiling: 'none', triggeredBy: { manualCaptureRunId: PRIOR, work_id: PRIOR } })).toMatchObject({ run_id: RUN });
    expect(captureUuid).toHaveBeenCalledTimes(1); expect(h.rpcs).toEqual([]);
    expect(h.inserted('paige_systems_check_run')[0].payload).not.toHaveProperty('work_id');
  });
  it.each([
    ['run_insert', { runInsertLostAck: true }],
    ['finding_write', { findingWriteLostAck: true }],
    ['run_finalize', { finalizeLostAck: true }],
  ] as const)('retains the same original Work/run identity after uncertain %s', async (reason, options) => {
    const h = fixture(['pass'], options);
    await expect(h.execute({ scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: PRIOR })).rejects.toMatchObject({ name: 'SystemsCheckCaptureUnconfirmed', runId: PRIOR, reason });
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.persisted().run?.id).toBe(PRIOR);
    expect(captureUuid).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
    if (reason === 'run_insert') { expect(h.dispatched).toEqual([]); expect(h.persisted().findings).toEqual([]); expect(h.updated('paige_systems_check_run')).toEqual([]); }
  });
  it('does not dispatch, inspect another run or retry when the original insert refuses', async () => {
    const h = fixture(['pass'], { insertError: true });
    await expect(h.execute({ scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: PRIOR })).rejects.toMatchObject({ name: 'SystemsCheckCaptureUnconfirmed', runId: PRIOR, reason: 'run_insert' });
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.dispatched).toEqual([]);
    expect(h.calls.filter(c => c.operation === 'read' && c.table === 'paige_systems_check_run')).toEqual([]);
    expect(h.updated('paige_systems_check_run')).toEqual([]); expect(captureUuid).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
  it.each([null,undefined,ACTION])('refuses missing or mismatched canonical Work correlation in the original readback: %j', async workId => {
    const h=fixture(['pass'],{runReadPatch:{work_id:workId}});
    await expect(h.execute({scanFlavor:'manual',actionFiling:'none',manualCaptureRunId:PRIOR})).rejects.toMatchObject({name:'SystemsCheckCaptureUnconfirmed',runId:PRIOR,reason:'run_readback'});
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1);expect(captureUuid).not.toHaveBeenCalled();expect(h.rpcs).toEqual([]);
  });
});

function deferredRead() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, pause: async () => { enter(); await released; } };
}

async function observedWithin<T>(operation: Promise<T>): Promise<T | 'did-not-settle'> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<'did-not-settle'>(resolve => {
      timeout = setTimeout(() => resolve('did-not-settle'), 1000);
    })]);
  } finally { clearTimeout(timeout); }
}

describe('Trusted manual cancellation retains original work and stops late continuation', () => {
  const manual = { scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: PRIOR };
  const unconfirmed = (reason: string) => ({ name: 'SystemsCheckCaptureUnconfirmed', runId: PRIOR, reason });

  it('passes the same native signal to every original core query and completes normal capture', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const h = fixture(['pass', 'fail']);
    expect(await h.execute({ ...manual, manualCaptureSignal: controller.signal })).toMatchObject({ run_id: PRIOR, check_count: 2, actions_filed: 0 });
    expect(h.calls.length).toBeGreaterThan(6);
    expect(h.calls.every(call => call.signal === controller.signal)).toBe(true);
    expect(add).toHaveBeenCalled();
    expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    expect(captureUuid).not.toHaveBeenCalled(); expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });

  it.each([null, false, 'aborted', {}, { aborted: false }])('rejects a non-native internal signal before I/O: %j', async manualCaptureSignal => {
    const h = fixture();
    await expect(h.execute({ ...manual, manualCaptureSignal })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_SIGNAL_INVALID');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(h.rpcs).toEqual([]);
  });

  it('requires the original Work identity rather than accepting a signal as authority', async () => {
    const h = fixture();
    await expect(h.execute({ scanFlavor: 'manual', actionFiling: 'none', manualCaptureSignal: new AbortController().signal })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_SIGNAL_CONTEXT');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]);
  });

  it('does not read or write after an already-cancelled internal request', async () => {
    const controller = new AbortController(); controller.abort('private worker reason');
    const h = fixture();
    await expect(h.execute({ ...manual, manualCaptureSignal: controller.signal })).rejects.toMatchObject(unconfirmed('context_read'));
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });

  it.each([
    ['tenants', 'read', 'context_read'],
    ['paige_systems_check_registry', 'read', 'catalog_read'],
    ['paige_systems_check_run', 'insert', 'run_insert'],
    ['paige_systems_check_finding', 'insert', 'finding_write'],
    ['paige_systems_check_finding', 'read', 'finding_readback'],
    ['paige_systems_check_run', 'update', 'run_finalize'],
    ['paige_systems_check_run', 'read', 'run_readback'],
  ] as const)('settles cancellation while %s %s ignores it, retaining phase %s', async (table, operation, phase) => {
    const gate = deferredRead(), controller = new AbortController();
    const h = fixture(['pass', 'pass'], { pauseResponse: async call => {
      if (call.table === table && call.operation === operation) await gate.pause();
    } });
    const pending = h.execute({ ...manual, manualCaptureSignal: controller.signal }).then(value => value, error => error);
    await gate.entered;
    const callsAtAbort = h.calls.length;
    controller.abort('private worker reason');
    const outcome = await observedWithin(pending);
    // Release the late acknowledgement even on a failed causal baseline.
    gate.release();
    await new Promise(resolve => setImmediate(resolve));
    expect(outcome).toMatchObject(unconfirmed(phase));
    expect(h.calls).toHaveLength(callsAtAbort);
    expect(h.inserted('paige_systems_check_run').length).toBeLessThanOrEqual(1);
    if (h.persisted().run) expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR });
    if (phase === 'run_insert') expect(h.persisted().run?.completed_at).toBeNull();
    if (phase === 'run_finalize' || phase === 'run_readback') expect(h.persisted().run?.completed_at).toEqual(expect.any(String));
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });

  it.each(['returns', 'throws'] as const)('stops an uncooperative check that later %s without writing an error finding', async late => {
    const gate = deferredRead(), controller = new AbortController();
    const h = fixture(['fail', 'pass'], { pauseRunner: async () => {
      await gate.pause();
      if (late === 'throws') throw new Error('late original read failure');
    } });
    const pending = h.execute({ ...manual, manualCaptureSignal: controller.signal }).then(value => value, error => error);
    await gate.entered;
    controller.abort();
    const outcome = await observedWithin(pending);
    gate.release();
    await new Promise(resolve => setImmediate(resolve));
    expect(outcome).toMatchObject(unconfirmed('check_read'));
    expect(h.dispatched).toHaveLength(1); expect(h.persisted().findings).toEqual([]);
    expect(h.updated('paige_systems_check_run')).toEqual([]);
    expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR, completed_at: null });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });

  it('rechecks cancellation before the first finding even when the check resolves concurrently', async () => {
    const controller = new AbortController();
    const h = fixture(['pass'], { pauseRunner: async () => { controller.abort(); } });
    await expect(h.execute({ ...manual, manualCaptureSignal: controller.signal })).rejects.toMatchObject(unconfirmed('check_read'));
    expect(h.persisted().findings).toEqual([]); expect(h.updated('paige_systems_check_run')).toEqual([]);
  });
});

describe('Trusted manual checkpoints precede each original capture step', () => {
  const manual = { scanFlavor: 'manual', actionFiling: 'none', manualCaptureRunId: PRIOR };
  const phases = ['context_read', 'catalog_read', 'run_insert', 'check_read', 'finding_write', 'finding_readback', 'run_finalize', 'run_readback'];
  const unconfirmed = (reason: string) => ({ name: 'SystemsCheckCaptureUnconfirmed', message: 'SYSTEMS_CHECK_CAPTURE_UNCONFIRMED', runId: PRIOR, reason });
  const phaseFor = (call: Readonly<Call>) => {
    if (call.table === 'tenants') return 'context_read';
    if (call.table === 'paige_systems_check_registry') return 'catalog_read';
    if (call.table === 'paige_systems_check_run') return call.operation === 'insert' ? 'run_insert' : call.operation === 'update' ? 'run_finalize' : 'run_readback';
    return call.operation === 'insert' ? 'finding_write' : 'finding_readback';
  };

  it('awaits a fresh trusted checkpoint before every actual original operation', async () => {
    const events: string[] = [], controller = new AbortController();
    const h = fixture(['pass'], { pauseResponse: async call => { events.push('io:' + phaseFor(call)); }, pauseRunner: async () => { events.push('io:check_read'); } });
    const checkpoint = vi.fn(async (phase: string) => { events.push('checkpoint:' + phase); return true; });
    expect(await h.execute({ ...manual, manualCaptureSignal: controller.signal, manualCaptureCheckpoint: checkpoint })).toMatchObject({ run_id: PRIOR, check_count: 1, actions_filed: 0 });
    expect(events).toEqual(phases.flatMap(phase => ['checkpoint:' + phase, 'io:' + phase]));
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });

  it.each([null, false, 'checkpoint', 1, {}, []])('refuses malformed checkpoint %j before all I/O', async manualCaptureCheckpoint => {
    const h = fixture();
    await expect(h.execute({ ...manual, manualCaptureSignal: new AbortController().signal, manualCaptureCheckpoint })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_CHECKPOINT_INVALID');
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(h.rpcs).toEqual([]);
  });

  it.each([
    { scanFlavor: 'manual', actionFiling: 'none' },
    manual,
    { scanFlavor: 'onboarding', actionFiling: 'none' },
  ])('requires the original manual identity and native cancellation context: %j', async context => {
    const checkpoint = vi.fn(async () => true), h = fixture();
    await expect(h.execute({ ...context, manualCaptureCheckpoint: checkpoint })).rejects.toThrow('SYSTEMS_CHECK_MANUAL_CHECKPOINT_CONTEXT');
    expect(checkpoint).not.toHaveBeenCalled(); expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]);
  });

  it.each([undefined, null, false, 'true', 1, {}])('does not treat a malformed acknowledgement as permission: %j', async answer => {
    const h = fixture();
    await expect(h.execute({ ...manual, manualCaptureSignal: new AbortController().signal, manualCaptureCheckpoint: async () => answer })).rejects.toMatchObject(unconfirmed('context_read'));
    expect(h.calls).toEqual([]); expect(h.persisted().run).toBeNull(); expect(h.dispatched).toEqual([]);
  });

  it.each(phases)('a refused %s prevents that original operation and every later step', async refused => {
    const issued: string[] = [], seen: string[] = [], controller = new AbortController();
    const h = fixture(['pass'], { pauseResponse: async call => { issued.push(phaseFor(call)); }, pauseRunner: async () => { issued.push('check_read'); } });
    await expect(h.execute({ ...manual, manualCaptureSignal: controller.signal, manualCaptureCheckpoint: async (phase: string) => {
      seen.push(phase); if (phase === refused) throw new Error('Private native authority refusal'); return true;
    } })).rejects.toMatchObject(unconfirmed(refused));
    expect(seen).toEqual(phases.slice(0, phases.indexOf(refused) + 1));
    expect(issued).toEqual(phases.slice(0, phases.indexOf(refused)));
    if (phases.indexOf(refused) <= phases.indexOf('run_insert')) expect(h.persisted().run).toBeNull();
    else expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR });
    if (refused === 'run_finalize') expect(h.persisted().run?.completed_at).toBeNull();
    if (refused === 'run_readback') expect(h.persisted().run?.completed_at).toEqual(expect.any(String));
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]); expect(captureUuid).not.toHaveBeenCalled();
  });

  it('a checkpoint cannot resume its original operation after cancelling the request', async () => {
    const controller = new AbortController(), h = fixture();
    await expect(h.execute({ ...manual, manualCaptureSignal: controller.signal, manualCaptureCheckpoint: async () => { controller.abort(); return true; } })).rejects.toMatchObject(unconfirmed('context_read'));
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]);
  });

  it('rechecks the native checkpoint before each later original check rather than caching a phase', async () => {
    const h = fixture(['pass', 'pass']); let checks = 0;
    await expect(h.execute({ ...manual, manualCaptureSignal: new AbortController().signal, manualCaptureCheckpoint: async (phase: string) => {
      if (phase === 'check_read' && ++checks === 2) throw new Error('Current authority changed'); return true;
    } })).rejects.toMatchObject(unconfirmed('check_read'));
    expect(checks).toBe(2); expect(h.dispatched).toHaveLength(1); expect(h.persisted().findings).toHaveLength(1);
    expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR, check_count: 2, completed_at: null });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });

  it.each(['resolves', 'rejects'] as const)('cancels an uncooperative checkpoint which later %s without starting I/O', async late => {
    const controller = new AbortController(), gate = deferredRead(), h = fixture();
    const add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = h.execute({ ...manual, manualCaptureSignal: controller.signal, manualCaptureCheckpoint: async () => {
      await gate.pause(); if (late === 'rejects') throw new Error('Late private guard failure'); return true;
    } }).then(value => value, error => error);
    const entered = await observedWithin(gate.entered);
    if (entered === 'did-not-settle') { gate.release(); await pending; expect(entered).not.toBe('did-not-settle'); return; }
    controller.abort(); const outcome = await observedWithin(pending); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(outcome).toMatchObject(unconfirmed('context_read')); expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]);
    expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
  });
});

type WorkCall = { name: string; input: Record<string, unknown>; signal?: AbortSignal };
function workFixture(options: Parameters<typeof fixture>[1] = {}, reply?: (call: WorkCall, normal: Result) => Promise<Result>) {
  const h = fixture(['fail'], options), calls: WorkCall[] = [];
  Object.assign(loaded.SYSTEMS_CHECK_DISPATCH as object, h.dispatch);
  const claimed = { work_id: PRIOR, work_status: 'claimed', server_idempotency_key: 'server-private-fixture-key',
    tenant_id: TENANT, initiating_user_id: ACTION, thread_id: null, attempt_count: 1,
    request_payload: { version: 1, scope: 'tenant', scan_flavor: 'manual', action_filing: 'none' } };
  const admin = { ...h.admin, rpc(name: string, input: Record<string, unknown>) {
    const call: WorkCall = { name, input }; calls.push(call);
    const answer = async (): Promise<Result> => {
      let normal: Result;
      if (name === '_start_manual_systems_check_work') normal = { data: [claimed], error: null };
      else if (name === 'heartbeat_paige_durable_work') normal = { data: [{ work_status: 'claimed', work_version: 2, work_lease_until: '2026-10-27T01:05:00Z' }], error: null };
      else if (name === 'transition_paige_durable_work' && h.persisted().run?.completed_at) normal = { data: [{ work_status: 'succeeded', work_version: 3, work_attempt_count: 1, work_lease_until: null, work_settled_at: '2026-10-27T01:01:00Z' }], error: null };
      else normal = { data: null, error: { message: 'Native result not established' } };
      return reply ? reply(call, normal) : normal;
    };
    const query = { abortSignal(signal: AbortSignal) { call.signal = signal; return query; },
      then: (fulfilled: (r: Result) => unknown, rejected?: (error: unknown) => unknown) => answer().then(fulfilled, rejected) };
    return query;
  } };
  const capture = new AbortController(), settlement = new AbortController();
  const settle = vi.fn(() => settlement.signal);
  return { ...h, calls: h.calls, workCalls: calls, capture, settlement, settle,
    execute: (extra: Record<string, unknown> = {}) => consumeWork({ admin, workId: PRIOR, captureSignal: capture.signal, settlementSignal: settle, ...extra }) };
}

describe('Private original Systems Work consumption, not public admission', () => {
  const unknown = { workId: PRIOR, confirmation: 'unconfirmed' };
  it('uses one native claim, fresh native heartbeat at every phase, actual whole Core, and original settlement', async () => {
    const h = workFixture();
    expect(await h.execute({ tenantId: RUN, scope: 'operator', scanFlavor: 'scheduled', actionFiling: 'all', runnerKeys: ['not-in-original-catalog'] }))
      .toEqual({ workId: PRIOR, confirmation: 'confirmed', workStatus: 'succeeded', runId: PRIOR });
    expect(h.workCalls[0]).toMatchObject({ name: '_start_manual_systems_check_work', input: { p_work: PRIOR }, signal: h.capture.signal });
    const beats = h.workCalls.filter(c => c.name === 'heartbeat_paige_durable_work');
    expect(beats).toHaveLength(8);
    for (const beat of beats) expect(beat).toMatchObject({ input: { _work_id: PRIOR, _server_idempotency_key: 'server-private-fixture-key', _lease_seconds: 300 }, signal: h.capture.signal });
    expect(h.workCalls.at(-1)).toMatchObject({ name: 'transition_paige_durable_work', input: { _work_id: PRIOR, _new_status: 'succeeded', _terminal_outcome: { verified_readback: true }, _reconciled: false }, signal: h.settlement.signal });
    expect(h.workCalls.filter(c => c.name === '_start_manual_systems_check_work')).toHaveLength(1);
    expect(h.dispatched).toHaveLength(1); expect(h.dispatched[0]).toMatchObject({ tenantId: TENANT, scope: 'tenant', scanFlavor: 'manual' });
    expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR, tenant_id: TENANT, scan_flavor: 'manual', selected_runner_keys: null });
    expect(JSON.stringify(h.persisted())).not.toContain('server-private-fixture-key');
    expect(h.calls.find(c => c.table === 'paige_systems_check_registry')?.filters.some(f => f[0] === 'in' && f[1] === 'runner_key')).toBe(false);
    expect(h.persisted().findings[0]).toMatchObject({ run_id: PRIOR, tenant_id: TENANT, resolution_action_id: null });
    expect(h.rpcs).toEqual([]); expect(forge).not.toHaveBeenCalled(); expect(h.settle).toHaveBeenCalledTimes(1);
  });
  it.each([null, '', 'not-a-work-id'])('refuses invalid internal identity %j without I/O', async workId => {
    const h = workFixture(); await expect(h.execute({ workId })).rejects.toThrow('SYSTEMS_WORK_INTERNAL_CONTEXT_INVALID'); expect(h.workCalls).toEqual([]);
  });
  it('does not claim an already interrupted request or fabricate a cancelled Work status', async () => {
    const h = workFixture(); h.capture.abort(); expect(await h.execute()).toEqual(unknown); expect(h.workCalls).toEqual([]); expect(h.settle).not.toHaveBeenCalled();
  });
  it.each(['refused', 'rejected', 'multiple', 'mismatched', 'payload', 'operator', 'wrong-attempt', 'missing-key'])(
    'refuses %s original claim without Core, settlement or second dispatch', async kind => {
      const h = workFixture({}, async (call, normal) => {
        if (call.name !== '_start_manual_systems_check_work') return normal;
        if (kind === 'rejected') throw new Error('Private source failure');
        if (kind === 'refused') return { data: null, error: { message: 'Native current authority refused' } };
        const row = { ...(normal.data as Record<string, unknown>[])[0] };
        if (kind === 'multiple') return { data: [row, row], error: null };
        if (kind === 'mismatched') row.work_id = RUN;
        if (kind === 'payload') row.request_payload = { version: 1, scope: 'tenant', scan_flavor: 'manual', action_filing: 'all' };
        if (kind === 'operator') row.tenant_id = null;
        if (kind === 'wrong-attempt') row.attempt_count = 2;
        if (kind === 'missing-key') delete row.server_idempotency_key;
        return { data: [row], error: null };
      });
      expect(await h.execute()).toEqual(unknown); expect(h.workCalls).toHaveLength(1); expect(h.calls).toEqual([]); expect(h.settle).not.toHaveBeenCalled();
    });
  it.each(['error', 'expired', 'empty', 'invalid-lease'])('stops at a %s native heartbeat, without an invented successful result', async kind => {
    const h = workFixture({}, async (call, normal) => {
      if (call.name !== 'heartbeat_paige_durable_work') return normal;
      if (kind === 'error') return { data: null, error: { message: 'Role revoked' } };
      if (kind === 'empty') return { data: [], error: null };
      const row = { ...(normal.data as Record<string, unknown>[])[0] };
      if (kind === 'expired') row.work_status = 'expired'; else row.work_lease_until = 'invalid';
      return { data: [row], error: null };
    });
    expect(await h.execute()).toEqual(unknown); expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]);
    expect(h.workCalls.map(c => c.name)).toEqual(['_start_manual_systems_check_work', 'heartbeat_paige_durable_work', 'transition_paige_durable_work']);
    expect(h.workCalls.at(-1)?.signal).toBe(h.settlement.signal);
  });
  it.each(['lost-reply', 'refused', 'empty', 'claimed', 'wrong-attempt', 'no-settled-time', 'lease-retained'])(
    'keeps one completed original run unconfirmed on %s settlement, never replays', async kind => {
      const h = workFixture({}, async (call, normal) => {
        if (call.name !== 'transition_paige_durable_work') return normal;
        if (kind === 'lost-reply') throw new Error('Acknowledgement lost after possible commit');
        if (kind === 'refused') return { data: null, error: { message: 'Current authority or native lease refused' } };
        if (kind === 'empty') return { data: [], error: null };
        const row = { ...(normal.data as Record<string, unknown>[])[0] };
        if (kind === 'claimed') row.work_status = 'claimed';
        if (kind === 'wrong-attempt') row.work_attempt_count = 2;
        if (kind === 'no-settled-time') row.work_settled_at = null;
        if (kind === 'lease-retained') row.work_lease_until = '2026-10-27T01:05:00Z';
        return { data: [row], error: null };
      });
      const result = await h.execute(); expect(result).toEqual(unknown); expect(JSON.stringify(result)).not.toContain('private-fixture-key');
      expect(h.dispatched).toHaveLength(1); expect(h.persisted().run?.completed_at).toBeTruthy();
      expect(h.inserted('paige_systems_check_run')).toHaveLength(1);
      expect(h.workCalls.filter(c => c.name === 'transition_paige_durable_work')).toHaveLength(1);
    });
  it.each(['same', 'aborted', 'invalid', 'throws'])('refuses %s reconciliation scope without recycling cancelled scan authority', async kind => {
    const h = workFixture(); h.settlement.abort();
    const settlementSignal = () => { if (kind === 'throws') throw new Error('Host scope unavailable');
      return kind === 'same' ? h.capture.signal : kind === 'aborted' ? h.settlement.signal : {}; };
    expect(await h.execute({ settlementSignal })).toEqual(unknown);
    expect(h.workCalls.filter(c => c.name === 'transition_paige_durable_work')).toHaveLength(0);
    expect(h.dispatched).toHaveLength(1);
  });
  it('does not restart after a late claim acknowledgement', async () => {
    const gate = deferredRead(), h = workFixture({}, async (call, normal) => { if (call.name === '_start_manual_systems_check_work') await gate.pause(); return normal; });
    const pending = h.execute(); await gate.entered; h.capture.abort();
    expect(await observedWithin(pending)).toEqual(unknown); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(h.workCalls).toHaveLength(1); expect(h.calls).toEqual([]); expect(h.settle).not.toHaveBeenCalled();
  });
  it('uses one fresh settlement scope after an uncooperative check is interrupted, preserving the partial original run', async () => {
    const gate = deferredRead(), h = workFixture({ pauseRunner: gate.pause });
    const pending = h.execute(); await gate.entered; h.capture.abort();
    expect(await observedWithin(pending)).toEqual(unknown); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(h.workCalls.at(-1)?.signal).toBe(h.settlement.signal);
    expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR, completed_at: null });
    expect(h.persisted().findings).toHaveLength(0); expect(h.dispatched).toHaveLength(1);
    expect(h.workCalls.filter(c => c.name === '_start_manual_systems_check_work')).toHaveLength(1);
  });
  it('can accept genuine native completion after a completed write loses its Core reply', async () => {
    const h = workFixture({ finalizeLostAck: true });
    expect(await h.execute()).toEqual({ workId: PRIOR, confirmation: 'confirmed', workStatus: 'succeeded', runId: PRIOR });
    expect(h.persisted().run?.completed_at).toBeTruthy(); expect(h.dispatched).toHaveLength(1); expect(h.settle).toHaveBeenCalledTimes(1);
  });
  it('bounds awaiting an uncooperative finalizer, retaining uncertainty if its late reply succeeds', async () => {
    const gate = deferredRead(), h = workFixture({}, async (call, normal) => { if (call.name === 'transition_paige_durable_work') await gate.pause(); return normal; });
    const pending = h.execute(); await gate.entered; h.settlement.abort();
    expect(await observedWithin(pending)).toEqual(unknown); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(h.workCalls.filter(c => c.name === 'transition_paige_durable_work')).toHaveLength(1); expect(h.dispatched).toHaveLength(1);
  });
  it('lets the original native dispatch claim refuse a concurrent second consumer, never a JS replay grant', async () => {
    let claims = 0;
    const h = workFixture({}, async (call, normal) => call.name === '_start_manual_systems_check_work' && ++claims > 1
      ? { data: null, error: { message: 'Native already dispatched' } } : normal);
    const outcomes = await Promise.all([h.execute(), h.execute()]);
    expect(outcomes.filter(o => o.confirmation === 'confirmed')).toHaveLength(1);
    expect(outcomes.filter(o => o.confirmation === 'unconfirmed')).toHaveLength(1);
    expect(h.workCalls.filter(c => c.name === '_start_manual_systems_check_work')).toHaveLength(2);
    expect(h.inserted('paige_systems_check_run')).toHaveLength(1); expect(h.dispatched).toHaveLength(1);
    expect(h.workCalls.filter(c => c.name === 'transition_paige_durable_work')).toHaveLength(1);
  });
  it.each(['resolves', 'rejects'] as const)('never resumes after an uncooperative native heartbeat later %s', async late => {
    const gate = deferredRead(), h = workFixture({}, async (call, normal) => {
      if (call.name === 'heartbeat_paige_durable_work') { await gate.pause(); if (late === 'rejects') throw new Error('Late authority failure'); }
      return normal;
    });
    const pending = h.execute(); await gate.entered; h.capture.abort();
    expect(await observedWithin(pending)).toEqual(unknown); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(h.calls).toEqual([]); expect(h.dispatched).toEqual([]); expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.workCalls.at(-1)?.signal).toBe(h.settlement.signal);
  });
  it('retains the original identity after a finding write commits too late to acknowledge', async () => {
    const gate = deferredRead(), h = workFixture({ pauseResponse: async call => {
      if (call.table === 'paige_systems_check_finding' && call.operation === 'insert') await gate.pause();
    } });
    const pending = h.execute(); await gate.entered; h.capture.abort();
    expect(await observedWithin(pending)).toEqual(unknown); gate.release(); await new Promise(resolve => setImmediate(resolve));
    expect(h.persisted().run).toMatchObject({ id: PRIOR, work_id: PRIOR, completed_at: null });
    expect(h.persisted().findings).toHaveLength(1); expect(h.updated('paige_systems_check_run')).toHaveLength(0);
    expect(h.dispatched).toHaveLength(1); expect(h.workCalls.filter(c => c.name === 'transition_paige_durable_work')).toHaveLength(1);
  });
});
