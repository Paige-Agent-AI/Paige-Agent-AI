// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { bindKnowledgeIngestScope, KnowledgeIngestScopeError } from '../../supabase/functions/_shared/knowledge-ingest-scope';
import { recordCapabilityRun, stableRunId } from '../../supabase/functions/_shared/capability-record';
import { OUTCOME_UNKNOWN_NOTE } from '../../supabase/functions/_shared/approval-outcome';

const tenant = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const doc = '00000000-0000-4000-8000-000000000003';
const other = '00000000-0000-4000-8000-000000000004';
const privateText = 'Private fixture body never belongs in a Rail payload';
const verified = { ok: true, doc_id: doc, chunk_count: 1, embedded: true };
type Result = Record<string, unknown>;

// Execute the existing Edge handler and real scope/receipt helpers. Only the SDK,
// ingestion-core and provider boundary are ports; core persistence has its own suite.
function setup(options: { result?: Result; recorderError?: boolean; lostReceiptAcknowledgement?: boolean; switchAfterIngest?: boolean; switchDuringReceipt?: boolean; throwIngest?: boolean } = {}) {
  let active = tenant;
  let handler!: (req: Request) => Promise<Response>;
  const events = new Map<string, Result>();
  const documents = new Map<string, Result>();
  const adminRpc = vi.fn(async (name: string, args: Result) => {
    expect(name).toBe('record_capability_run');
    if (options.switchDuringReceipt) active = other;
    if (options.recorderError) return { data: null, error: { message: 'fixture receipt unavailable' } };
    const key = [args._tenant_id, args._run_id, args._outcome].join(':');
    events.set(key, args);
    if (options.lostReceiptAcknowledgement) return { data: null, error: { message: 'fixture receipt acknowledgement lost' } };
    return { data: null, error: null };
  });
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    from: (table: string) => {
      expect(table).toBe('profiles');
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { active_tenant_id: active }, error: null }) };
      return query;
    },
    rpc: async (name: string) => ({ data: name === 'is_tenant_member', error: null }),
  };
  const admin = { rpc: adminRpc };
  const ingest = vi.fn(async (client: unknown, params: Result, ports: { docClient: unknown; authorize: () => Promise<void> }) => {
    expect(client).toBe(admin); expect(ports.docClient).toBe(caller);
    expect(params).toMatchObject({ tenantId: tenant, created_by: actor, share_to_network: false });
    await ports.authorize();
    if (options.throwIngest) throw Error('fixture ingestion acknowledgement lost');
    const result = options.result ?? verified;
    if (result.doc_id) documents.set(String(result.doc_id), { tenant_id: tenant, content: privateText });
    if (options.switchAfterIngest) active = other;
    return result;
  });
  const scope = { serve: (fn: typeof handler) => { handler = fn; }, z, bindKnowledgeIngestScope, KnowledgeIngestScopeError,
    recordCapabilityRun, stableRunId, ingestDoc: ingest,
    Deno: { env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'fixture-service' : 'fixture-anon' } },
    createClient: (_url: string, key: string) => key === 'fixture-service' ? admin : caller };
  const source = readFileSync('supabase/functions/kb-ingest-doc/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
  new Function(...Object.keys(scope), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(...Object.values(scope));
  const run = async (body: Result = {}) => {
    const response = await handler(new Request('https://local.test/kb-ingest-doc', { method: 'POST',
      headers: { Authorization: 'Bearer fixture-caller' }, body: JSON.stringify({ title: 'Fixture reference', content: privateText, ...body }) }));
    return { response, body: await response.json() };
  };
  return { run, adminRpc, events, documents, ingest };
}

async function chatThroughNative(test: ReturnType<typeof setup>, loseAcknowledgement = false) {
  const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
  const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
  let branch: ts.Statement | undefined;
  const visit = (node: ts.Node) => { if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "save_to_knowledge_base"') branch = node.thenStatement; ts.forEachChild(node, visit); };
  visit(ast); if (!branch) throw Error('Existing Knowledge consumer missing');
  const code = ts.transpileModule(`async function dispatch(tc,supabaseUrl,authHeader,fetch,toolResults,personaCtx,OUTCOME_UNKNOWN_NOTE,requestExecutionState) ${branch.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dispatch = new Function(`${code};return dispatch;`)();
  const results: Array<{ content: string }> = []; const state = { needsReview: false };
  await dispatch({ id: 'native-save-fixture', function: { name: 'save_to_knowledge_base', arguments: JSON.stringify({ title: 'Fixture reference', content: privateText }) } },
    'https://local.test', 'Bearer fixture-caller', async (_url: string, init: { body: string }) => {
      const native = await test.run(JSON.parse(init.body));
      if (loseAcknowledgement) throw new TypeError('fixture response lost after native completion');
      return Response.json(native.body, { status: native.response.status });
    }, results, { tenant_id: tenant }, OUTCOME_UNKNOWN_NOTE, state);
  return { result: JSON.parse(results[0].content), state };
}

describe('Knowledge native executor workspace receipts', () => {
  it('records the verified save with the existing admin and stable document identity, without private content', async () => {
    const test = setup(); const { body } = await test.run();
    expect(test.adminRpc).toHaveBeenCalledTimes(1);
    const args = test.adminRpc.mock.calls[0][1];
    expect(args).toMatchObject({ _tenant_id: tenant, _actor_id: actor, _capability_key: 'save_to_knowledge_base', _outcome: 'capability_succeeded',
      _detail: { document_id: doc, chunk_count: 1, indexing_complete: true } });
    expect(args._run_id).toBe(await stableRunId(['save_to_knowledge_base', tenant, doc]));
    expect(JSON.stringify(args)).not.toContain(privateText);
    expect(body).toMatchObject({ ...verified, verified: true, railRecorded: true, outcome: 'capability_succeeded', run_id: args._run_id });
    expect(test.documents.size).toBe(1);
  });
  it('deduplicates only the receipt for the same native document, without claiming ingestion exactly-once', async () => {
    const test = setup(); await test.run(); await test.run();
    expect(test.adminRpc).toHaveBeenCalledTimes(2); expect(test.events.size).toBe(1);
    expect(test.ingest).toHaveBeenCalledTimes(2);
  });
  it('records persisted partial indexing without claiming all content is searchable', async () => {
    const test = setup({ result: { ...verified, embedded: false } }); const { body } = await test.run();
    expect(body).toMatchObject({ ok: true, verified: true, embedded: false, railRecorded: true });
    expect(test.adminRpc.mock.calls[0]?.[1]._detail).toMatchObject({ indexing_complete: false });
  });
  it('keeps the verified document when its receipt fails and preserves native ingestion compatibility', async () => {
    const test = setup({ recorderError: true }); const { body } = await test.run();
    expect(body).toMatchObject({ ...verified, verified: true, railRecorded: false, outcome: 'capability_completed_unrecorded' });
    expect(test.documents.size).toBe(1); expect(test.ingest).toHaveBeenCalledTimes(1); expect(test.events.size).toBe(0);
  });
  it('refuses another workspace before ingestion or receipt', async () => {
    const test = setup(); const { response } = await test.run({ tenant_id: other });
    expect(response.status).toBe(403); expect(test.ingest).not.toHaveBeenCalled(); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('does not turn a post-ingestion workspace switch into an authorized receipt or expose its prior doc identity', async () => {
    const test = setup({ switchAfterIngest: true }); const { body } = await test.run();
    expect(body).toMatchObject({ ok: false, error: 'persistence_unverified' });
    expect(body.doc_id).toBeUndefined(); expect(test.adminRpc).not.toHaveBeenCalled(); expect(test.documents.size).toBe(1);
  });
  it('does not report completion in a changed workspace after receipt dispatch', async () => {
    const test = setup({ switchDuringReceipt: true }); const { body } = await test.run();
    expect(body).toMatchObject({ ok: false, error: 'persistence_unverified' }); expect(body.doc_id).toBeUndefined();
    expect(test.adminRpc.mock.calls[0][1]._tenant_id).toBe(tenant);
  });
  it.each([
    { ok: false, error: 'persistence_unverified', doc_id: doc, chunk_count: 0, embedded: false },
    { ok: false, error: 'persistence_unverified', chunk_count: 0, embedded: false },
    { ok: false, error: 'embedding_failed', not_applied: true, chunk_count: 0, embedded: false },
  ])('never files a successful receipt for an unverified or absent save: %j', async result => {
    const test = setup({ result }); const { body } = await test.run();
    expect(body.ok).toBe(false);
    expect(test.adminRpc.mock.calls.every(([, args]) => args._outcome !== 'capability_succeeded')).toBe(true);
  });
  it('does not retry an unknown ingestion or fabricate a document identity', async () => {
    const test = setup({ throwIngest: true }); const { body } = await test.run();
    expect(body).toMatchObject({ ok: false, error: 'persistence_unverified' }); expect(body.doc_id).toBeUndefined();
    expect(test.ingest).toHaveBeenCalledTimes(1); expect(test.adminRpc).not.toHaveBeenCalled();
  });
  it('has already filed the native receipt if its completed HTTP acknowledgement is subsequently lost', async () => {
    const test = setup(); const { result, state } = await chatThroughNative(test, true);
    expect(result).toMatchObject({ success: false, outcome_unknown: true }); expect(state.needsReview).toBe(true);
    expect(test.events.size).toBe(1); expect(test.documents.size).toBe(1); expect(test.ingest).toHaveBeenCalledTimes(1);
  });
  it('carries the actual native missing-receipt result to the unchanged Chat action path without repeating ingestion', async () => {
    const test = setup({ recorderError: true }); const { result, state } = await chatThroughNative(test);
    expect(result).toMatchObject({ success: false, verified: true, railRecorded: false, outcome: 'capability_completed_unrecorded', knowledge_doc_id: doc });
    expect(state.needsReview).toBe(false); expect(test.documents.size).toBe(1); expect(test.ingest).toHaveBeenCalledTimes(1);
  });
  it('does not assert receipt absence after its committed RPC acknowledgement was lost', async () => {
    const test = setup({ lostReceiptAcknowledgement: true }); const { result } = await chatThroughNative(test);
    expect(test.events.size).toBe(1); expect(test.documents.size).toBe(1); expect(test.ingest).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ verified: true, railRecorded: false, outcome: 'capability_completed_unrecorded' });
    expect(result.note).toContain('activity record could not be confirmed'); expect(result.note).not.toContain('record is missing');
  });
  it('preserves both partial indexing and unconfirmed receipt facts across native executor and Chat', async () => {
    const test = setup({ result: { ...verified, embedded: false }, recorderError: true });
    const { result } = await chatThroughNative(test);
    expect(result).toMatchObject({ verified: true, partial: true, embedded: false, railRecorded: false, outcome: 'capability_completed_unrecorded' });
    expect(result.note).toMatch(/activity record could not be confirmed.*Indexing is incomplete/);
    expect(test.documents.size).toBe(1); expect(test.ingest).toHaveBeenCalledTimes(1);
  });
});
