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
type Summary = { run_id: string; check_count: number; pass_count: number; fail_count: number; skip_count: number; error_count: number; actions_filed: number; findings: Array<{ finding_id: string; resolution_action_id: string | null; status: string }> };
const run = loaded.runSystemsCheck as (options: Record<string, unknown>) => Promise<Summary>;
const TENANT = 'b4000000-0000-4000-8000-000000001111';
const RUN = 'b4000000-0000-4000-8000-00000000a001';
const PRIOR = 'b4000000-0000-4000-8000-00000000a002';
const ACTION = 'b4000000-0000-4000-8000-00000000c001';
type Call = { table: string; operation: 'read' | 'insert' | 'update'; payload?: Record<string, unknown>; filters: unknown[][] };
type Result = { data: unknown; error: { message: string } | null };
type Query = {
  select(): Query; insert(payload: Record<string, unknown>): Query; update(payload: Record<string, unknown>): Query;
  eq(...args: unknown[]): Query; neq(...args: unknown[]): Query; not(...args: unknown[]): Query; is(...args: unknown[]): Query;
  in(...args: unknown[]): Query; order(...args: unknown[]): Query; limit(...args: unknown[]): Query;
  maybeSingle(): Promise<Result>; single(): Promise<Result>; then(fulfilled: (result: Result) => unknown): Promise<unknown>;
};

function fixture(statuses: string[] = ['fail'], options: { previous?: string; scope?: 'tenant' | 'operator'; catalogError?: boolean; insertError?: boolean; findingError?: boolean; missing?: boolean; throws?: boolean } = {}) {
  const calls: Call[] = [], rpcs: Array<{ name: string; input: Record<string, unknown> }> = [], dispatched: Record<string, unknown>[] = [];
  let finding = 0;
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
        if (table === 'paige_systems_check_run' && call.operation === 'read') return { data: options.previous ? { id: PRIOR } : null, error: null };
        if (table === 'paige_systems_check_finding' && call.operation === 'read') return { data: rows.map(row => ({ check_id: row.check_id, status: options.previous })), error: null };
        if (call.operation === 'insert' && table === 'paige_systems_check_run') return options.insertError ? { data: null, error: { message: 'Write unavailable' } } : { data: { id: RUN }, error: null };
        if (call.operation === 'insert' && table === 'paige_systems_check_finding') return options.findingError ? { data: null, error: { message: 'Finding write unavailable' } } : { data: { id: `b4000000-0000-4000-8000-${String(++finding).padStart(12, '0')}` }, error: null };
        if (call.operation === 'update') return { data: null, error: null };
        throw new Error('Unbound original source operation: ' + table);
      };
      const query: Query = {
        select() { return query; }, insert(payload: Record<string, unknown>) { call.operation = 'insert'; call.payload = payload; return query; }, update(payload: Record<string, unknown>) { call.operation = 'update'; call.payload = payload; return query; },
        eq(...args: unknown[]) { call.filters.push(['eq', ...args]); return query; }, neq(...args: unknown[]) { call.filters.push(['neq', ...args]); return query; }, not(...args: unknown[]) { call.filters.push(['not', ...args]); return query; }, is(...args: unknown[]) { call.filters.push(['is', ...args]); return query; },
        in(...args: unknown[]) { call.filters.push(['in', ...args]); return query; }, order(...args: unknown[]) { call.filters.push(['order', ...args]); return query; }, limit(...args: unknown[]) { call.filters.push(['limit', ...args]); return query; },
        maybeSingle: async () => answer(), single: async () => answer(), then: (fulfilled: (result: Result) => unknown) => Promise.resolve(answer()).then(fulfilled),
      };
      return query;
    },
    async rpc(name: string, input: Record<string, unknown>) { rpcs.push({ name, input }); return { data: { ok: true, action_id: ACTION }, error: null }; },
  };
  const dispatch = Object.fromEntries(rows.filter(() => !options.missing).map(row => [row.runner_key, async (context: Record<string, unknown>) => {
    dispatched.push(context);
    if (options.throws) throw new Error('Original source failed');
    return { status: row.status, evidence: { source: 'original_record' }, interpretation: 'Recorded observation' };
  }]));
  const scope = options.scope ?? 'tenant';
  const base = { admin, tenantId: scope === 'tenant' ? TENANT : null, scope, scanFlavor: 'onboarding', dispatch };
  return { calls, rpcs, dispatched, execute: (extra: Record<string, unknown> = {}) => run({ ...base, ...extra }), inserted: (table: string) => calls.filter(call => call.table === table && call.operation === 'insert'), updated: (table: string) => calls.filter(call => call.table === table && call.operation === 'update') };
}
beforeEach(() => {
  forge.mockReset().mockResolvedValue({ result: { content: 'Synthetic original draft', needs_config: false, model: 'synthetic' } });
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
  it.each([['catalog', { catalogError: true }], ['run', { insertError: true }]] as const)('fails loudly when the original %s cannot be recorded/read', async (_name, option) => {
    const h = fixture(['fail'], option); await expect(h.execute({ actionFiling: 'none' })).rejects.toThrow(/SYSTEMS_CHECK_(CATALOG_READ|RUN_INSERT)_FAILED/);
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
    const h = fixture(['fail'], { findingError: true }); const result = await h.execute({ actionFiling: 'none' });
    expect(result).toMatchObject({ run_id: RUN, fail_count: 1, actions_filed: 0, findings: [{ finding_id: '', status: 'fail', resolution_action_id: null }] });
    expect(forge).not.toHaveBeenCalled(); expect(h.rpcs).toEqual([]);
  });
});

describe('Existing remediation contracts remain active at their original ports', () => {
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
