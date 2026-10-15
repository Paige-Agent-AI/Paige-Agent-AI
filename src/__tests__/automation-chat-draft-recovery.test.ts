// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { databaseAnswered, OUTCOME_UNKNOWN_NOTE } from '../../supabase/functions/_shared/approval-outcome';
import { interactiveEffect, interactiveReceiptContext } from '../../supabase/functions/_shared/paige-turn/interactive';
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Statement | undefined;
const named = new Map<string, ts.VariableDeclaration>();
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) named.set(n.name.text, n);
  if (ts.isIfStatement(n) && n.expression.getText(ast) === 'tc.function.name === "automation_draft"') branch = n.thenStatement;
  ts.forEachChild(n, visit);
}
visit(ast);
if (!branch) throw new Error('Canonical automation draft dispatch missing');
const code = ts.transpileModule(`async function dispatch(tc, supabaseClient, personaCtx, user, toolResults,
  databaseAnswered, OUTCOME_UNKNOWN_NOTE, requestExecutionState) ${branch.getText(ast)}`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dispatch = new Function(`${code}; return dispatch;`)();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), process = id(3), version = '2026-10-15T16:00:00.123456Z';
const input = { name: 'Fixture process', trigger_key: 'contact.created', steps: [{ action_kind: 'crm.advance_journey_stage', config: { stage: 'review', nested: { b: 2, a: 1 } } }] };
type Row = Record<string, unknown>;
async function drive(fault = '', args: object = input) {
  const state = { processes: [] as Row[], acts: [] as Row[], writes: [] as { table: string; op: string; filters: unknown[] }[], reads: [] as string[] };
  const recovery = { needsReview: false }, outputs: Array<{ content: string }> = [];
  let scopeReads = 0;
  const caller = { rpc: async (name: string) => name === 'current_user_tenant_id'
    ? { data: fault === 'wrong-scope' || fault === 'scope-after-create' && ++scopeReads > 2 ? id(99) : tenant, error: null }
    : fault === 'posture-throws' ? Promise.reject(new TypeError('response lost'))
    : fault === 'posture-unavailable' ? { data: null, error: { code: 'PGRST000' } } : { data: { effective: 'confirm', dark: [], can_fire: false }, error: null },
  from(table: string) {
    let op = 'read', value: unknown, columns = '', single = false;
    const filters: Array<[string, unknown]> = [];
    const execute = async () => {
      if (op !== 'read') state.writes.push({ table, op, filters }); else state.reads.push(table);
      if (table === 'paige_automation_triggers') return { data: { key: input.trigger_key, is_live: true, dark_reason: null }, error: null };
      const rows = table === 'paige_automations' ? state.processes : state.acts;
      if (op === 'insert') {
        if (table === 'paige_automations' && fault === 'create-refused') return { data: null, error: { code: '42501', message: 'denied' } };
        if (table === 'paige_automation_acts' && ['step-fail', 'cleanup-zero', 'concurrent-edit'].includes(fault)) {
          if (fault === 'concurrent-edit') state.processes[0].updated_at = '2026-10-15T16:01:00Z';
          return { data: null, error: { code: '23514', message: 'step refused' } };
        }
        rows.push(...(Array.isArray(value) ? value : [value]).map((v: Row) => ({ ...v, id: process, updated_at: version })));
        // The real acts trigger fingerprints the chain and updates its parent revision.
        if (table === 'paige_automation_acts') state.processes[0].updated_at = '2026-10-15T16:00:01Z';
        if (table === 'paige_automations' && fault === 'create-lost') return { data: null, error: { code: '', message: 'response lost' } };
        if (table === 'paige_automation_acts' && fault === 'steps-lost') return { data: null, error: { code: '', message: 'response lost' } };
      }
      const matches = rows.filter(row => filters.every(([k, v]) => row[k] === v));
      if (op === 'delete' && fault !== 'cleanup-zero') {
        state.processes = state.processes.filter(row => !matches.includes(row));
        state.acts = state.acts.filter(row => !matches.some(p => p.id === row.automation_id));
      }
      if (op === 'read' && table === 'paige_automation_acts' && fault === 'missing-steps') return { data: [], error: null };
      if (op === 'delete' && fault === 'cleanup-zero') return { data: [], error: null };
      const project = (row: Row) => !columns ? row : Object.fromEntries(columns.split(',').map(k => [k, row[k]]));
      return { data: single ? matches[0] ? project(matches[0]) : null : matches.map(project), error: null };
    };
    const q = { select(c: string) { columns = c; return q; }, insert(v: unknown) { value = v; op = 'insert'; return q; }, delete() { op = 'delete'; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; }, order() { return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; }, then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return execute().then(resolve, reject); } };
    return q;
  } };
  await dispatch({ id: 'draft-call', function: { name: 'automation_draft', arguments: JSON.stringify(args) } }, caller, { tenant_id: tenant }, { id: actor }, outputs,
    databaseAnswered, OUTCOME_UNKNOWN_NOTE, recovery);
  expect(outputs).toHaveLength(1);
  return { state, result: JSON.parse(outputs[0].content), recovery };
}
describe('automation draft exact configuration and recovery', () => {
  it('verifies the native process and ordered acts before claiming it was built', async () => {
    const { state, result } = await drive();
    expect(result).toMatchObject({ success: true, automation_id: process, state: 'draft', granted: 'confirm', verified_readback: true, execution_started: false });
    expect(state.reads).toContain('paige_automations'); expect(state.reads).toContain('paige_automation_acts');
    expect(state.processes[0]).toMatchObject({ tenant_id: tenant, created_by: actor, state: 'draft', granted_lane: 'confirm' });
  });
  it('never grants autonomy from model-supplied grant or state fields', async () => {
    const { state, result } = await drive('', { ...input, granted_lane: 'auto', state: 'live' });
    expect(result).toMatchObject({ success: true, execution_started: false, state: 'draft', granted: 'confirm' });
    expect(state.processes[0]).toMatchObject({ state: 'draft', granted_lane: 'confirm' });
  });
  it('rejects 21 steps before writing instead of silently truncating the approved process', async () => {
    const { state, result } = await drive('', { ...input, steps: Array.from({ length: 21 }, () => input.steps[0]) });
    expect(state.writes).toHaveLength(0); expect(result).toMatchObject({ success: false, not_applied: true });
  });
  it('refuses a changed workspace before creation', async () => {
    const { state, result } = await drive('wrong-scope');
    expect(state.writes).toHaveLength(0); expect(result).toMatchObject({ success: false, not_applied: true });
  });
  it('retains a committed process when its creation response is lost', async () => {
    const { state, result, recovery } = await drive('create-lost');
    expect(state.processes).toHaveLength(1); expect(result).toMatchObject({ success: false, outcome_unknown: true });
    expect(recovery.needsReview).toBe(true); expect(JSON.stringify(result)).not.toMatch(/different name|try again/i);
  });
  it('a zero-row cleanup acknowledgement does not prove the partial process was removed', async () => {
    const { state, result, recovery } = await drive('cleanup-zero');
    expect(state.processes).toHaveLength(1); expect(result).toMatchObject({ success: false, outcome_unknown: true, automation_id: process });
    expect(recovery.needsReview).toBe(true); expect(result.not_applied).not.toBe(true);
  });
  it('known step refusal may report non-application only after deleting the exact unchanged new draft', async () => {
    const { state, result } = await drive('step-fail');
    expect(state.processes).toHaveLength(0); expect(result).toMatchObject({ success: false, not_applied: true });
    expect(state.writes.find(w => w.op === 'delete')?.filters).toEqual(expect.arrayContaining([
      ['id', process], ['tenant_id', tenant], ['created_by', actor], ['state', 'draft'], ['granted_lane', 'confirm'], ['updated_at', version],
    ]));
  });
  it('never compensates away a process another legitimate request has changed', async () => {
    const { state, result } = await drive('concurrent-edit');
    expect(state.processes).toHaveLength(1); expect(result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('reconciles an acknowledged-lost steps write by exact readback without rewriting or deleting it', async () => {
    const { state, result } = await drive('steps-lost');
    expect(result).toMatchObject({ success: true, verified_readback: true });
    expect(state.writes.filter(w => w.table === 'paige_automation_acts' && w.op === 'insert')).toHaveLength(1);
    expect(state.writes.some(w => w.op === 'delete')).toBe(false);
  });
  it('does not claim a built process when the requested acts cannot be reopened', async () => {
    expect((await drive('missing-steps')).result).toMatchObject({ success: false, outcome_unknown: true });
  });
  it('does not invent readiness when the autonomy read fails', async () => {
    expect((await drive('posture-unavailable')).result).toMatchObject({ success: true, readiness: 'unverified', what_it_would_do: null, execution_started: false });
  });
  it('persists only the native process identity for uncertain recovery, with no replay authority', async () => {
    const { result } = await drive('missing-steps');
    const effect = interactiveEffect('automation_draft', result);
    expect(effect).toMatchObject({ outcome: 'outcome_unknown', record_refs: [{ kind: 'automation', id: process }] });
    expect(interactiveReceiptContext({ interactive: { effects: [effect] } })).toContain('Read back authoritative');
    const declarations = ['WRITE_TARGET', 'UUID', 'TARGET_ID_KEYS', 'resolveWriteTargetId'].map(name => {
      const node = named.get(name); if (!node) throw new Error(`Missing ${name}`); return `const ${node.getText(ast)};`;
    }).join('\n');
    const code = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const resolver = new Function(`${code}; return resolveWriteTargetId;`)();
    expect(resolver({ automation_id: id(99), contact_id: id(98) }, result, 'automation_draft')).toBe(process);
    expect(resolver({ automation_id: id(99), contact_id: id(98) }, {}, 'automation_draft')).toBeNull();
  });
  it('retains verified saved configuration when the read-only readiness response is lost', async () => {
    expect((await drive('posture-throws')).result).toMatchObject({ success: true, readiness: 'unverified', what_it_would_do: null, execution_started: false });
  });
  it('stops after creation when workspace authorization changes', async () => {
    const { state, result } = await drive('scope-after-create');
    expect(state.writes.filter(w => w.table === 'paige_automation_acts')).toHaveLength(0);
    expect(result).toMatchObject({ success: false, outcome_unknown: true, automation_id: process });
  });
  it('retains a native single-insert authorization refusal as non-application', async () => {
    const { state, result } = await drive('create-refused');
    expect(state.processes).toHaveLength(0); expect(result).toMatchObject({ success: false, not_applied: true });
  });
  it.each([
    { ...input, name: 'x'.repeat(121) }, { ...input, category: 'x'.repeat(41) },
    { ...input, steps: [] }, { ...input, tenant_id: id(99) },
    { ...input, steps: [{ ...input.steps[0], tool_key: 'crm_create_task' }] },
    { ...input, steps: [{ action_kind: 'crm.advance_journey_stage', config: [] }] },
    { ...input, steps: [{ config: {} }] },
  ])('rejects malformed or unapproved configuration before writing: %j', async args => {
    const { state, result } = await drive('', args);
    expect(state.writes).toHaveLength(0); expect(result).toMatchObject({ success: false, not_applied: true });
  });
});
