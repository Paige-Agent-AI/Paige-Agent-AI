// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { executePortalRequestPublication } from '../../supabase/functions/_shared/client-portal-request-publication';
import { readEnvelopeStatus } from '../../supabase/functions/_shared/paige-turn/interactive';
import { confirmFingerprint } from '../../supabase/functions/_shared/confirm-fingerprint';

const source = ts.createSourceFile('index.ts', readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let dispatch: ts.Statement | undefined, target: ts.Expression | undefined;
function find(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'tc.function.name === PORTAL_REQUEST_SHARE_TOOL') dispatch = node.thenStatement;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'resolveWriteTargetId') target = node.initializer;
  ts.forEachChild(node, find);
}
find(source);
if (!dispatch || !target) throw Error('Original Root dispatch or locator is missing');
const body = ts.transpileModule(`async function run() ${dispatch.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const locator = ts.transpileModule(`const locate=${target.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const uuid = (n: number) => `e09fa000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function setup(options: { live?: boolean } = {}) {
  const scope = { actorId: uuid(1), tenantId: uuid(2), threadId: uuid(3), clientId: null, audience: 'owner' as const };
  const stored = { expected_tenant_id: uuid(2), contact_id: uuid(4), work_id: uuid(5), version: '2026-10-25T12:00:00.123456Z', title: 'Read the guide', body: 'Choose one milestone.', recipient_user_id: uuid(6), access_version: null };
  const fingerprint = await confirmFingerprint('client_portal_request_share',stored);
  const claim = { id: uuid(8), fingerprint, requestNonce: uuid(9), threadId: uuid(3), clientId: null };
  const response = { data: { schema_version: 1, actor_id: uuid(1), tenant_id: uuid(2), contact_id: uuid(4), work_id: uuid(5), customer_action_id: uuid(10), status: 'shared', replayed: false, published_at: '2026-10-25T13:00:00Z' } as unknown, error: null as unknown };
  const slot = { state: 'claimed', claim, dispatched: false };
  const token = fingerprint + ':' + uuid(7);
  const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ abortSignal: () => Promise.resolve(response) }));
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: uuid(1) } }, error: null })) };
  const record = vi.fn(async (_service: unknown, _options: Record<string, unknown>) => true);
  const revalidate = vi.fn(async () => true);
  const toolResults: Array<{ content: string }> = [];
  const state = { needsReview: false };
  const deps = { traceCtx: { content_policy: 'full' }, portalRequestContentCarried: false, portalRequestScope: () => scope,
    approvalChannel: new Map([['call-1', 'operator_card']]), approvalSpend: new Map([[token, 'call-1']]), portalRequestClaims: new Map([[token, slot]]),
    tc: { id: 'call-1', function: { name: 'client_portal_request_share', arguments: JSON.stringify(stored) } },
    liveRuntimeScope: options.live ? {} : null, portalRequestCurrent: () => true, executePortalRequestPublication, confirmFingerprint,
    supabaseClient: { rpc, auth }, req: { signal: new AbortController().signal }, requestExecutionState: state,
    supabase: {}, user: { id: uuid(1) }, revalidateProposalScope: revalidate, recordCapabilityRun: record, stableRunId: async () => uuid(11), toolResults, OUTCOME_UNKNOWN_NOTE: 'Check the original record.' };
  const run = new Function(...Object.keys(deps), `${body}; return run;`)(...Object.values(deps)) as () => Promise<void>;
  const result = () => JSON.parse(toolResults.at(-1)!.content);
  return { deps, scope, claim, stored, response, slot, token, rpc, record, revalidate, state, run, result };
}
it('forwards the actual common claim only to the original caller-JWT publisher', async () => {
  const f = await setup(); await f.run();
  expect(f.rpc).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenCalledWith('share_client_portal_request', { _expected_actor_id: uuid(1), _expected_tenant_id: uuid(2), _confirmation_id: uuid(8), _fingerprint: f.claim.fingerprint, _claimed_in_request: uuid(9), _thread_id: uuid(3) });
  expect(f.result()).toMatchObject({ success: true, verified_readback: true, record_locator: { table: 'paige_actions', id: uuid(5) }, customer_action_id: uuid(10) });
  expect(f.record.mock.calls[0][1]).toMatchObject({ capabilityKey: 'client_portal_request_share', outcome: 'capability_succeeded' });
});
it('does not execute a model-authored call without the original card channel', async () => {
  const f = await setup(); f.deps.approvalChannel.clear(); await f.run(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.result()).toMatchObject({ success: false, not_applied: true });
});
it('does not execute through voice approval or an absent common claim', async () => {
  for (const mode of ['live', 'no-claim']) { const f = await setup({ live: mode === 'live' }); if (mode === 'no-claim') f.deps.portalRequestClaims.clear(); await f.run(); expect(f.rpc).not.toHaveBeenCalled(); }
});
it('never dispatches a claimed approval twice, including after uncertain acknowledgment', async () => {
  const f = await setup(); f.response.data = null; f.response.error = { code: '503' }; await f.run(); await f.run();
  expect(f.rpc).toHaveBeenCalledOnce(); expect(f.state.needsReview).toBe(true); expect(f.slot.dispatched).toBe(true);
});
it('does not report native denials or malformed receipts as completed sharing', async () => {
  for (const mode of ['denied', 'malformed']) { const f = await setup(); if (mode === 'denied') { f.response.data = null; f.response.error = { code: '42501' }; } else (f.response.data as Record<string, unknown>).work_id = uuid(99); await f.run(); expect(f.result().success).toBe(false); expect(f.result().verified_readback).toBeUndefined(); expect(f.state.needsReview).toBe(mode === 'malformed'); }
});
it('refuses changed business scope and additional model-authored fields before dispatch', async () => {
  for (const mode of ['business', 'extra']) { const f = await setup(); if (mode === 'business') f.scope.tenantId = uuid(99); else f.deps.tc.function.arguments = JSON.stringify({ ...f.stored, approved: true }); await f.run(); expect(f.rpc).not.toHaveBeenCalled(); }
});
it('a missing telemetry acknowledgement does not erase a verified native result', async () => {
  const f = await setup(); f.record.mockResolvedValue(false); await f.run(); expect(f.result()).toMatchObject({ success: true, verified_readback: true });
});
it('binds the original claimed call independently of reused provider call identifiers',async()=>{
  const f=await setup(),otherFingerprint=await confirmFingerprint('client_portal_request_share',{...f.stored,work_id:uuid(99)});
  const otherToken=otherFingerprint+':'+uuid(70);
  f.deps.approvalSpend.clear();f.deps.approvalSpend.set(otherToken,'call-1');f.deps.approvalSpend.set(f.token,'call-1');
  f.deps.portalRequestClaims.set(otherToken,{state:'claimed',claim:{...f.claim,id:uuid(88),fingerprint:otherFingerprint},dispatched:false});
  await f.run();expect(f.rpc).toHaveBeenCalledOnce();expect(f.rpc.mock.calls[0][1]).toMatchObject({_confirmation_id:uuid(8),_fingerprint:f.claim.fingerprint});
});
it('does not dispatch words changed after the original claim was captured',async()=>{
  const f=await setup();f.deps.tc.function.arguments=JSON.stringify({...f.stored,body:'Different words after approval.'});
  await f.run();expect(f.rpc).not.toHaveBeenCalled();expect(f.result()).toMatchObject({success:false,not_applied:true});
});
it('withholds a native result if current business authority retires before the reply',async()=>{
  for(const mode of ['retired','unavailable']){
    const f = await setup();if(mode==='retired')f.revalidate.mockResolvedValue(false);else f.revalidate.mockRejectedValue(new Error('Original scope unavailable'));
    await f.run();expect(f.rpc).toHaveBeenCalledOnce();expect(f.result()).toMatchObject({success:false,outcome_unknown:true});
    expect(f.result().work_id).toBeUndefined();expect(f.state.needsReview).toBe(true);
    expect(f.record.mock.calls[0][1]).toMatchObject({outcome:'capability_succeeded',detail:{result_withheld:true}});
    await f.run();expect(f.rpc).toHaveBeenCalledOnce();
  }
});
it('attributes sharing only to verified original Work, never the related contact', () => {
  const locate = new Function('UUID', 'TARGET_ID_KEYS', 'WRITE_TARGET', `${locator};return locate;`)(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, ['contact_id'], {});
  const args = { contact_id: uuid(4), work_id: uuid(5) }, out = { success: true, verified_readback: true, work_id: uuid(5), record_locator: { table: 'paige_actions', id: uuid(5) } };
  expect(locate(args, out, 'client_portal_request_share')).toBe(uuid(5));
  expect(locate(args, { ...out, verified_readback: false }, 'client_portal_request_share')).toBeNull();
  expect(locate(args, { ...out, record_locator: { table: 'clients', id: uuid(4) } }, 'client_portal_request_share')).toBeNull();
});
it('words original-source reconciliation as an existing share rather than a fresh act', () => {
  const raw = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
  const from = raw.indexOf('function toolResultReportsFailure'), to = raw.indexOf('// One home for turning a client_ref');
  expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(raw.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const describe = new Function('readEnvelopeStatus', `${js};return describeStep;`)(readEnvelopeStatus);
  const call = { function: { name: 'client_portal_request_share', arguments: '{}' } };
  expect(describe(call, { content: JSON.stringify({ success: true, already_shared: true }) }).label).toBe('Confirmed the request was already shared');
  expect(describe(call, { content: JSON.stringify({ success: true, replayed: true }) }).label).toBe('Confirmed the request was already shared');
  expect(describe(call, { content: JSON.stringify({ success: true }) }).label).toBe('Shared the saved customer request');
  expect(describe(call, { content: JSON.stringify({ success: false, outcome_unknown: true }) }).label).toBe("Couldn't verify that request was shared");
});
