// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { classifySpentApproval, OUTCOME_UNKNOWN_NOTE } from '../../supabase/functions/_shared/approval-outcome';
import { interactiveEffect } from '../../supabase/functions/_shared/paige-turn/interactive';

const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Statement | undefined;
let reconciliationGuard: ts.IfStatement | undefined;
function visit(n: ts.Node) {
  if (ts.isIfStatement(n) && n.expression.getText(ast).includes('MUTATING_TOOLS.has(tc.function.name)')
    && n.thenStatement.getText(ast).includes('prior_effect_reconciliation_required')) reconciliationGuard = n;
  if (ts.isIfStatement(n) && n.expression.getText(ast) === 'tc.function.name === "save_to_knowledge_base"') branch = n.thenStatement;
  ts.forEachChild(n, visit);
}
visit(ast);
if (!branch) throw new Error('Canonical ingestion dispatch missing');
const code = ts.transpileModule(`async function dispatch(tc, supabaseUrl, authHeader, fetch, toolResults,
  personaCtx, OUTCOME_UNKNOWN_NOTE, requestExecutionState) ${branch.getText(ast)}`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dispatch = new Function(`${code}; return dispatch;`)();
const tenant = '00000000-0000-4000-8000-000000000001';
const doc = '00000000-0000-4000-8000-000000000002';
const args = { title: 'Fixture reference', content: 'Private fixture content', tenant_id: 'model-tenant', share_to_network: true };
async function drive(data: unknown, options: { status?: number; raw?: string; thrown?: unknown; tenant?: string | null } = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [], outputs: Array<{ content: string }> = [];
  const requestExecutionState = { needsReview: false };
  await dispatch({ id: 'ingest-call', function: { name: 'save_to_knowledge_base', arguments: JSON.stringify(args) } },
    'https://local.test', 'Bearer fixture-only', async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if ('thrown' in options) throw options.thrown;
      return new Response(options.raw ?? JSON.stringify(data), { status: options.status ?? 200 });
    }, outputs, { tenant_id: 'tenant' in options ? options.tenant : tenant }, OUTCOME_UNKNOWN_NOTE, requestExecutionState);
  expect(outputs).toHaveLength(1);
  return { result: JSON.parse(outputs[0].content), calls, requestExecutionState };
}
describe('Knowledge Chat ingestion uses native scope and outcome evidence', () => {
  it('keeps the uncertain save separate from its definitely unexecuted approved successor', async () => {
    const prior = await drive(null, { thrown: new TypeError('Lost ingestion acknowledgement') });
    if (!reconciliationGuard) throw new Error('Canonical reconciliation guard missing');
    const run = new Function('MUTATING_TOOLS', 'requestExecutionState', 'interactive', 'interactiveReceiptScanSaturated',
      'interactiveUnresolvedEffects', 'tc', `const toolResults=[]; let dispatches=0; for(let i=0;i<1;i++) {
      ${reconciliationGuard.getText(ast)} dispatches++; } return { toolResults, dispatches };`);
    const observed = run(new Set(['plan_create']), prior.requestExecutionState, false, false, [],
      { id: 'approved-successor', function: { name: 'plan_create', arguments: '{}' } });
    expect(observed.dispatches).toBe(0);
    const result = JSON.parse(observed.toolResults[0].content);
    expect(result).toMatchObject({ success: false, not_applied: true, refused_before_run: true });
    expect(classifySpentApproval(JSON.stringify(result)).outcome).toBe('not_run');
    expect(interactiveEffect('plan_create', result)).toBeNull();
    expect(interactiveEffect('save_to_knowledge_base', prior.result)?.outcome).toBe('outcome_unknown');
  });
  it('pins the native request to the server workspace and preserves the ordinary caller JWT', async () => {
    const { calls } = await drive({ ok: true, doc_id: doc, chunk_count: 2, embedded: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ tenant_id: tenant, source: 'paste', share_to_network: false });
    expect(calls[0].headers.Authorization).toBe('Bearer fixture-only');
  });
  it('refuses unresolved workspace before any ingestion request', async () => {
    const { calls, result } = await drive({}, { tenant: null });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false, not_applied: true });
  });
  it.each([{}, { ok: true }, { ok: true, doc_id: doc }, { ok: true, doc_id: doc, chunk_count: 0, embedded: true },
    { ok: true, doc_id: 'bad-id', chunk_count: 1, embedded: true }, { ok: true, doc_id: doc, chunk_count: 1 }])('never treats an incomplete HTTP200 body as saved: %j', async data => {
      const { result } = await drive(data);
      expect(result).toMatchObject({ success: false, outcome_unknown: true });
    });
  it('requires actual native document and indexed-chunk evidence for full success', async () => {
    const { result, requestExecutionState } = await drive({ ok: true, doc_id: doc, chunk_count: 2, embedded: true });
    expect(result).toMatchObject({ success: true, doc_id: doc, chunk_count: 2, embedded: true });
    expect(requestExecutionState.needsReview).toBe(false);
  });
  it('does not claim complete indexing when the native core saved only part of the content', async () => {
    const { result } = await drive({ ok: true, doc_id: doc, chunk_count: 1, embedded: false });
    expect(result).toMatchObject({ success: true, partial: true, embedded: false });
    expect(result.note).toMatch(/part|incomplete/i);
    expect(result.note).not.toMatch(/retry|searchable now/i);
  });
  it('preserves unverified persistence and prevents a blind repeat', async () => {
    const { result, requestExecutionState } = await drive({ ok: false, doc_id: doc, chunk_count: 0, embedded: false, error: 'persistence_unverified' }, { status: 400 });
    expect(result).toMatchObject({ success: false, outcome_unknown: true, doc_id: doc });
    expect(result.note).not.toMatch(/did not save|did NOT save|will.*retry/i);
    expect(classifySpentApproval(JSON.stringify(result)).outcome).toBe('unconfirmed');
    expect(interactiveEffect('save_to_knowledge_base', result)?.outcome).toBe('outcome_unknown');
    expect(requestExecutionState.needsReview).toBe(true);
    expect(interactiveEffect('save_to_knowledge_base', result)?.record_refs).toContainEqual({ kind: 'knowledge_document', id: doc });
  });
  it('an explicit native pre-ingestion refusal remains not-applied', async () => {
    const { result } = await drive({ error: 'Unauthorized', ingestion_started: false }, { status: 401 });
    expect(result).toMatchObject({ success: false, not_applied: true });
    expect(result.outcome_unknown).not.toBe(true);
  });
  it('lost HTTP responses remain uncertain and the request is never retried automatically', async () => {
    const { result, calls } = await drive(null, { thrown: new TypeError('Failed to fetch') });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(calls).toHaveLength(1);
  });
  it('a malformed HTTP response is not a successful save', async () => {
    const { result } = await drive(null, { raw: '<html>upstream unavailable</html>' });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('preserves the core verified-removal decision without treating every failure as absence', async () => {
    const { result } = await drive({ ok: false, chunk_count: 0, embedded: false, not_applied: true, error: 'embedding_failed' });
    expect(result).toMatchObject({ success: false, not_applied: true });
    expect(classifySpentApproval(JSON.stringify(result)).outcome).toBe('not_run');
  });
  it('refuses contradictory native success and non-application evidence', async () => {
    const { result } = await drive({ ok: true, doc_id: doc, chunk_count: 2, embedded: true, not_applied: true });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
});
