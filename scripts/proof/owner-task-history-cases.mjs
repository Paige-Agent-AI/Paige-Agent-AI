// Extension of the existing owned disposable PostgreSQL proof. No bootstrap,
// production URL, alternate store, executor or auth implementation.
import assert from 'node:assert/strict';
import { readOwnerTaskHistory } from '../../supabase/functions/_shared/paige-orchestration/owner-task-history.ts';
import { createOwnerTaskHistoryHandler } from '../../supabase/functions/_shared/paige-orchestration/owner-task-history-handler.ts';
import { readOwnerTaskHistoryList, readOwnerTaskOutcome } from '../../src/solo/data/ownerTaskAutomation.ts';

export async function proveOwnerTaskHistory(c) {
  const { sql, held, actor, tenant, other, human, check, literal } = c;
  const service = "set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
  const f = held(80000), approvalId = sql(`select id from paige_pending_approvals where metadata->>'act_execution_id'=${literal(f.row.id)};`);
  const request = { approvalId, tenantId: tenant }, reads = [];
  const json = statement => JSON.parse(sql(statement));
  const rpc = (prefix, name, args = {}) => {
    reads.push(name);
    const allowed = { current_user_tenant_id: [], can_read_owner_task_approval: ['_approval_id'],
      read_owner_task_act: ['_event_id', '_act_id', '_correlation'] };
    assert.ok(name in allowed, 'read-only native RPC allowlist'); assert.deepEqual(Object.keys(args), allowed[name]);
    return { data: json(prefix + `select to_jsonb(public.${name}(${Object.values(args).map(literal).join(',')}))::text;`), error: null };
  };
  const from = (prefix, table) => {
    assert.ok(['paige_approval_queue_v', 'paige_act_executions', 'paige_workspace_events'].includes(table));
    let columns = '', filters = [];
    const q = { select(value) { assert.match(value, /^[a-z_,]+$/); columns = value; return q; },
      eq(key, value) { assert.match(key, /^[a-z_]+$/); filters.push(`${key}=${typeof value === 'number' ? value : literal(value)}`); return q; },
      async maybeSingle() {
        reads.push(table);
        const rows = json(prefix + `select coalesce(jsonb_agg(to_jsonb(r)),'[]')::text from(select ${columns} from public.${table} where ${filters.join(' and ')})r;`);
        assert.ok(rows.length <= 1, 'exact unique row'); return { data: rows[0] ?? null, error: null };
      } };
    return q;
  };
  const clients = (viewer = actor) => ({
    caller: { auth: { getUser: async () => ({ data: { user: { id: viewer } }, error: null }) }, // Explicit Auth fixture port; SQL Auth state remains checked.
      rpc: async (name, args) => rpc(human(viewer), name, args), from: table => from(human(viewer), table) },
    service: { rpc: async (name, args) => rpc(service, name, args), from: table => from(service, table) },
  });
  let observed = await readOwnerTaskHistory(request, clients());
  check('history reader crosses actual caller-JWT RLS view and sealed companion predicate for a pending hold', () => {
    assert.equal(observed.status, 'ready'); assert.equal(observed.approvalStatus, 'pending'); assert.equal(observed.originalTask.state, 'unconfirmed');
    assert.ok(!reads.includes('read_owner_task_act'));
  });
  // Fixture drives the existing original native approve/claim/CRM bridge. No
  // HTTP or production approval is claimed by these selected-contract cases.
  sql(service + `select paige_approve_act_execution(${literal(f.event)},${literal(f.act)},${literal(actor)});
    select paige_claim_act_dispatch(${literal(f.event)},${literal(f.act)},gen_random_uuid(),interval '10 minutes',true);`);
  const landed = json(service + `select execute_owner_task_act(${literal(f.event)},${literal(f.act)},${literal(f.correlation)})::text;`);
  assert.equal(landed.state, 'found');
  assert.throws(() => sql(service + `update paige_pending_approvals set status='approved'where id=${literal(approvalId)};`), /ORCH_APPROVAL_LEDGER_NOT_RESOLVED/);
  check('native approval cannot claim completion before the original ledger settles', () => {
    assert.equal(sql(`select status from paige_pending_approvals where id=${literal(approvalId)};`), 'pending');
  });
  // Use the same canonical terminal recorder the engine calls, not a raw
  // fixture UPDATE or a second task execution. Held arguments stay immutable.
  sql(service + `select paige_record_act_execution(${literal(f.event)},${literal(f.process)},${literal(f.act)},1,${literal(tenant)},
    'native','owner.task','confirm','executed',null,${literal(f.correlation)},${literal(f.correlation)},null,'{}'::jsonb,null,now(),now());`);
  sql(service + `update paige_pending_approvals set status='approved',reviewed_at=clock_timestamp(),reviewed_by_user_id=${literal(actor)} where id=${literal(approvalId)};`);
  const before = sql("select jsonb_build_object('tasks',(select count(*)from tasks),'results',(select count(*)from crm_command_results),'rails',(select count(*)from paige_workspace_events),'approvals',(select jsonb_agg(to_jsonb(a)order by id)from paige_pending_approvals a),'acts',(select jsonb_agg(to_jsonb(l)order by id)from paige_act_executions l))::text;");
  observed = await readOwnerTaskHistory(request, clients());
  check('history returns the original native Task and exact private Rail receipt without a stored task locator', () => {
    assert.equal(observed.status, 'ready'); assert.equal(observed.originalTask.state, 'verified');
    assert.equal(observed.originalTask.taskId, landed.result.readback.id); assert.equal(observed.originalTask.runId, landed.result.correlation_id);
    assert.equal(observed.currentTask.state, 'not_read');
    assert.equal(json(`select detail from paige_act_executions where id=${literal(f.row.id)};`).approve?.task_id, undefined);
  });
  // Extend the same original-record proof through the actual client receiver and
  // HTTP handler. getUser and the client's membership projection are explicit
  // fixture ports; the native companion, queue RLS, result and Rail remain real.
  const scope = { actorId: actor, tenantId: tenant, epoch: 1 }, base = clients();
  const caller = { ...base.caller, from(table) {
    assert.ok(['tenant_members', 'paige_approval_queue_v'].includes(table));
    let columns = '', filters = [], orders = [], limit = 0, single = false;
    const q = { select(value) { assert.match(value, /^[a-z_,]+$/); columns = value; return q; },
      eq(key, value) { assert.ok(['tenant_id', 'user_id', 'source', 'category', 'metadata->>automation_id'].includes(key));
        filters.push(`${key === 'metadata->>automation_id' ? "metadata->>'automation_id'" : key}=${literal(value)}`); return q; },
      order(key, options) { assert.ok(['updated_at', 'id'].includes(key)); orders.push(`${key} ${options.ascending ? 'asc' : 'desc'}`); return q; },
      limit(value) { assert.equal(value, 26); limit = value; return q; }, maybeSingle() { single = true; return q; },
      async then(resolve, reject) { try {
        assert.ok(filters.length); const suffix = `${orders.length ? ` order by ${orders.join(',')}` : ''}${limit ? ` limit ${limit}` : ''}`;
        const prefix = table === 'tenant_members' ? '' : human(actor); // Explicit membership projection port.
        const rows = json(prefix + `select coalesce(jsonb_agg(to_jsonb(r)),'[]')::text from(select ${columns} from public.${table} where ${filters.join(' and ')}${suffix})r;`);
        resolve({ data: single ? rows[0] ?? null : rows, error: null });
      } catch (error) { reject(error); } } };
    return q;
  } };
  const history = await readOwnerTaskHistoryList(scope, f.process, caller, () => scope);
  check('client locates a settled original native approval through actual queue RLS with process and tenant filters', () => {
    assert.equal(history.status, 'ready'); assert.equal(history.items.length, 1);
    assert.equal(history.items[0].approvalId, approvalId); assert.equal(history.items[0].occurrenceId, f.row.id);
    assert.equal(history.items[0].approvalStatus, 'approved'); assert.equal(history.hasMore, false);
  });
  let httpReads = 0;
  const handler = createOwnerTaskHistoryHandler({ caller: authorization => { assert.equal(authorization, 'Bearer protected-fixture'); return base.caller; }, service: () => base.service });
  const viaHttp = await readOwnerTaskOutcome(scope, { processId: f.process, approvalId, occurrenceId: f.row.id }, caller, {
    async invoke(name, options) {
      assert.equal(name, 'paige-owner-task-history'); assert.equal(options.method, 'POST'); httpReads++;
      const response = await handler(new Request('https://unit-test.invalid/paige-owner-task-history', { method: 'POST',
        headers: { Authorization: 'Bearer protected-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }));
      return { data: await response.json(), error: response.ok ? null : true };
    },
  }, () => scope);
  check('actual client and HTTP handler preserve the original native Task and receipt without an effect or retry', () => {
    assert.equal(httpReads, 1); assert.deepEqual(viaHttp, observed);
    assert.equal(viaHttp.originalTask.taskId, landed.result.readback.id);
  });
  await readOwnerTaskHistory(request, clients());
  const after = sql("select jsonb_build_object('tasks',(select count(*)from tasks),'results',(select count(*)from crm_command_results),'rails',(select count(*)from paige_workspace_events),'approvals',(select jsonb_agg(to_jsonb(a)order by id)from paige_pending_approvals a),'acts',(select jsonb_agg(to_jsonb(l)order by id)from paige_act_executions l))::text;");
  check('repeated native history reads change zero tasks, results, Rail, approval or ledger rows', () => assert.equal(after, before));
  sql(`update paige_automations set state='paused' where id=${literal(f.process)};`);
  observed = await readOwnerTaskHistory(request, clients());
  check('pausing future process work does not hide its original verified result', () => assert.equal(observed.originalTask.state, 'verified'));
  sql(`update tenant_members set role='member'where tenant_id=${literal(tenant)}and user_id=${literal(other)};`);
  observed = await readOwnerTaskHistory(request, clients(other));
  check('actual native companion refuses a member without exposing private result or receipt', () => assert.deepEqual(observed, { status: 'refused' }));
  sql(`update tenant_members set role='admin'where tenant_id=${literal(tenant)}and user_id=${literal(other)};`);
  observed = await readOwnerTaskHistory(request, clients(other));
  check('later authorized native admin can inspect original actor result without replacing that actor', () => {
    assert.equal(observed.status, 'ready'); assert.equal(observed.originalTask.taskId, landed.result.readback.id);
  });
  observed = await readOwnerTaskHistory({ ...request, tenantId: other }, clients());
  check('foreign requested tenant is refusal-only, never a service lookup scope', () => assert.deepEqual(observed, { status: 'refused' }));
  sql(`update tenant_members set status='inactive'where tenant_id=${literal(tenant)}and user_id=${literal(actor)};`);
  try {
    observed = await readOwnerTaskHistory(request, clients(other));
    check('revoked original actor keeps a later admin observation unconfirmed rather than impersonating a new actor', () => {
      assert.equal(observed.status, 'ready'); assert.equal(observed.originalTask.state, 'unconfirmed');
    });
  } finally { sql(`update tenant_members set status='active'where tenant_id=${literal(tenant)}and user_id=${literal(actor)};`); }
}
