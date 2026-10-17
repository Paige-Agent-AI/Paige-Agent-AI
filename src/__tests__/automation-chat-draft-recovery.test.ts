// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { env } from 'node:process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { databaseAnswered, OUTCOME_UNKNOWN_NOTE } from '../../supabase/functions/_shared/approval-outcome';
import { interactiveEffect, interactiveReceiptContext } from '../../supabase/functions/_shared/paige-turn/interactive';
import { runEventActs, type EngineDb } from '../../supabase/functions/_shared/paige-orchestration/engine';
import { executeApprovedLayerCAct, type ApproveExecutorDb } from '../../supabase/functions/_shared/paige-orchestration/approve-executor';
import { nativeAdapter } from '../../supabase/functions/_shared/paige-orchestration/native-adapter';
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
        if (table === 'paige_automations' && fault === 'name-conflict') return { data: null, error: { code: '23505', message: 'duplicate' } };
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
  it('gives name-conflict recovery without changing approved arguments or retrying', async () => {
    const { state, result, recovery } = await drive('name-conflict');
    expect(result).toMatchObject({ success: false, not_applied: true, execution_started: false, reason: 'name_conflict' });
    expect(result.error).toMatch(/name.*already exists/i);
    expect(result.note).toMatch(/inspect.*existing|existing.*inspect/i);
    expect(result.note).toMatch(/new approval/i);
    expect(state.writes).toHaveLength(1); expect(state.processes).toHaveLength(0); expect(state.acts).toHaveLength(0);
    expect(recovery.needsReview).toBe(false);
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

// The SAME saved Chat process/acts enter the real engine and C5 executor. Only the
// database/CRM transport is synthetic here; the native SQL companion proof is separate.
async function ownerTask(fault = '') {
  const saved = await drive('', { name: 'Internal contact review', trigger_key: 'contact.created',
    steps: [fault === 'bare-tool' ? { tool_key: 'crm_create_task', config: { title: 'Review new contact' } }
      : { action_kind: 'owner.task', config: { title: 'Review new contact', description: 'Review the new CRM record.' } }] });
  let eventId = id(10);
  const actId = id(11), contact = id(12), approval = id(13), task = id(14), other = id(15);
  saved.state.processes[0].state = 'live'; // owner arming is outside this core proof
  saved.state.acts[0].id = actId;
  const tables: Record<string, Row[]> = { paige_automations: saved.state.processes, paige_automation_acts: saved.state.acts,
    paige_act_executions: [], paige_native_events: [{ id: eventId, tenant_id: tenant, event_key: 'contact.created',
      subject_table: 'clients', subject_id: contact, dedup_key: `contact.created:${contact}`, payload: { contact_id: contact } }],
    clients: [{ id: contact, tenant_id: tenant, updated_at: version }], paige_pending_approvals: [] };
  const calls: Array<{ fn: string; args: Row }> = [], effects: Row[] = [], results: Row[] = [];
  if (fault === 'native-sql') {
    nativeSql(`insert into paige_automations(id,tenant_id,name,trigger_key,created_by,granted_lane,state)
      values('${process}','${tenant}','Internal contact review','contact.created','${actor}','confirm','live');
      insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      values('${actId}','${process}',1,'owner.task','${JSON.stringify(saved.state.acts[0].config)}'::jsonb);
      insert into clients(id,tenant_id,first_name,last_name,account_number,source)
      values('${contact}','${tenant}','Synthetic','Engine native','engine-native','test');`);
    eventId = nativeSql(`select id from paige_native_events where subject_id='${contact}';`);
  }
  const sourceSnapshot = () => JSON.stringify({ process: { name: tables.paige_automations[0].name,
    conditions: tables.paige_automations[0].conditions, state: tables.paige_automations[0].state, granted_lane: tables.paige_automations[0].granted_lane },
    acts: tables.paige_automation_acts, event: tables.paige_native_events, contact: tables.clients });
  let revoked = false, lost = fault === 'lost-ack', readError = false;
  const db = { from(table: string) {
    const filters: Array<[string, unknown, string]> = [];
    const q = { select() { return q; }, eq(k: string, v: unknown) { filters.push([k, v, 'eq']); return q; },
      lte(k: string, v: unknown) { filters.push([k, v, 'lte']); return q; }, order() { return q; }, limit() { return q; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        if (fault === 'native-sql') {
          const where = filters.map(([k, v, op]) => k + (op === 'lte' ? '<=' : '=') + "'" + String(v).split("'").join("''") + "'").join(' and ') || 'true';
          const data = JSON.parse(nativeSql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text from public.${table} t where ${where};`));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: (tables[table] ?? []).filter(row => filters.every(([k, v, op]) =>
          op === 'lte' ? String(row[k]) <= String(v) : row[k] === v)), error: null }).then(resolve, reject);
      } }; return q;
  }, async rpc(fn: string, args: Row = {}) {
    calls.push({ fn, args });
    if (fault === 'native-sql' && ['resolve_automation_autonomy', 'paige_record_act_execution', 'paige_approve_act_execution',
      'paige_claim_act_dispatch', 'execute_owner_task_act', 'read_owner_task_act'].includes(fn)) {
      const value = (v: unknown) => v == null ? 'null' : typeof v === 'object'
        ? "'" + JSON.stringify(v).split("'").join("''") + "'::jsonb"
        : typeof v === 'boolean' || typeof v === 'number' ? String(v) : "'" + String(v).split("'").join("''") + "'";
      const named = Object.entries(args).map(([key, v]) => key + '=>' + value(v)).join(',');
      const output = nativeSql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';select to_jsonb(public.${fn}(${named}))::text;`);
      const data = output ? JSON.parse(output) : null;
      if (fn === 'execute_owner_task_act') { effects.push(args); if (data?.result) results.push(data.result); }
      return { data, error: null };
    }
    if (fn === 'resolve_automation_autonomy') return { data: { found: true, state: fault === 'paused' ? 'paused' : 'live', effective: 'confirm' }, error: null };
    if (fn === 'paige_record_act_execution') {
      let row = tables.paige_act_executions[0];
      if (!row) {
        row = { id: id(16), event_id: eventId, act_id: actId, automation_id: process, tenant_id: tenant,
          act_position: 1, created_at: new Date().toISOString(), capability_key: args._capability_key,
          effective_lane: args._effective_lane, idempotency_key: args._idempotency_key,
          correlation_ref: args._correlation_ref, outcome: args._outcome, detail: args._detail };
        row.detail = { ...(row.detail as Row), owner_task_source: sourceSnapshot() };
        tables.paige_act_executions.push(row);
        tables.paige_pending_approvals.push({ id: approval, tenant_id: tenant, source: 'paige_orchestration', status: 'pending',
          metadata: { event_id: eventId, act_id: actId, act_execution_id: row.id } });
      } else if (['accepted_for_execution', 'ambiguous', 'retrying'].includes(String(row.outcome))) {
        row.outcome = args._outcome; row.detail = { ...(row.detail as Row), ...(args._detail as Row) };
      }
      return { data: { ...row }, error: null };
    }
    if (fn === 'paige_approve_act_execution') {
      const row = tables.paige_act_executions[0];
      if (row.outcome === 'approval_pending') { row.outcome = 'accepted_for_execution';
        row.detail = { ...(row.detail as Row), approved_by: args._approver_user_id, approved_at: new Date().toISOString() }; }
      return { data: { ...row }, error: null };
    }
    if (fn === 'paige_claim_act_dispatch') return { data: { id: id(16) }, error: null };
    if (fn === 'execute_owner_task_act' || fn === 'read_owner_task_act') {
      const row = tables.paige_act_executions[0], detail = row.detail as Row;
      if (fault === 'native-sql') {
        const data = nativeSql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';
          select public.${fn}('${args._event_id}','${args._act_id}','${args._correlation}')::text;`);
        return { data: data ? JSON.parse(data) : null, error: null };
      }
      const failure = () => ({ data: { outcome: 'failed' }, error: null });
      if (!detail.owner_task_source || !detail.approved_by || !detail.approved_at) return failure();
      const nativeArgs = { _tenant_id: row.tenant_id, _actor_id: detail.approved_by, _idempotency_key: row.idempotency_key,
        _command: { action: 'task.create', approval_channel: 'operator_card', patch: detail.snapshot_args } };
      const prior = await db.rpc('read_crm_command_result', nativeArgs);
      if (prior.error) return { data: { state: 'unknown' }, error: null };
      if (prior.data) return { data: { state: 'found', result: prior.data, actor_id: detail.approved_by }, error: null };
      if (fn === 'read_owner_task_act') return { data: { state: 'absent' }, error: null };
      if (fault === 'changed-at-command') tables.paige_automations[0].state = 'paused';
      if (fault === 'context-locked') return { data: { outcome: 'accepted_for_execution', proven_no_effect: true }, error: null };
      const patch = detail.snapshot_args as Row;
      if (sourceSnapshot() !== detail.owner_task_source || tables.paige_automation_acts.length !== 1
        || tables.paige_native_events[0].event_key !== 'contact.created' || tables.clients[0].tenant_id !== tenant
        || Object.keys(patch).some(k => k !== 'title' && k !== 'description')) return failure();
      const response = await db.rpc('execute_crm_command', nativeArgs);
      return { data: response.error || !response.data ? { state: 'unknown' }
        : { state: 'found', result: response.data, actor_id: detail.approved_by }, error: null };
    }
    if (fn === 'execute_crm_command' || fn === 'read_crm_command_result') {
      if (fault === 'native-sql') {
        const command = JSON.stringify(args._command).split("'").join("''");
        const output = nativeSql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';
          select public.${fn}('${args._tenant_id}','${args._actor_id}','${command}'::jsonb,'${args._idempotency_key}')::text;`);
        const data = output ? JSON.parse(output) : null;
        if (fn === 'execute_crm_command') { effects.push(args); if (data) results.push(data); }
        return { data, error: null };
      }
      if (revoked || args._actor_id !== actor || args._tenant_id !== tenant) return { data: null, error: { code: '42501', message: 'CRM_FORBIDDEN' } };
      if (readError) return { data: null, error: { code: '', message: 'response lost' } };
      let value = results[0];
      if (fn === 'execute_crm_command' && !value) {
        const command = args._command as Row, patch = command.patch as Row;
        effects.push({ ...args }); value = { ok: true, action: 'task.create', outcome: 'succeeded', receipt_recorded: true,
          readback: { id: task, assignee_user_id: actor, title: patch.title, description: patch.description, status: 'pending', external_effect: false, notification_sent: false } };
        results.push(value);
        if (fault === 'empty-ack') return { data: null, error: null };
        if (fault === 'bad-receipt') value.receipt_recorded = false;
        if (lost) { lost = false; return { data: null, error: { code: '', message: 'lost after commit' } }; }
      }
      return { data: value ?? null, error: null };
    }
    return { data: null, error: null };
  } };
  const event = { event_id: eventId, event_key: 'contact.created', tenant_id: tenant, subject_table: 'clients', subject_id: contact, payload: { contact_id: contact } };
  const engine = await runEventActs(db as unknown as EngineDb, event, saved.state.processes as never);
  if (fault === 'native-sql') tables.paige_act_executions = JSON.parse(nativeSql(`select jsonb_agg(to_jsonb(x))::text from paige_act_executions x where event_id='${eventId}' and act_id='${actId}';`));
  const held = structuredClone(tables.paige_act_executions[0]);
  if (fault === 'foreign-subject') tables.clients[0].tenant_id = other;
  if (fault === 'foreign-event') tables.paige_native_events[0].tenant_id = other;
  if (fault === 'wrong-event') tables.paige_native_events[0].event_key = 'manual.run_now';
  if (fault === 'process-changed') tables.paige_automations[0].conditions = [{ field: 'source', op: 'eq', value: 'changed' }];
  if (fault === 'contact-changed') tables.clients[0].updated_at = '2099-01-01T00:00:00Z';
  if (fault === 'malformed') (tables.paige_act_executions[0].detail as Row).snapshot_args = { title: 'Review', expires_at: '2099-01-01' };
  if (fault === 'revoked') revoked = true;
  const approve = (who = actor, expectedTenant = tenant) => executeApprovedLayerCAct({ db: db as unknown as ApproveExecutorDb,
    eventId, actId, approverUserId: who, expectedTenantId: expectedTenant,
    resolveAvailability: async () => ({ ok: true, status: { availability: 'live' } }) as never });
  return { ...saved, tables, calls, effects, results, engine, held, approve, actor, other,
    revoke: () => { revoked = true; }, uncertainRead: () => { readError = true; },
    direct: () => nativeAdapter.dispatch!({ db, tenantId: tenant, actionKind: 'owner.task', args: { title: 'forged' },
      correlationRef: String(held.correlation_ref), subjectTable: 'clients', subjectId: contact, eventId, actId }) };
}

// Optional native port, using ONLY a separately prepared disposable localhost DB.
// The ordinary fixture remains provider/network free; no production URL is accepted.
function nativeSql(sql: string) {
  const value = env.OWNER_TASK_NATIVE_DB;
  if (!value) throw new Error('OWNER_TASK_NATIVE_DB is required');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/int336_test')) throw new Error('Isolated localhost test DB only');
  const run = spawnSync(env.PSQL_BIN ?? 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', value],
    { input: sql, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (run.status !== 0) throw new Error(run.stderr || 'Native SQL port failed');
  return run.stdout.trim();
}

describe('saved contact-created owner.task native core', () => {
  it.skipIf(!env.OWNER_TASK_NATIVE_DB)('carries the saved draft through actual engine/C5 and the real native CRM SQL writer', async () => {
    const f = await ownerTask('native-sql');
    expect((await f.approve()).executed).toBe(true);
    expect((await f.approve()).executed).toBe(true);
    expect(f.effects).toHaveLength(1);
    const result = f.results[0];
    expect(result).toMatchObject({ action: 'task.create', receipt_recorded: true,
      readback: { assignee_user_id: actor, title: 'Review new contact', external_effect: false, notification_sent: false } });
    expect(nativeSql(`select count(*) from public.tasks where tenant_id='${tenant}' and title='Review new contact';`)).toBe('1');
    expect(nativeSql(`select count(*) from public.crm_command_results where tenant_id='${tenant}' and idempotency_key='${f.held.idempotency_key}';`)).toBe('1');
  });
  it('holds the same saved draft, then writes one canonical task through the existing command port; replay writes zero', async () => {
    const f = await ownerTask();
    expect(f.result).toMatchObject({ state: 'draft', granted: 'confirm', execution_started: false });
    expect(f.held).toMatchObject({ capability_key: 'owner.task', outcome: 'approval_pending' });
    expect(f.effects).toHaveLength(0);
    expect(await f.approve()).toMatchObject({ executed: true, outcome: 'executed' });
    expect(await f.approve()).toMatchObject({ executed: true, reason: 'not_pending_approval' });
    expect(f.effects).toHaveLength(1);
    expect(f.effects[0]).toMatchObject({ _actor_id: actor, _tenant_id: tenant,
      _idempotency_key: f.held.idempotency_key, _command: { action: 'task.create', approval_channel: 'operator_card',
        patch: { title: 'Review new contact', description: 'Review the new CRM record.' } } });
    expect(f.calls.some(c => c.fn === 'record_rail_event')).toBe(true);
  });
  it('cannot dispatch without the protected native approval even with fabricated args', async () => {
    const f = await ownerTask(); expect((await f.direct()).outcome).not.toBe('executed'); expect(f.effects).toHaveLength(0);
  });
  it('refuses a process revoked at the native command boundary', async () => {
    const f = await ownerTask('changed-at-command');
    expect((await f.approve()).executed).toBe(false); expect(f.effects).toHaveLength(0);
  });
  it('retains proved pre-effect lock refusal as accepted and resumable, never unknown', async () => {
    const f = await ownerTask('context-locked'); expect((await f.approve()).outcome).toBe('accepted_for_execution');
    expect((await f.approve()).outcome).toBe('accepted_for_execution'); expect(f.effects).toHaveLength(0);
  });
  it('keeps historical bare tool drafts unsupported', async () => {
    const f = await ownerTask('bare-tool'); expect((await f.approve()).reason).toBe('not_supported_in_slice'); expect(f.effects).toHaveLength(0);
  });
  it.each(['foreign-subject', 'foreign-event', 'wrong-event', 'process-changed', 'contact-changed', 'malformed', 'revoked', 'paused'])('%s cannot produce a task', async fault => {
    const f = await ownerTask(fault); expect((await f.approve()).executed).toBe(false); expect(f.effects).toHaveLength(0);
  });
  it('rejects a foreign caller tenant before redemption or disclosure', async () => {
    const f = await ownerTask(); expect((await f.approve(actor, f.other)).reason).toBe('tenant_authorization_mismatch');
    expect(f.calls.some(c => c.fn === 'paige_approve_act_execution')).toBe(false); expect(f.effects).toHaveLength(0);
  });
  it('adopts a committed lost acknowledgement using the original actor even when another reviewer retries', async () => {
    const f = await ownerTask('lost-ack'); expect((await f.approve()).outcome).toBe('ambiguous');
    expect((await f.approve(f.other)).executed).toBe(true); expect(f.effects).toHaveLength(1);
    expect((f.tables.paige_act_executions[0].detail as Row).approved_by).toBe(actor);
    expect(f.calls.filter(c => c.fn === 'read_crm_command_result').every(c => c.args._actor_id === actor)).toBe(true);
  });
  it('does not treat an empty success response or missing native receipt as task completion', async () => {
    for (const fault of ['empty-ack', 'bad-receipt']) {
      const f = await ownerTask(fault);
      expect((await f.approve()).outcome).toBe('ambiguous'); expect(f.effects).toHaveLength(1);
      if (fault === 'empty-ack') expect((await f.approve(f.other)).executed).toBe(true);
      else expect((await f.approve(f.other)).executed).toBe(false);
      expect(f.effects).toHaveLength(1);
    }
  });
  it('does not authorize a new native actor or accept a missing original actor on resume', async () => {
    const f = await ownerTask(); expect((await f.approve(f.other)).executed).toBe(false); expect(f.effects).toHaveLength(0);
    const g = await ownerTask(); g.tables.paige_act_executions[0].outcome = 'accepted_for_execution';
    expect((await g.approve()).reason).toBe('native_approval_actor_missing'); expect(g.effects).toHaveLength(0);
  });
  it('uses only the held immutable args when the browser or a later live act attempts substitution', async () => {
    const f = await ownerTask(); f.tables.paige_automation_acts[0].config = { title: 'Substituted title' };
    expect((await f.approve()).executed).toBe(false); expect(f.effects).toHaveLength(0);
    const g = await ownerTask(); g.tables.paige_act_executions[0].outcome = 'accepted_for_execution';
    g.tables.paige_act_executions[0].detail = { ...(g.tables.paige_act_executions[0].detail as Row), approved_by: actor, approved_at: new Date().toISOString() };
    expect((await g.direct()).outcome).toBe('executed');
    expect(g.effects[0]).toMatchObject({ _command: { patch: { title: 'Review new contact' } } });
  });
  it('never substitutes a new reviewer for revoked original authority or replays an uncertain read', async () => {
    const f = await ownerTask('lost-ack'); await f.approve(); f.revoke();
    expect((await f.approve(f.other)).executed).toBe(false); expect(f.effects).toHaveLength(1);
    const g = await ownerTask(); const row = g.tables.paige_act_executions[0]; row.outcome = 'accepted_for_execution';
    row.detail = { ...(row.detail as Row), approved_by: actor, approved_at: new Date().toISOString() }; g.uncertainRead();
    expect((await g.approve(g.other)).executed).toBe(false); expect(g.effects).toHaveLength(0);
  });
});
