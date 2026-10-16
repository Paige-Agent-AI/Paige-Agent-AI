// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { recordCapabilityRun } from '../../supabase/functions/_shared/capability-record';

const actor = '00000000-0000-4000-8000-000000000001';
const tenant = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const question = 'Protected fixture public research question';
type Row = Record<string, unknown>;
type Reply = { data: Row | Row[] | null; error: { message: string } | null };
interface QueryPort extends PromiseLike<Reply> {
  select(fields: string): QueryPort;
  eq(key: string, value: unknown): QueryPort;
  order(): QueryPort;
  limit(): QueryPort;
  insert(value: Row | Row[]): QueryPort;
  maybeSingle(): Promise<Reply>;
}
const source = readFileSync('supabase/functions/paige-deep-research/index.ts', 'utf8');

type Options = {
  member?: boolean; actorMissing?: boolean; identityError?: boolean; profileError?: boolean;
  noTenant?: boolean; unconfigured?: boolean; switchAt?: 'search' | 'run-insert' | 'receipt' | 'synthesis' | 'strategy-error';
  runWriteError?: boolean; lostRunAck?: boolean; sourceWriteError?: boolean; lostSourcesAck?: boolean;
  runReadError?: boolean; sourcesReadError?: boolean; corruptRead?: 'actor' | 'tenant' | 'findings' | 'source' | 'extra-source';
  recorderError?: boolean; lostReceiptAck?: boolean;
  cited?: boolean; failedSynthesis?: boolean; scopeReadThrows?: boolean; strategyError?: boolean;
};

function fixture(options: Options = {}) {
  let active = options.noTenant ? null : tenant;
  let handler!: (request: Request) => Promise<Response>;
  const rows: Record<string, Row[]> = { research_runs: [], research_sources: [] };
  const operations: Array<{ table: string; method: string; filters: Array<[string, unknown]>; fields?: string }> = [];
  const receipts = new Map<string, Row>();
  const identity = () => ({ data: { user: options.actorMissing ? null : { id: actor } }, error: options.identityError ? { message: 'fixture unavailable' } : null });
  const query = (table: string) => {
    let method = 'read'; let payload: Row[] = []; let fields = '';
    const filters: Array<[string, unknown]> = [];
    const q: QueryPort = {
      select: (value: string) => { fields = value; return q; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      order: () => q, limit: () => q,
      insert: (value: Row | Row[]) => { method = 'insert'; payload = Array.isArray(value) ? value : [value]; return q; },
      maybeSingle: () => execute(true),
      then: (ok, bad) => execute(false).then(ok, bad),
    };
    async function execute(single: boolean) {
      operations.push({ table, method, filters: [...filters], fields });
      if (table === 'profiles') {
        if (options.scopeReadThrows) throw new Error('fixture scope read lost');
        return { data: { active_tenant_id: active }, error: options.profileError ? { message: 'fixture unavailable' } : null };
      }
      if (table === 'tenant_members') return { data: options.member === false ? null : { user_id: actor, tenant_id: active, status: 'active' }, error: null };
      if (method === 'insert') {
        if (table === 'research_runs' && options.switchAt === 'run-insert') active = other;
        const failed = table === 'research_runs' ? options.runWriteError : options.sourceWriteError;
        const lost = table === 'research_runs' ? options.lostRunAck : options.lostSourcesAck;
        if (!failed) rows[table].push(...structuredClone(payload));
        return { data: null, error: failed || lost ? { message: 'fixture write acknowledgement unavailable' } : null };
      }
      if (table === 'research_runs' && options.runReadError || table === 'research_sources' && options.sourcesReadError) return { data: null, error: { message: 'fixture read unavailable' } };
      let result = structuredClone(rows[table].filter(row => filters.every(([key, value]) => row[key] === value)));
      if (table === 'research_runs' && result.length) {
        if (options.corruptRead === 'actor') result[0].user_id = other;
        if (options.corruptRead === 'tenant') result[0].tenant_id = other;
        if (options.corruptRead === 'findings') result[0].findings = [];
      }
      if (table === 'research_sources' && result.length) {
        if (options.corruptRead === 'source') result[0].url = 'https://example.invalid/wrong';
        if (options.corruptRead === 'extra-source') result.push({ ...result[0], source_index: 2 });
      }
      // A port must not fabricate fields the real PostgREST SELECT did not request.
      if (fields && fields !== '*') result = result.map(row => Object.fromEntries(fields.split(',').map(key => key.trim()).filter(key => key in row).map(key => [key, row[key]])));
      return { data: single ? result[0] ?? null : result, error: null };
    }
    return q;
  };
  const adminRpc = vi.fn(async (name: string, args: Row) => {
    expect(name).toBe('record_capability_run');
    if (options.switchAt === 'receipt') active = other;
    if (options.recorderError) return { data: null, error: { message: 'fixture recorder unavailable' } };
    receipts.set([args._tenant_id, args._run_id, args._outcome].join(':'), args);
    return { data: null, error: options.lostReceiptAck ? { message: 'fixture acknowledgement lost' } : null };
  });
  const admin = { from: query, rpc: adminRpc, auth: { admin: { getUserById: async () => identity() } } };
  const caller = { from: query, auth: { getUser: async () => identity() }, rpc: async (name: string) => ({ data: name === 'current_user_tenant_id' ? active : options.member !== false, error: null }) };
  const provider = vi.fn(async (url: string) => {
    if (options.switchAt === 'search') active = other;
    if (url.endsWith('/paige-web-search')) return Response.json({ configured: !options.unconfigured, results: options.cited ? [
      { url: 'https://research-fixture.gov/evidence', title: 'Protected research fixture evidence', description: 'Protected supporting fixture research establishes a reproducible baseline.' },
    ] : [] });
    if (url.endsWith('/fetch-url-content')) return Response.json({ success: true, content: 'Protected supporting fixture research establishes a reproducible baseline.' });
    throw new Error('Unexpected fixture provider endpoint');
  });
  const model = vi.fn(async (phase: string) => {
    if (options.failedSynthesis && ['unit_synthesis', 'dossier_synthesis'].includes(phase)) {
      if (options.switchAt === 'synthesis') active = other;
      throw new Error('fixture synthesis failed');
    }
    return { resp: { choices: [{ message: { content: JSON.stringify(
    phase === 'unit_planner' ? { units: [{ objective: 'Verify the protected fixture baseline', coverage_kind: 'overall' }] }
      : phase === 'unit_synthesis' ? { insufficient: false, findings: [{ summary: 'Protected supporting fixture research establishes a reproducible baseline.', citations: [1], name: null, website: null, phone: null, values: [] }] }
        : { queries: ['protected fixture query'], done: false }) } }] }, route: null };
  });
  const strategy = vi.fn(async () => {
    if (options.strategyError) {
      if (options.switchAt === 'strategy-error') active = other;
      throw new Error('fixture unexpected strategy error');
    }
    return { degraded: true };
  });
  const scope = { serve: (fn: typeof handler) => { handler = fn; }, recordCapabilityRun,
    createClient: (_url: string, key: string) => key === 'fixture-service' ? admin : caller,
    researchCompletion: model, strategizeBeforeReasoning: strategy, fetch: provider,
    Deno: { env: { get: (name: string) => ({ SUPABASE_URL: 'https://local.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon' })[name] } } };
  const ast = ts.createSourceFile('research.ts', source, ts.ScriptTarget.Latest, true);
  const withoutImports = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const js = ts.transpileModule(withoutImports, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const persistRun = new Function(...Object.keys(scope), `${js}; return persistRun;`)(...Object.values(scope));
  const run = async (body: Row = {}, service = false) => {
    const response = await handler(new Request('https://local.invalid/research', { method: 'POST', headers: { Authorization: `Bearer ${service ? 'fixture-service' : 'fixture-user'}` }, body: JSON.stringify({ question, user_id: actor, max_hops: 1, expected_tenant_id: tenant, ...body }) }));
    return { response, body: await response.json() };
  };
  const persist = async (result: Row = nativeResult()) => {
    await persistRun('https://local.invalid', 'fixture-service', runId, { question, user_id: actor, caller: 'chat' }, result, tenant, {}, async () => {
      if (active !== tenant || options.member === false) throw Error('RESEARCH_SCOPE_UNVERIFIED');
    });
    return result;
  };
  return { run, persist, rows, receipts, operations, adminRpc, admin, provider, model, strategy };
}

function nativeResult(): Row {
  return { run_id: runId, question, findings: [{ text: 'Protected supported finding', citations: [1], confidence: 'high' }],
    sources: [{ index: 1, url: 'https://example.invalid/protected-source', title: 'Fixture source', snippet: 'Private source text must not enter a receipt', reliability_score: 0.9, tier: 'T1', reliability: 'high', published_at: null, fetched_at: '2026-10-16T00:00:00Z', excluded: false }],
    coverage: { stop_reason: 'answered', configured: true, hops_used: 1, searches: 1, reads: 1, note: 'Fixture result' } };
}

describe('incumbent native Research receipt contract', () => {
  it('proves the complete same-actor/tenant report and sources before filing its existing Rail receipt', async () => {
    const test = fixture(); const result = await test.persist();
    expect(result).toMatchObject({ persistence_verified: true, receipt_recorded: true, receipt_outcome: 'capability_succeeded' });
    expect(test.adminRpc).toHaveBeenCalledTimes(1);
    expect(test.adminRpc.mock.calls[0][1]).toMatchObject({ _tenant_id: tenant, _actor_id: actor, _capability_key: 'deep_research', _run_id: runId, _outcome: 'capability_succeeded', _detail: { report_saved: true, findings_count: 1, sources_count: 1, stop_reason: 'answered' } });
    expect(JSON.stringify(test.adminRpc.mock.calls)).not.toContain(question);
    expect(JSON.stringify(test.adminRpc.mock.calls)).not.toContain('Private source text');
    for (const op of test.operations.filter(op => op.method === 'read')) {
      expect(op.filters).toContainEqual(['tenant_id', tenant]); expect(op.filters).toContainEqual(['user_id', actor]);
      expect(op.filters).toContainEqual([op.table === 'research_runs' ? 'id' : 'run_id', runId]);
    }
  });
  it.each(['actor', 'tenant', 'findings', 'source', 'extra-source'] as const)('does not call a mismatched %s report saved', async corruptRead => {
    const test = fixture({ corruptRead }); const result = await test.persist();
    expect(result.persistence_verified).toBe(false);
    expect(test.adminRpc.mock.calls.every(([, args]) => args._outcome !== 'capability_succeeded')).toBe(true);
  });
  it.each(['runWriteError', 'sourceWriteError', 'runReadError', 'sourcesReadError'] as const)('preserves truthful unconfirmed persistence on %s without retry/delete', async fault => {
    const test = fixture({ [fault]: true }); const result = await test.persist();
    expect(result.persistence_verified).toBe(false);
    expect(test.operations.filter(op => op.method === 'insert' && op.table === 'research_runs')).toHaveLength(1);
    expect(test.operations.every(op => ['read', 'insert'].includes(op.method))).toBe(true);
    expect(test.adminRpc.mock.calls.every(([, args]) => args._outcome !== 'capability_succeeded')).toBe(true);
  });
  it.each(['lostRunAck', 'lostSourcesAck'] as const)('reconciles %s from canonical readback without repeating the business write', async fault => {
    const test = fixture({ [fault]: true }); const result = await test.persist();
    expect(result).toMatchObject({ persistence_verified: true, receipt_recorded: true });
    expect(test.rows.research_runs).toHaveLength(1); expect(test.rows.research_sources).toHaveLength(1);
  });
  it.each(['recorderError', 'lostReceiptAck'] as const)('keeps the saved report separate from unconfirmed %s, with no research retry', async fault => {
    const test = fixture({ [fault]: true }); const result = await test.persist();
    expect(result).toMatchObject({ persistence_verified: true, receipt_recorded: false, receipt_outcome: 'capability_completed_unrecorded' });
    expect(test.rows.research_runs).toHaveLength(1); expect(test.rows.research_sources).toHaveLength(1); expect(test.adminRpc).toHaveBeenCalledTimes(1);
    expect(test.receipts.size).toBe(fault === 'lostReceiptAck' ? 1 : 0);
  });
  it('deduplicates only the receipt with the native run UUID, not the research request', async () => {
    const test = fixture(); await test.persist();
    await recordCapabilityRun(test.admin, { tenantId: tenant, actorId: actor, capabilityKey: 'deep_research', runId, outcome: 'capability_succeeded' });
    expect(test.receipts.size).toBe(1); expect(test.adminRpc).toHaveBeenCalledTimes(2);
    expect(test.operations.filter(op => op.table === 'research_runs' && op.method === 'insert')).toHaveLength(1);
  });
});

describe('actual native Research authenticated door', () => {
  it('guards every structured result return independently of optional persistence and guards the generic error return', () => {
    const ast = ts.createSourceFile('research.ts', source, ts.ScriptTarget.Latest, true);
    let execution: ts.TryStatement | undefined;
    const locate = (node: ts.Node) => {
      if (ts.isTryStatement(node) && node.tryBlock.statements.some(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'strategy'))) execution = node;
      ts.forEachChild(node, locate);
    };
    locate(ast); expect(execution).toBeDefined();
    const resultReturns: ts.ReturnStatement[] = [];
    const collect = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression && ts.isCallExpression(node.expression)
        && node.expression.expression.getText(ast) === 'json') resultReturns.push(node);
      ts.forEachChild(node, collect);
    };
    collect(execution!.tryBlock); expect(resultReturns).toHaveLength(5);
    for (const resultReturn of resultReturns) {
      expect(ts.isBlock(resultReturn.parent)).toBe(true);
      const statements = (resultReturn.parent as ts.Block).statements;
      expect(statements[statements.indexOf(resultReturn) - 1].getText(ast)).toBe('await assertResearchScope();');
    }
    const errorScope = execution!.catchClause!.block.statements.find(ts.isTryStatement);
    expect(errorScope?.tryBlock.getText(ast)).toContain('await assertResearchScope();');
    expect(errorScope?.catchClause?.block.getText(ast)).toContain('return refuseChangedScope();');
  });
  it.each([
    ['general', false], ['general', true], ['dossier', false], ['dossier', true],
  ] as const)('withholds %s synthesis failure after workspace changes even with no persistence (service=%s)', async (mode, service) => {
    const test = fixture({ cited: true, failedSynthesis: true, switchAt: 'synthesis' });
    const { response, body } = await test.run({ question: mode === 'dossier' ? 'Research the company Protected Fixture Labs' : question, persist: false }, service);
    expect(test.model.mock.calls.some(([phase]) => phase === (mode === 'dossier' ? 'dossier_synthesis' : 'unit_synthesis'))).toBe(true);
    expect(test.provider.mock.calls.length).toBeGreaterThan(0);
    expect(response.status).toBe(409); expect(body.outcome_unknown).toBe(true);
    expect(body.run_id).toBeUndefined(); expect(body.question).toBeUndefined(); expect(body.findings).toBeUndefined(); expect(body.sources).toBeUndefined();
    expect(test.rows.research_runs).toEqual([]); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it.each(['general', 'dossier'] as const)('keeps a same-workspace %s no-persist synthesis failure available without falsely saving it', async mode => {
    const test = fixture({ cited: true, failedSynthesis: true });
    const { response, body } = await test.run({ question: mode === 'dossier' ? 'Research the company Protected Fixture Labs' : question, persist: false }, true);
    expect(response.status).toBe(200); expect(body.coverage.stop_reason).toBe('error');
    expect(body.run_id).toEqual(expect.any(String)); expect(body.sources.length).toBeGreaterThan(0);
    expect(test.rows.research_runs).toEqual([]); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it.each([false, true])('withholds unexpected post-await error identities after a scope change (service=%s)', async service => {
    const test = fixture({ strategyError: true, switchAt: 'strategy-error' });
    const { response, body } = await test.run({ persist: false }, service);
    expect(test.strategy).toHaveBeenCalledTimes(1); expect(response.status).toBe(409); expect(body.outcome_unknown).toBe(true);
    expect(body.run_id).toBeUndefined(); expect(body.question).toBeUndefined(); expect(body.findings).toBeUndefined(); expect(body.sources).toBeUndefined();
    expect(test.rows.research_runs).toEqual([]); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('preserves the structured unexpected-error response when identity and scope still hold', async () => {
    const test = fixture({ strategyError: true }); const { response, body } = await test.run({ persist: false });
    expect(response.status).toBe(200); expect(body.coverage.stop_reason).toBe('error'); expect(body.run_id).toEqual(expect.any(String));
    expect(test.rows.research_runs).toEqual([]); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('runs the real citation/validation/persistence/receipt path with protected provider ports', async () => {
    const test = fixture({ cited: true }); const { body } = await test.run();
    expect(body.findings.length).toBeGreaterThan(0); expect(body.findings[0].citations).toEqual([1]);
    expect(body.sources).toHaveLength(1); expect(body).toMatchObject({ persistence_verified: true, receipt_recorded: true });
    expect(test.provider).toHaveBeenCalledTimes(2); expect(test.rows.research_runs[0].findings).toEqual(body.findings);
    expect(test.rows.research_sources[0].url).toBe(body.sources[0].url); expect(test.receipts.size).toBe(1);
  });
  it('records a persisted synthesis failure as failure, never useful findings or successful completion', async () => {
    const test = fixture({ cited: true, failedSynthesis: true }); const { body } = await test.run();
    expect(body.coverage.stop_reason).toBe('error'); expect(body.findings).toEqual([]);
    expect(body).toMatchObject({ persistence_verified: true, receipt_recorded: true, receipt_outcome: 'capability_failed' });
    expect(test.adminRpc.mock.calls[0][1]._outcome).toBe('capability_failed');
  });
  it.each([false, true])('preserves ordinary/delegated actor contract (service=%s) and records a truthful no-findings attempt', async service => {
    const test = fixture(); const { response, body } = await test.run({}, service);
    expect(response.status).toBe(200); expect(body.coverage.stop_reason).toBe('no_results');
    expect(body).toMatchObject({ persistence_verified: true, receipt_recorded: true });
    expect(test.provider).toHaveBeenCalledTimes(1); expect(test.rows.research_runs).toHaveLength(1); expect(test.receipts.size).toBe(1);
  });
  it('rejects a forged ordinary body actor before strategy/model/provider/persistence/receipt', async () => {
    const test = fixture(); const { response } = await test.run({ user_id: other });
    expect(response.status).toBe(403); expect(test.strategy).not.toHaveBeenCalled(); expect(test.model).not.toHaveBeenCalled(); expect(test.provider).not.toHaveBeenCalled(); expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it.each([{ actorMissing: true }, { identityError: true }, { profileError: true }, { scopeReadThrows: true }, { member: false }, { noTenant: true }])('refuses missing/revoked/unverifiable ordinary identity or workspace before effects: %j', async options => {
    const test = fixture(options); const { response } = await test.run();
    expect([401, 403]).toContain(response.status); expect(test.strategy).not.toHaveBeenCalled(); expect(test.model).not.toHaveBeenCalled(); expect(test.provider).not.toHaveBeenCalled(); expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it.each([{ actorMissing: true }, { member: false }, { noTenant: true }])('also refuses unverified delegated identity/workspace: %j', async options => {
    const test = fixture(options); const { response } = await test.run({}, true);
    expect([401, 403]).toContain(response.status); expect(test.strategy).not.toHaveBeenCalled(); expect(test.provider).not.toHaveBeenCalled(); expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('refuses a contradictory expected workspace before effects', async () => {
    const test = fixture(); const { response } = await test.run({ expected_tenant_id: other });
    expect(response.status).toBe(403); expect(test.provider).not.toHaveBeenCalled(); expect(test.strategy).not.toHaveBeenCalled(); expect(test.rows.research_runs).toHaveLength(0);
  });
  it('preserves explicit no-persist callers without manufacturing a saved report or receipt', async () => {
    const test = fixture(); const { body } = await test.run({ persist: false });
    expect(body.coverage.stop_reason).toBe('no_results'); expect(body.persistence_verified).not.toBe(true); expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('does not turn an unconfigured search into a saved run, useful findings or successful receipt', async () => {
    const test = fixture({ unconfigured: true }); const { body } = await test.run();
    expect(body.coverage.configured).toBe(false); expect(body.findings).toEqual([]); expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it.each(['search', 'run-insert', 'receipt'] as const)('withholds former-workspace result after a %s scope transition; never attributes it to the new tenant', async switchAt => {
    const test = fixture({ switchAt }); const { response, body } = await test.run();
    expect(response.status).toBe(409); expect(body.run_id).toBeUndefined(); expect(body.findings).toBeUndefined();
    expect(test.adminRpc.mock.calls.every(([, args]) => args._tenant_id === tenant && args._actor_id === actor)).toBe(true);
    if (switchAt === 'search') { expect(test.rows.research_runs).toHaveLength(0); expect(test.adminRpc).not.toHaveBeenCalled(); }
    if (switchAt === 'run-insert') expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('has filed its receipt before a completed HTTP acknowledgement can be lost', async () => {
    const test = fixture();
    await expect((async () => { const { response } = await test.run(); expect(response.status).toBe(200); throw new Error('fixture HTTP acknowledgement lost'); })()).rejects.toThrow('acknowledgement lost');
    expect(test.rows.research_runs).toHaveLength(1); expect(test.receipts.size).toBe(1); expect(test.provider).toHaveBeenCalledTimes(1);
  });
});
