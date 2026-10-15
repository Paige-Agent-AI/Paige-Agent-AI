import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { databaseAnswered, OUTCOME_UNKNOWN_NOTE, classifySpentApproval } from '../../supabase/functions/_shared/approval-outcome';
import { interactiveEffect } from '../../supabase/functions/_shared/paige-turn/interactive';

// Execute the incumbent dispatch AST. No copied executor, hosted account or provider.
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Statement | undefined;
const named = new Map<string, ts.VariableDeclaration>();
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast).includes('tc.function.name === "plan_set_reminder"')
    && node.expression.getText(ast).includes('tc.function.name === "plan_list"')) branch = node.thenStatement;
  if (ts.isVariableDeclaration(node)) named.set(node.name.getText(ast), node);
  ts.forEachChild(node, visit);
}
visit(ast);
if (!branch) throw new Error('Canonical Planning dispatch missing');
const compiled = ts.transpileModule(`async function dispatch(tc, personaCtx, supabaseClient, toolResults,
  databaseAnswered, OUTCOME_UNKNOWN_NOTE, user, recordCapabilityRun, supabase, planningExecutionState) ${branch.getText(ast)}`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const dispatch = new Function(`${compiled}; return dispatch;`)();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), item = id(3), plan = id(4);
const args = { title: 'Fixture reminder', remind_at: '2026-10-16T13:00:00Z' };
const saved = { id: item, tenant_id: tenant, item_type: 'reminder', title: args.title,
  remind_at: '2026-10-16T13:00:00+00:00', remind_target: 'user', remind_channel: 'in_app',
  assigned_to_user_id: actor, created_by: actor, summary: null, plan_id: null, contact_id: null,
  updated_at: '2026-10-15T15:00:00Z', status: 'open' };
async function drive(options: { tool?: string; args?: object; reply?: unknown; thrown?: unknown;
  readback?: unknown; readError?: unknown; resolvedTenant?: string; resolvedTenants?: string[] } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [], reads: Array<{ table: string; filters: unknown[] }> = [];
  const outputs: Array<{ content: string }> = [], receipts: unknown[] = [];
  let scopeRead = 0;
  const executionState = { needsReview: false };
  const caller = { rpc: async (name: string, rpcArgs: unknown) => {
    calls.push({ name, args: rpcArgs });
    if (name === 'current_user_tenant_id') return { data: options.resolvedTenants?.[scopeRead++] ?? options.resolvedTenant ?? tenant, error: null };
    if ('thrown' in options) throw options.thrown;
    return options.reply ?? { data: { ok: true, item_id: item, item_type: 'reminder' }, error: null };
  }, from(table: string) {
    const read = { table, filters: [] as unknown[] }; reads.push(read);
    const query = { select: () => query, eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: 'readback' in options ? options.readback : saved, error: options.readError ?? null }) };
    return query;
  } };
  await dispatch({ id: 'planning-call', function: { name: options.tool ?? 'plan_set_reminder',
    arguments: JSON.stringify(options.args ?? args) } }, { tenant_id: tenant }, caller, outputs,
  databaseAnswered, OUTCOME_UNKNOWN_NOTE, { id: actor }, async (_client: unknown, receipt: unknown) => { receipts.push(receipt); }, {}, executionState);
  expect(outputs).toHaveLength(1);
  return { result: JSON.parse(outputs[0].content), calls, reads, receipts, executionState };
}
describe('canonical Planning Chat execution and recovery', () => {
  it('retains lost-write uncertainty for model, approval and persisted interactive recovery', async () => {
    const { result, calls } = await drive({ thrown: new TypeError('Failed to fetch') });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(result.note).not.toMatch(/did not happen|try again/i);
    expect(classifySpentApproval(JSON.stringify(result)).outcome).toBe('unconfirmed');
    expect(interactiveEffect('plan_set_reminder', result)?.outcome).toBe('outcome_unknown');
    expect(calls.filter(c => c.name === 'plan_set_reminder')).toHaveLength(1);
  });
  it('a wrapped network error is not a database refusal', async () => {
    const { result } = await drive({ reply: { data: null, error: { message: 'FetchError: connection lost', code: '' } } });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(result.not_applied).not.toBe(true);
  });
  it('a single-RPC SQL refusal proves non-application and remains permission denied', async () => {
    const { result, reads } = await drive({ reply: { data: null, error: { code: '42501', message: 'PLAN_FORBIDDEN' } } });
    expect(result).toMatchObject({ success: false, not_applied: true });
    expect(result.outcome_unknown).not.toBe(true);
    expect(classifySpentApproval(JSON.stringify(result)).outcome).toBe('not_run');
    expect(reads).toHaveLength(0);
  });
  it.each([null, {}, { ok: false }, { ok: true, item_id: 'bad-id' }])('requires a usable writer acknowledgement: %j', async data => {
    const { result } = await drive({ reply: { data, error: null } });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('verifies the actual caller-scoped reminder record and does not promise delivery', async () => {
    const { result, reads } = await drive();
    expect(result).toMatchObject({ success: true, item_id: item, record_locator: { table: 'plan_items', id: item } });
    expect(reads).toEqual([{ table: 'plan_items', filters: [['tenant_id', tenant], ['id', item]] }]);
    expect(result.note).not.toMatch(/will ping|will.*email|locked in/i);
  });
  it.each([null, { ...saved, tenant_id: id(99) }, { ...saved, title: 'Different reminder' },
    { ...saved, remind_at: '2026-10-16T14:00:00Z' }, { ...saved, assigned_to_user_id: id(99) }])
  ('does not turn missing or mismatched record evidence into success', async readback => {
    const { result } = await drive({ readback });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(result.not_applied).not.toBe(true);
  });
  it('a readback failure after the write remains unknown', async () => {
    const { result } = await drive({ readError: { code: '42501' } });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(result.not_applied).not.toBe(true);
  });
  it('refuses a changed caller workspace before the writer', async () => {
    const { result, calls } = await drive({ resolvedTenant: id(99) });
    expect(result).toMatchObject({ success: false, not_applied: true });
    expect(calls.some(c => c.name === 'plan_set_reminder')).toBe(false);
  });
  it('keeps plan_list read failures separate from uncertain writes', async () => {
    const { result } = await drive({ tool: 'plan_list', args: {}, thrown: new TypeError('Failed to fetch') });
    expect(result.success).toBe(false);
    expect(result.outcome_unknown).not.toBe(true);
  });
  it('records the reminder identity in the existing closed interactive receipt', async () => {
    const { result } = await drive();
    expect(interactiveEffect('plan_set_reminder', result)?.record_refs).toContainEqual({ kind: 'plan_item', id: item });
  });
  it.each([
    ['plan_create', { title: 'Fixture project', horizon: 'week', starts_on: '2026-10-16', ends_on: '2026-10-22', campaign_ref: { label: 'Fixture', kind: 'campaign', id: plan } },
      { ok: true, plan_id: plan }, { id: plan, title: 'Fixture project', summary: null, created_by: actor,
        horizon: 'week', starts_on: '2026-10-16', ends_on: '2026-10-22', scope: 'individual', owner_user_id: actor,
        campaign_ref: { id: plan, kind: 'campaign', label: 'Fixture' }, status: 'active' }, 'plans'],
    ['plan_add_milestone', { title: 'Fixture milestone', plan_id: plan, assigned_to_user_id: actor },
      { ok: true, item_id: item }, { id: item, title: 'Fixture milestone', summary: null, created_by: actor,
        item_type: 'milestone', assigned_to_user_id: actor, priority: 'normal', plan_id: plan, due_at: null, status: 'open' }, 'plan_items'],
    ['plan_assign_task', { title: 'Fixture task', plan_id: plan, assigned_to_user_id: actor },
      { ok: true, item_id: item, action_id: id(50) }, { id: item, title: 'Fixture task', summary: null, created_by: actor,
        item_type: 'task', assigned_to_user_id: actor, priority: 'normal', plan_id: plan, due_at: null,
        parent_item_id: null, contact_id: null, campaign_ref: null, status: 'open' }, 'plan_items'],
    ['plan_update_item', { item_id: item, status: 'done', priority: 'high', due_at: '2026-10-16T13:00:00.123456Z' },
      { ok: true, item_id: item }, { id: item, status: 'done', priority: 'high', due_at: '2026-10-16T13:00:00.123456+00:00' }, 'plan_items'],
    ['plan_remove_item', { item_id: item }, { ok: true, item_id: item }, { id: item, status: 'cancelled' }, 'plan_items'],
  ] as const)('verifies %s through its incumbent RPC and canonical record', async (tool, toolArgs, ack, row, table) => {
    const { result, calls, reads } = await drive({ tool, args: toolArgs, reply: { data: ack, error: null },
      readback: { ...row, tenant_id: tenant, updated_at: '2026-10-15T15:00:00Z' } });
    expect(result.success).toBe(true);
    expect(result.record_locator).toEqual({ table, id: row.id });
    expect(calls.filter(c => c.name === tool)).toHaveLength(1);
    expect(reads).toEqual([{ table, filters: [['tenant_id', tenant], ['id', row.id]] }]);
  });
  it('preserves PostgreSQL microseconds instead of accepting a merely millisecond-equal time', async () => {
    const { result } = await drive({ args: { ...args, remind_at: '2026-10-16T13:00:00.123456Z' },
      readback: { ...saved, remind_at: '2026-10-16T13:00:00.123457Z' } });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('holds subsequent writes after missing evidence, but not after an answered refusal', async () => {
    expect(source).toContain('MUTATING_TOOLS.has(tc.function.name) && (planningExecutionState.needsReview || interactive &&');
    const uncertain = await drive({ readback: null });
    expect(uncertain.result.outcome_unknown).toBe(true);
    expect(uncertain.executionState.needsReview).toBe(true);
    const refused = await drive({ reply: { data: null, error: { code: '42501', message: 'PLAN_FORBIDDEN' } } });
    expect(refused.result.not_applied).toBe(true);
    expect(refused.executionState.needsReview).toBe(false);
  });
  it('withholds success if the active workspace changes after the write', async () => {
    const { result } = await drive({ resolvedTenants: [tenant, id(99)] });
    expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('attributes Planning items to the verified item, never their parent, contact or linked action', () => {
    const declarations = ['WRITE_TARGET', 'UUID', 'TARGET_ID_KEYS', 'resolveWriteTargetId'].map(name => {
      const node = named.get(name); if (!node) throw new Error(`Missing ${name}`); return `const ${node.getText(ast)};`;
    }).join('\n');
    const code = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const resolver = new Function(`${code}; return { resolveWriteTargetId, WRITE_TARGET };`)();
    for (const tool of ['plan_set_reminder', 'plan_assign_task', 'plan_add_milestone', 'plan_update_item', 'plan_remove_item']) {
      expect(resolver.WRITE_TARGET[tool]).toBe('plan_items');
      expect(resolver.resolveWriteTargetId({ plan_id: plan, contact_id: id(20) }, {
        action_id: id(30), plan_id: plan, item_id: item, verified_readback: true,
        readback: { plan_id: plan }, record_locator: { table: 'plan_items', id: item },
      }, tool)).toBe(item);
      expect(resolver.resolveWriteTargetId({ plan_id: plan }, { outcome_unknown: true }, tool)).toBeNull();
    }
    expect(resolver.resolveWriteTargetId({ item_id: item }, { outcome_unknown: true }, 'plan_update_item')).toBe(item);
    expect(resolver.resolveWriteTargetId({}, { contact_id: item }, 'crm_create_contact')).toBe(item);
  });
});
