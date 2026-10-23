import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rpc: vi.fn(), model: vi.fn(), authorized: true,
  handler: null as null | ((request: Request) => Promise<Response>) }));
vi.mock('../../supabase/functions/_shared/systems-check-http.ts', () => ({
  adminClient: () => ({ rpc: state.rpc }), isAuthorizedInternalCaller: async () => state.authorized,
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../../supabase/functions/_shared/model-router.ts', () => ({ callModel: state.model }));
const workId = 'a3400000-0000-4000-8000-000000000081';
const tenantId = 'a3400000-0000-4000-8000-000000000011';
const turnId = 'a3400000-0000-4000-8000-000000000082';
function payload(cadence: 'month' | 'quarter' = 'month') {
  const end = new Date(Date.now() - 60_000).toISOString();
  const start = new Date(Date.now() - 30 * 86400_000).toISOString();
  return { version: 1, doc_type: 'business_review', title: 'Recorded business review', brief: 'Inspect recorded receipts.',
    report_period: { key: cadence, start, end }, report_evidence: { version: 1, captured_at: end, measurements: [{
      metric_key: 'sales.cash.recorded_received', metric_version: '1.0.0', owner_department: 'sales', label: 'Recorded cash',
      definition: 'Recorded receipts in the source period.', formula: 'SUM(recorded receipts)', unit: 'currency_minor', dimensions: {},
      range: { key: cadence, start, end, bounds: '[start,end)', timezone: 'UTC', semantics: 'event_timestamp_cohort' },
      values: { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '20000', record_count: 1 }], breakdown: [] },
      source_refs: ['public.paige_invoice_payments'], as_of: end, freshness: { queried_at: end, source_updated_through: null },
      coverage: { state: 'complete', candidate_count: 1, contributing_count: 1, excluded_count: 0 }, exclusions: [],
      truth_state: 'LIVE', caveats: ['Recorded receipts do not establish bank settlement.'],
      source_revision_ref: `sr_v1_${'a'.repeat(64)}`, evidence_ref: `aneb_v1_${'b'.repeat(64)}`,
      reference_expires_at: new Date(Date.parse(end) + 15 * 60_000).toISOString(),
    }] } };
}
const completed = () => [{ content_id: workId, work_status: 'succeeded', receipt_recorded: true, document_revision: 1, completion_turn_id: turnId }];
let stored: ReturnType<typeof payload>;
let completeResult: { data: unknown; error: unknown };
let settlement: ((args: Record<string, unknown>) => unknown);
beforeEach(async () => {
  vi.resetModules(); state.rpc.mockReset(); state.model.mockReset(); state.authorized = true;
  stored = payload(); completeResult = { data: completed(), error: null };
  settlement = args => ({ data: args._new_status, error: null });
  state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'start_paige_document_work_execution') return { data: [{ work_id: workId, work_status: 'claimed',
      server_idempotency_key: 'original-server-key', tenant_id: tenantId, initiating_user_id: turnId,
      thread_id: turnId, attempt_count: 1, request_payload: stored }], error: null };
    if (name === 'complete_paige_document_work') return completeResult;
    if (name === 'settle_paige_document_work_failure') return settlement(args);
    throw new Error(`Unexpected original RPC: ${name}`);
  });
  vi.stubGlobal('Deno', { env: { get: () => 'isolated-only' }, serve: (handler: typeof state.handler) => { state.handler = handler; } });
  const path = '../../supabase/functions/paige-document-worker/index.ts';
  await import(/* @vite-ignore */ path);
});
afterEach(() => vi.unstubAllGlobals());
const run = async () => {
  const response = await state.handler!(new Request('https://worker.invalid', { method: 'POST',
    body: JSON.stringify({ mode: 'run', work_id: workId, report_evidence: { forged: true } }) }));
  return { http: response.status, body: await response.json() };
};
const names = () => state.rpc.mock.calls.map(([name]) => name);
describe('original document handler consumes native captured business reviews', () => {
  it.each(['month', 'quarter'] as const)('persists %s facts without a model or caller-supplied evidence', async cadence => {
    stored = payload(cadence);
    expect((await run()).body).toMatchObject({ ok: true, status: 'succeeded', content_id: workId, receipt_recorded: true, verified_readback: true });
    const args = state.rpc.mock.calls.find(([name]) => name === 'complete_paige_document_work')![1];
    expect(args).toMatchObject({ _work_id: workId, _server_idempotency_key: 'original-server-key', _doc_type: 'business_review', _provider: null, _model: null, _tokens_used: 0 });
    expect(JSON.stringify(args._blocks)).toContain('USD 200.00');
    expect(JSON.stringify(args._blocks)).toContain('bank settlement');
    expect(JSON.stringify(args._blocks)).not.toMatch(/aneb_v1_|a3400000|forged/);
    expect(names()).toEqual(['start_paige_document_work_execution', 'complete_paige_document_work']);
    expect(state.model).not.toHaveBeenCalled();
  });
  it('refuses an untrusted caller before any work read', async () => {
    state.authorized = false; expect((await run()).http).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('honors the original current-authority block before formatting or writing', async () => {
    state.rpc.mockResolvedValueOnce({ data: [{ work_status: 'blocked' }], error: null });
    expect((await run()).body).toMatchObject({ status: 'blocked', blocked_reason: 'authority_changed' });
    expect(names()).toHaveLength(1); expect(state.model).not.toHaveBeenCalled();
  });
  it('never redispatches an original claimed attempt', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DURABLE_WORK_ALREADY_DISPATCHED' } });
    expect((await run()).body).toMatchObject({ duplicate_dispatch_prevented: true }); expect(names()).toHaveLength(1);
  });
  it.each(['capture', 'period', 'revision', 'title', 'version'] as const)('refuses invalid %s and records only verified original failure', async field => {
    if (field === 'capture') stored.report_evidence.measurements = [];
    if (field === 'period') stored.report_period.start = 'unavailable';
    if (field === 'revision') Object.assign(stored, { target_content_id: workId });
    if (field === 'title') stored.title = ' ';
    if (field === 'version') stored.version = 2;
    expect((await run()).body).toMatchObject({ ok: false, status: 'failed', settlement_verified: true });
    expect(names()).toEqual(['start_paige_document_work_execution', 'settle_paige_document_work_failure']);
    expect(state.model).not.toHaveBeenCalled();
  });
  it.each([null, [], [{ ...completed()[0], receipt_recorded: false }], [{ ...completed()[0], content_id: turnId }],
    [{ ...completed()[0], completion_turn_id: 'not-an-id' }], [...completed(), ...completed()]])('withholds success for incomplete or mismatched completion %j', async data => {
    completeResult = { data, error: null };
    expect((await run()).body).toMatchObject({ ok: false, status: 'outcome_unknown', settlement_verified: true, reconciliation_required: true });
    expect(state.model).not.toHaveBeenCalled();
  });
  it('distinguishes a native authority refusal from an ambiguous completion', async () => {
    completeResult = { data: null, error: { code: '42501', message: 'DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED' } };
    expect((await run()).body).toMatchObject({ status: 'failed', settlement_verified: true });
  });
  it.each(['network', '08006'] as const)('keeps %s completion uncertainty on the same work', async code => {
    completeResult = { data: null, error: { code, message: 'transport not confirmed' } };
    expect((await run()).body).toMatchObject({ status: 'outcome_unknown', reconciliation_required: true });
    expect(names()).toEqual(['start_paige_document_work_execution', 'complete_paige_document_work', 'settle_paige_document_work_failure']);
  });
  it.each(['error', 'empty', 'throw'] as const)('does not manufacture terminal failure when settlement is %s', async mode => {
    stored.report_evidence.measurements = [];
    settlement = () => { if (mode === 'throw') throw new Error('unconfirmed'); return { data: null, error: mode === 'error' ? { code: '08006' } : null }; };
    expect((await run()).body).toMatchObject({ status: 'outcome_unknown', error_code: 'business_review_outcome_unknown', settlement_verified: false, reconciliation_required: true });
  });
  it('rejects mismatched original work identity without using another work key', async () => {
    state.rpc.mockResolvedValueOnce({ data: [{ work_id: turnId, work_status: 'claimed', server_idempotency_key: 'wrong', request_payload: stored }], error: null });
    expect((await run()).http).toBe(500); expect(names()).toHaveLength(1); expect(state.model).not.toHaveBeenCalled();
  });
});
