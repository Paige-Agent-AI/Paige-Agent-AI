// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';
import { TEAM_HUB_EGRESS_WITHHELD_TOOLS, teamHubSessionTainted } from '../../supabase/functions/_shared/team-hub/chat';

const raw = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const source = ts.createSourceFile('index.ts', raw, ts.ScriptTarget.Latest, true);
let guard: ts.IfStatement | undefined;
function find(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source).includes('portalRequestContentCarried')
    && node.expression.getText(source).includes('TEAM_HUB_EGRESS_WITHHELD_TOOLS')) guard = node;
  ts.forEachChild(node, find);
}
find(source);
if (!guard) throw Error('Original per-call privacy guard absent');
const compiled = ts.transpileModule(`function gate(calls) { const toolResults=[]; const reached=[]; for(const tc of calls) { ${guard.getText(source)} reached.push(tc.function.name); } return {toolResults,reached}; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const run = (carried: boolean, names: string[]) => new Function('portalRequestContentCarried', 'TEAM_HUB_EGRESS_WITHHELD_TOOLS', `${compiled};return gate;`)(carried, TEAM_HUB_EGRESS_WITHHELD_TOOLS)(names.map((name, i) => ({ id: String(i), function: { name } })));

let tracePrivacy: ts.IfStatement | undefined;
function findTrace(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source).includes('!customerPortal')
    && node.getText(source).includes('[PORTAL_REQUEST_SHARE_TOOL], PORTAL_REQUEST_SHARE_TOOL')) tracePrivacy = node;
  ts.forEachChild(node, findTrace);
}
findTrace(source);
if (!tracePrivacy) throw Error('Original Portal trace privacy branch missing');
const traceCode = ts.transpileModule(`async function inspect(){${tracePrivacy.getText(source)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function inspectTrace(flags: { conversational?: boolean; recovery?: boolean; customer?: boolean; tainted?: boolean } = {}) {
  let reads = 0;
  const traceCtx = { content_policy: 'full' };
  const names = ['customerPortal', 'interactiveConversational', 'interactiveRecoveryReadOnly', 'traceCtx', 'supabase', 'user', 'personaCtx', 'PORTAL_REQUEST_SHARE_TOOL', 'teamHubSessionTainted'];
  const values = [!!flags.customer, !!flags.conversational, !!flags.recovery, traceCtx, {}, { id: 'test-actor' }, { tenant_id: 'test-business' }, 'client_portal_request_share', async () => { reads++; return !!flags.tainted; }];
  await new Function(...names, `${traceCode};return inspect;`)(...values)();
  return { reads, policy: traceCtx.content_policy };
}
it('keeps conversational and read-only recovery off the approval store while withholding private traces', async () => {
  for (const flags of [{ conversational: true }, { recovery: true }, { conversational: true, recovery: true }]) {
    expect(await inspectTrace(flags)).toEqual({ reads: 0, policy: 'metadata_only' });
  }
});
it('retains admitted owner trace checks and leaves the customer private path separate', async () => {
  expect(await inspectTrace()).toEqual({ reads: 1, policy: 'full' });
  expect(await inspectTrace({ tainted: true })).toEqual({ reads: 1, policy: 'metadata_only' });
  expect(await inspectTrace({ customer: true })).toEqual({ reads: 0, policy: 'full' });
});

it('keeps untainted owner turns on the original path', () => {
  expect(run(false, ['web_fetch', 'web_search', 'save_to_knowledge_base', 'crm_log_activity']).reached).toEqual(['web_fetch', 'web_search', 'save_to_knowledge_base', 'crm_log_activity']);
});
it('blocks private request egress before each subsequent tool reaches dispatch', () => {
  const result = run(true, ['web_fetch', 'web_search', 'save_to_knowledge_base', 'crm_log_activity']);
  expect(result.reached).toEqual([]); expect(result.toolResults).toHaveLength(4);
  for (const row of result.toolResults) expect(JSON.parse(row.content)).toMatchObject({ success: false, not_applied: true, refused_before_run: true });
});
it('reuses the existing classifier while retaining the original approval lane', () => {
  expect(run(true, ['client_portal_request_share']).reached).toEqual(['client_portal_request_share']);
  expect(raw.indexOf(guard!.getText(source))).toBeLessThan(raw.indexOf('executed.push(tc);', raw.indexOf(guard!.getText(source))));
});
it('retains Team Hub own flag, assignment and round-level filter unchanged', () => {
  expect([...raw.matchAll(/teamHubContentCarried = ([a-z]+)/g)].map(x => x[1])).toEqual(['false', 'true']);
  expect(raw).toContain('const teamHubWithheld = teamHubContentCarried ? roundCalls.filter');
});
it('uses original actor-recorded cards and receipts for later private-summary protection', async () => {
  const actor = 'e09fa000-0000-4000-8000-000000000001', tenant = 'e09fa000-0000-4000-8000-000000000002';
  const filters: unknown[][] = [];
  const service = { from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'limit']) q[name] = (...args: unknown[]) => { filters.push([table, name, ...args]); return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === 'tenant_members' ? [{ tenant_id: tenant }] : table === 'paige_pending_confirmations' ? [{ id: 'test-existing-card' }] : [], error: null }));
    return q as never;
  } };
  expect(await teamHubSessionTainted(service, actor, [tenant], ['client_portal_request_share'], 'client_portal_request_share')).toBe(true);
  expect(filters).toContainEqual(['paige_pending_confirmations', 'eq', 'user_id', actor]);
  expect(filters).toContainEqual(['paige_pending_confirmations', 'eq', 'tool_name', 'client_portal_request_share']);
  expect(filters).toContainEqual(['paige_workspace_events', 'in', 'capability_key', ['client_portal_request_share']]);
});
it('wires Portal privacy separately before summary model calls and retains the original Team Hub contract', () => {
  const summary = raw.slice(raw.indexOf('// === SESSION SUMMARY GENERATION MODE ==='), raw.indexOf('const last20 = sessionMessages.slice(-20);'));
  expect(summary).toContain('[summaryTenantId, summaryCallerTenantId], TEAM_HUB_CHAT_TOOL_NAMES, TEAM_HUB_POST_TOOL_NAME)');
  expect(summary).toContain('[summaryTenantId, summaryCallerTenantId], [PORTAL_REQUEST_SHARE_TOOL], PORTAL_REQUEST_SHARE_TOOL)');
  expect(summary).toContain('if (summaryTeamHubWithheld) {');
  expect(summary).toContain('memory_write_status: "not_attempted"');
});
